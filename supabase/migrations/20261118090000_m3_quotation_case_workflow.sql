/*
# M3: Quotation and case workflow

Run on STAGING first, after a fresh backup. Safe to run more than once. Needs M1 (20261109090000) and M2 (20261117090000) applied first.
Additive: no existing column is changed or dropped. Existing quotations and cases keep every value; existing cases get a "stage" worked out from their status.

1. status_history: one row for EVERY quotation status change and EVERY case status / stage / assignee change, written by a database trigger,
   so it is logged whichever screen (or API call) made the change. Nobody can edit or delete history from the app.
2. Quotation states: draft, pending, approved, rejected, completed. Allowed moves are enforced in the database (Manager / Owner may correct any move, still logged).
   "Expired" is not a stored status: a pending quotation whose validity date has passed is shown as expired. Follow-up date and note added.
3. cases: stage (new, documents, submitted, processing, ready, delivered), assigned_to, priority, due_date, next_action, next_action_on,
   excise_reference, excise_submitted_on. Stage and status stay consistent; a closed case can be reopened by a Manager / Owner only.
4. case_documents: required-document checklist per case (default list per service, editable per case).
5. create_case_from_quotation(): one action. Only an APPROVED quotation. Safe to call twice: the second call returns the same case (the quotation row is locked while it runs).
   A database rule also stops a second open case being linked to the same quotation by any other route.
6. set_quotation_status / set_case_stage / set_case_status: change with a note (a cancellation must give a reason).

NOT in M3 on purpose: client notifications and reminders (M5), payment allocation (M4). Fee calculation engine and PDF are untouched.
*/

-- 1) history ----------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('quotation', 'case')),
  entity_id uuid NOT NULL,
  field text NOT NULL DEFAULT 'status',
  from_value text,
  to_value text NOT NULL,
  note text,
  changed_by uuid DEFAULT auth.uid(),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_status_history_entity ON public.status_history (entity_type, entity_id, changed_at);
ALTER TABLE public.status_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.status_history FROM anon, authenticated;
GRANT SELECT ON public.status_history TO authenticated;
GRANT ALL ON public.status_history TO service_role;
DROP POLICY IF EXISTS status_history_select ON public.status_history;
CREATE POLICY status_history_select ON public.status_history FOR SELECT TO authenticated USING (public.app_rank() >= 1);

