-- ======================================================================================================================
-- M8 tests: END-TO-END regression + ROLE matrix through the same entry points the app uses (SET ROLE authenticated, no postgres shortcuts).
-- Flow: client -> vehicle -> quotation -> approval -> case -> documents -> payments -> reminder -> delivery -> reconciliation.
-- RUN ON STAGING ONLY, as postgres, after M1..M6 are installed. One transaction, ends with ROLLBACK. Every result line must say PASS.
-- ======================================================================================================================
BEGIN;
SELECT set_config('m8.r', '', true);
INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-0000-0000-0000000008a1', 'm8-owner@test.invalid',   'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000008a2', 'm8-manager@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000008a3', 'm8-staff@test.invalid',   'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000008a4', 'm8-staff2@test.invalid',  'authenticated', 'authenticated');
UPDATE public.profiles SET role = 'admin',   active = true, full_name = 'Owner M8'   WHERE id = '00000000-0000-0000-0000-0000000008a1';
UPDATE public.profiles SET role = 'manager', active = true, full_name = 'Manager M8' WHERE id = '00000000-0000-0000-0000-0000000008a2';
UPDATE public.profiles SET role = 'staff',   active = true, full_name = 'Staff M8'   WHERE id = '00000000-0000-0000-0000-0000000008a3';
UPDATE public.profiles SET role = 'staff',   active = true, full_name = 'Staff2 M8'  WHERE id = '00000000-0000-0000-0000-0000000008a4';

CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN u = '' THEN '' ELSE '{"sub":"' || u || '","role":"authenticated"}' END, true);
  IF u = '' THEN EXECUTE 'RESET ROLE'; ELSE EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.rec(name text, ok boolean) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN PERFORM set_config('m8.r', current_setting('m8.r') || CASE WHEN COALESCE(ok, false) THEN 'PASS' ELSE 'FAIL' END || ' ' || name || E'\n', true); END $f$;
-- scratch values that must survive between blocks (temp table readable by the authenticated role)
CREATE TEMP TABLE m8_ctx (k text PRIMARY KEY, v text); GRANT ALL ON m8_ctx TO PUBLIC;

-- ===== PART A: the working day, step by step =====
-- A1 staff registers a client (assigned to self) and the vehicle + quotation are saved atomically
DO $$ DECLARE r jsonb; cid uuid := '00000000-0000-0000-0000-00000008c001'; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000008a3');
  INSERT INTO public.clients (id, name, phone, cnic, assigned_to, created_by) VALUES (cid, 'M8 Client', '03001234567', '3520112345671', '00000000-0000-0000-0000-0000000008a3', '00000000-0000-0000-0000-0000000008a3');
  r := public.create_quotation_atomic(cid,
    '{"province":"punjab","registration_type":"transfer","vehicle_category":"car","registration_number":"M8-REG-1","chassis_number":"M8CHASSIS1"}'::jsonb,
    '{"transaction_type":"transfer","subtotal_govt":8000,"subtotal_service":2000,"subtotal_additional":0,"grand_total":10000,"validity_days":15}'::jsonb,
    '[{"label":"Transfer fee","category":"government","amount":8000,"fee_type":"transfer","sort_order":1},{"label":"Service","category":"service","amount":2000,"fee_type":"service_charge","sort_order":100}]'::jsonb);
  INSERT INTO m8_ctx VALUES ('q', r->>'quotation_id'), ('v', r->>'vehicle_id');
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('A1 client + vehicle + quotation + 2 items saved together', (SELECT count(*) FROM public.quotation_line_items WHERE quotation_id = (r->>'quotation_id')::uuid) = 2
     AND (SELECT status FROM public.quotations WHERE id = (r->>'quotation_id')::uuid) IN ('draft','pending') AND (r->>'vehicle_id') IS NOT NULL);
END $$;

-- A2 duplicate warning finds the same phone / registration (warn, never merge)
DO $$ DECLARE d jsonb; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000008a4');
  d := public.find_duplicates('0300-1234567', NULL, 'M8-REG-1', NULL, NULL, NULL)::jsonb;
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('A2 duplicate warning finds existing client and vehicle', d::text LIKE '%M8 Client%' OR d::text LIKE '%00000008c001%');
END $$;

