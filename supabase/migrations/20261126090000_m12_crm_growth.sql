-- M12: CRM growth pack. Additive and safe to run more than once. Changes no existing data.
--   1. Leads (inquiries) with follow-up dates and a call / WhatsApp / visit log (also usable on clients)
--   2. Expenses (manager and owner only), voided instead of deleted, with a profit summary
--   3. Client documents: metadata table + PRIVATE storage bucket (CNIC, registration book, challan ...)
--   4. Vehicle renewal dates (token tax, registration) for reminders
--   5. Message templates (WhatsApp) the owner can edit
--   6. crm_kpis() / expense_summary() for the dashboard and reports; convert_lead_to_client()
-- Security by design: row-level security on every table, rights by role (Staff = 1, Manager = 2, Owner = 3), nothing for signed-out visitors,
-- created_by can never be forged, money / document changes are written to the audit log by the database itself.

-- 1) Vehicle renewal dates ---------------------------------------------------------------------------------------------------------
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS token_tax_due date;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS registration_due date;
CREATE INDEX IF NOT EXISTS idx_vehicles_token_tax_due ON public.vehicles (token_tax_due) WHERE token_tax_due IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehicles_registration_due ON public.vehicles (registration_due) WHERE registration_due IS NOT NULL;

-- 2) Leads -------------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0 AND length(name) <= 120),
  phone text CHECK (phone IS NULL OR length(phone) <= 40),
  source text NOT NULL DEFAULT 'other' CHECK (source IN ('walk_in', 'phone', 'whatsapp', 'showroom', 'reference', 'website', 'social', 'other')),
  interest text CHECK (interest IS NULL OR length(interest) <= 200),
  vehicle_info text CHECK (vehicle_info IS NULL OR length(vehicle_info) <= 200),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'quoted', 'won', 'lost')),
  next_follow_up date,
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  lost_reason text CHECK (lost_reason IS NULL OR length(lost_reason) <= 300),
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leads_lost_needs_reason CHECK (status <> 'lost' OR length(btrim(coalesce(lost_reason, ''))) > 0)
);
CREATE INDEX IF NOT EXISTS idx_leads_status_followup ON public.leads (status, next_follow_up);
CREATE INDEX IF NOT EXISTS idx_leads_client ON public.leads (client_id);

CREATE TABLE IF NOT EXISTS public.crm_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'note' CHECK (kind IN ('call', 'whatsapp', 'visit', 'email', 'note')),
  note text NOT NULL CHECK (length(btrim(note)) > 0 AND length(note) <= 2000),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_activities_one_parent CHECK ((lead_id IS NOT NULL)::int + (client_id IS NOT NULL)::int = 1)
);
CREATE INDEX IF NOT EXISTS idx_crm_activities_lead ON public.crm_activities (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_activities_client ON public.crm_activities (client_id, created_at DESC);

-- 3) Expenses ----------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date date NOT NULL DEFAULT public.lb_today(),
  category text NOT NULL CHECK (category IN ('rent', 'utilities', 'internet_phone', 'salary', 'agent_payment', 'government_fee_paid', 'transport_fuel', 'stationery_printing', 'marketing', 'repair_maintenance', 'tax_fee', 'other')),
  amount numeric(14, 2) NOT NULL CHECK (amount > 0 AND amount < 100000000),
  paid_from text NOT NULL DEFAULT 'cash' CHECK (paid_from IN ('cash', 'bank', 'mobile_wallet', 'other')),
  description text CHECK (description IS NULL OR length(description) <= 500),
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text CHECK (void_reason IS NULL OR length(void_reason) <= 300),
  CONSTRAINT expenses_void_pair CHECK ((voided_at IS NULL AND void_reason IS NULL) OR (voided_at IS NOT NULL AND length(btrim(coalesce(void_reason, ''))) > 0))
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses (expense_date DESC);

CREATE OR REPLACE FUNCTION public.lb_expense_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.expense_date > public.lb_today() + 1 THEN RAISE EXCEPTION 'An expense cannot be dated in the future.' USING ERRCODE = '22023'; END IF;
  IF NEW.expense_date < public.lb_today() - 800 THEN RAISE EXCEPTION 'An expense cannot be dated more than about two years back.' USING ERRCODE = '22023'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lb_expense_guard_trg ON public.expenses;
CREATE TRIGGER lb_expense_guard_trg BEFORE INSERT ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.lb_expense_guard();

