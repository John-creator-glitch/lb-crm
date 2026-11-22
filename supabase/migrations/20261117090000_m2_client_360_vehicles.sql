/*
# M2: Client 360 and vehicle management

Run on STAGING first, after a fresh backup. Safe to run more than once. Needs the M1 migration (20261109090000) applied first.
Purely additive: no existing column is changed or dropped, no existing row is rewritten (new columns get defaults / stay empty).

1. vehicles: chassis_number, engine_number (so vehicles can be searched and checked for duplicates by chassis too).
2. clients: status (active / inactive), assigned_to (the staff member who looks after the client), business_type (free text, e.g. Garage).
   Only a Manager or the Owner can assign a client to somebody (database trigger, not only a hidden button).
3. Normalising functions (phone, CNIC, number plate, chassis) so "0300-1234567", "+92 300 1234567" and "03001234567" are the same number.
4. Plain (NOT unique) indexes on the normalised values: duplicates are WARNED about, never blocked or merged.
5. find_duplicates(): returns clients / vehicles that share a phone, CNIC, registration number or chassis number with what is being typed.
6. global_search(): one search over client name, phone, CNIC, C/O, vehicle registration, chassis and engine number.
   Both functions run as the signed-in user (SECURITY INVOKER), so row level security decides what each person can see.
7. create_quotation_atomic(): can now link an EXISTING vehicle (p_vehicle.id) instead of always inserting a new vehicle row.
   Everything else in that function is exactly as in M1.

NOT in M2 on purpose: documents and reminders tabs (M3 / M5), quotation-from-vehicle workflow and case rules (M3), payment allocation (M4).
*/

-- 1) vehicles -------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS chassis_number text;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS engine_number text;

-- 2) clients --------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_status_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_status_check CHECK (status IN ('active', 'inactive'));
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS business_type text;
CREATE INDEX IF NOT EXISTS idx_clients_assigned ON public.clients (assigned_to);

-- Only Manager / Owner may assign a client to a person (staff may leave it empty, or take a new client for themselves).
-- auth.uid() is null for the SQL editor / service role: those are not blocked.
CREATE OR REPLACE FUNCTION public.clients_guard_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.app_rank() >= 2 THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_to IS NOT NULL AND NEW.assigned_to <> auth.uid() THEN
      RAISE EXCEPTION 'Only a manager or the owner can assign a client to another person.';
    END IF;
  ELSIF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    RAISE EXCEPTION 'Only a manager or the owner can change who a client is assigned to.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS clients_guard_assignment_trg ON public.clients;
CREATE TRIGGER clients_guard_assignment_trg BEFORE INSERT OR UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.clients_guard_assignment();