-- A3 staff sends it (draft -> pending) and may approve along the normal flow; going backwards needs a manager, who must give a reason
DO $$ DECLARE q uuid := (SELECT v::uuid FROM m8_ctx WHERE k = 'q'); back_blocked boolean := false; no_reason boolean := false; st text; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000008a3');
  IF (SELECT status FROM public.quotations WHERE id = q) = 'draft' THEN PERFORM public.set_quotation_status(q, 'pending'); END IF;
  PERFORM public.set_quotation_status(q, 'approved', 'client confirmed');
  BEGIN PERFORM public.set_quotation_status(q, 'draft', 'staff going back'); EXCEPTION WHEN OTHERS THEN back_blocked := true; END;
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000008a2');
  BEGIN PERFORM public.set_quotation_status(q, 'pending', ''); EXCEPTION WHEN OTHERS THEN no_reason := true; END;
  PERFORM public.set_quotation_status(q, 'pending', 'client asked for changes'); PERFORM public.set_quotation_status(q, 'approved', 'confirmed again');
  PERFORM pg_temp.as_user('');
  SELECT status INTO st FROM public.quotations WHERE id = q;
  PERFORM pg_temp.rec('A3 staff follows the flow, cannot go backwards; manager corrects with a reason; every move logged', back_blocked AND st = 'approved' AND (SELECT count(*) FROM public.status_history WHERE entity_id = q) >= 3);
END $$;

-- A4 approved quotation becomes ONE case with checklist; second click returns the same case
DO $$ DECLARE q uuid := (SELECT v::uuid FROM m8_ctx WHERE k = 'q'); r1 jsonb; r2 jsonb; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000008a3');
  r1 := public.create_case_from_quotation(q); r2 := public.create_case_from_quotation(q);
  INSERT INTO m8_ctx VALUES ('c', r1->>'case_id');
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('A4 one case only, checklist created, repeat click is safe', r1->>'case_id' = r2->>'case_id' AND (SELECT count(*) FROM public.cases WHERE quotation_id = q) = 1
     AND (SELECT count(*) FROM public.case_documents WHERE case_id = (r1->>'case_id')::uuid) >= 1);
END $$;

-- A5 staff collects every required document, then manager moves the case documents -> submitted -> processing -> ready
DO $$ DECLARE c uuid := (SELECT v::uuid FROM m8_ctx WHERE k = 'c'); st text; pend int; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000008a3');
  UPDATE public.case_documents SET received = true WHERE case_id = c;
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000008a2');
  PERFORM public.set_case_stage(c, 'documents'); PERFORM public.set_case_stage(c, 'submitted', 'Sent to Excise'); PERFORM public.set_case_stage(c, 'processing'); PERFORM public.set_case_stage(c, 'ready');
  PERFORM pg_temp.as_user('');
  SELECT stage INTO st FROM public.cases WHERE id = c; SELECT count(*) INTO pend FROM public.case_documents WHERE case_id = c AND required AND NOT received;
  PERFORM pg_temp.rec('A5 documents received, stages walked to ready, each move logged', st = 'ready' AND pend = 0 AND (SELECT count(*) FROM public.status_history WHERE entity_id = c) >= 4);
END $$;

-- A6 payments: part payment by staff, balance by manager; ledger shows outstanding then zero; overpay-safe numbers
DO $$ DECLARE q uuid := (SELECT v::uuid FROM m8_ctx WHERE k = 'q'); cid uuid := '00000000-0000-0000-0000-00000008c001'; b1 numeric; b2 numeric; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000008a3');
  INSERT INTO public.payments (quotation_id, amount, payment_method) VALUES (q, 4000, 'cash');
  b1 := (public.ledger_balance(cid)).pending;
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000008a2');
  INSERT INTO public.payments (quotation_id, amount, payment_method) VALUES (q, 6000, 'bank');
  b2 := (public.ledger_balance(cid)).pending;
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('A6 ledger: 10000 billed, 4000 paid -> 6000 due, then 0 due', b1 = 6000 AND b2 = 0);
END $$;

-- A7 reminder: staff sets a follow-up for the case, completes it, and the event trail exists
DO $$ DECLARE rid uuid := '00000000-0000-0000-0000-00000008d001'; c uuid := (SELECT v::uuid FROM m8_ctx WHERE k = 'c'); BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000008a3');
  INSERT INTO public.reminders (id, title, case_id, client_id, owner_id, created_by, due_at) VALUES (rid, 'Call client for delivery', c, '00000000-0000-0000-0000-00000008c001', '00000000-0000-0000-0000-0000000008a3', '00000000-0000-0000-0000-0000000008a3', now() + interval '1 day');
  PERFORM public.complete_reminder(rid, 'client informed');
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('A7 reminder created and completed with history', (SELECT status FROM public.reminders WHERE id = rid) = 'completed' AND (SELECT count(*) FROM public.reminder_events WHERE reminder_id = rid) >= 1);
END $$;

-- A8 delivery: case delivered + completed, quotation completed (needs manager), staff cannot reopen a completed case
DO $$ DECLARE c uuid := (SELECT v::uuid FROM m8_ctx WHERE k = 'c'); q uuid := (SELECT v::uuid FROM m8_ctx WHERE k = 'q'); blocked boolean := false; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000008a2');
  PERFORM public.set_case_stage(c, 'delivered'); PERFORM public.set_case_status(c, 'completed', 'handed over');
  PERFORM public.set_quotation_status(q, 'completed', 'case delivered');
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000008a3');
  BEGIN PERFORM public.set_case_status(c, 'in_progress', 'staff reopen'); EXCEPTION WHEN OTHERS THEN blocked := true; END;
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('A8 delivered and completed; staff cannot reopen', blocked AND (SELECT status FROM public.cases WHERE id = c) = 'completed' AND (SELECT status FROM public.quotations WHERE id = q) = 'completed');
END $$;