-- written only by the triggers below (SECURITY DEFINER); the note of the current action travels in a transaction-local setting
CREATE OR REPLACE FUNCTION public.lb_log_change(p_type text, p_id uuid, p_field text, p_from text, p_to text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.status_history (entity_type, entity_id, field, from_value, to_value, note, changed_by)
  VALUES (p_type, p_id, p_field, p_from, p_to, nullif(current_setting('lb.change_note', true), ''), auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.lb_log_change(text, uuid, text, text, text) FROM public;

-- 2) quotations -------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS follow_up_on date;
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS follow_up_note text;

CREATE OR REPLACE FUNCTION public.quotation_move_allowed(p_from text, p_to text, p_rank int) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_from = p_to THEN true
    WHEN p_rank >= 2 THEN true                                  -- manager / owner may correct any move; it is logged
    WHEN p_from = 'draft'     THEN p_to IN ('pending', 'rejected')
    WHEN p_from = 'pending'   THEN p_to IN ('approved', 'rejected', 'draft')
    WHEN p_from = 'approved'  THEN p_to IN ('completed', 'pending', 'rejected')
    WHEN p_from = 'rejected'  THEN p_to IN ('pending')
    ELSE false                                                  -- completed: only a manager / owner can reopen
  END
$$;
GRANT EXECUTE ON FUNCTION public.quotation_move_allowed(text, text, int) TO authenticated;

-- SECURITY DEFINER so the trigger may write history; nobody can call lb_log_change themselves, and auth.uid() / app_rank() still see the signed-in user
CREATE OR REPLACE FUNCTION public.quotations_status_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF auth.uid() IS NOT NULL AND NOT public.quotation_move_allowed(OLD.status, NEW.status, public.app_rank()) THEN
      RAISE EXCEPTION 'A quotation cannot go from "%" to "%". Ask a manager if this is a correction.', OLD.status, NEW.status;
    END IF;
    PERFORM public.lb_log_change('quotation', NEW.id, 'status', OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.quotations_status_guard() FROM public;
DROP TRIGGER IF EXISTS quotations_status_guard_trg ON public.quotations;
CREATE TRIGGER quotations_status_guard_trg BEFORE UPDATE OF status ON public.quotations FOR EACH ROW EXECUTE FUNCTION public.quotations_status_guard();

-- 3) cases ------------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'new';
-- existing cases: derive the stage from their status ONCE (the triggers are created after this, so no history rows are made for it)
UPDATE public.cases SET stage = CASE status WHEN 'completed' THEN 'delivered' WHEN 'active' THEN 'processing' ELSE 'new' END
 WHERE stage = 'new' AND status IN ('completed', 'active');
ALTER TABLE public.cases DROP CONSTRAINT IF EXISTS cases_stage_check;
ALTER TABLE public.cases ADD CONSTRAINT cases_stage_check CHECK (stage IN ('new', 'documents', 'submitted', 'processing', 'ready', 'delivered'));
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';
ALTER TABLE public.cases DROP CONSTRAINT IF EXISTS cases_priority_check;
ALTER TABLE public.cases ADD CONSTRAINT cases_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS next_action text;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS next_action_on date;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS excise_reference text;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS excise_submitted_on date;
CREATE INDEX IF NOT EXISTS idx_cases_assigned ON public.cases (assigned_to);
CREATE INDEX IF NOT EXISTS idx_cases_quotation ON public.cases (quotation_id);

CREATE OR REPLACE FUNCTION public.cases_workflow_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE other_no text; rk int := public.app_rank(); n_from text; n_to text;
BEGIN
  -- one open case per quotation (cancelled cases do not count, so a cancelled case can be replaced)
  IF NEW.quotation_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.quotation_id IS DISTINCT FROM OLD.quotation_id) AND NEW.status <> 'cancelled' THEN
    SELECT c.case_no INTO other_no FROM public.cases c WHERE c.quotation_id = NEW.quotation_id AND c.id <> NEW.id AND c.status <> 'cancelled' LIMIT 1;
    IF FOUND THEN RAISE EXCEPTION 'This quotation already has case %. Open that case instead of creating another.', other_no; END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'completed' THEN NEW.stage := 'delivered'; END IF;
    IF NEW.status IN ('completed', 'cancelled') AND NEW.closed_on IS NULL THEN NEW.closed_on := public.lb_today(); END IF;
    RETURN NEW;
  END IF;

  -- a closed case is reopened (status or stage moved) by a manager / owner only
  IF OLD.status IN ('completed', 'cancelled') AND auth.uid() IS NOT NULL AND rk < 2
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.stage IS DISTINCT FROM OLD.stage) THEN
    RAISE EXCEPTION 'This case is closed. Only a manager or the owner can reopen it.';
  END IF;

  -- stage and status stay consistent
  IF NEW.stage IS DISTINCT FROM OLD.stage AND NEW.status = OLD.status THEN
    IF NEW.stage = 'delivered' THEN NEW.status := 'completed';
    ELSIF NEW.status = 'pending' AND NEW.stage <> 'new' THEN NEW.status := 'active';
    ELSIF OLD.status = 'completed' AND NEW.stage <> 'delivered' THEN NEW.status := 'active';   -- reopened by moving the stage back
    END IF;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'completed' AND NEW.stage <> 'delivered' THEN NEW.stage := 'delivered'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('completed', 'cancelled') THEN NEW.closed_on := coalesce(NEW.closed_on, public.lb_today());
    ELSE NEW.closed_on := NULL; END IF;
  END IF;
  NEW.updated_at := now();

  IF NEW.status IS DISTINCT FROM OLD.status THEN PERFORM public.lb_log_change('case', NEW.id, 'status', OLD.status, NEW.status); END IF;
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN PERFORM public.lb_log_change('case', NEW.id, 'stage', OLD.stage, NEW.stage); END IF;
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    SELECT full_name INTO n_from FROM public.profiles WHERE id = OLD.assigned_to;
    SELECT full_name INTO n_to FROM public.profiles WHERE id = NEW.assigned_to;
    PERFORM public.lb_log_change('case', NEW.id, 'assigned_to', coalesce(n_from, 'nobody'), coalesce(n_to, 'nobody'));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cases_workflow_guard() FROM public;
