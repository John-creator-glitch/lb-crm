-- ======================================================================================================================
-- M1 role and integrity tests. RUN ON STAGING ONLY, in Supabase SQL Editor, as the postgres user.
-- Everything runs inside one transaction and ends with ROLLBACK, so no test data stays. The last SELECT shows PASS / FAIL lines.
-- Needs: 20261108180000_roles_and_rights.sql and 20261109090000_m1_integrity_permissions.sql already applied, and at least one
-- existing owner (so the test users do not become owner).
-- Status: executed against PostgreSQL 16 during M2 (all PASS after fixing T2, which counted the owner-only audit log as staff). Run again on your staging project.
-- ======================================================================================================================
BEGIN;
SELECT set_config('m1.results', '', true);

-- test users (ids are fixed so the blocks below can impersonate them)
INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'm1-staff@test.invalid',   'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a2', 'm1-manager@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a3', 'm1-owner@test.invalid',   'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a4', 'm1-inactive@test.invalid','authenticated', 'authenticated');
UPDATE public.profiles SET role = 'staff',   active = true  WHERE id = '00000000-0000-0000-0000-0000000000a1';
UPDATE public.profiles SET role = 'manager', active = true  WHERE id = '00000000-0000-0000-0000-0000000000a2';
UPDATE public.profiles SET role = 'admin',   active = true  WHERE id = '00000000-0000-0000-0000-0000000000a3';
UPDATE public.profiles SET role = 'staff',   active = false WHERE id = '00000000-0000-0000-0000-0000000000a4';

-- fixture rows made as postgres
INSERT INTO public.clients (id, name, created_by) VALUES ('00000000-0000-0000-0000-00000000c001', 'M1 Test Client', '00000000-0000-0000-0000-0000000000a3');
INSERT INTO public.quotations (id, quotation_number, client_id, status, subtotal_govt, grand_total, created_by)
  VALUES ('00000000-0000-0000-0000-00000000d001', 'M1-TEST-Q1', '00000000-0000-0000-0000-00000000c001', 'approved', 1000, 1000, '00000000-0000-0000-0000-0000000000a3');
INSERT INTO public.payments (id, quotation_id, amount, created_by)
  VALUES ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000d001', 500, '00000000-0000-0000-0000-0000000000a3');
INSERT INTO public.audit_logs (user_id, action) VALUES ('00000000-0000-0000-0000-0000000000a3', 'm1_fixture');
INSERT INTO public.app_settings (key, value) VALUES ('m1_test_key', '{}'::jsonb);

