-- ======================================================================================================================
-- M4 tests (finance reconciliation): partial payments, on-account allocation counted once, reversal, staff limits, ledger numbers.
-- RUN ON STAGING ONLY, in Supabase SQL Editor, as the postgres user. One transaction, ends with ROLLBACK: no test data stays.
-- Needs M1..M4 migrations. Every line of the final result must say PASS.
-- ======================================================================================================================
BEGIN;
SELECT set_config('m4.r', '', true);
INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-0000-0000-0000000000d1', 'm4-staff@test.invalid',   'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d2', 'm4-manager@test.invalid', 'authenticated', 'authenticated');
UPDATE public.profiles SET role = 'staff',   active = true, full_name = 'Staff M4'   WHERE id = '00000000-0000-0000-0000-0000000000d1';
UPDATE public.profiles SET role = 'manager', active = true, full_name = 'Manager M4' WHERE id = '00000000-0000-0000-0000-0000000000d2';

-- Showroom S (opening balance 500) with customer C billed to it; separate client X
INSERT INTO public.clients (id, name, opening_balance, created_by) VALUES ('00000000-0000-0000-0000-00000000f201', 'M4 Showroom', 500, '00000000-0000-0000-0000-0000000000d2'), ('00000000-0000-0000-0000-00000000f203', 'M4 Solo', 0, '00000000-0000-0000-0000-0000000000d2');
INSERT INTO public.clients (id, name, parent_id, bill_to_parent, created_by) VALUES ('00000000-0000-0000-0000-00000000f202', 'M4 Customer', '00000000-0000-0000-0000-00000000f201', true, '00000000-0000-0000-0000-0000000000d2');
INSERT INTO public.quotations (id, quotation_number, client_id, transaction_type, status, grand_total, created_by) VALUES
  ('00000000-0000-0000-0000-00000000b201', 'M4-Q1', '00000000-0000-0000-0000-00000000f202', 'transfer',  'approved', 1000, '00000000-0000-0000-0000-0000000000d2'),
  ('00000000-0000-0000-0000-00000000b202', 'M4-Q2', '00000000-0000-0000-0000-00000000f202', 'transfer',  'pending',   600, '00000000-0000-0000-0000-0000000000d2'),
  ('00000000-0000-0000-0000-00000000b203', 'M4-Q3', '00000000-0000-0000-0000-00000000f202', 'transfer',  'draft',     300, '00000000-0000-0000-0000-0000000000d2'),
  ('00000000-0000-0000-0000-00000000b204', 'M4-Q4', '00000000-0000-0000-0000-00000000f203', 'transfer',  'approved', 2000, '00000000-0000-0000-0000-0000000000d2');
INSERT INTO public.payments (id, quotation_id, amount, created_by) VALUES
  ('00000000-0000-0000-0000-00000000e201', '00000000-0000-0000-0000-00000000b201', 400, '00000000-0000-0000-0000-0000000000d2'),
  ('00000000-0000-0000-0000-00000000e202', '00000000-0000-0000-0000-00000000b203',  50, '00000000-0000-0000-0000-0000000000d2');
INSERT INTO public.client_payments (id, client_id, amount, created_by) VALUES ('00000000-0000-0000-0000-00000000e301', '00000000-0000-0000-0000-00000000f201', 700, '00000000-0000-0000-0000-0000000000d2');

CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN u = '' THEN '' ELSE '{"sub":"' || u || '","role":"authenticated"}' END, true);
  IF u = '' THEN EXECUTE 'RESET ROLE'; ELSE EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.rec(name text, ok boolean) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN PERFORM set_config('m4.r', current_setting('m4.r') || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' ' || name || E'\n', true); END $f$;

-- T1 ledger numbers reconcile with the records: opening 500 + billed (1000+600, draft excluded) - received (400+50+700)
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM public.ledger_balance('00000000-0000-0000-0000-00000000f201');
  PERFORM pg_temp.rec('T1 ledger_balance = opening + billed - received (draft not billed, its payment still counted)', r.opening = 500 AND r.billed = 1600 AND r.received = 1150 AND r.pending = 950);
END $$;

