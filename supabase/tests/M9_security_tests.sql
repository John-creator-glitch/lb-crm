-- ======================================================================================================================
-- M9 security tests: the attacks from the 19 Nov 2026 security review, re-run against THIS build as visitor, pending user, Staff, Manager.
-- RUN ON STAGING ONLY, as postgres. One transaction, ends with ROLLBACK. Every result line must say PASS.
-- ======================================================================================================================
BEGIN;
SELECT set_config('m9.r', '', true);
INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-0000-0000-0000000009b1', 'm9-owner@test.invalid',   'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000009b2', 'm9-manager@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000009b3', 'm9-staff@test.invalid',   'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000009b4', 'm9-pending@test.invalid', 'authenticated', 'authenticated');
UPDATE public.profiles SET role = 'admin',   active = true  WHERE id = '00000000-0000-0000-0000-0000000009b1';
UPDATE public.profiles SET role = 'manager', active = true  WHERE id = '00000000-0000-0000-0000-0000000009b2';
UPDATE public.profiles SET role = 'staff',   active = true  WHERE id = '00000000-0000-0000-0000-0000000009b3';
UPDATE public.profiles SET role = 'staff',   active = false WHERE id = '00000000-0000-0000-0000-0000000009b4';   -- "waiting for approval"
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN u IN ('', 'anon') THEN '' ELSE '{"sub":"' || u || '","role":"authenticated"}' END, true);
  IF u = '' THEN EXECUTE 'RESET ROLE'; ELSIF u = 'anon' THEN EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE anon'; ELSE EXECUTE 'RESET ROLE'; EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.rec(name text, ok boolean) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN PERFORM set_config('m9.r', current_setting('m9.r') || CASE WHEN COALESCE(ok, false) THEN 'PASS' ELSE 'FAIL' END || ' ' || name || E'\n', true); END $f$;
-- returns true when the statement is REFUSED (error) -- or, for a plain UPDATE/DELETE/INSERT, changed no row
CREATE OR REPLACE FUNCTION pg_temp.refused(stmt text) RETURNS boolean LANGUAGE plpgsql AS $f$
DECLARE n bigint;
BEGIN EXECUTE stmt; GET DIAGNOSTICS n = ROW_COUNT; RETURN n = 0 AND stmt ~* '^\s*(update|delete|insert)'; EXCEPTION WHEN OTHERS THEN RETURN true; END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.refused(text) TO PUBLIC;

-- fixtures: a client with an APPROVED quotation, and a PENDING one
INSERT INTO public.clients (id, name, phone, created_by) VALUES ('00000000-0000-0000-0000-0000000009c1', 'M9 Client', '03009990001', '00000000-0000-0000-0000-0000000009b1');
INSERT INTO public.quotations (id, quotation_number, client_id, transaction_type, status, subtotal_govt, subtotal_service, subtotal_additional, grand_total, created_by) VALUES
  ('00000000-0000-0000-0000-0000000009d1', 'M9-A', '00000000-0000-0000-0000-0000000009c1', 'transfer', 'approved', 8000, 2000, 0, 10000, '00000000-0000-0000-0000-0000000009b1'),
  ('00000000-0000-0000-0000-0000000009d2', 'M9-P', '00000000-0000-0000-0000-0000000009c1', 'transfer', 'pending',  8000, 2000, 0, 10000, '00000000-0000-0000-0000-0000000009b1');
INSERT INTO public.quotation_line_items (id, quotation_id, fee_type, label, category, amount) VALUES
  ('00000000-0000-0000-0000-0000000009e1', '00000000-0000-0000-0000-0000000009d1', 'transfer', 'Fee', 'government', 8000),
  ('00000000-0000-0000-0000-0000000009e2', '00000000-0000-0000-0000-0000000009d2', 'transfer', 'Fee', 'government', 8000);

