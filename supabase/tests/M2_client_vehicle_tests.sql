-- ======================================================================================================================
-- M2 tests: client 360, vehicles, duplicate finder, global search, assignment rule, reuse of an existing vehicle.
-- RUN ON STAGING ONLY, in Supabase SQL Editor, as the postgres user. One transaction, ends with ROLLBACK: no test data stays.
-- Needs the M1 and M2 migrations applied. The last SELECT lists PASS / FAIL lines: every line must say PASS.
-- Status: executed against a real PostgreSQL 16 with the full migration chain (see docs/M2_report.md). Run it again on your staging project.
-- ======================================================================================================================
BEGIN;
SELECT set_config('m2.results', '', true);

INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-0000-0000-0000000000b1', 'm2-staff@test.invalid',   'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', 'm2-manager@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b3', 'm2-owner@test.invalid',   'authenticated', 'authenticated');
UPDATE public.profiles SET role = 'staff',   active = true WHERE id = '00000000-0000-0000-0000-0000000000b1';
UPDATE public.profiles SET role = 'manager', active = true WHERE id = '00000000-0000-0000-0000-0000000000b2';
UPDATE public.profiles SET role = 'admin',   active = true WHERE id = '00000000-0000-0000-0000-0000000000b3';

-- fixtures (made as postgres). "Old" client rows are created WITHOUT the new columns to prove existing rows stay valid.
INSERT INTO public.clients (id, name, phone, cnic, created_by) VALUES
  ('00000000-0000-0000-0000-00000000f001', 'Ali Khan',   '0300-1234567', '35202-1234567-1', '00000000-0000-0000-0000-0000000000b3'),
  ('00000000-0000-0000-0000-00000000f002', 'Star Motors', '042-35761234', NULL,              '00000000-0000-0000-0000-0000000000b3');
UPDATE public.clients SET client_type = 'showroom' WHERE id = '00000000-0000-0000-0000-00000000f002';
INSERT INTO public.vehicles (id, client_id, registration_number, chassis_number, company, model, created_by) VALUES
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000f001', 'LEA-21-1234', 'JTDKB20U0-12345', 'Toyota', 'Corolla', '00000000-0000-0000-0000-0000000000b3'),
  ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-00000000f001', 'ABC 777',      NULL,              'Honda',  'Civic',   '00000000-0000-0000-0000-0000000000b3');

-- T1 normalisers (same examples as tests/duplicates.test.ts)
SELECT set_config('m2.results', current_setting('m2.results') ||
  CASE WHEN public.lb_norm_phone('0300-1234567') = '03001234567' AND public.lb_norm_phone('+92 300 1234567') = '03001234567'
        AND public.lb_norm_phone('0092-300-1234567') = '03001234567' AND public.lb_norm_phone('923001234567') = '03001234567'
        AND public.lb_norm_phone('3001234567') = '03001234567' AND public.lb_norm_phone('123') IS NULL AND public.lb_norm_phone(NULL) IS NULL
       THEN 'PASS' ELSE 'FAIL' END || ' T1a phone normaliser' || E'\n', true);
SELECT set_config('m2.results', current_setting('m2.results') ||
  CASE WHEN public.lb_norm_cnic('35202-1234567-1') = '3520212345671' AND public.lb_norm_cnic('3520212345') IS NULL
        AND public.lb_norm_plate('lea-21 1234') = 'LEA211234' AND public.lb_norm_plate('AB') IS NULL
        AND public.lb_norm_chassis('jtdkb20u0-12345') = 'JTDKB20U012345' AND public.lb_norm_chassis('1234') IS NULL
       THEN 'PASS' ELSE 'FAIL' END || ' T1b cnic / plate / chassis normaliser' || E'\n', true);

-- T2 existing rows kept their data and got safe defaults
SELECT set_config('m2.results', current_setting('m2.results') ||
  CASE WHEN (SELECT status = 'active' AND assigned_to IS NULL AND business_type IS NULL AND name = 'Ali Khan' AND phone = '0300-1234567' FROM public.clients WHERE id = '00000000-0000-0000-0000-00000000f001')
       THEN 'PASS' ELSE 'FAIL' END || ' T2 existing client unchanged, defaults applied' || E'\n', true);

-- T3 duplicate finder as STAFF: finds by phone written differently, by CNIC, by plate and chassis; never blocks; excludes the record being edited
DO $$
DECLARE r jsonb; ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r := public.find_duplicates('+92 300 1234567', '35202-1234567-1', NULL, NULL, NULL, NULL);
  ok := jsonb_array_length(r->'clients') = 1 AND r->'clients'->0->'reasons' = '["phone","cnic"]'::jsonb;
  r := public.find_duplicates('03001234567', NULL, NULL, NULL, '00000000-0000-0000-0000-00000000f001', NULL);
  ok := ok AND jsonb_array_length(r->'clients') = 0;
  r := public.find_duplicates(NULL, NULL, 'lea 21 1234', 'JTDKB20U0 12345', NULL, NULL);
  ok := ok AND jsonb_array_length(r->'vehicles') = 1 AND r->'vehicles'->0->'reasons' = '["registration","chassis"]'::jsonb AND r->'vehicles'->0->>'client_name' = 'Ali Khan';
  r := public.find_duplicates('12', NULL, 'AB', NULL, NULL, NULL);
  ok := ok AND jsonb_array_length(r->'clients') = 0 AND jsonb_array_length(r->'vehicles') = 0;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('m2.results', current_setting('m2.results') || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' T3 duplicate finder (phone, CNIC, plate, chassis, exclude self, too-short ignored)' || E'\n', true);
