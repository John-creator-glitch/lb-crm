-- M4: Payments, receipts and client ledger. Additive and safe to run more than once.
-- 1) Payments are never edited in amount/date/target and never silently deleted: a wrong payment is REVERSED (manager/owner, with a reason) and re-entered.
-- 2) An on-account payment can be ALLOCATED to a quotation. Allocation does not change the client balance (the money was already counted once
--    when it was received); it only shows which quotation it paid. The database refuses over-allocation (double counting).
-- 3) ledger_balance() and quotation_payment_summary give the same numbers the screens show, for reconciliation tests and reports.

-- helper: the account that pays for a client's bills (the parent when bill_to_parent is set)
CREATE OR REPLACE FUNCTION public.lb_payer(p_client uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN c.bill_to_parent AND c.parent_id IS NOT NULL THEN c.parent_id ELSE c.id END FROM public.clients c WHERE c.id = p_client
$$;

-- 1) reversal columns -------------------------------------------------------------------------------------------------------------
ALTER TABLE public.payments        ADD COLUMN IF NOT EXISTS reversed_at timestamptz, ADD COLUMN IF NOT EXISTS reversed_by uuid, ADD COLUMN IF NOT EXISTS reversal_reason text;
ALTER TABLE public.client_payments ADD COLUMN IF NOT EXISTS reversed_at timestamptz, ADD COLUMN IF NOT EXISTS reversed_by uuid, ADD COLUMN IF NOT EXISTS reversal_reason text;

CREATE OR REPLACE FUNCTION public.payments_money_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'payments' THEN
    IF NEW.quotation_id IS DISTINCT FROM OLD.quotation_id THEN RAISE EXCEPTION 'The amount, date and account of a payment cannot be edited. Reverse the payment and record it again.'; END IF;
  ELSE
    IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN RAISE EXCEPTION 'The amount, date and account of a payment cannot be edited. Reverse the payment and record it again.'; END IF;
  END IF;
  IF NEW.amount IS DISTINCT FROM OLD.amount OR NEW.payment_date IS DISTINCT FROM OLD.payment_date THEN
    RAISE EXCEPTION 'The amount, date and account of a payment cannot be edited. Reverse the payment and record it again.';
  END IF;
  IF (NEW.reversed_at IS DISTINCT FROM OLD.reversed_at OR NEW.reversed_by IS DISTINCT FROM OLD.reversed_by OR NEW.reversal_reason IS DISTINCT FROM OLD.reversal_reason)
     AND coalesce(current_setting('lb.reversing', true), '') <> '1' THEN
    RAISE EXCEPTION 'Use Reverse payment to cancel a payment.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS payments_money_guard_trg ON public.payments;
CREATE TRIGGER payments_money_guard_trg BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.payments_money_guard();
DROP TRIGGER IF EXISTS client_payments_money_guard_trg ON public.client_payments;
CREATE TRIGGER client_payments_money_guard_trg BEFORE UPDATE ON public.client_payments FOR EACH ROW EXECUTE FUNCTION public.payments_money_guard();

-- hard delete is owner-only; managers use reversal, which keeps the record
DROP POLICY IF EXISTS payments_delete ON public.payments;
CREATE POLICY payments_delete ON public.payments FOR DELETE TO authenticated USING (public.app_rank() >= 3);
DROP POLICY IF EXISTS client_payments_delete ON public.client_payments;
CREATE POLICY client_payments_delete ON public.client_payments FOR DELETE TO authenticated USING (public.app_rank() >= 3);

-- 2) allocations ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_payment_id uuid NOT NULL REFERENCES public.client_payments(id) ON DELETE RESTRICT,
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz, voided_by uuid, void_reason text
);
CREATE INDEX IF NOT EXISTS idx_alloc_payment ON public.payment_allocations (client_payment_id);
CREATE INDEX IF NOT EXISTS idx_alloc_quotation ON public.payment_allocations (quotation_id);
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.payment_allocations TO authenticated;
GRANT ALL ON public.payment_allocations TO service_role;
DROP POLICY IF EXISTS alloc_select ON public.payment_allocations;
CREATE POLICY alloc_select ON public.payment_allocations FOR SELECT TO authenticated USING (public.app_rank() >= 1);
-- no insert/update/delete policy: allocations change only through the functions below