-- T2 staff may record a payment but cannot edit, delete or reverse one
DO $$ DECLARE n int; rev boolean := false; amt numeric; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  INSERT INTO public.payments (quotation_id, amount) VALUES ('00000000-0000-0000-0000-00000000b201', 100);
  UPDATE public.payments SET amount = 1 WHERE id = '00000000-0000-0000-0000-00000000e201';
  DELETE FROM public.payments WHERE id = '00000000-0000-0000-0000-00000000e201';
  BEGIN PERFORM public.reverse_payment('quotation', '00000000-0000-0000-0000-00000000e201', 'nope'); EXCEPTION WHEN OTHERS THEN rev := true; END;
  PERFORM pg_temp.as_user('');
  SELECT amount INTO amt FROM public.payments WHERE id = '00000000-0000-0000-0000-00000000e201';
  PERFORM pg_temp.rec('T2 staff can add but not edit/delete/reverse payments', amt = 400 AND rev AND (SELECT count(*) FROM public.payments WHERE quotation_id = '00000000-0000-0000-0000-00000000b201') = 2);
  DELETE FROM public.payments WHERE quotation_id = '00000000-0000-0000-0000-00000000b201' AND amount = 100;   -- remove the extra test payment (postgres)
END $$;

-- T3 even a manager cannot change amount/date/target or fake a reversal by direct UPDATE; notes may be corrected
DO $$ DECLARE a boolean := false; b boolean := false; c boolean := false; n text; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
  BEGIN UPDATE public.payments SET amount = 1 WHERE id = '00000000-0000-0000-0000-00000000e201'; EXCEPTION WHEN OTHERS THEN a := true; END;
  BEGIN UPDATE public.client_payments SET amount = 1 WHERE id = '00000000-0000-0000-0000-00000000e301'; EXCEPTION WHEN OTHERS THEN b := true; END;
  BEGIN UPDATE public.payments SET reversed_at = now(), reversal_reason = 'x' WHERE id = '00000000-0000-0000-0000-00000000e201'; EXCEPTION WHEN OTHERS THEN c := true; END;
  UPDATE public.payments SET notes = 'cheque no. 123' WHERE id = '00000000-0000-0000-0000-00000000e201';
  PERFORM pg_temp.as_user('');
  SELECT notes INTO n FROM public.payments WHERE id = '00000000-0000-0000-0000-00000000e201';
  PERFORM pg_temp.rec('T3 money fields locked even for manager, notes editable', a AND b AND c AND n = 'cheque no. 123');
END $$;

-- T4 allocation: on-account 700 -> 600 to Q2 and 100 to Q1; over-allocation, unbilled quotation and wrong account are refused
DO $$ DECLARE e1 boolean := false; e2 boolean := false; e3 boolean := false; e4 boolean := false; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  PERFORM public.allocate_client_payment('00000000-0000-0000-0000-00000000e301', '00000000-0000-0000-0000-00000000b202', 600);
  BEGIN PERFORM public.allocate_client_payment('00000000-0000-0000-0000-00000000e301', '00000000-0000-0000-0000-00000000b201', 101); EXCEPTION WHEN OTHERS THEN e1 := true; END;   -- only 100 left
  BEGIN PERFORM public.allocate_client_payment('00000000-0000-0000-0000-00000000e301', '00000000-0000-0000-0000-00000000b203', 10);  EXCEPTION WHEN OTHERS THEN e2 := true; END;   -- draft
  BEGIN PERFORM public.allocate_client_payment('00000000-0000-0000-0000-00000000e301', '00000000-0000-0000-0000-00000000b204', 10);  EXCEPTION WHEN OTHERS THEN e3 := true; END;   -- other account
  BEGIN PERFORM public.allocate_client_payment('00000000-0000-0000-0000-00000000e301', '00000000-0000-0000-0000-00000000b202', 1);   EXCEPTION WHEN OTHERS THEN e4 := true; END;   -- Q2 already fully paid
  PERFORM public.allocate_client_payment('00000000-0000-0000-0000-00000000e301', '00000000-0000-0000-0000-00000000b201', 100);
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('T4 allocation splits one payment across quotations and refuses over-allocation', e1 AND e2 AND e3 AND e4
    AND (SELECT count(*) FROM public.payment_allocations WHERE voided_at IS NULL) = 2);
END $$;

-- T5 allocation does NOT change the client balance (counted once) but does show on the quotation
DO $$ DECLARE r record; s1 record; s2 record; BEGIN
  SELECT * INTO r FROM public.ledger_balance('00000000-0000-0000-0000-00000000f201');
  SELECT * INTO s1 FROM public.quotation_payment_summary WHERE quotation_id = '00000000-0000-0000-0000-00000000b201';
  SELECT * INTO s2 FROM public.quotation_payment_summary WHERE quotation_id = '00000000-0000-0000-0000-00000000b202';
  PERFORM pg_temp.rec('T5 balance unchanged by allocation; quotation shows direct 400 + allocated 100, Q2 fully paid',
    r.pending = 950 AND s1.paid_direct = 400 AND s1.paid_allocated = 100 AND s1.outstanding = 500 AND s2.paid = 600 AND s2.outstanding = 0);
END $$;