END $$;

-- T4 duplicates are only warned about: a second client with the same phone can still be saved (nothing blocks, nothing merges)
DO $$
DECLARE n int; ok boolean := true;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.clients (name, phone) VALUES ('Ali Khan (second)', '03001234567');
    INSERT INTO public.vehicles (registration_number, client_id) VALUES ('LEA211234', '00000000-0000-0000-0000-00000000f001');
  EXCEPTION WHEN OTHERS THEN ok := false;
  END;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM public.clients WHERE phone IN ('0300-1234567', '03001234567');
  PERFORM set_config('m2.results', current_setting('m2.results') || CASE WHEN ok AND n = 2 THEN 'PASS' ELSE 'FAIL' END || ' T4 duplicate is saved when the user chooses to, never merged' || E'\n', true);
END $$;

-- T5 assignment rule: staff cannot assign to someone else or change it; staff may take a new client for themselves; manager may assign
DO $$
DECLARE e_ins boolean := false; e_upd boolean := false; ok_self boolean := true; ok_mgr boolean := true;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN INSERT INTO public.clients (name, assigned_to) VALUES ('Assigned elsewhere', '00000000-0000-0000-0000-0000000000b2'); EXCEPTION WHEN OTHERS THEN e_ins := true; END;
  BEGIN INSERT INTO public.clients (name, assigned_to) VALUES ('Mine', '00000000-0000-0000-0000-0000000000b1'); EXCEPTION WHEN OTHERS THEN ok_self := false; END;
  BEGIN UPDATE public.clients SET assigned_to = '00000000-0000-0000-0000-0000000000b2' WHERE id = '00000000-0000-0000-0000-00000000f001'; EXCEPTION WHEN OTHERS THEN e_upd := true; END;
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
  BEGIN UPDATE public.clients SET assigned_to = '00000000-0000-0000-0000-0000000000b1' WHERE id = '00000000-0000-0000-0000-00000000f001'; EXCEPTION WHEN OTHERS THEN ok_mgr := false; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('m2.results', current_setting('m2.results') || CASE WHEN e_ins AND e_upd THEN 'PASS' ELSE 'FAIL' END || ' T5a staff cannot assign / reassign a client (direct API)' || E'\n', true);
  PERFORM set_config('m2.results', current_setting('m2.results') || CASE WHEN ok_self AND ok_mgr THEN 'PASS' ELSE 'FAIL' END || ' T5b staff may take a client for self, manager may assign' || E'\n', true);
END $$;

-- T6 status can only be active / inactive
DO $$
DECLARE e boolean := false;
BEGIN
  BEGIN UPDATE public.clients SET status = 'banana' WHERE id = '00000000-0000-0000-0000-00000000f001'; EXCEPTION WHEN check_violation THEN e := true; END;
  PERFORM set_config('m2.results', current_setting('m2.results') || CASE WHEN e THEN 'PASS' ELSE 'FAIL' END || ' T6 client status is validated' || E'\n', true);
END $$;

-- T7 global search as STAFF: name, phone written another way, CNIC, plate, chassis; archived last; short query returns nothing; wildcard characters are literal
DO $$
DECLARE ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ok := jsonb_array_length(public.global_search('ali khan')->'clients') >= 1
    AND jsonb_array_length(public.global_search('+92 300 1234567')->'clients') >= 1
    AND jsonb_array_length(public.global_search('3520212345671')->'clients') = 1
    AND jsonb_array_length(public.global_search('lea 21 1234')->'vehicles') >= 1
    AND jsonb_array_length(public.global_search('jtdkb20u012345')->'vehicles') = 1
    AND jsonb_array_length(public.global_search('a')->'clients') = 0
    AND jsonb_array_length(public.global_search('%%')->'clients') = 0
    AND public.global_search('corolla')->'vehicles'->0->>'client_name' = 'Ali Khan';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('m2.results', current_setting('m2.results') || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' T7 global search finds clients and vehicles by every identifier' || E'\n', true);
END $$;

-- T8 an inactive account cannot search or check duplicates
DO $$
DECLARE e1 boolean := false; e2 boolean := false;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES ('00000000-0000-0000-0000-0000000000b4', 'm2-inactive@test.invalid', 'authenticated', 'authenticated');
  UPDATE public.profiles SET role = 'staff', active = false WHERE id = '00000000-0000-0000-0000-0000000000b4';
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b4","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.global_search('ali'); EXCEPTION WHEN OTHERS THEN e1 := true; END;
  BEGIN PERFORM public.find_duplicates('03001234567'); EXCEPTION WHEN OTHERS THEN e2 := true; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('m2.results', current_setting('m2.results') || CASE WHEN e1 AND e2 THEN 'PASS' ELSE 'FAIL' END || ' T8 inactive account is refused by search and duplicate check' || E'\n', true);