-- an expense is never edited or deleted: it is voided with a reason (the row stays for the audit trail)
CREATE OR REPLACE FUNCTION public.void_expense(p_id uuid, p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.app_rank() < 2 THEN RAISE EXCEPTION 'Only a manager or the owner can void an expense.' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'A reason is required to void an expense.' USING ERRCODE = '22023'; END IF;
  UPDATE public.expenses SET voided_at = now(), voided_by = auth.uid(), void_reason = left(btrim(p_reason), 300) WHERE id = p_id AND voided_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found or already voided.' USING ERRCODE = '22023'; END IF;
END $$;

-- 4) Client documents --------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  doc_type text NOT NULL DEFAULT 'other' CHECK (doc_type IN ('cnic', 'registration_book', 'invoice', 'challan', 'transfer_letter', 'affidavit', 'photo', 'other')),
  file_name text NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 150),
  storage_path text NOT NULL UNIQUE CHECK (length(storage_path) <= 300),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_documents_path_in_client_folder CHECK (storage_path LIKE client_id::text || '/%' AND storage_path !~ '\.\.' AND storage_path !~ '//')
);
CREATE INDEX IF NOT EXISTS idx_client_documents_client ON public.client_documents (client_id, created_at DESC);

-- 5) Message templates -------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9_]{2,40}$'),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 80),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 1200),
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.message_templates (key, title, body, sort_order) VALUES
  ('follow_up', 'Follow-up on an inquiry', 'Assalam o Alaikum {name}, aap ne {vehicle} ke baare mein poocha tha. Kya aap ko hamari madad chahiye? Hum har tarah ki rehnumai ke liye hazir hain. - {business}', 10),
  ('quotation_ready', 'Quotation ready', 'Assalam o Alaikum {name}, aap ki quotation tayyar hai: {amount}. Koi sawal ho to zaroor bataiye. - {business}', 20),
  ('documents_needed', 'Documents needed', 'Assalam o Alaikum {name}, {vehicle} ke kaam ke liye CNIC ki copy aur registration book ki copy bhej dein. Shukriya. - {business}', 30),
  ('case_done', 'Work completed', 'Assalam o Alaikum {name}, aap ka {vehicle} ka kaam mukammal ho gaya hai. Hum par bharosa karne ka shukriya. - {business}', 40),
  ('payment_due', 'Payment reminder', 'Assalam o Alaikum {name}, aap ki taraf {amount} baqi hain. Meharbani karke ada kar dein. Shukriya. - {business}', 50),
  ('renewal_due', 'Token tax / registration renewal', 'Assalam o Alaikum {name}, aap ki gaari {vehicle} ka token tax / registration {date} ko due hai. Hum aap ke liye ye kaam kar saktay hain. - {business}', 60)
ON CONFLICT (key) DO NOTHING;

-- 6) Row-level security, rights, audit and anti-forgery ------------------------------------------------------------------------------
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leads_select ON public.leads;  CREATE POLICY leads_select ON public.leads FOR SELECT TO authenticated USING ((SELECT public.app_rank()) >= 1);
DROP POLICY IF EXISTS leads_insert ON public.leads;  CREATE POLICY leads_insert ON public.leads FOR INSERT TO authenticated WITH CHECK ((SELECT public.app_rank()) >= 1);
DROP POLICY IF EXISTS leads_update ON public.leads;  CREATE POLICY leads_update ON public.leads FOR UPDATE TO authenticated USING ((SELECT public.app_rank()) >= 1) WITH CHECK ((SELECT public.app_rank()) >= 1);
DROP POLICY IF EXISTS leads_delete ON public.leads;  CREATE POLICY leads_delete ON public.leads FOR DELETE TO authenticated USING ((SELECT public.app_rank()) >= 2);

DROP POLICY IF EXISTS crm_activities_select ON public.crm_activities; CREATE POLICY crm_activities_select ON public.crm_activities FOR SELECT TO authenticated USING ((SELECT public.app_rank()) >= 1);
DROP POLICY IF EXISTS crm_activities_insert ON public.crm_activities; CREATE POLICY crm_activities_insert ON public.crm_activities FOR INSERT TO authenticated WITH CHECK ((SELECT public.app_rank()) >= 1);
DROP POLICY IF EXISTS crm_activities_delete ON public.crm_activities; CREATE POLICY crm_activities_delete ON public.crm_activities FOR DELETE TO authenticated USING ((SELECT public.app_rank()) >= 3);

