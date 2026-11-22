-- M11: insider-abuse protection (found by attacking the app as a logged-in Staff user through the public API). Idempotent.
-- Before: a Staff login could, with no trace in the audit log,
--   * put someone else's name (e.g. the Owner) in "created_by" of clients / payments / quotations, or reassign it later,
--   * change a client's opening balance (forgive or invent a debt),
--   * add payments / credits directly with any amount and date.
-- Now: (1) created_by is always the real signed-in user and can never be changed,
--      (2) only Manager / Owner can set or change an opening balance,
--      (3) every insert / change / delete on the money tables is written to the audit log by the database itself,
--          with the real user id and the old -> new values, so it cannot be skipped by calling the API directly.

-- 1) authorship cannot be forged or rewritten -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lb_lock_created_by() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- applies to the public API (role 'authenticated'), also inside the app's own functions; internal maintenance runs as the database owner and is not touched
  IF auth.uid() IS NOT NULL AND coalesce(current_setting('role', true), '') = 'authenticated' THEN
    IF TG_OP = 'INSERT' THEN NEW.created_by := auth.uid(); ELSE NEW.created_by := OLD.created_by; END IF;
  END IF;
  RETURN NEW;
END $$;

-- 2) opening balance is a manager decision -----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lb_opening_balance_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.app_rank() < 2 AND (
       (TG_OP = 'INSERT' AND coalesce(NEW.opening_balance, 0) <> 0)
    OR (TG_OP = 'UPDATE' AND NEW.opening_balance IS DISTINCT FROM OLD.opening_balance)) THEN
    RAISE EXCEPTION 'Only a manager or the owner can set or change an opening balance.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lb_opening_balance_guard_trg ON public.clients;
CREATE TRIGGER lb_opening_balance_guard_trg BEFORE INSERT OR UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.lb_opening_balance_guard();

-- 3) tamper-proof audit trail written by the database ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lb_audit_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; o jsonb; d jsonb; eid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN r := to_jsonb(OLD); ELSE r := to_jsonb(NEW); END IF;
  eid := nullif(r ->> 'id', '')::uuid;
  IF TG_OP = 'UPDATE' THEN
    o := to_jsonb(OLD);
    SELECT jsonb_object_agg(n.key, jsonb_build_object('old', o -> n.key, 'new', n.value)) INTO d
      FROM jsonb_each(r) n WHERE n.value IS DISTINCT FROM (o -> n.key) AND n.key NOT IN ('updated_at');
    IF d IS NULL THEN RETURN NEW; END IF;
  ELSE
    d := r;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'db.' || lower(TG_OP) || '.' || TG_TABLE_NAME, TG_TABLE_NAME, eid, d);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.lb_audit_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lb_lock_created_by() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lb_opening_balance_guard() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients','quotations','payments','client_payments','payment_allocations','cases','vehicles','transfers'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS lb_lock_created_by_trg ON public.%I', t);
    EXECUTE format('CREATE TRIGGER lb_lock_created_by_trg BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.lb_lock_created_by()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['clients','payments','client_payments','payment_allocations'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS lb_audit_row_trg ON public.%I', t);
    EXECUTE format('CREATE TRIGGER lb_audit_row_trg AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.lb_audit_row()', t);
  END LOOP;
  -- quotations: creation is already logged by create_quotation_atomic; log only changes to money, client or status (not every autosave)
  DROP TRIGGER IF EXISTS lb_audit_row_trg ON public.quotations;
  CREATE TRIGGER lb_audit_row_trg AFTER DELETE OR UPDATE OF grand_total, subtotal_govt, subtotal_service, subtotal_additional, client_id, status ON public.quotations
    FOR EACH ROW EXECUTE FUNCTION public.lb_audit_row();
END $$;