END $$;

-- T9 quotation from an EXISTING vehicle links it and inserts no second vehicle row
DO $$
DECLARE r jsonb; n_before int; n_after int; ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n_before FROM public.vehicles;
  r := public.create_quotation_atomic('00000000-0000-0000-0000-00000000f001',
      '{"id":"00000000-0000-0000-0000-00000000a001"}'::jsonb,
      '{"transaction_type":"transfer","subtotal_govt":1000,"subtotal_service":200,"subtotal_additional":0,"grand_total":1200}'::jsonb,
      '[{"label":"Transfer fee","category":"government","amount":1000,"fee_type":"t","sort_order":1},{"label":"Service","category":"service","amount":200,"fee_type":"s","sort_order":2}]'::jsonb);
  SELECT count(*) INTO n_after FROM public.vehicles;
  ok := (r->>'vehicle_id') = '00000000-0000-0000-0000-00000000a001' AND n_before = n_after
        AND (SELECT vehicle_id FROM public.quotations WHERE id = (r->>'quotation_id')::uuid) = '00000000-0000-0000-0000-00000000a001';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('m2.results', current_setting('m2.results') || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' T9 existing vehicle is linked, not duplicated' || E'\n', true);
END $$;

-- T10 an unknown vehicle id, or a vehicle of an unrelated client, is refused and leaves nothing behind; a new vehicle (no id) still works
DO $$
DECLARE e_missing boolean := false; e_other boolean := false; n_q_before int; n_q_after int; r jsonb; ok_new boolean := true;
  items jsonb := '[{"label":"Fee","category":"government","amount":500,"fee_type":"f","sort_order":1}]';
  hdr jsonb := '{"transaction_type":"transfer","subtotal_govt":500,"subtotal_service":0,"subtotal_additional":0,"grand_total":500}';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n_q_before FROM public.quotations;
  BEGIN PERFORM public.create_quotation_atomic('00000000-0000-0000-0000-00000000f001', '{"id":"00000000-0000-0000-0000-0000deadbeef"}'::jsonb, hdr, items); EXCEPTION WHEN OTHERS THEN e_missing := true; END;
  -- vehicle a001 belongs to Ali Khan; quotation client is Star Motors (not his parent, not his child) -> refused
  BEGIN PERFORM public.create_quotation_atomic('00000000-0000-0000-0000-00000000f002', '{"id":"00000000-0000-0000-0000-00000000a001"}'::jsonb, hdr, items); EXCEPTION WHEN OTHERS THEN e_other := true; END;
  SELECT count(*) INTO n_q_after FROM public.quotations;
  BEGIN r := public.create_quotation_atomic('00000000-0000-0000-0000-00000000f002', '{"registration_number":"NEW-1","chassis_number":"CHASSIS-NEW-1"}'::jsonb, hdr, items); EXCEPTION WHEN OTHERS THEN ok_new := false; END;
  EXECUTE 'RESET ROLE';
  ok_new := ok_new AND (SELECT chassis_number FROM public.vehicles WHERE id = (r->>'vehicle_id')::uuid) = 'CHASSIS-NEW-1';
  PERFORM set_config('m2.results', current_setting('m2.results') || CASE WHEN e_missing AND e_other AND n_q_before = n_q_after THEN 'PASS' ELSE 'FAIL' END || ' T10a bad vehicle id refused, nothing saved' || E'\n', true);
  PERFORM set_config('m2.results', current_setting('m2.results') || CASE WHEN ok_new THEN 'PASS' ELSE 'FAIL' END || ' T10b new vehicle (no id) still saved with chassis number' || E'\n', true);
END $$;

-- T11 showroom customer: a vehicle of a customer billed to the showroom may be quoted under the showroom
DO $$
DECLARE r jsonb; ok boolean := true;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  UPDATE public.clients SET parent_id = '00000000-0000-0000-0000-00000000f002', bill_to_parent = true WHERE id = '00000000-0000-0000-0000-00000000f001';
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN r := public.create_quotation_atomic('00000000-0000-0000-0000-00000000f002', '{"id":"00000000-0000-0000-0000-00000000a002"}'::jsonb,
      '{"transaction_type":"transfer","subtotal_govt":500,"subtotal_service":0,"subtotal_additional":0,"grand_total":500}'::jsonb,
      '[{"label":"Fee","category":"government","amount":500,"fee_type":"f","sort_order":1}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN ok := false; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('m2.results', current_setting('m2.results') || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' T11 showroom may quote its customer''s vehicle' || E'\n', true);
END $$;

SELECT current_setting('m2.results') AS results;   -- every line must say PASS
ROLLBACK;
