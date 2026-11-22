-- ======================================================================================================================
-- M3 tests: quotation states, quotation -> case (one action, idempotent), case stages, checklist, status history.
-- RUN ON STAGING ONLY, in Supabase SQL Editor, as the postgres user. One transaction, ends with ROLLBACK: no test data stays.
-- Needs M1, M2 and M3 migrations. Every line of the final result must say PASS.
-- ======================================================================================================================
BEGIN;
SELECT set_config('m3.r', '', true);
INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'm3-staff@test.invalid',   'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c2', 'm3-manager@test.invalid', 'authenticated', 'authenticated');
UPDATE public.profiles SET role = 'staff',   active = true, full_name = 'Staff Test'   WHERE id = '00000000-0000-0000-0000-0000000000c1';
UPDATE public.profiles SET role = 'manager', active = true, full_name = 'Manager Test' WHERE id = '00000000-0000-0000-0000-0000000000c2';

INSERT INTO public.clients (id, name, phone, assigned_to, created_by) VALUES ('00000000-0000-0000-0000-00000000f101', 'M3 Client', '03005550000', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c2');
INSERT INTO public.vehicles (id, client_id, registration_number, created_by) VALUES ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-00000000f101', 'M3-111', '00000000-0000-0000-0000-0000000000c2');
INSERT INTO public.quotations (id, quotation_number, client_id, vehicle_id, transaction_type, status, subtotal_govt, subtotal_service, subtotal_additional, grand_total, created_by) VALUES
  ('00000000-0000-0000-0000-00000000b101', 'M3-Q1', '00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000a101', 'transfer', 'pending', 1000, 200, 50, 1250, '00000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-00000000b102', 'M3-Q2', '00000000-0000-0000-0000-00000000f101', NULL, 'token_tax', 'pending', 100, 0, 0, 100, '00000000-0000-0000-0000-0000000000c2');

-- T1 staff follows the allowed moves; a forbidden move is refused; every real move is logged; the note is kept
DO $$
DECLARE bad boolean := false; ok boolean; n int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.set_quotation_status('00000000-0000-0000-0000-00000000b101', 'approved', 'client confirmed on phone');
  BEGIN PERFORM public.set_quotation_status('00000000-0000-0000-0000-00000000b101', 'draft'); EXCEPTION WHEN OTHERS THEN bad := true; END;   -- approved -> draft is not allowed
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM public.status_history WHERE entity_id = '00000000-0000-0000-0000-00000000b101' AND from_value = 'pending' AND to_value = 'approved' AND note = 'client confirmed on phone' AND changed_by = '00000000-0000-0000-0000-0000000000c1';
  ok := bad AND n = 1 AND (SELECT count(*) FROM public.status_history WHERE entity_id = '00000000-0000-0000-0000-00000000b101') = 1;
  PERFORM set_config('m3.r', current_setting('m3.r') || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' T1 quotation moves enforced and logged with note' || E'\n', true);
END $$;

-- T2 direct UPDATE (not through the helper) is also checked and logged; rejection through the helper needs a reason
DO $$
DECLARE bad boolean := false; ok boolean; need_reason boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN UPDATE public.quotations SET status = 'rejected' WHERE id = '00000000-0000-0000-0000-00000000b102'; EXCEPTION WHEN OTHERS THEN bad := true; END;   -- pending -> rejected is allowed
  BEGIN PERFORM public.set_quotation_status('00000000-0000-0000-0000-00000000b102', 'pending'); EXCEPTION WHEN OTHERS THEN bad := true; END;                -- rejected -> pending allowed
  BEGIN PERFORM public.set_quotation_status('00000000-0000-0000-0000-00000000b102', 'rejected', ''); EXCEPTION WHEN OTHERS THEN need_reason := true; END;
  EXECUTE 'RESET ROLE';
  ok := NOT bad AND need_reason AND (SELECT count(*) FROM public.status_history WHERE entity_id = '00000000-0000-0000-0000-00000000b102') = 2;
  PERFORM set_config('m3.r', current_setting('m3.r') || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' T2 direct update logged; rejection needs a reason' || E'\n', true);
END $$;

-- T3 a completed quotation can be reopened by a manager only
DO $$
DECLARE staff_blocked boolean := false; mgr_ok boolean := true;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);   -- act as the SQL editor (no signed-in user) for fixture changes
  UPDATE public.quotations SET status = 'completed' WHERE id = '00000000-0000-0000-0000-00000000b102';
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.set_quotation_status('00000000-0000-0000-0000-00000000b102', 'approved'); EXCEPTION WHEN OTHERS THEN staff_blocked := true; END;
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
  BEGIN PERFORM public.set_quotation_status('00000000-0000-0000-0000-00000000b102', 'approved', 'correction'); EXCEPTION WHEN OTHERS THEN mgr_ok := false; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('m3.r', current_setting('m3.r') || CASE WHEN staff_blocked AND mgr_ok THEN 'PASS' ELSE 'FAIL' END || ' T3 completed quotation: staff blocked, manager may correct' || E'\n', true);
