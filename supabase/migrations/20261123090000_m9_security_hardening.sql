-- M9 security hardening (from the 19 Nov 2026 security review). Idempotent; changes no data.
-- 1. A quotation's MONEY is locked once approved: only Manager / Owner may change amounts or line items (Staff may still work on draft / pending quotations).
-- 2. Two elevated trigger functions get a fixed search_path.
-- 3. Defence in depth: nobody who is not signed in (anon / PUBLIC) can execute ANY function in the public schema; signed-in users keep exactly the access they had.

-- 1 -------------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.quotations_amount_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.app_rank() < 2 AND OLD.status IN ('approved', 'completed') AND (
       NEW.grand_total IS DISTINCT FROM OLD.grand_total OR NEW.subtotal_govt IS DISTINCT FROM OLD.subtotal_govt
    OR NEW.subtotal_service IS DISTINCT FROM OLD.subtotal_service OR NEW.subtotal_additional IS DISTINCT FROM OLD.subtotal_additional
    OR NEW.client_id IS DISTINCT FROM OLD.client_id) THEN
    RAISE EXCEPTION 'The amounts of an approved quotation can only be changed by a manager or the owner.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS quotations_amount_guard_trg ON public.quotations;
CREATE TRIGGER quotations_amount_guard_trg BEFORE UPDATE ON public.quotations FOR EACH ROW EXECUTE FUNCTION public.quotations_amount_guard();

CREATE OR REPLACE FUNCTION public.quotation_lines_amount_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE qid uuid; st text;
BEGIN
  IF auth.uid() IS NULL OR public.app_rank() >= 2 THEN RETURN COALESCE(NEW, OLD); END IF;
  qid := COALESCE(NEW.quotation_id, OLD.quotation_id);
  SELECT status INTO st FROM public.quotations WHERE id = qid;
  IF st IN ('approved', 'completed') THEN
    RAISE EXCEPTION 'The fee lines of an approved quotation can only be changed by a manager or the owner.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.quotation_id IS DISTINCT FROM OLD.quotation_id THEN
    SELECT status INTO st FROM public.quotations WHERE id = NEW.quotation_id;
    IF st IN ('approved', 'completed') THEN RAISE EXCEPTION 'The fee lines of an approved quotation can only be changed by a manager or the owner.' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS quotation_lines_amount_guard_trg ON public.quotation_line_items;
CREATE TRIGGER quotation_lines_amount_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON public.quotation_line_items FOR EACH ROW EXECUTE FUNCTION public.quotation_lines_amount_guard();

-- 2 -------------------------------------------------------------------------------------------------------------------------------------
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.snapshot_fee_rule_revision() SET search_path = public;

-- 3 -------------------------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE f record; keep oid[] := '{}';
BEGIN
  -- remember what signed-in users may run today (so internal helpers that are already locked stay locked)
  FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
           AND has_function_privilege('authenticated', p.oid, 'EXECUTE') LOOP keep := keep || f.oid; END LOOP;
  FOR f IN SELECT p.oid::regprocedure AS sig, p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p') LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    IF f.oid = ANY (keep) THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig); END IF;
  END LOOP;
END $$;
-- Functions created by LATER migrations: run this statement again after adding any new function (or add REVOKE ... FROM PUBLIC, anon next to it).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
