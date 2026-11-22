-- M14: owner can reset a user's password (through the admin-set-password Edge Function). The user must choose their own new password at the next sign-in.
-- Idempotent. Nothing here lets a normal user touch the flag: only the Edge Function (service role) can set it, and it is cleared only after the password really changed.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- Private table: the fingerprint of the temporary password. No signed-in user can read or write it.
CREATE TABLE IF NOT EXISTS public.password_resets (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  temp_hash text,
  reset_by uuid,
  reset_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_resets FROM PUBLIC, anon, authenticated;

-- Called by the Edge Function ONLY (service role) right after it set the temporary password.
CREATE OR REPLACE FUNCTION public.lb_mark_password_reset(p_target uuid, p_by uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  UPDATE public.profiles SET must_change_password = true WHERE id = p_target;
  INSERT INTO public.password_resets (user_id, temp_hash, reset_by, reset_at)
  VALUES (p_target, (SELECT u.encrypted_password FROM auth.users u WHERE u.id = p_target), p_by, now())
  ON CONFLICT (user_id) DO UPDATE SET temp_hash = EXCLUDED.temp_hash, reset_by = EXCLUDED.reset_by, reset_at = now();
END $$;
REVOKE EXECUTE ON FUNCTION public.lb_mark_password_reset(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lb_mark_password_reset(uuid, uuid) TO service_role;

-- Called by the signed-in user after choosing a new password. Works only if the stored password really is different from the temporary one.
CREATE OR REPLACE FUNCTION public.clear_must_change_password() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE cur text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT u.encrypted_password INTO cur FROM auth.users u WHERE u.id = auth.uid();
  IF NOT EXISTS (SELECT 1 FROM public.password_resets r WHERE r.user_id = auth.uid() AND r.temp_hash IS NOT DISTINCT FROM cur) THEN
    UPDATE public.profiles SET must_change_password = false WHERE id = auth.uid();
    DELETE FROM public.password_resets WHERE user_id = auth.uid();
  END IF;
  RETURN NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.must_change_password);
END $$;
REVOKE EXECUTE ON FUNCTION public.clear_must_change_password() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_must_change_password() TO authenticated;

-- belt and braces: the profiles guard also keeps the flag away from users
CREATE OR REPLACE FUNCTION public.profiles_protect_trg() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'Profiles are created by the system only.' USING ERRCODE = '42501'; END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.role IS DISTINCT FROM OLD.role OR NEW.active IS DISTINCT FROM OLD.active OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.must_change_password IS DISTINCT FROM OLD.must_change_password THEN
      RAISE EXCEPTION 'Role, access, e-mail and password rules can only be changed by the owner.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
REVOKE EXECUTE ON FUNCTION public.profiles_protect_trg() FROM PUBLIC, anon, authenticated;

-- =====================================================================================================================================
-- M14 part 2: staff must not be able to see how much money the business received.
-- Until now every signed-in person could read ALL payments (Receipts page total, or a direct API call). Now:
--   Owner / Manager : everything (unchanged)
--   Staff           : only the payments of THEIR OWN customers (assigned to them or created by them) and payments they entered themselves
-- Expenses, profit, reports and the money part of the dashboard were already closed to staff.
-- =====================================================================================================================================
DROP POLICY IF EXISTS payments_select ON public.payments;
CREATE POLICY payments_select ON public.payments FOR SELECT TO authenticated USING (
  (SELECT public.app_rank()) >= 2
  OR (
    (SELECT public.app_rank()) = 1
    AND (
      created_by = (SELECT auth.uid())
      OR quotation_id IN (SELECT q.id FROM public.quotations q
                           WHERE q.created_by = (SELECT auth.uid())
                              OR q.client_id IN (SELECT c.id FROM public.clients c WHERE c.assigned_to = (SELECT auth.uid()) OR c.created_by = (SELECT auth.uid())))
    )
  )
);

DROP POLICY IF EXISTS client_payments_select ON public.client_payments;
CREATE POLICY client_payments_select ON public.client_payments FOR SELECT TO authenticated USING (
  (SELECT public.app_rank()) >= 2
  OR (
    (SELECT public.app_rank()) = 1
    AND (
      created_by = (SELECT auth.uid())
      OR client_id IN (SELECT c.id FROM public.clients c WHERE c.assigned_to = (SELECT auth.uid()) OR c.created_by = (SELECT auth.uid()))
    )
  )
);

DROP POLICY IF EXISTS alloc_select ON public.payment_allocations;
CREATE POLICY alloc_select ON public.payment_allocations FOR SELECT TO authenticated USING (
  (SELECT public.app_rank()) >= 2
  OR (
    (SELECT public.app_rank()) = 1
    AND (
      created_by = (SELECT auth.uid())
      OR client_payment_id IN (SELECT cp.id FROM public.client_payments cp)   -- already limited by client_payments_select
    )
  )
);