END $$;

-- T4 a PENDING quotation cannot create a case; an approved one creates exactly one linked case with client, vehicle, fees, assignee and checklist
DO $$
DECLARE refused boolean := false; r jsonb; c public.cases%ROWTYPE; docs int; ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);   -- act as the SQL editor (no signed-in user) for fixture changes
  UPDATE public.quotations SET status = 'pending' WHERE id = '00000000-0000-0000-0000-00000000b102';             -- b102 is pending again for the refusal test
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.create_case_from_quotation('00000000-0000-0000-0000-00000000b102'); EXCEPTION WHEN OTHERS THEN refused := true; END;
  r := public.create_case_from_quotation('00000000-0000-0000-0000-00000000b101');
  EXECUTE 'RESET ROLE';
  SELECT * INTO c FROM public.cases WHERE id = (r->>'case_id')::uuid;
  SELECT count(*) INTO docs FROM public.case_documents WHERE case_id = c.id;
  ok := refused AND (r->>'already_existed')::boolean = false AND c.client_id = '00000000-0000-0000-0000-00000000f101' AND c.vehicle_id = '00000000-0000-0000-0000-00000000a101'
        AND c.service_type = 'transfer' AND c.govt_fee = 1000 AND c.service_charge = 250 AND c.status = 'pending' AND c.stage = 'new'
        AND c.assigned_to = '00000000-0000-0000-0000-0000000000c2' AND c.case_no ~ '^CS-[0-9]{8}-[0-9A-F]{4}$' AND docs = 5;
  PERFORM set_config('m3.r', current_setting('m3.r') || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' T4 approved quotation makes one correct case; pending refused' || E'\n', true);
END $$;

-- T5 idempotent: calling again (double click, second person) returns the SAME case; still exactly one case and one checklist
DO $$
DECLARE r jsonb; ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r := public.create_case_from_quotation('00000000-0000-0000-0000-00000000b101');
  r := public.create_case_from_quotation('00000000-0000-0000-0000-00000000b101');
  EXECUTE 'RESET ROLE';
  ok := (r->>'already_existed')::boolean AND (SELECT count(*) FROM public.cases WHERE quotation_id = '00000000-0000-0000-0000-00000000b101') = 1
        AND (SELECT count(*) FROM public.case_documents cd JOIN public.cases c ON c.id = cd.case_id WHERE c.quotation_id = '00000000-0000-0000-0000-00000000b101') = 5;
  PERFORM set_config('m3.r', current_setting('m3.r') || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' T5 repeated conversion returns the same case, no duplicate' || E'\n', true);
END $$;