DROP TRIGGER IF EXISTS cases_workflow_guard_trg ON public.cases;
CREATE TRIGGER cases_workflow_guard_trg BEFORE INSERT OR UPDATE ON public.cases FOR EACH ROW EXECUTE FUNCTION public.cases_workflow_guard();

-- 4) document checklist ------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.case_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  required boolean NOT NULL DEFAULT true,
  received boolean NOT NULL DEFAULT false,
  received_on date,
  notes text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_case_documents_case ON public.case_documents (case_id);
ALTER TABLE public.case_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_documents FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_documents TO authenticated;
GRANT ALL ON public.case_documents TO service_role;
DROP POLICY IF EXISTS case_documents_select ON public.case_documents;
DROP POLICY IF EXISTS case_documents_insert ON public.case_documents;
DROP POLICY IF EXISTS case_documents_update ON public.case_documents;
DROP POLICY IF EXISTS case_documents_delete ON public.case_documents;
CREATE POLICY case_documents_select ON public.case_documents FOR SELECT TO authenticated USING (public.app_rank() >= 1);
CREATE POLICY case_documents_insert ON public.case_documents FOR INSERT TO authenticated WITH CHECK (public.app_rank() >= 1);
CREATE POLICY case_documents_update ON public.case_documents FOR UPDATE TO authenticated USING (public.app_rank() >= 1) WITH CHECK (public.app_rank() >= 1);
CREATE POLICY case_documents_delete ON public.case_documents FOR DELETE TO authenticated USING (public.app_rank() >= 1);

CREATE OR REPLACE FUNCTION public.case_documents_stamp() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.received AND (TG_OP = 'INSERT' OR NOT OLD.received) AND NEW.received_on IS NULL THEN NEW.received_on := public.lb_today(); END IF;
  IF NOT NEW.received THEN NEW.received_on := NULL; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS case_documents_stamp_trg ON public.case_documents;
CREATE TRIGGER case_documents_stamp_trg BEFORE INSERT OR UPDATE ON public.case_documents FOR EACH ROW EXECUTE FUNCTION public.case_documents_stamp();