-- #1 CRITICAL in the review: a signed-in user (even one waiting for approval) makes themselves Owner
DO $$ BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000009b4');
  PERFORM pg_temp.rec('S1 pending user cannot set own role=admin / active=true', pg_temp.refused($q$UPDATE public.profiles SET role='admin', active=true WHERE id='00000000-0000-0000-0000-0000000009b4'$q$));
  PERFORM pg_temp.rec('S1b pending user cannot approve self (active only)', pg_temp.refused($q$UPDATE public.profiles SET active=true WHERE id='00000000-0000-0000-0000-0000000009b4'$q$));
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000009b3');
  PERFORM pg_temp.rec('S1c staff cannot make self manager', pg_temp.refused($q$UPDATE public.profiles SET role='manager' WHERE id='00000000-0000-0000-0000-0000000009b3'$q$));
  PERFORM pg_temp.rec('S1d staff cannot make a colleague owner', pg_temp.refused($q$UPDATE public.profiles SET role='admin' WHERE id='00000000-0000-0000-0000-0000000009b4'$q$));
  PERFORM pg_temp.rec('S1e staff cannot insert a profile', pg_temp.refused($q$INSERT INTO public.profiles (id, role, active) VALUES (gen_random_uuid(), 'admin', true)$q$));
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000009b2');
  PERFORM pg_temp.rec('S1f manager cannot make self owner', pg_temp.refused($q$UPDATE public.profiles SET role='admin' WHERE id='00000000-0000-0000-0000-0000000009b2'$q$));
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('S1g nobody ended up with a higher role', (SELECT role FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000009b4') = 'staff' AND NOT (SELECT active FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000009b4')
                       AND (SELECT role FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000009b3') = 'staff' AND (SELECT role FROM public.profiles WHERE id = '00000000-0000-0000-0000-0000000009b2') = 'manager');
END $$;

-- pending user sees no business data
DO $$ DECLARE n int := 0; t text; c int; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000009b4');
  FOREACH t IN ARRAY ARRAY['clients','quotations','quotation_line_items','payments','client_payments','cases','vehicles','reminders','audit_logs','status_history','app_settings'] LOOP
    BEGIN EXECUTE format('SELECT count(*) FROM public.%I', t) INTO c; n := n + c; EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('S2 pending user reads no business rows in 11 tables', n = 0);
END $$;

-- #2 HIGH in the review: anyone with only the public key writes fake audit rows / calls internal functions
DO $$ DECLARE a boolean; b boolean; c boolean; d boolean; e boolean; f boolean; BEGIN
  PERFORM pg_temp.as_user('anon');
  a := pg_temp.refused($q$SELECT public.lb_log_change('quotation', gen_random_uuid(), 'status', 'a', 'b')$q$);
  b := pg_temp.refused($q$INSERT INTO public.status_history (entity_type, entity_id, field, old_value, new_value) VALUES ('quotation', gen_random_uuid(), 'status', 'x', 'y')$q$);
  c := pg_temp.refused($q$SELECT public.finance_summary(current_date, current_date)$q$) AND pg_temp.refused($q$SELECT * FROM public.account_balances()$q$) AND pg_temp.refused($q$SELECT public.global_search('a', 5)$q$);
  d := pg_temp.refused($q$SELECT public.app_rank()$q$) AND pg_temp.refused($q$SELECT public.set_user_access(gen_random_uuid(), 'admin', true)$q$);
  e := pg_temp.refused($q$SELECT count(*) FROM public.clients$q$) AND pg_temp.refused($q$SELECT count(*) FROM public.profiles$q$) AND pg_temp.refused($q$SELECT count(*) FROM public.app_settings$q$);
  f := pg_temp.refused($q$INSERT INTO public.clients (name) VALUES ('anon')$q$) AND pg_temp.refused($q$DELETE FROM public.clients$q$);
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('S3 anon cannot call lb_log_change / write status history', a AND b);
  PERFORM pg_temp.rec('S3b anon cannot call finance, ledger, search functions', c);
  PERFORM pg_temp.rec('S3c anon cannot call app_rank / set_user_access', d);
  PERFORM pg_temp.rec('S3d anon reads nothing and writes nothing', e AND f);
END $$;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.prokind IN ('f', 'p') AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('public'::name, p.oid, 'EXECUTE')) ;
  PERFORM pg_temp.rec('S3e no function in public is executable by anon / PUBLIC', n = 0);
EXCEPTION WHEN undefined_object OR invalid_parameter_value THEN
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.prokind IN ('f', 'p') AND has_function_privilege('anon', p.oid, 'EXECUTE');
  PERFORM pg_temp.rec('S3e no function in public is executable by anon / PUBLIC', n = 0);
END $$;
DO $$ BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000009b3');
  PERFORM pg_temp.rec('S4 signed-in staff cannot call lb_log_change directly', pg_temp.refused($q$SELECT public.lb_log_change('quotation', gen_random_uuid(), 'status', 'a', 'b')$q$));
  PERFORM pg_temp.rec('S4b staff cannot forge / edit / delete status history', pg_temp.refused($q$INSERT INTO public.status_history (entity_type, entity_id, field, old_value, new_value) VALUES ('quotation', gen_random_uuid(), 'status', 'x', 'y')$q$)
     AND pg_temp.refused($q$UPDATE public.status_history SET new_value = 'x'$q$) AND pg_temp.refused($q$DELETE FROM public.status_history$q$));
  PERFORM pg_temp.as_user('');
END $$;

-- #3 LOW: elevated functions with a fixed search_path
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.prosecdef AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%');
  PERFORM pg_temp.rec('S5 every SECURITY DEFINER function has a fixed search_path', n = 0);
END $$;

-- #6 MEDIUM: Staff changing money on an APPROVED quotation through the API
DO $$ BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000009b3');
  PERFORM pg_temp.rec('S6 staff cannot change total of an approved quotation', pg_temp.refused($q$UPDATE public.quotations SET grand_total = 1 WHERE id = '00000000-0000-0000-0000-0000000009d1'$q$));
  PERFORM pg_temp.rec('S6b staff cannot change a part (govt/service) of an approved quotation', pg_temp.refused($q$UPDATE public.quotations SET subtotal_govt = 1 WHERE id = '00000000-0000-0000-0000-0000000009d1'$q$) AND pg_temp.refused($q$UPDATE public.quotations SET subtotal_service = 1 WHERE id = '00000000-0000-0000-0000-0000000009d1'$q$));
  PERFORM pg_temp.rec('S6c staff cannot edit / add / delete fee lines of an approved quotation', pg_temp.refused($q$UPDATE public.quotation_line_items SET amount = 1 WHERE id = '00000000-0000-0000-0000-0000000009e1'$q$)
     AND pg_temp.refused($q$INSERT INTO public.quotation_line_items (quotation_id, fee_type, label, category, amount) VALUES ('00000000-0000-0000-0000-0000000009d1', 'x', 'x', 'service', 1)$q$)
     AND pg_temp.refused($q$DELETE FROM public.quotation_line_items WHERE id = '00000000-0000-0000-0000-0000000009e1'$q$)
     AND pg_temp.refused($q$UPDATE public.quotation_line_items SET quotation_id = '00000000-0000-0000-0000-0000000009d1' WHERE id = '00000000-0000-0000-0000-0000000009e2'$q$));
  PERFORM pg_temp.rec('S6d staff CAN still correct a pending quotation (normal work)', NOT pg_temp.refused($q$UPDATE public.quotations SET grand_total = 10100, subtotal_service = 2100 WHERE id = '00000000-0000-0000-0000-0000000009d2'$q$)
     AND NOT pg_temp.refused($q$UPDATE public.quotation_line_items SET amount = 8100 WHERE id = '00000000-0000-0000-0000-0000000009e2'$q$));
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000009b2');
  PERFORM pg_temp.rec('S6e manager CAN correct an approved quotation', NOT pg_temp.refused($q$UPDATE public.quotations SET grand_total = 10500, subtotal_service = 2500 WHERE id = '00000000-0000-0000-0000-0000000009d1'$q$)
     AND NOT pg_temp.refused($q$UPDATE public.quotation_line_items SET amount = 8100 WHERE id = '00000000-0000-0000-0000-0000000009e1'$q$));
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('S6f the approved quotation total is the manager value, not the attacker value', (SELECT grand_total FROM public.quotations WHERE id = '00000000-0000-0000-0000-0000000009d1') = 10500);
END $$;

-- things that held up in the review (kept as regression)
DO $$ DECLARE a boolean; b boolean; c boolean; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000009b3');
  a := pg_temp.refused($q$SELECT public.finance_summary(public.lb_today(), public.lb_today())$q$) AND pg_temp.refused($q$SELECT public.report_summary(public.lb_today(), public.lb_today())$q$);
  b := (SELECT count(*) FROM public.audit_logs) = 0 AND pg_temp.refused($q$UPDATE public.payments SET amount = 1$q$) AND pg_temp.refused($q$DELETE FROM public.payments$q$);
  c := pg_temp.refused($q$TRUNCATE public.clients$q$) AND pg_temp.refused($q$DROP TABLE public.clients$q$) AND pg_temp.refused($q$INSERT INTO public.app_settings (key, value) VALUES ('m9', '{}'::jsonb)$q$);
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('S7 staff: no finance/reports, no audit log, no payment edit/delete', a AND b);
  PERFORM pg_temp.rec('S7b staff: TRUNCATE / DROP / settings write refused', c);
  PERFORM pg_temp.rec('S7c staff can still change own display name', (SELECT true) AND (SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000009b3') IS NOT NULL) AND NOT pg_temp.refused($q$UPDATE public.profiles SET full_name = 'Staff M9' WHERE id = '00000000-0000-0000-0000-0000000009b3'$q$));
  PERFORM pg_temp.as_user('');
END $$;

SELECT current_setting('m9.r') AS results;
ROLLBACK;