-- 3) normalisers (the TypeScript twins live in src/lib/duplicates.ts and are tested with the same examples) -----------------------
-- Phone: digits only; +92 / 0092 / 92 prefix becomes 0; a bare 3xxxxxxxxx mobile gets its 0. Fewer than 7 digits: not comparable (NULL).
CREATE OR REPLACE FUNCTION public.lb_norm_phone(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN length(d) < 7 THEN NULL
    WHEN d ~ '^0092[0-9]{10}$' THEN '0' || substr(d, 5)
    WHEN d ~ '^92[0-9]{10}$'   THEN '0' || substr(d, 3)
    WHEN d ~ '^3[0-9]{9}$'     THEN '0' || d
    ELSE d END
  FROM (SELECT regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g') AS d) s
$$;
-- CNIC: exactly 13 digits, otherwise NULL.
CREATE OR REPLACE FUNCTION public.lb_norm_cnic(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN length(d) = 13 THEN d ELSE NULL END
  FROM (SELECT regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g') AS d) s
$$;
-- Number plate: letters and digits only, upper case, at least 3 characters.
CREATE OR REPLACE FUNCTION public.lb_norm_plate(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN length(d) >= 3 THEN d ELSE NULL END
  FROM (SELECT upper(regexp_replace(coalesce(t, ''), '[^A-Za-z0-9]', '', 'g')) AS d) s
$$;
-- Chassis / engine number: letters and digits only, upper case, at least 5 characters.
CREATE OR REPLACE FUNCTION public.lb_norm_chassis(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN length(d) >= 5 THEN d ELSE NULL END
  FROM (SELECT upper(regexp_replace(coalesce(t, ''), '[^A-Za-z0-9]', '', 'g')) AS d) s
$$;
GRANT EXECUTE ON FUNCTION public.lb_norm_phone(text), public.lb_norm_cnic(text), public.lb_norm_plate(text), public.lb_norm_chassis(text) TO authenticated;

-- 4) plain indexes (NOT unique: a duplicate is a warning, never an error) --------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_clients_norm_phone ON public.clients (public.lb_norm_phone(phone));
CREATE INDEX IF NOT EXISTS idx_clients_norm_cnic ON public.clients (public.lb_norm_cnic(cnic));
CREATE INDEX IF NOT EXISTS idx_vehicles_norm_plate ON public.vehicles (public.lb_norm_plate(registration_number));
CREATE INDEX IF NOT EXISTS idx_vehicles_norm_chassis ON public.vehicles (public.lb_norm_chassis(chassis_number));

-- 5) duplicate finder -----------------------------------------------------------------------------------------------------------
-- Pass whatever is being typed (any argument may be null). Pass the id of the record being edited to leave it out of the answer.
-- Returns { clients: [{id,name,phone,cnic,archived,reasons:[...]}], vehicles: [{id,client_id,client_name,registration_number,chassis_number,reasons:[...]}] }
CREATE OR REPLACE FUNCTION public.find_duplicates(p_phone text DEFAULT NULL, p_cnic text DEFAULT NULL, p_registration text DEFAULT NULL,
                                                 p_chassis text DEFAULT NULL, p_exclude_client uuid DEFAULT NULL, p_exclude_vehicle uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  n_phone text := public.lb_norm_phone(p_phone);
  n_cnic text := public.lb_norm_cnic(p_cnic);
  n_plate text := public.lb_norm_plate(p_registration);
  n_chassis text := public.lb_norm_chassis(p_chassis);
  res_c jsonb := '[]'::jsonb;
  res_v jsonb := '[]'::jsonb;
BEGIN
  IF public.app_rank() < 1 THEN RAISE EXCEPTION 'Your account is not active.'; END IF;

  IF n_phone IS NOT NULL OR n_cnic IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) INTO res_c FROM (
      SELECT c.id, c.name, c.phone, c.cnic, (c.archived_at IS NOT NULL) AS archived,
             array_remove(ARRAY[CASE WHEN n_phone IS NOT NULL AND public.lb_norm_phone(c.phone) = n_phone THEN 'phone' END,
                                CASE WHEN n_cnic  IS NOT NULL AND public.lb_norm_cnic(c.cnic)   = n_cnic  THEN 'cnic'  END], NULL) AS reasons
      FROM public.clients c
      WHERE (p_exclude_client IS NULL OR c.id <> p_exclude_client)
        AND ((n_phone IS NOT NULL AND public.lb_norm_phone(c.phone) = n_phone) OR (n_cnic IS NOT NULL AND public.lb_norm_cnic(c.cnic) = n_cnic))
      ORDER BY c.created_at LIMIT 10) m;
  END IF;

  IF n_plate IS NOT NULL OR n_chassis IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) INTO res_v FROM (
      SELECT v.id, v.client_id, cl.name AS client_name, v.registration_number, v.chassis_number,
             array_remove(ARRAY[CASE WHEN n_plate   IS NOT NULL AND public.lb_norm_plate(v.registration_number) = n_plate     THEN 'registration' END,
                                CASE WHEN n_chassis IS NOT NULL AND public.lb_norm_chassis(v.chassis_number)    = n_chassis   THEN 'chassis' END], NULL) AS reasons
      FROM public.vehicles v LEFT JOIN public.clients cl ON cl.id = v.client_id
      WHERE (p_exclude_vehicle IS NULL OR v.id <> p_exclude_vehicle)
        AND ((n_plate IS NOT NULL AND public.lb_norm_plate(v.registration_number) = n_plate) OR (n_chassis IS NOT NULL AND public.lb_norm_chassis(v.chassis_number) = n_chassis))
      ORDER BY v.created_at LIMIT 10) m;
  END IF;

  RETURN jsonb_build_object('clients', res_c, 'vehicles', res_v);
END $$;
REVOKE ALL ON FUNCTION public.find_duplicates(text, text, text, text, uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.find_duplicates(text, text, text, text, uuid, uuid) TO authenticated;

-- 6) global search --------------------------------------------------------------------------------------------------------------
-- Money is never returned here. Archived clients are returned (flagged) after the active ones.
CREATE OR REPLACE FUNCTION public.global_search(p_q text, p_limit int DEFAULT 15) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  q text := btrim(coalesce(p_q, ''));
  lim int := least(greatest(coalesce(p_limit, 15), 1), 50);
  like_q text;
  q_digits text := regexp_replace(q, '[^0-9]', '', 'g');
  q_phone text := public.lb_norm_phone(q);
  q_alnum text := upper(regexp_replace(q, '[^A-Za-z0-9]', '', 'g'));
  res_c jsonb := '[]'::jsonb;
  res_v jsonb := '[]'::jsonb;
BEGIN
  IF public.app_rank() < 1 THEN RAISE EXCEPTION 'Your account is not active.'; END IF;
  IF length(q) < 2 THEN RETURN jsonb_build_object('clients', res_c, 'vehicles', res_v); END IF;
  like_q := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) INTO res_c FROM (
    SELECT c.id, c.name, c.phone, c.cnic, c.client_type, c.care_of, c.parent_id, (c.archived_at IS NOT NULL) AS archived
    FROM public.clients c
    WHERE c.name ILIKE like_q OR coalesce(c.care_of, '') ILIKE like_q OR coalesce(c.email, '') ILIKE like_q
       OR (length(q_digits) >= 3 AND (regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') LIKE '%' || q_digits || '%'
                                      OR regexp_replace(coalesce(c.cnic, ''), '[^0-9]', '', 'g') LIKE '%' || q_digits || '%'))
       OR (q_phone IS NOT NULL AND public.lb_norm_phone(c.phone) = q_phone)
    ORDER BY (c.archived_at IS NOT NULL), (c.name ILIKE replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%') DESC, c.name
    LIMIT lim) m;

  SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) INTO res_v FROM (
    SELECT v.id, v.client_id, cl.name AS client_name, v.registration_number, v.chassis_number, v.engine_number, v.company, v.model, v.manufacturing_year
    FROM public.vehicles v LEFT JOIN public.clients cl ON cl.id = v.client_id
    WHERE (length(q_alnum) >= 3 AND (upper(regexp_replace(coalesce(v.registration_number, ''), '[^A-Za-z0-9]', '', 'g')) LIKE '%' || q_alnum || '%'
                                     OR upper(regexp_replace(coalesce(v.chassis_number, ''), '[^A-Za-z0-9]', '', 'g')) LIKE '%' || q_alnum || '%'
                                     OR upper(regexp_replace(coalesce(v.engine_number, ''), '[^A-Za-z0-9]', '', 'g')) LIKE '%' || q_alnum || '%'))
       OR coalesce(v.company, '') || ' ' || coalesce(v.model, '') ILIKE like_q
    ORDER BY v.created_at DESC
    LIMIT lim) m;

  RETURN jsonb_build_object('clients', res_c, 'vehicles', res_v);
END $$;
REVOKE ALL ON FUNCTION public.global_search(text, int) FROM public;
GRANT EXECUTE ON FUNCTION public.global_search(text, int) TO authenticated;

-- 7) quotation save can reuse an existing vehicle ----------------------------------------------------------------------------------
-- Same function as in M1 with ONE change: if p_vehicle contains "id", that vehicle is linked (it must exist and belong to the same client,
-- or to the client's showroom / customer) and no new vehicle row is inserted. Without "id" it behaves exactly as before.
CREATE OR REPLACE FUNCTION public.create_quotation_atomic(p_client_id uuid, p_vehicle jsonb, p_quotation jsonb, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_vehicle_id uuid;
  v_existing_id uuid;
  v_vehicle_owner uuid;
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

  -- vehicle (optional): link an existing one, or insert a new one
  IF p_vehicle IS NOT NULL AND jsonb_typeof(p_vehicle) = 'object' AND p_vehicle <> '{}'::jsonb THEN
    v_existing_id := nullif(p_vehicle->>'id', '')::uuid;
    IF v_existing_id IS NOT NULL THEN
      SELECT v.client_id INTO v_vehicle_owner FROM public.vehicles v WHERE v.id = v_existing_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'The selected vehicle no longer exists. Pick the vehicle again.'; END IF;
      IF v_vehicle_owner IS NOT NULL AND v_vehicle_owner <> p_client_id
         AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v_vehicle_owner AND c.parent_id = p_client_id)
         AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = p_client_id AND c.parent_id = v_vehicle_owner) THEN
        RAISE EXCEPTION 'This vehicle belongs to a different client.';
      END IF;
      v_vehicle_id := v_existing_id;
    ELSE
      INSERT INTO public.vehicles (client_id, province, registration_type, vehicle_category, company, model, engine_cc, manufacturing_year,
                                   invoice_value, registration_number, filer_status, origin, fuel_type, chassis_number, engine_number)
      VALUES (p_client_id, nullif(p_vehicle->>'province', ''), nullif(p_vehicle->>'registration_type', ''), nullif(p_vehicle->>'vehicle_category', ''),
              nullif(p_vehicle->>'company', ''), nullif(p_vehicle->>'model', ''), nullif(p_vehicle->>'engine_cc', '')::int,
              nullif(p_vehicle->>'manufacturing_year', '')::int, nullif(p_vehicle->>'invoice_value', '')::numeric,
              nullif(p_vehicle->>'registration_number', ''), nullif(p_vehicle->>'filer_status', ''), nullif(p_vehicle->>'origin', ''),
              nullif(p_vehicle->>'fuel_type', ''), nullif(p_vehicle->>'chassis_number', ''), nullif(p_vehicle->>'engine_number', ''))
      RETURNING id INTO v_vehicle_id;
    END IF;
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