-- Suggested checklist per service. These are only a starting point: edit the list on each case to match what the office actually asks for.
CREATE OR REPLACE FUNCTION public.default_case_documents(p_service text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_service
    WHEN 'new_registration' THEN ARRAY['Owner CNIC copy', 'Invoice / sale letter', 'Import or customs papers (if imported)', 'Application form signed by owner']
    WHEN 'transfer'         THEN ARRAY['Seller CNIC copy', 'Buyer CNIC copy', 'Registration book (original)', 'Transfer form signed by seller and buyer', 'Token tax clearance']
    WHEN 'token_tax'        THEN ARRAY['Registration book copy', 'Previous token receipt']
    WHEN 'number_plate'     THEN ARRAY['Registration book copy', 'Owner CNIC copy', 'Old plate (if replacing)']
    WHEN 'duplicate_docs'   THEN ARRAY['Owner CNIC copy', 'Application / affidavit', 'Police report (if lost)']
    ELSE ARRAY[]::text[]
  END
$$;
GRANT EXECUTE ON FUNCTION public.default_case_documents(text) TO authenticated;

-- 5) quotation -> case, one action ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_case_from_quotation(p_quotation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  q public.quotations%ROWTYPE;
  ex public.cases%ROWTYPE;
  v_service text; v_assignee uuid; v_id uuid; v_no text; v_try int := 0; d text; i int := 0;
BEGIN
  IF public.app_rank() < 1 THEN RAISE EXCEPTION 'Your account is not active.'; END IF;
  SELECT * INTO q FROM public.quotations WHERE id = p_quotation_id FOR UPDATE;    -- the lock makes a double click / two people safe
  IF NOT FOUND THEN RAISE EXCEPTION 'Quotation not found.'; END IF;

  SELECT * INTO ex FROM public.cases WHERE quotation_id = q.id AND status <> 'cancelled' ORDER BY created_at LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('case_id', ex.id, 'case_no', ex.case_no, 'already_existed', true); END IF;

  IF q.status <> 'approved' THEN RAISE EXCEPTION 'Only an approved quotation can create a case (this one is "%").', q.status; END IF;
  IF q.client_id IS NULL THEN RAISE EXCEPTION 'This quotation has no client. Link a client first.'; END IF;

  v_service := CASE WHEN q.transaction_type IN ('new_registration', 'transfer', 'token_tax') THEN q.transaction_type ELSE 'other' END;
  SELECT c.assigned_to INTO v_assignee FROM public.clients c WHERE c.id = q.client_id;
  v_assignee := coalesce(v_assignee, auth.uid());

  LOOP
    v_try := v_try + 1;
    v_no := 'CS-' || to_char(public.lb_today(), 'YYYYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 4));
    BEGIN
      INSERT INTO public.cases (case_no, client_id, vehicle_id, quotation_id, service_type, status, stage, govt_fee, service_charge, assigned_to, opened_on)
      VALUES (v_no, q.client_id, q.vehicle_id, q.id, v_service, 'pending', 'new', q.subtotal_govt, coalesce(q.subtotal_service, 0) + coalesce(q.subtotal_additional, 0), v_assignee, public.lb_today())
      RETURNING id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_try >= 8 THEN RAISE EXCEPTION 'Could not create a unique case number. Please try again.'; END IF;
    END;
  END LOOP;

  FOREACH d IN ARRAY public.default_case_documents(v_service) LOOP
    i := i + 1;
    INSERT INTO public.case_documents (case_id, label, sort_order) VALUES (v_id, d, i);
  END LOOP;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'case_created_from_quotation', 'case', v_id, jsonb_build_object('case_no', v_no, 'quotation_number', q.quotation_number, 'client_id', q.client_id));
  RETURN jsonb_build_object('case_id', v_id, 'case_no', v_no, 'already_existed', false);
END $$;
REVOKE ALL ON FUNCTION public.create_case_from_quotation(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.create_case_from_quotation(uuid) TO authenticated;

-- 6) changes with a note ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_quotation_status(p_id uuid, p_status text, p_note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF p_status NOT IN ('draft', 'pending', 'approved', 'rejected', 'completed') THEN RAISE EXCEPTION 'Unknown status.'; END IF;
  IF p_status = 'rejected' AND coalesce(btrim(p_note), '') = '' THEN RAISE EXCEPTION 'Please write why the quotation is rejected.'; END IF;
  PERFORM set_config('lb.change_note', coalesce(p_note, ''), true);
  UPDATE public.quotations SET status = p_status WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quotation not found.'; END IF;
  PERFORM set_config('lb.change_note', '', true);
END $$;

CREATE OR REPLACE FUNCTION public.set_case_stage(p_id uuid, p_stage text, p_note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM set_config('lb.change_note', coalesce(p_note, ''), true);
  UPDATE public.cases SET stage = p_stage WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Case not found.'; END IF;
  PERFORM set_config('lb.change_note', '', true);
END $$;

CREATE OR REPLACE FUNCTION public.set_case_status(p_id uuid, p_status text, p_note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF p_status NOT IN ('pending', 'active', 'completed', 'cancelled') THEN RAISE EXCEPTION 'Unknown status.'; END IF;
  IF p_status = 'cancelled' AND coalesce(btrim(p_note), '') = '' THEN RAISE EXCEPTION 'Please write why the case is cancelled.'; END IF;
  PERFORM set_config('lb.change_note', coalesce(p_note, ''), true);
  UPDATE public.cases SET status = p_status WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Case not found.'; END IF;
  PERFORM set_config('lb.change_note', '', true);
END $$;

REVOKE ALL ON FUNCTION public.set_quotation_status(uuid, text, text), public.set_case_stage(uuid, text, text), public.set_case_status(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_quotation_status(uuid, text, text), public.set_case_stage(uuid, text, text), public.set_case_status(uuid, text, text) TO authenticated;
