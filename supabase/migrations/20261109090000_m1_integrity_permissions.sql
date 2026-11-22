/*
# M1: data integrity, save safety and permissions

Run on STAGING first, after a fresh backup. Safe to run more than once. Needs 20261108180000_roles_and_rights.sql applied first.

1. public.lb_today(): today's date in Pakistan (Asia/Karachi). Database defaults for payment_date, opened_on, entry_date use it
   (CURRENT_DATE is the UTC day and is wrong between midnight and 5 am in Pakistan).
2. public.create_quotation_atomic(): saves vehicle + quotation + line items + audit entry in ONE transaction, validates everything,
   creates the quotation number on the server (retries on a clash). Any failure rolls back everything.
3. payments.quotation_id no longer cascades: a quotation that has payments cannot be deleted (payments are never lost silently).
4. payments.amount must be more than zero (NOT VALID: checks new and changed rows, does not fail on old rows).
5. audit_logs: user_id is filled automatically and must be the signed-in user, so entries cannot be written in somebody else's name.

NOT in M1 on purpose (see the M1 report): locking approved quotations (M3), case duplicates (M3), staff row-level finance limits (needs owner decision).
*/

-- 1) Pakistan business date --------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lb_today() RETURNS date
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Karachi')::date $$;
GRANT EXECUTE ON FUNCTION public.lb_today() TO authenticated;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('payments','payment_date'),('client_payments','payment_date'),('cases','opened_on'),('hpa_counts','entry_date')) AS v(t, c) LOOP
    IF to_regclass('public.' || r.t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT public.lb_today()', r.t, r.c);
    END IF;
  END LOOP;
END $$;

-- 2) Atomic quotation save -----------------------------------------------------------------------------------------------------
-- SECURITY INVOKER (the default): row level security of the signed-in user applies to every insert inside.
CREATE OR REPLACE FUNCTION public.create_quotation_atomic(p_client_id uuid, p_vehicle jsonb, p_quotation jsonb, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_vehicle_id uuid;
  v_qid uuid;
  v_no text;
  v_try int := 0;
  h_govt numeric := round(coalesce(nullif(p_quotation->>'subtotal_govt', '')::numeric, 0), 2);
  h_service numeric := round(coalesce(nullif(p_quotation->>'subtotal_service', '')::numeric, 0), 2);
  h_add numeric := round(coalesce(nullif(p_quotation->>'subtotal_additional', '')::numeric, 0), 2);
  h_grand numeric := round(coalesce(nullif(p_quotation->>'grand_total', '')::numeric, 0), 2);
  v_days int := coalesce(nullif(p_quotation->>'validity_days', '')::int, 15);
  i_govt numeric; i_service numeric; i_add numeric;
BEGIN
  IF public.app_rank() < 1 THEN RAISE EXCEPTION 'Your account is not active.'; END IF;
  IF p_client_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.clients WHERE id = p_client_id) THEN
    RAISE EXCEPTION 'Client not found. Select a client and try again.';
  END IF;
  IF p_quotation IS NULL OR jsonb_typeof(p_quotation) <> 'object' THEN RAISE EXCEPTION 'Quotation details are missing.'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'A quotation needs at least one line item.';
  END IF;
  IF v_days < 1 OR v_days > 365 THEN RAISE EXCEPTION 'Validity must be between 1 and 365 days.'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items) AS x(label text, category text, amount numeric)
    WHERE coalesce(trim(x.label), '') = '' OR x.category IS NULL OR x.category NOT IN ('government', 'service', 'additional') OR x.amount IS NULL
  ) THEN
    RAISE EXCEPTION 'Every line item needs a label, a category (government, service or additional) and an amount.';
  END IF;

  SELECT coalesce(sum(x.amount) FILTER (WHERE x.category = 'government'), 0),
         coalesce(sum(x.amount) FILTER (WHERE x.category = 'service'), 0),
         coalesce(sum(x.amount) FILTER (WHERE x.category = 'additional'), 0)
    INTO i_govt, i_service, i_add
  FROM jsonb_to_recordset(p_items) AS x(category text, amount numeric);

  IF abs(i_govt - h_govt) > 0.01 OR abs(i_service - h_service) > 0.01 OR abs(i_add - h_add) > 0.01 THEN
    RAISE EXCEPTION 'Quotation totals do not match its line items (items: govt %, service %, additional %; header: govt %, service %, additional %).',
      i_govt, i_service, i_add, h_govt, h_service, h_add;
  END IF;
  IF abs(h_grand - (h_govt + h_service + h_add)) > 0.01 THEN
    RAISE EXCEPTION 'Grand total % is not the sum of its parts (%).', h_grand, h_govt + h_service + h_add;
  END IF;

  -- vehicle (optional)
  IF p_vehicle IS NOT NULL AND jsonb_typeof(p_vehicle) = 'object' AND p_vehicle <> '{}'::jsonb THEN
    INSERT INTO public.vehicles (client_id, province, registration_type, vehicle_category, company, model, engine_cc, manufacturing_year,
                                 invoice_value, registration_number, filer_status, origin, fuel_type)
    VALUES (p_client_id, nullif(p_vehicle->>'province', ''), nullif(p_vehicle->>'registration_type', ''), nullif(p_vehicle->>'vehicle_category', ''),
            nullif(p_vehicle->>'company', ''), nullif(p_vehicle->>'model', ''), nullif(p_vehicle->>'engine_cc', '')::int,
            nullif(p_vehicle->>'manufacturing_year', '')::int, nullif(p_vehicle->>'invoice_value', '')::numeric,
            nullif(p_vehicle->>'registration_number', ''), nullif(p_vehicle->>'filer_status', ''), nullif(p_vehicle->>'origin', ''),
            nullif(p_vehicle->>'fuel_type', ''))
    RETURNING id INTO v_vehicle_id;
  END IF;

  -- quotation, with a server-made number; try again if two people hit the same number
  LOOP
    v_try := v_try + 1;
    v_no := 'LB-' || to_char(public.lb_today(), 'YYYYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 4));
    BEGIN
      INSERT INTO public.quotations (quotation_number, client_id, vehicle_id, transaction_type, status, calculation_snapshot,
                                     subtotal_govt, subtotal_service, subtotal_additional, grand_total, validity_date, payment_terms, notes)
      VALUES (v_no, p_client_id, v_vehicle_id, nullif(p_quotation->>'transaction_type', ''), 'pending', p_quotation->'calculation_snapshot',
              h_govt, h_service, h_add, h_grand, public.lb_today() + v_days, nullif(p_quotation->>'payment_terms', ''), NULL)
      RETURNING id INTO v_qid;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_try >= 8 THEN RAISE EXCEPTION 'Could not create a unique quotation number. Please try again.'; END IF;
    END;
  END LOOP;

  INSERT INTO public.quotation_line_items (quotation_id, fee_type, label, category, amount, formula, source, rule_version, is_override, override_reason, sort_order)
  SELECT v_qid, coalesce(nullif(trim(x.fee_type), ''), 'other'), x.label, x.category, x.amount, x.formula, x.source, x.rule_version,
         coalesce(x.is_override, false), x.override_reason, coalesce(x.sort_order, 0)
  FROM jsonb_to_recordset(p_items) AS x(fee_type text, label text, category text, amount numeric, formula text, source text,
                                        rule_version text, is_override boolean, override_reason text, sort_order int);

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'quotation_created', 'quotation', v_qid, jsonb_build_object('quotation_number', v_no, 'total', h_grand));

  RETURN jsonb_build_object('quotation_id', v_qid, 'quotation_number', v_no, 'vehicle_id', v_vehicle_id);