DROP POLICY IF EXISTS expenses_select ON public.expenses; CREATE POLICY expenses_select ON public.expenses FOR SELECT TO authenticated USING ((SELECT public.app_rank()) >= 2);
DROP POLICY IF EXISTS expenses_insert ON public.expenses; CREATE POLICY expenses_insert ON public.expenses FOR INSERT TO authenticated WITH CHECK ((SELECT public.app_rank()) >= 2);

DROP POLICY IF EXISTS client_documents_select ON public.client_documents; CREATE POLICY client_documents_select ON public.client_documents FOR SELECT TO authenticated USING ((SELECT public.app_rank()) >= 1);
DROP POLICY IF EXISTS client_documents_insert ON public.client_documents; CREATE POLICY client_documents_insert ON public.client_documents FOR INSERT TO authenticated WITH CHECK ((SELECT public.app_rank()) >= 1);
DROP POLICY IF EXISTS client_documents_delete ON public.client_documents; CREATE POLICY client_documents_delete ON public.client_documents FOR DELETE TO authenticated USING ((SELECT public.app_rank()) >= 2);

DROP POLICY IF EXISTS message_templates_select ON public.message_templates; CREATE POLICY message_templates_select ON public.message_templates FOR SELECT TO authenticated USING ((SELECT public.app_rank()) >= 1);
DROP POLICY IF EXISTS message_templates_insert ON public.message_templates; CREATE POLICY message_templates_insert ON public.message_templates FOR INSERT TO authenticated WITH CHECK ((SELECT public.app_rank()) >= 3);
DROP POLICY IF EXISTS message_templates_update ON public.message_templates; CREATE POLICY message_templates_update ON public.message_templates FOR UPDATE TO authenticated USING ((SELECT public.app_rank()) >= 3) WITH CHECK ((SELECT public.app_rank()) >= 3);
DROP POLICY IF EXISTS message_templates_delete ON public.message_templates; CREATE POLICY message_templates_delete ON public.message_templates FOR DELETE TO authenticated USING ((SELECT public.app_rank()) >= 3);

-- table rights: nothing for signed-out visitors; append-only tables get no UPDATE / DELETE at all
REVOKE ALL ON public.leads, public.crm_activities, public.expenses, public.client_documents, public.message_templates FROM anon, PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON public.expenses FROM authenticated;
REVOKE UPDATE, TRUNCATE ON public.crm_activities, public.client_documents FROM authenticated;
REVOKE TRUNCATE ON public.leads, public.message_templates FROM authenticated;

-- updated_at, created_by cannot be forged, the database writes the audit trail
DROP TRIGGER IF EXISTS leads_updated_at ON public.leads;
CREATE TRIGGER leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS message_templates_updated_at ON public.message_templates;
CREATE TRIGGER message_templates_updated_at BEFORE UPDATE ON public.message_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leads', 'crm_activities', 'expenses', 'client_documents'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS lb_lock_created_by_trg ON public.%I', t);
    EXECUTE format('CREATE TRIGGER lb_lock_created_by_trg BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.lb_lock_created_by()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['leads', 'expenses', 'client_documents', 'message_templates'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS lb_audit_row_trg ON public.%I', t);
    EXECUTE format('CREATE TRIGGER lb_audit_row_trg AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.lb_audit_row()', t);
  END LOOP;
END $$;

-- 7) Dashboard / report numbers ----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_kpis(p_from date, p_to date) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE r int := public.app_rank(); today date := public.lb_today(); out jsonb;
BEGIN
  IF r < 1 THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  out := jsonb_build_object(
    'leads_followup_due', (SELECT count(*) FROM public.leads WHERE status IN ('new', 'contacted', 'quoted') AND next_follow_up IS NOT NULL AND next_follow_up <= today),
    'leads_new',  (SELECT count(*) FROM public.leads WHERE status = 'new'),
    'leads_open', (SELECT count(*) FROM public.leads WHERE status IN ('new', 'contacted', 'quoted')),
    'leads_won',  (SELECT count(*) FROM public.leads WHERE status = 'won'  AND public.lb_pk_date(updated_at) BETWEEN p_from AND p_to),
    'leads_lost', (SELECT count(*) FROM public.leads WHERE status = 'lost' AND public.lb_pk_date(updated_at) BETWEEN p_from AND p_to),
    'renewals_overdue', (SELECT count(*) FROM public.vehicles WHERE LEAST(token_tax_due, registration_due) < today),
    'renewals_30',      (SELECT count(*) FROM public.vehicles WHERE LEAST(token_tax_due, registration_due) BETWEEN today AND today + 30));
  IF r >= 2 THEN
    out := out || jsonb_build_object('expenses_total', coalesce((SELECT sum(amount) FROM public.expenses WHERE voided_at IS NULL AND expense_date BETWEEN p_from AND p_to), 0),
                                     'expenses_count', (SELECT count(*) FROM public.expenses WHERE voided_at IS NULL AND expense_date BETWEEN p_from AND p_to));
  ELSE
    out := out || jsonb_build_object('expenses_total', NULL, 'expenses_count', NULL);
  END IF;
  RETURN out;