CREATE OR REPLACE FUNCTION public.allocate_client_payment(p_payment uuid, p_quotation uuid, p_amount numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cp public.client_payments; q public.quotations; v_free numeric; v_out numeric; v_id uuid; v_amt numeric := round(coalesce(p_amount, 0), 2);
BEGIN
  IF auth.uid() IS NULL OR public.app_rank() < 1 THEN RAISE EXCEPTION 'Not allowed.'; END IF;
  IF v_amt <= 0 THEN RAISE EXCEPTION 'Enter an amount more than zero.'; END IF;
  SELECT * INTO cp FROM public.client_payments WHERE id = p_payment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
  IF cp.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'This payment was reversed and cannot be allocated.'; END IF;
  SELECT * INTO q FROM public.quotations WHERE id = p_quotation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quotation not found.'; END IF;
  IF q.status IN ('draft', 'rejected') THEN RAISE EXCEPTION 'A % quotation is not billed, so no payment can be allocated to it.', q.status; END IF;
  IF q.client_id IS NULL OR public.lb_payer(q.client_id) IS DISTINCT FROM cp.client_id THEN RAISE EXCEPTION 'This quotation is not billed to the account that made the payment.'; END IF;
  v_free := cp.amount - coalesce((SELECT sum(amount) FROM public.payment_allocations WHERE client_payment_id = cp.id AND voided_at IS NULL), 0);
  IF v_amt > v_free THEN RAISE EXCEPTION 'Only % of this payment is still unallocated.', v_free; END IF;
  v_out := q.grand_total
    - coalesce((SELECT sum(amount) FROM public.payments WHERE quotation_id = q.id AND reversed_at IS NULL), 0)
    - coalesce((SELECT sum(amount) FROM public.payment_allocations WHERE quotation_id = q.id AND voided_at IS NULL), 0);
  IF v_amt > v_out THEN RAISE EXCEPTION 'The quotation has only % outstanding. Allocating more would count the money twice.', greatest(v_out, 0); END IF;
  INSERT INTO public.payment_allocations (client_payment_id, quotation_id, amount) VALUES (cp.id, q.id, v_amt) RETURNING id INTO v_id;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'payment_allocated', 'quotation', q.id, jsonb_build_object('client_payment_id', cp.id, 'amount', v_amt, 'quotation_number', q.quotation_number));
  RETURN jsonb_build_object('allocation_id', v_id, 'unallocated_left', v_free - v_amt, 'outstanding_left', v_out - v_amt);
