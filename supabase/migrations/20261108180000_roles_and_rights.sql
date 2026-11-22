/*
# Users, roles and rights

Hierarchy (higher includes everything below it):
  Owner   (role = 'admin')   everything: users, settings, rates, fee rules, audit log, restore backup
  Manager (role = 'manager') all business data including deleting records, reports, backup download. No users, settings or rates
  Staff   (role = 'staff')   daily work: calculator, quotations, clients, transfers, cases, tasks, inventory, record payments.
                             Cannot delete records, edit or delete a payment once recorded, or see reports.

New accounts are NOT active. Anyone who signs up (or is added in Supabase > Authentication) waits for the owner to approve them
in the app under "Users & Rights". The very first account in an empty system becomes the Owner automatically.
Rights are enforced here in the database (row level security), not only on screen.

Safe to run more than once. Works on a fresh database and on one that already holds data.
*/

-- 1) profiles: plain-text role (also converts an old enum), active flag, email ------------------------------------------
DO $$
DECLARE r record;
BEGIN
  -- all policies are rebuilt below; dropping them first lets the role column type change
  FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY (ARRAY[
    'profiles','fee_rules','fee_rule_revisions','audit_logs','clients','vehicles','quotations','quotation_line_items','payments','client_payments',
    'punjab_rate_sets','ict_rate_sets','app_settings','hpa_counts','cases','tasks','inventory_items','transfers'])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;

  IF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='role') <> 'text' THEN
    ALTER TABLE public.profiles ALTER COLUMN role DROP DEFAULT;
    ALTER TABLE public.profiles ALTER COLUMN role TYPE text USING role::text;
  END IF;

  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass AND contype = 'c' LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'staff';
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin','manager','staff'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;   -- existing users stay active
ALTER TABLE public.profiles ALTER COLUMN active SET DEFAULT false;                          -- new accounts wait for approval
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;
UPDATE public.profiles p SET email = u.email FROM auth.users u WHERE u.id = p.id AND p.email IS NULL;

-- make sure somebody is the owner (the first registered user) if no admin exists yet
UPDATE public.profiles SET role = 'admin', active = true
WHERE NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin' AND active)
  AND id = (SELECT id FROM public.profiles ORDER BY created_at LIMIT 1);

-- 2) helper: rank of the signed-in user (0 = not active / unknown) ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_rank() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT CASE p.role WHEN 'admin' THEN 3 WHEN 'manager' THEN 2 WHEN 'staff' THEN 1 ELSE 0 END
                   FROM public.profiles p WHERE p.id = auth.uid() AND p.active), 0)
$$;
REVOKE ALL ON FUNCTION public.app_rank() FROM public;
GRANT EXECUTE ON FUNCTION public.app_rank() TO authenticated;

-- 3) new accounts: first one is the owner, everyone else waits for approval --------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE first_one boolean;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin') INTO first_one;
  INSERT INTO public.profiles (id, full_name, role, active, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), CASE WHEN first_one THEN 'admin' ELSE 'staff' END, first_one, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4) the owner changes a person's role / access through this function only -------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_user_access(target uuid, new_role text, new_active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE old_row public.profiles;
BEGIN
  IF public.app_rank() < 3 THEN RAISE EXCEPTION 'Only the owner can change user access.'; END IF;
  IF new_role NOT IN ('admin','manager','staff') THEN RAISE EXCEPTION 'Unknown role.'; END IF;
  IF target = auth.uid() AND (new_role <> 'admin' OR NOT new_active) THEN
    RAISE EXCEPTION 'You cannot remove your own owner access. Make someone else an owner first.';
  END IF;
  SELECT * INTO old_row FROM public.profiles WHERE id = target;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found.'; END IF;
  UPDATE public.profiles SET role = new_role, active = new_active WHERE id = target;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'user_access_changed', 'user', target,
          jsonb_build_object('email', old_row.email, 'name', old_row.full_name, 'from_role', old_row.role, 'to_role', new_role, 'was_active', old_row.active, 'now_active', new_active));
END $$;
REVOKE ALL ON FUNCTION public.set_user_access(uuid, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.set_user_access(uuid, text, boolean) TO authenticated;

-- 5) rights per table -----------------------------------------------------------------------------------------------------
GRANT SELECT, UPDATE (full_name) ON public.profiles TO authenticated;
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.app_rank() >= 1);
CREATE POLICY "profiles_update_own_name" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DO $$
DECLARE t text;
BEGIN
  -- daily business data: staff read, add and change; managers also delete
  FOREACH t IN ARRAY ARRAY['clients','vehicles','quotations','quotation_line_items','hpa_counts','cases','tasks','inventory_items','transfers'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.app_rank() >= 1)', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.app_rank() >= 1)', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.app_rank() >= 1) WITH CHECK (public.app_rank() >= 1)', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.app_rank() >= 2)', t || '_delete', t);
  END LOOP;
  -- money: staff record payments, only managers and the owner correct or delete them
  FOREACH t IN ARRAY ARRAY['payments','client_payments'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.app_rank() >= 1)', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.app_rank() >= 1)', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.app_rank() >= 2) WITH CHECK (public.app_rank() >= 2)', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.app_rank() >= 2)', t || '_delete', t);
  END LOOP;
  -- fee rules and rate sets: everyone working can read them (the calculator needs them), only the owner changes them
  FOREACH t IN ARRAY ARRAY['fee_rules','punjab_rate_sets','ict_rate_sets'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.app_rank() >= 1)', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.app_rank() >= 3)', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.app_rank() >= 3) WITH CHECK (public.app_rank() >= 3)', t || '_update', t);
    IF t = 'fee_rules' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.app_rank() >= 3)', t || '_delete', t);
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (status = ''draft'' AND public.app_rank() >= 3)', t || '_delete', t);  -- history is kept: only drafts can go
    END IF;
  END LOOP;
END $$;

-- settings and branding: signed-in users read (the login screen shows the logo), the owner changes
GRANT SELECT, INSERT, UPDATE ON public.app_settings TO authenticated;
CREATE POLICY "app_settings_select" ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "app_settings_insert" ON public.app_settings FOR INSERT TO authenticated WITH CHECK (public.app_rank() >= 3);
CREATE POLICY "app_settings_update" ON public.app_settings FOR UPDATE TO authenticated USING (public.app_rank() >= 3) WITH CHECK (public.app_rank() >= 3);

-- audit trail: everyone working adds entries, only the owner reads, nobody edits or deletes
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
CREATE POLICY "audit_logs_select" ON public.audit_logs FOR SELECT TO authenticated USING (public.app_rank() >= 3);
CREATE POLICY "audit_logs_insert" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (public.app_rank() >= 1);
CREATE POLICY "fee_rule_revisions_select" ON public.fee_rule_revisions FOR SELECT TO authenticated USING (public.app_rank() >= 3);

/*
IF YOU EVER LOSE OWNER ACCESS (run in the Supabase SQL Editor, put your own email):
  UPDATE public.profiles SET role = 'admin', active = true WHERE email = 'you@example.com';
*/