-- T1 forced failure after the vehicle row is inserted leaves NO partial records (amount 1e20 overflows numeric(14,2) at the quotation insert)
DO $$
DECLARE failed boolean := false; n_v int; n_q int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.create_quotation_atomic('00000000-0000-0000-0000-00000000c001',
      '{"province":"punjab","registration_type":"new_registration","vehicle_category":"car","registration_number":"M1-ROLLBACK"}'::jsonb,
      '{"transaction_type":"new_registration","subtotal_govt":1e20,"subtotal_service":0,"subtotal_additional":0,"grand_total":1e20}'::jsonb,
      '[{"label":"Huge","category":"government","amount":1e20,"fee_type":"x","sort_order":1}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN failed := true;
  END;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n_v FROM public.vehicles WHERE registration_number = 'M1-ROLLBACK';
  SELECT count(*) INTO n_q FROM public.quotations WHERE grand_total >= 1e12;
  PERFORM set_config('m1.results', current_setting('m1.results') || CASE WHEN failed AND n_v = 0 AND n_q = 0 THEN 'PASS' ELSE 'FAIL' END || ' T1 forced failure leaves no partial records' || E'\n', true);
END $$;

-- T2 good save: vehicle + quotation + 2 items + audit row in the staff user's name
DO $$
DECLARE r jsonb; n_i int; n_a int; v_ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r := public.create_quotation_atomic('00000000-0000-0000-0000-00000000c001',
      '{"province":"punjab","registration_type":"new_registration","vehicle_category":"car","registration_number":"M1-GOOD"}'::jsonb,
      '{"transaction_type":"new_registration","subtotal_govt":1000,"subtotal_service":200,"subtotal_additional":0,"grand_total":1200,"validity_days":15}'::jsonb,
      '[{"label":"Registration fee","category":"government","amount":1000,"fee_type":"reg","sort_order":1},{"label":"Service","category":"service","amount":200,"fee_type":"service_charge","sort_order":100}]'::jsonb);
  SELECT count(*) INTO n_i FROM public.quotation_line_items WHERE quotation_id = (r->>'quotation_id')::uuid;
  v_ok := (r->>'quotation_number') ~ '^LB-[0-9]{8}-[0-9A-F]{4}$' AND (r->>'vehicle_id') IS NOT NULL AND n_i = 2;
  EXECUTE 'RESET ROLE';
  -- audit log is owner-only to read, so it is counted after leaving the staff role (counting it as staff always gives 0)
  SELECT count(*) INTO n_a FROM public.audit_logs WHERE entity_id = (r->>'quotation_id')::uuid AND user_id = '00000000-0000-0000-0000-0000000000a1';
  PERFORM set_config('m1.results', current_setting('m1.results') || CASE WHEN v_ok AND n_a = 1 THEN 'PASS' ELSE 'FAIL' END || ' T2 valid save creates everything once' || E'\n', true);
END $$;

-- T3 totals that do not match the items are refused; T3b empty items refused
DO $$
DECLARE e1 boolean := false; e2 boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.create_quotation_atomic('00000000-0000-0000-0000-00000000c001', '{}'::jsonb,
      '{"subtotal_govt":999,"subtotal_service":0,"subtotal_additional":0,"grand_total":999}'::jsonb,
      '[{"label":"A","category":"government","amount":1000,"fee_type":"x","sort_order":1}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN e1 := true; END;
  BEGIN PERFORM public.create_quotation_atomic('00000000-0000-0000-0000-00000000c001', '{}'::jsonb, '{"grand_total":0}'::jsonb, '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN e2 := true; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('m1.results', current_setting('m1.results') || CASE WHEN e1 AND e2 THEN 'PASS' ELSE 'FAIL' END || ' T3 mismatched totals and empty items are refused' || E'\n', true);
END $$;

-- T4 staff cannot change or delete a recorded payment (rows are invisible to the update, so 0 rows change)
DO $$
DECLARE n_u int; n_d int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.payments SET amount = 1 WHERE id = '00000000-0000-0000-0000-00000000e001'; GET DIAGNOSTICS n_u = ROW_COUNT;
  DELETE FROM public.payments WHERE id = '00000000-0000-0000-0000-00000000e001'; GET DIAGNOSTICS n_d = ROW_COUNT;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('m1.results', current_setting('m1.results') || CASE WHEN n_u = 0 AND n_d = 0 THEN 'PASS' ELSE 'FAIL' END || ' T4 staff cannot edit or delete a payment' || E'\n', true);
END $$;

-- T5 manager can correct a payment's details (notes); since M4 the amount is locked and wrong payments are reversed (see M4 tests)
DO $$
DECLARE n_u int; amt_blocked boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.payments SET notes = 'corrected by manager' WHERE id = '00000000-0000-0000-0000-00000000e001'; GET DIAGNOSTICS n_u = ROW_COUNT;
  IF to_regproc('public.reverse_payment(text,uuid,text)') IS NOT NULL THEN
    BEGIN UPDATE public.payments SET amount = 600 WHERE id = '00000000-0000-0000-0000-00000000e001'; EXCEPTION WHEN OTHERS THEN amt_blocked := true; END;
  ELSE amt_blocked := true;   -- M4 not installed: nothing to check
  END IF;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('m1.results', current_setting('m1.results') || CASE WHEN n_u = 1 AND amt_blocked THEN 'PASS' ELSE 'FAIL' END || ' T5 manager can correct payment details; amount is locked' || E'\n', true);
END $$;

-- T6 staff cannot read the audit log; T7 staff cannot change settings (update touches 0 rows, insert is refused)
DO $$
DECLARE n_a int; n_u int; ins_blocked boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n_a FROM public.audit_logs;
  UPDATE public.app_settings SET value = '{"hacked":true}'::jsonb WHERE key = 'm1_test_key'; GET DIAGNOSTICS n_u = ROW_COUNT;
  BEGIN INSERT INTO public.app_settings (key, value) VALUES ('m1_staff_key', '{}'::jsonb); EXCEPTION WHEN OTHERS THEN ins_blocked := true; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('m1.results', current_setting('m1.results') || CASE WHEN n_a = 0 THEN 'PASS' ELSE 'FAIL' END || ' T6 staff cannot read the audit log' || E'\n', true);
  PERFORM set_config('m1.results', current_setting('m1.results') || CASE WHEN n_u = 0 AND ins_blocked THEN 'PASS' ELSE 'FAIL' END || ' T7 staff cannot change settings' || E'\n', true);
END $$;

-- T8 audit entries cannot be written in someone else's name (and the default fills the real user)
DO $$
DECLARE spoof_blocked boolean := false; own_ok boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN INSERT INTO public.audit_logs (user_id, action) VALUES ('00000000-0000-0000-0000-0000000000a3', 'm1_spoof'); EXCEPTION WHEN OTHERS THEN spoof_blocked := true; END;
  BEGIN INSERT INTO public.audit_logs (action) VALUES ('m1_own'); own_ok := true; EXCEPTION WHEN OTHERS THEN own_ok := false; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('m1.results', current_setting('m1.results') || CASE WHEN spoof_blocked AND own_ok THEN 'PASS' ELSE 'FAIL' END || ' T8 audit user_id cannot be spoofed' || E'\n', true);
END $$;

-- T9 a quotation with payments cannot be deleted, even by the owner
DO $$
DECLARE blocked boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN DELETE FROM public.quotations WHERE id = '00000000-0000-0000-0000-00000000d001'; EXCEPTION WHEN foreign_key_violation THEN blocked := true; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('m1.results', current_setting('m1.results') || CASE WHEN blocked THEN 'PASS' ELSE 'FAIL' END || ' T9 quotation with payments cannot be deleted' || E'\n', true);
END $$;

-- T10 staff cannot change anybody's access; T11 payment of 0 or less is refused; T13 inactive user sees nothing
DO $$
DECLARE e10 boolean := false; e11 boolean := false; n_c int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.set_user_access('00000000-0000-0000-0000-0000000000a1', 'admin', true); EXCEPTION WHEN OTHERS THEN e10 := true; END;
  BEGIN INSERT INTO public.payments (quotation_id, amount) VALUES ('00000000-0000-0000-0000-00000000d001', 0); EXCEPTION WHEN check_violation THEN e11 := true; END;
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}', true);
  SELECT count(*) INTO n_c FROM public.clients;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('m1.results', current_setting('m1.results') || CASE WHEN e10 THEN 'PASS' ELSE 'FAIL' END || ' T10 staff cannot change user access' || E'\n', true);
  PERFORM set_config('m1.results', current_setting('m1.results') || CASE WHEN e11 THEN 'PASS' ELSE 'FAIL' END || ' T11 zero payment refused' || E'\n', true);
  PERFORM set_config('m1.results', current_setting('m1.results') || CASE WHEN n_c = 0 THEN 'PASS' ELSE 'FAIL' END || ' T13 inactive account sees no data' || E'\n', true);
END $$;

-- T12 Pakistan date helper
SELECT set_config('m1.results', current_setting('m1.results') ||
  CASE WHEN public.lb_today() = (now() AT TIME ZONE 'Asia/Karachi')::date THEN 'PASS' ELSE 'FAIL' END || ' T12 lb_today is the Pakistan date' || E'\n', true);

SELECT current_setting('m1.results') AS results;   -- every line must say PASS
ROLLBACK;