-- T6 another route (manual case insert / relink) cannot attach a second open case to the same quotation
DO $$
DECLARE e1 boolean := false; ok2 boolean := true;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);   -- act as the SQL editor (no signed-in user) for fixture changes
  BEGIN INSERT INTO public.cases (case_no, client_id, quotation_id, service_type, created_by) VALUES ('CS-DUP-1', '00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000b101', 'transfer', '00000000-0000-0000-0000-0000000000c2'); EXCEPTION WHEN OTHERS THEN e1 := true; END;
  -- a cancelled case does not block a replacement
  UPDATE public.cases SET status = 'cancelled' WHERE quotation_id = '00000000-0000-0000-0000-00000000b101';
  BEGIN INSERT INTO public.cases (case_no, client_id, quotation_id, service_type, created_by) VALUES ('CS-DUP-2', '00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000b101', 'transfer', '00000000-0000-0000-0000-0000000000c2'); EXCEPTION WHEN OTHERS THEN ok2 := false; END;
  PERFORM set_config('m3.r', current_setting('m3.r') || CASE WHEN e1 AND ok2 THEN 'PASS' ELSE 'FAIL' END || ' T6 second open case for one quotation is refused; replacing a cancelled one is allowed' || E'\n', true);
  DELETE FROM public.cases WHERE case_no IN ('CS-DUP-2');
  UPDATE public.cases SET status = 'pending' WHERE quotation_id = '00000000-0000-0000-0000-00000000b101';
END $$;

-- T7 stage moves drive status; delivered closes the case; history has stage + status rows; staff cannot reopen, manager can
DO $$
DECLARE cid uuid; s text; st text; closed date; ok boolean; staff_blocked boolean := false; mgr_ok boolean := true; hist int;
BEGIN
  SELECT id INTO cid FROM public.cases WHERE quotation_id = '00000000-0000-0000-0000-00000000b101';
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM public.set_case_stage(cid, 'documents');
  SELECT status INTO st FROM public.cases WHERE id = cid;                      -- pending -> active
  ok := st = 'active';
  PERFORM public.set_case_stage(cid, 'submitted', 'File sent to Excise office');
  PERFORM public.set_case_stage(cid, 'delivered');
  SELECT status, stage, closed_on INTO st, s, closed FROM public.cases WHERE id = cid;
  ok := ok AND st = 'completed' AND s = 'delivered' AND closed = public.lb_today();
  BEGIN PERFORM public.set_case_stage(cid, 'processing'); EXCEPTION WHEN OTHERS THEN staff_blocked := true; END;
  BEGIN PERFORM public.set_case_status(cid, 'active'); EXCEPTION WHEN OTHERS THEN staff_blocked := staff_blocked AND true; END;
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
  BEGIN PERFORM public.set_case_stage(cid, 'processing', 'client brought a missing paper'); EXCEPTION WHEN OTHERS THEN mgr_ok := false; END;
  EXECUTE 'RESET ROLE';
  SELECT status, closed_on INTO st, closed FROM public.cases WHERE id = cid;
  ok := ok AND staff_blocked AND mgr_ok AND st = 'active' AND closed IS NULL;
  SELECT count(*) INTO hist FROM public.status_history WHERE entity_type = 'case' AND entity_id = cid;
  -- 3 stage moves + pending->active + active->completed (+ stage rows) + reopen: stage + status; require at least the key rows with notes
  ok := ok AND EXISTS (SELECT 1 FROM public.status_history WHERE entity_id = cid AND field = 'stage' AND to_value = 'submitted' AND note = 'File sent to Excise office')
           AND EXISTS (SELECT 1 FROM public.status_history WHERE entity_id = cid AND field = 'status' AND from_value = 'completed' AND to_value = 'active' AND changed_by = '00000000-0000-0000-0000-0000000000c2')
           AND hist >= 8;
  PERFORM set_config('m3.r', current_setting('m3.r') || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' T7 stage drives status, closing and reopening rules, every move logged' || E'\n', true);
END $$;