-- T6 direct payments plus allocations can never exceed what the quotation owes
DO $$ DECLARE bad boolean := false; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  INSERT INTO public.client_payments (client_id, amount) VALUES ('00000000-0000-0000-0000-00000000f201', 900);
  BEGIN PERFORM public.allocate_client_payment((SELECT id FROM public.client_payments WHERE amount = 900), '00000000-0000-0000-0000-00000000b201', 501); EXCEPTION WHEN OTHERS THEN bad := true; END;
  PERFORM public.allocate_client_payment((SELECT id FROM public.client_payments WHERE amount = 900), '00000000-0000-0000-0000-00000000b201', 500);
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('T6 cannot allocate more than outstanding; exact outstanding allowed', bad AND (SELECT outstanding FROM public.quotation_payment_summary WHERE quotation_id = '00000000-0000-0000-0000-00000000b201') = 0);
END $$;

-- T7 reversal needs manager + reason; reversing the on-account payment voids its allocations and the balance goes back up exactly once
DO $$ DECLARE noreason boolean := false; twice boolean := false; r record; s2 record; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
  BEGIN PERFORM public.reverse_payment('on_account', '00000000-0000-0000-0000-00000000e301', '   '); EXCEPTION WHEN OTHERS THEN noreason := true; END;
  PERFORM public.reverse_payment('on_account', '00000000-0000-0000-0000-00000000e301', 'Cheque bounced');
  BEGIN PERFORM public.reverse_payment('on_account', '00000000-0000-0000-0000-00000000e301', 'again'); EXCEPTION WHEN OTHERS THEN twice := true; END;
  PERFORM pg_temp.as_user('');
  SELECT * INTO r FROM public.ledger_balance('00000000-0000-0000-0000-00000000f201');
  SELECT * INTO s2 FROM public.quotation_payment_summary WHERE quotation_id = '00000000-0000-0000-0000-00000000b202';
  -- received was 1150 + 900 (second on-account) = 2050, pending 500+1600-2050 = 50; reversing the 700 gives received 1350, pending 750
  PERFORM pg_temp.rec('T7 reversal: reason required, not repeatable, allocations voided, balance back up by 700',
    noreason AND twice AND r.received = 1350 AND r.pending = 750 AND s2.paid = 0 AND s2.outstanding = 600
    AND (SELECT count(*) FROM public.payment_allocations WHERE client_payment_id = '00000000-0000-0000-0000-00000000e301' AND voided_at IS NULL) = 0);
END $$;

-- T8 a reversed on-account payment cannot be allocated; reversing a direct payment lifts the quotation balance
DO $$ DECLARE bad boolean := false; s1 record; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
  BEGIN PERFORM public.allocate_client_payment('00000000-0000-0000-0000-00000000e301', '00000000-0000-0000-0000-00000000b202', 10); EXCEPTION WHEN OTHERS THEN bad := true; END;
  PERFORM public.reverse_payment('quotation', '00000000-0000-0000-0000-00000000e201', 'Entered on the wrong quotation');
  PERFORM pg_temp.as_user('');
  SELECT * INTO s1 FROM public.quotation_payment_summary WHERE quotation_id = '00000000-0000-0000-0000-00000000b201';
  PERFORM pg_temp.rec('T8 reversed payment cannot be allocated; reversing a direct payment raises the outstanding', bad AND s1.paid_direct = 0 AND s1.paid_allocated = 500 AND s1.outstanding = 500);
END $$;

-- T9 staff cannot undo an allocation; manager can, with a reason; every reversal and allocation is in the audit log
DO $$ DECLARE staffbad boolean := false; a uuid; BEGIN
  SELECT id INTO a FROM public.payment_allocations WHERE voided_at IS NULL LIMIT 1;
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
  BEGIN PERFORM public.void_allocation(a, 'x'); EXCEPTION WHEN OTHERS THEN staffbad := true; END;
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
  PERFORM public.void_allocation(a, 'Allocated to the wrong car');
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('T9 only manager voids an allocation; audit trail written', staffbad
    AND (SELECT count(*) FROM public.audit_logs WHERE action = 'payment_reversed') = 2
    AND (SELECT count(*) FROM public.audit_logs WHERE action = 'payment_allocated') = 3
    AND (SELECT count(*) FROM public.audit_logs WHERE action = 'payment_allocation_voided') >= 1);
END $$;

-- T10 solo client with no on-account money: pending = billed - direct payments
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM public.ledger_balance('00000000-0000-0000-0000-00000000f203');
  PERFORM pg_temp.rec('T10 plain client ledger', r.billed = 2000 AND r.received = 0 AND r.pending = 2000);
END $$;

SELECT current_setting('m4.r') AS results;   -- every line must say PASS
ROLLBACK;