END $$;
REVOKE ALL ON FUNCTION public.create_quotation_atomic(uuid, jsonb, jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.create_quotation_atomic(uuid, jsonb, jsonb, jsonb) TO authenticated;

-- 3) payments are never deleted by deleting their quotation ---------------------------------------------------------------------
DO $$
DECLARE fk text;
BEGIN
  FOR fk IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.payments'::regclass AND contype = 'f' AND confrelid = 'public.quotations'::regclass LOOP
    EXECUTE format('ALTER TABLE public.payments DROP CONSTRAINT %I', fk);
  END LOOP;
  ALTER TABLE public.payments ADD CONSTRAINT payments_quotation_id_fkey
    FOREIGN KEY (quotation_id) REFERENCES public.quotations(id) ON DELETE RESTRICT;
END $$;

-- 4) payment amount must be positive (new and changed rows) ----------------------------------------------------------------------
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_amount_positive;
ALTER TABLE public.payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0) NOT VALID;
-- After the old data is reviewed (M0 inventory block 10), run once:  ALTER TABLE public.payments VALIDATE CONSTRAINT payments_amount_positive;

-- 5) audit trail cannot be written in somebody else's name -------------------------------------------------------------------------
ALTER TABLE public.audit_logs ALTER COLUMN user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS "audit_logs_insert" ON public.audit_logs;
CREATE POLICY "audit_logs_insert" ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (public.app_rank() >= 1 AND user_id = auth.uid());