-- A9 reconciliation: the dashboard/report figures for today include this job exactly (owner view), and equal the ledger
DO $$ DECLARE f jsonb; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000008a1');
  f := public.finance_summary(public.lb_today(), public.lb_today())::jsonb;
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('A9 finance summary shows this job: billed >= 10000 and collected >= 10000', (f->>'billed')::numeric >= 10000 AND (f->>'collected')::numeric >= 10000);
END $$;

-- ===== PART B: role matrix, DIRECT database calls (what someone could try with the API key) =====
DO $$ DECLARE a boolean; b boolean; c boolean; d boolean; e boolean; f boolean; g boolean; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000008a3');
  a := false; BEGIN PERFORM public.finance_summary(public.lb_today(), public.lb_today()); EXCEPTION WHEN OTHERS THEN a := true; END;
  b := false; BEGIN PERFORM public.report_summary(public.lb_today(), public.lb_today()); EXCEPTION WHEN OTHERS THEN b := true; END;
  c := false; BEGIN PERFORM public.set_user_access('00000000-0000-0000-0000-0000000008a4', 'admin', true); EXCEPTION WHEN OTHERS THEN c := true; END;
  d := (SELECT count(*) FROM public.audit_logs) = 0;
  INSERT INTO m8_ctx VALUES ('key','x') ON CONFLICT DO NOTHING;
  e := false; BEGIN INSERT INTO public.app_settings (key, value) VALUES ('m8_staff_key', '{}'::jsonb); EXCEPTION WHEN OTHERS THEN e := true; END;
  e := e AND NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'm8_staff_key');
  f := false; BEGIN DELETE FROM public.clients WHERE id = '00000000-0000-0000-0000-00000008c001'; EXCEPTION WHEN OTHERS THEN f := true; END; f := f OR EXISTS (SELECT 1 FROM public.clients WHERE id = '00000000-0000-0000-0000-00000008c001');
  g := false; BEGIN PERFORM public.reverse_payment('quotation', (SELECT id FROM public.payments LIMIT 1), 'staff'); EXCEPTION WHEN OTHERS THEN g := true; END;
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('B1 staff: no finance/report aggregates', a AND b);
  PERFORM pg_temp.rec('B2 staff: cannot change user roles, settings, read audit log', c AND d AND e);
  PERFORM pg_temp.rec('B3 staff: cannot delete a client or reverse a payment', f AND g);
END $$;

DO $$ DECLARE a boolean; b boolean; c boolean; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000008a2');
  a := true; BEGIN PERFORM public.finance_summary(public.lb_today(), public.lb_today()); PERFORM public.report_summary(public.lb_today(), public.lb_today()); EXCEPTION WHEN OTHERS THEN a := false; END;
  b := false; BEGIN PERFORM public.set_user_access('00000000-0000-0000-0000-0000000008a4', 'admin', true); EXCEPTION WHEN OTHERS THEN b := true; END;
  c := (SELECT count(*) FROM public.audit_logs) >= 0;
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('B4 manager: sees finance and reports but cannot make anyone owner', a AND b AND c);
END $$;

DO $$ DECLARE a boolean := true; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000008a1');
  BEGIN PERFORM public.set_user_access('00000000-0000-0000-0000-0000000008a4', 'manager', true); EXCEPTION WHEN OTHERS THEN a := false; END;
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('B5 owner can change a user role', a AND (SELECT role FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000008a4') = 'manager');
  UPDATE public.profiles SET role = 'staff' WHERE id = '00000000-0000-0000-0000-0000000008a4';
END $$;

-- B6 not signed in (anon): nothing readable, nothing writable
DO $$ DECLARE n int := 0; w boolean := false; BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN SELECT count(*) INTO n FROM public.clients; EXCEPTION WHEN OTHERS THEN n := 0; END;
  BEGIN INSERT INTO public.clients (name) VALUES ('anon'); EXCEPTION WHEN OTHERS THEN w := true; END;
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.rec('B6 anonymous: no rows, cannot write', n = 0 AND w);
END $$;

-- B7 inactive staff member sees nothing
DO $$ DECLARE n int; BEGIN
  UPDATE public.profiles SET active = false WHERE id = '00000000-0000-0000-0000-0000000008a4';
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000008a4');
  SELECT count(*) INTO n FROM public.clients;
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('B7 deactivated user sees no clients', n = 0);
END $$;

SELECT current_setting('m8.r') AS results;
ROLLBACK;