END $$;

CREATE OR REPLACE FUNCTION public.expense_summary(p_from date, p_to date) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE out jsonb;
BEGIN
  IF public.app_rank() < 2 THEN RAISE EXCEPTION 'Expense figures are for managers and the owner.' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object(
    'total', coalesce(sum(amount), 0), 'count', count(*),
    'by_category', coalesce((SELECT jsonb_agg(jsonb_build_object('category', category, 'total', t, 'count', c) ORDER BY t DESC)
                             FROM (SELECT category, sum(amount) AS t, count(*) AS c FROM public.expenses WHERE voided_at IS NULL AND expense_date BETWEEN p_from AND p_to GROUP BY category) x), '[]'::jsonb),
    'by_method', coalesce((SELECT jsonb_object_agg(paid_from, t) FROM (SELECT paid_from, sum(amount) AS t FROM public.expenses WHERE voided_at IS NULL AND expense_date BETWEEN p_from AND p_to GROUP BY paid_from) y), '{}'::jsonb))
  INTO out FROM public.expenses WHERE voided_at IS NULL AND expense_date BETWEEN p_from AND p_to;
  RETURN out;
END $$;

-- turns a lead into a client in one step (runs with the caller's own rights)
CREATE OR REPLACE FUNCTION public.convert_lead_to_client(p_lead uuid) RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE l public.leads%ROWTYPE; cid uuid;
BEGIN
  IF public.app_rank() < 1 THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO l FROM public.leads WHERE id = p_lead FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead not found.' USING ERRCODE = '22023'; END IF;
  IF l.client_id IS NOT NULL THEN RETURN l.client_id; END IF;
  INSERT INTO public.clients (name, phone, notes) VALUES (l.name, l.phone, nullif(btrim(coalesce(l.notes, '')), '')) RETURNING id INTO cid;
  UPDATE public.leads SET client_id = cid, status = 'won', next_follow_up = NULL WHERE id = p_lead;
  INSERT INTO public.crm_activities (client_id, kind, note) VALUES (cid, 'note', 'Created from an inquiry (' || l.source || ')' || CASE WHEN l.interest IS NOT NULL THEN ': ' || l.interest ELSE '' END);
  RETURN cid;
END $$;

-- functions: only signed-in users may run them
REVOKE ALL ON FUNCTION public.crm_kpis(date, date), public.expense_summary(date, date), public.convert_lead_to_client(uuid), public.void_expense(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_kpis(date, date), public.expense_summary(date, date), public.convert_lead_to_client(uuid), public.void_expense(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.lb_expense_guard() FROM PUBLIC, anon, authenticated;

-- 8) Private file storage for client documents (only where Supabase Storage exists) ----------------------------------------------------
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'Supabase Storage not found: the document bucket was not created.';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('lb-documents', 'lb-documents', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

  EXECUTE 'DROP POLICY IF EXISTS lb_documents_insert ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS lb_documents_select ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS lb_documents_delete ON storage.objects';
  -- upload: signed-in, only into the folder of an existing client (folder name = client id).
  -- Note: objects.name is written in full on purpose: inside the sub-query a bare "name" would mean clients.name.
  EXECUTE $p$CREATE POLICY lb_documents_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'lb-documents' AND (SELECT public.app_rank()) >= 1
    AND (storage.foldername(objects.name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id::text = (storage.foldername(objects.name))[1]))$p$;
  -- download: only files that are registered in client_documents (so stray uploads can never be read)
  EXECUTE $p$CREATE POLICY lb_documents_select ON storage.objects FOR SELECT TO authenticated USING (
    bucket_id = 'lb-documents' AND (SELECT public.app_rank()) >= 1
    AND EXISTS (SELECT 1 FROM public.client_documents d WHERE d.storage_path = objects.name))$p$;
  -- delete: manager / owner only. There is no UPDATE policy: a stored file can never be overwritten.
  EXECUTE $p$CREATE POLICY lb_documents_delete ON storage.objects FOR DELETE TO authenticated USING (
    bucket_id = 'lb-documents' AND (SELECT public.app_rank()) >= 2)$p$;
END $$;