END $$;
REVOKE ALL ON FUNCTION public.allocate_client_payment(uuid, uuid, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.allocate_client_payment(uuid, uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.void_allocation(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.payment_allocations;
BEGIN
  IF auth.uid() IS NULL OR public.app_rank() < 2 THEN RAISE EXCEPTION 'Only a manager or the owner can undo an allocation.'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'A reason is required.'; END IF;
  SELECT * INTO a FROM public.payment_allocations WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Allocation not found.'; END IF;
  IF a.voided_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.payment_allocations SET voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason) WHERE id = p_id;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'payment_allocation_voided', 'quotation', a.quotation_id, jsonb_build_object('allocation_id', a.id, 'amount', a.amount, 'reason', btrim(p_reason)));
END $$;
REVOKE ALL ON FUNCTION public.void_allocation(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.void_allocation(uuid, text) TO authenticated;

-- reversal: p_kind = 'quotation' (payments) or 'on_account' (client_payments)
CREATE OR REPLACE FUNCTION public.reverse_payment(p_kind text, p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_amount numeric; v_ref uuid; v_done timestamptz; v_why text := btrim(coalesce(p_reason, ''));
BEGIN
  IF auth.uid() IS NULL OR public.app_rank() < 2 THEN RAISE EXCEPTION 'Only a manager or the owner can reverse a payment.'; END IF;
  IF v_why = '' THEN RAISE EXCEPTION 'A reason is required to reverse a payment.'; END IF;
  PERFORM set_config('lb.reversing', '1', true);
  IF p_kind = 'quotation' THEN
    SELECT amount, quotation_id, reversed_at INTO v_amount, v_ref, v_done FROM public.payments WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
    IF v_done IS NOT NULL THEN RAISE EXCEPTION 'This payment is already reversed.'; END IF;
    UPDATE public.payments SET reversed_at = now(), reversed_by = auth.uid(), reversal_reason = v_why WHERE id = p_id;
  ELSIF p_kind = 'on_account' THEN
    SELECT amount, client_id, reversed_at INTO v_amount, v_ref, v_done FROM public.client_payments WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
    IF v_done IS NOT NULL THEN RAISE EXCEPTION 'This payment is already reversed.'; END IF;
    UPDATE public.payment_allocations SET voided_at = now(), voided_by = auth.uid(), void_reason = 'Payment reversed: ' || v_why WHERE client_payment_id = p_id AND voided_at IS NULL;
    UPDATE public.client_payments SET reversed_at = now(), reversed_by = auth.uid(), reversal_reason = v_why WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Unknown payment kind.';
  END IF;
  PERFORM set_config('lb.reversing', '', true);
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'payment_reversed', CASE WHEN p_kind = 'quotation' THEN 'quotation' ELSE 'client' END, v_ref, jsonb_build_object('payment_id', p_id, 'kind', p_kind, 'amount', v_amount, 'reason', v_why));
END $$;
REVOKE ALL ON FUNCTION public.reverse_payment(text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.reverse_payment(text, uuid, text) TO authenticated;

-- 3) numbers --------------------------------------------------------------------------------------------------------------------------
-- Billed = every quotation billed to this account except draft and rejected. Received = payments on those quotations (any status) + on-account
-- payments, never reversed ones. Pending = opening + billed - received (negative = advance). Same rules as src/lib/ledger.ts.
CREATE OR REPLACE FUNCTION public.ledger_balance(p_account uuid) RETURNS TABLE (opening numeric, billed numeric, received numeric, pending numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH o AS (SELECT coalesce(opening_balance, 0) AS v FROM public.clients WHERE id = p_account),
  qs AS (SELECT id, status, grand_total FROM public.quotations WHERE client_id IS NOT NULL AND public.lb_payer(client_id) = p_account),
  b AS (SELECT coalesce(sum(grand_total) FILTER (WHERE status NOT IN ('draft', 'rejected')), 0) AS v FROM qs),
  r AS (SELECT coalesce((SELECT sum(p.amount) FROM public.payments p JOIN qs ON qs.id = p.quotation_id WHERE p.reversed_at IS NULL), 0)
             + coalesce((SELECT sum(amount) FROM public.client_payments WHERE client_id = p_account AND reversed_at IS NULL), 0) AS v)
  SELECT o.v, b.v, r.v, o.v + b.v - r.v FROM o, b, r
$$;
GRANT EXECUTE ON FUNCTION public.ledger_balance(uuid) TO authenticated;

CREATE OR REPLACE VIEW public.quotation_payment_summary WITH (security_invoker = true) AS
SELECT q.id AS quotation_id, q.grand_total,
  coalesce((SELECT sum(p.amount) FROM public.payments p WHERE p.quotation_id = q.id AND p.reversed_at IS NULL), 0) AS paid_direct,
  coalesce((SELECT sum(a.amount) FROM public.payment_allocations a WHERE a.quotation_id = q.id AND a.voided_at IS NULL), 0) AS paid_allocated,
  coalesce((SELECT sum(p.amount) FROM public.payments p WHERE p.quotation_id = q.id AND p.reversed_at IS NULL), 0)
  + coalesce((SELECT sum(a.amount) FROM public.payment_allocations a WHERE a.quotation_id = q.id AND a.voided_at IS NULL), 0) AS paid,
  q.grand_total
  - coalesce((SELECT sum(p.amount) FROM public.payments p WHERE p.quotation_id = q.id AND p.reversed_at IS NULL), 0)
  - coalesce((SELECT sum(a.amount) FROM public.payment_allocations a WHERE a.quotation_id = q.id AND a.voided_at IS NULL), 0) AS outstanding
FROM public.quotations q;
GRANT SELECT ON public.quotation_payment_summary TO authenticated;