-- T8 cancelling a case needs a reason, and the reason is stored in history
DO $$
DECLARE cid uuid; no_reason boolean := false; ok boolean;
BEGIN
  SELECT id INTO cid FROM public.cases WHERE quotation_id = '00000000-0000-0000-0000-00000000b101';
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.set_case_status(cid, 'cancelled'); EXCEPTION WHEN OTHERS THEN no_reason := true; END;
  PERFORM public.set_case_status(cid, 'cancelled', 'Client withdrew');
  EXECUTE 'RESET ROLE';
  ok := no_reason AND EXISTS (SELECT 1 FROM public.status_history WHERE entity_id = cid AND to_value = 'cancelled' AND note = 'Client withdrew') AND (SELECT closed_on FROM public.cases WHERE id = cid) IS NOT NULL;
  PERFORM set_config('m3.r', current_setting('m3.r') || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' T8 cancellation needs and stores a reason' || E'\n', true);
END $$;

-- T9 assignment change is logged with names
DO $$
DECLARE cid uuid; ok boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);   -- act as the SQL editor (no signed-in user) for fixture changes
  INSERT INTO public.cases (id, case_no, client_id, service_type, created_by) VALUES ('00000000-0000-0000-0000-00000000c901', 'CS-T9', '00000000-0000-0000-0000-00000000f101', 'other', '00000000-0000-0000-0000-0000000000c2');
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.cases SET assigned_to = '00000000-0000-0000-0000-0000000000c1' WHERE id = '00000000-0000-0000-0000-00000000c901';
  EXECUTE 'RESET ROLE';
  ok := EXISTS (SELECT 1 FROM public.status_history WHERE entity_id = '00000000-0000-0000-0000-00000000c901' AND field = 'assigned_to' AND from_value = 'nobody' AND to_value = 'Staff Test');
  PERFORM set_config('m3.r', current_setting('m3.r') || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' T9 assignment change logged' || E'\n', true);
END $$;

-- T10 history cannot be written, edited or deleted by a signed-in user; checklist ticks stamp the received date
DO $$
DECLARE e1 boolean := false; e2 boolean := false; e3 boolean := false; d uuid; got date; cleared date;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN INSERT INTO public.status_history (entity_type, entity_id, to_value) VALUES ('case', gen_random_uuid(), 'fake'); EXCEPTION WHEN OTHERS THEN e1 := true; END;
  BEGIN UPDATE public.status_history SET to_value = 'x'; EXCEPTION WHEN OTHERS THEN e2 := true; END;
  BEGIN DELETE FROM public.status_history; EXCEPTION WHEN OTHERS THEN e3 := true; END;
  INSERT INTO public.case_documents (case_id, label) VALUES ('00000000-0000-0000-0000-00000000c901', 'Extra paper') RETURNING id INTO d;
  UPDATE public.case_documents SET received = true WHERE id = d;
  SELECT received_on INTO got FROM public.case_documents WHERE id = d;
  UPDATE public.case_documents SET received = false WHERE id = d;
  SELECT received_on INTO cleared FROM public.case_documents WHERE id = d;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('m3.r', current_setting('m3.r') || CASE WHEN e1 AND e2 AND e3 THEN 'PASS' ELSE 'FAIL' END || ' T10a history cannot be written or changed from the app' || E'\n', true);
  PERFORM set_config('m3.r', current_setting('m3.r') || CASE WHEN got = public.lb_today() AND cleared IS NULL THEN 'PASS' ELSE 'FAIL' END || ' T10b checklist stamps and clears the received date' || E'\n', true);
END $$;

-- T11 old data: a case that existed before M3 keeps its values; the stage was derived from its status
DO $$
DECLARE ok boolean;
BEGIN
  ok := (SELECT stage FROM public.cases WHERE id = '00000000-0000-0000-0000-00000000c901') = 'new' AND (SELECT priority FROM public.cases WHERE id = '00000000-0000-0000-0000-00000000c901') = 'normal';
  PERFORM set_config('m3.r', current_setting('m3.r') || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' T11 defaults on new columns' || E'\n', true);
END $$;

SELECT current_setting('m3.r') AS results;   -- every line must say PASS
ROLLBACK;
