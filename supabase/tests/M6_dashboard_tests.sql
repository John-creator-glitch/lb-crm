-- ======================================================================================================================
-- M6 tests (dashboard & reports reconciliation): finance totals vs ledger, KPI counts = records, staff scope, Pakistan-time boundaries.
-- RUN ON STAGING ONLY, in Supabase SQL Editor, as the postgres user. One transaction, ends with ROLLBACK: no test data stays.
-- Needs M1..M6 migrations. Every line of the final result must say PASS.
-- ======================================================================================================================
BEGIN;
SELECT set_config('m6.r', '', true);
INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-0000-0000-0000000000f1', 'm6-staff@test.invalid',   'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f2', 'm6-manager@test.invalid', 'authenticated', 'authenticated');
UPDATE public.profiles SET role = 'staff',   active = true, full_name = 'Staff M6'   WHERE id = '00000000-0000-0000-0000-0000000000f1';
UPDATE public.profiles SET role = 'manager', active = true, full_name = 'Manager M6' WHERE id = '00000000-0000-0000-0000-0000000000f2';

CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN u = '' THEN '' ELSE '{"sub":"' || u || '","role":"authenticated"}' END, true);
  IF u = '' THEN EXECUTE 'RESET ROLE'; ELSE EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.claims(u text) RETURNS void LANGUAGE plpgsql AS $f$   -- act as a user WITHOUT switching role (for fixtures)
BEGIN PERFORM set_config('request.jwt.claims', CASE WHEN u = '' THEN '' ELSE '{"sub":"' || u || '","role":"authenticated"}' END, true); END $f$;
CREATE OR REPLACE FUNCTION pg_temp.rec(name text, ok boolean) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN PERFORM set_config('m6.r', current_setting('m6.r') || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' ' || name || E'\n', true); END $f$;

-- baseline (the database may already hold data): finance figures for the test range before any fixture exists
SELECT pg_temp.claims('00000000-0000-0000-0000-0000000000f2');
CREATE TEMP TABLE m6_base AS SELECT public.finance_summary(public.lb_today() - 60, public.lb_today()) AS f, public.dashboard_kpis(public.lb_today() - 120, public.lb_today()) AS d;
GRANT ALL ON m6_base TO PUBLIC;

-- fixtures. Account S1 (showroom, opening 500) with customer C billed to it; solo client X.
INSERT INTO public.clients (id, name, opening_balance, assigned_to, created_by) VALUES ('00000000-0000-0000-0000-00000000f601', 'M6 Showroom', 500, '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2'), ('00000000-0000-0000-0000-00000000f603', 'M6 Solo', 0, NULL, '00000000-0000-0000-0000-0000000000f2');
INSERT INTO public.clients (id, name, parent_id, bill_to_parent, created_by) VALUES ('00000000-0000-0000-0000-00000000f602', 'M6 Customer', '00000000-0000-0000-0000-00000000f601', true, '00000000-0000-0000-0000-0000000000f2');
INSERT INTO public.quotations (id, quotation_number, client_id, transaction_type, status, subtotal_govt, subtotal_service, subtotal_additional, grand_total, created_by, created_at) VALUES
  ('00000000-0000-0000-0000-00000000b601', 'M6-Q1', '00000000-0000-0000-0000-00000000f602', 'transfer', 'approved',  800, 200,   0, 1000, '00000000-0000-0000-0000-0000000000f2', now() - interval '48 days'),
  ('00000000-0000-0000-0000-00000000b602', 'M6-Q2', '00000000-0000-0000-0000-00000000f602', 'transfer', 'pending',   400, 200,   0,  600, '00000000-0000-0000-0000-0000000000f2', now() - interval '29 days'),
  ('00000000-0000-0000-0000-00000000b603', 'M6-Q3', '00000000-0000-0000-0000-00000000f602', 'transfer', 'draft',     200, 100,   0,  300, '00000000-0000-0000-0000-0000000000f2', now() - interval '1 day'),
  ('00000000-0000-0000-0000-00000000b604', 'M6-Q4', '00000000-0000-0000-0000-00000000f603', 'transfer', 'approved', 1500, 400, 100, 2000, '00000000-0000-0000-0000-0000000000f2', now() - interval '109 days'),
  ('00000000-0000-0000-0000-00000000b605', 'M6-Q5', NULL,         'transfer', 'approved',  500, 200,   0,  700, '00000000-0000-0000-0000-0000000000f2', now()),
  ('00000000-0000-0000-0000-00000000b606', 'M6-Q6', '00000000-0000-0000-0000-00000000f603', 'transfer', 'pending',    60,  40,   0,  100, '00000000-0000-0000-0000-0000000000f1', now());
INSERT INTO public.payments (quotation_id, amount, payment_date, payment_method, created_by) VALUES
  ('00000000-0000-0000-0000-00000000b601', 400, public.lb_today() - 47, 'cash', '00000000-0000-0000-0000-0000000000f2'), ('00000000-0000-0000-0000-00000000b603', 50, public.lb_today() - 1, 'bank', '00000000-0000-0000-0000-0000000000f2');
INSERT INTO public.client_payments (client_id, amount, payment_date, payment_method, created_by) VALUES ('00000000-0000-0000-0000-00000000f601', 700, public.lb_today() - 3, 'cash', '00000000-0000-0000-0000-0000000000f2');
INSERT INTO public.client_payments (client_id, amount, payment_date, payment_method, reversed_at, reversed_by, reversal_reason, created_by) VALUES ('00000000-0000-0000-0000-00000000f601', 999, public.lb_today() - 2, 'cash', now(), '00000000-0000-0000-0000-0000000000f2', 'wrong', '00000000-0000-0000-0000-0000000000f2');
SELECT pg_temp.claims('');

-- cases: c1 active/assigned to staff/stale/missing a required document; c2 active unassigned; c3 completed today; c4 active, fresh, documents complete
INSERT INTO public.cases (id, case_no, client_id, service_type, status, assigned_to, created_by) VALUES
  ('00000000-0000-0000-0000-00000000c601', 'M6-C1', '00000000-0000-0000-0000-00000000f601', 'transfer', 'active', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2'), ('00000000-0000-0000-0000-00000000c602', 'M6-C2', '00000000-0000-0000-0000-00000000f601', 'transfer', 'active', NULL, '00000000-0000-0000-0000-0000000000f2'),
  ('00000000-0000-0000-0000-00000000c604', 'M6-C4', '00000000-0000-0000-0000-00000000f601', 'transfer', 'active', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f2');
INSERT INTO public.cases (id, case_no, client_id, service_type, status, assigned_to, closed_on, created_by) VALUES ('00000000-0000-0000-0000-00000000c603', 'M6-C3', '00000000-0000-0000-0000-00000000f601', 'transfer', 'completed', '00000000-0000-0000-0000-0000000000f2', public.lb_today(), '00000000-0000-0000-0000-0000000000f2');
INSERT INTO public.case_documents (case_id, label, required, received) VALUES ('00000000-0000-0000-0000-00000000c601', 'CNIC', true, false), ('00000000-0000-0000-0000-00000000c604', 'CNIC', true, true);
ALTER TABLE public.cases DISABLE TRIGGER USER;
UPDATE public.cases SET updated_at = now() - interval '10 days' WHERE id = '00000000-0000-0000-0000-00000000c601';
ALTER TABLE public.cases ENABLE TRIGGER USER;
INSERT INTO public.reminders (id, title, owner_id, created_by, due_at) VALUES ('00000000-0000-0000-0000-00000000d601', 'overdue staff', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', now() - interval '1 hour'), ('00000000-0000-0000-0000-00000000d602', 'later', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f2', now() + interval '2 days');
INSERT INTO public.reminders (id, title, owner_id, created_by, due_at) VALUES ('00000000-0000-0000-0000-00000000d603', 'snoozed', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f2', now() - interval '3 hours');
SELECT pg_temp.claims('00000000-0000-0000-0000-0000000000f2');
SELECT public.snooze_reminder('00000000-0000-0000-0000-00000000d603', now() + interval '1 day');
SELECT pg_temp.claims('');

-- T1 finance figures reconcile with the ledger for the range (today-60 .. today). Q4 (109 days old) is before the range: it is in the opening balance.
DO $$ DECLARE b jsonb; a jsonb; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
  SELECT f INTO b FROM m6_base; a := public.finance_summary(public.lb_today() - 60, public.lb_today());
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('T1 billed 1700 (Q1+Q2+Q6; draft Q3 and client-less Q5 excluded), split govt 1260 / service 440 / additional 0',
    (a->>'billed')::numeric - (b->>'billed')::numeric = 1700 AND (a->>'billed_govt')::numeric - (b->>'billed_govt')::numeric = 1260
    AND (a->>'billed_service')::numeric - (b->>'billed_service')::numeric = 440 AND (a->>'billed_additional')::numeric - (b->>'billed_additional')::numeric = 0
    AND ((a->>'billed_govt')::numeric + (a->>'billed_service')::numeric + (a->>'billed_additional')::numeric) = (a->>'billed')::numeric);
  PERFORM pg_temp.rec('T1b collected 1150 (400+50+700); the reversed 999 is not counted; walk-in Q5 reported separately (700)',
    (a->>'collected')::numeric - (b->>'collected')::numeric = 1150 AND (a->>'billed_without_client')::numeric - (b->>'billed_without_client')::numeric = 700);
  PERFORM pg_temp.rec('T1c opening + billed - collected = closing, and closing equals the live ledger total',
    (a->>'reconciles')::boolean AND (a->>'matches_ledger_now')::boolean
    AND (a->>'net_opening')::numeric - (b->>'net_opening')::numeric = 2500 AND (a->>'net_closing')::numeric - (b->>'net_closing')::numeric = 3050
    AND (a->>'net_now')::numeric - (b->>'net_now')::numeric = 3050);
END $$;

-- T2 per-account balances equal the M4 ledger rules; overdue = what is unpaid on bills older than 30 days, oldest bills paid first
DO $$ DECLARE s record; x record; n int; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
  SELECT * INTO s FROM public.account_balances() WHERE account_id = '00000000-0000-0000-0000-00000000f601';
  SELECT * INTO x FROM public.account_balances() WHERE account_id = '00000000-0000-0000-0000-00000000f603';
  SELECT count(*) INTO n FROM public.account_balances() WHERE account_id = '00000000-0000-0000-0000-00000000f602';
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('T2 account S: pending 950 and overdue 350; X: pending 2100, overdue 2000; child customer has no account of its own',
    s.opening = 500 AND s.billed = 1600 AND s.received = 1150 AND s.pending = 950 AND s.overdue = 350 AND x.pending = 2100 AND x.overdue = 2000 AND n = 0);
END $$;

-- T2b age buckets match the TypeScript ageing (src/lib/ledger.ts, tests/ledger.test.ts): S = 600 / 350 / 0 / 0, X = 100 current + 2000 in 90+, advance only when overpaid
DO $$ DECLARE s record; x record; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
  SELECT * INTO s FROM public.account_balances() WHERE account_id = '00000000-0000-0000-0000-00000000f601';
  SELECT * INTO x FROM public.account_balances() WHERE account_id = '00000000-0000-0000-0000-00000000f603';
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('T2b age buckets: S 600/350/0/0, X 100/0/0/2000, buckets add up to pending, no advance',
    s.b0 = 600 AND s.b31 = 350 AND s.b61 = 0 AND s.b90 = 0 AND x.b0 = 100 AND x.b90 = 2000 AND s.b0 + s.b31 + s.b61 + s.b90 = s.pending AND x.b0 + x.b31 + x.b61 + x.b90 = x.pending AND s.advance = 0 AND x.advance = 0);
END $$;

-- T3 every dashboard count equals the number of records its KPI opens
DO $$ DECLARE k text; bad text := ''; d jsonb; c bigint; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
  d := public.dashboard_kpis(public.lb_today() - 120, public.lb_today())->'counts';
  FOREACH k IN ARRAY ARRAY['clients_total','clients_new','vehicles_total','cases_active','cases_completed','cases_stale','cases_unassigned','cases_missing_docs','q_draft','q_pending','q_approved','q_rejected','q_completed','reminders_overdue','accounts_due'] LOOP
    SELECT count(*) INTO c FROM public.kpi_ids(k, public.lb_today() - 120, public.lb_today());
    IF c <> (d->>k)::bigint THEN bad := bad || k || ' '; END IF;
  END LOOP;
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('T3 each KPI count = its records (' || coalesce(nullif(bad, ''), 'all 15 match') || ')', bad = '');
END $$;

-- T4 the right records behind the KPIs
DO $$ DECLARE a boolean; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
  a := '00000000-0000-0000-0000-00000000b601' IN (SELECT public.kpi_ids('q_approved', public.lb_today() - 120, public.lb_today())) AND '00000000-0000-0000-0000-00000000b604' IN (SELECT public.kpi_ids('q_approved', public.lb_today() - 120, public.lb_today()))
   AND '00000000-0000-0000-0000-00000000b603' NOT IN (SELECT public.kpi_ids('q_approved', public.lb_today() - 120, public.lb_today()))
   AND '00000000-0000-0000-0000-00000000b603' IN (SELECT public.kpi_ids('q_draft', public.lb_today() - 120, public.lb_today()))
   AND '00000000-0000-0000-0000-00000000b604' NOT IN (SELECT public.kpi_ids('q_approved', public.lb_today() - 60, public.lb_today()))      -- date range applies
   AND '00000000-0000-0000-0000-00000000f601' IN (SELECT public.kpi_ids('accounts_due', public.lb_today() - 1, public.lb_today())) AND '00000000-0000-0000-0000-00000000f603' IN (SELECT public.kpi_ids('accounts_due', public.lb_today() - 1, public.lb_today()))
   AND '00000000-0000-0000-0000-00000000f602' NOT IN (SELECT public.kpi_ids('accounts_due', public.lb_today() - 1, public.lb_today()));
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('T4 quotation KPIs open the right quotations for the chosen dates; payments-due opens the overdue accounts', a);
END $$;

-- T5 case and reminder KPIs
DO $$ DECLARE a boolean; r record; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
  a := '00000000-0000-0000-0000-00000000c601' IN (SELECT public.kpi_ids('cases_active', public.lb_today(), public.lb_today())) AND '00000000-0000-0000-0000-00000000c603' NOT IN (SELECT public.kpi_ids('cases_active', public.lb_today(), public.lb_today()))
   AND '00000000-0000-0000-0000-00000000c603' IN (SELECT public.kpi_ids('cases_completed', public.lb_today(), public.lb_today()))
   AND '00000000-0000-0000-0000-00000000c601' IN (SELECT public.kpi_ids('cases_stale', public.lb_today(), public.lb_today())) AND '00000000-0000-0000-0000-00000000c604' NOT IN (SELECT public.kpi_ids('cases_stale', public.lb_today(), public.lb_today()))
   AND '00000000-0000-0000-0000-00000000c602' IN (SELECT public.kpi_ids('cases_unassigned', public.lb_today(), public.lb_today())) AND '00000000-0000-0000-0000-00000000c601' NOT IN (SELECT public.kpi_ids('cases_unassigned', public.lb_today(), public.lb_today()))
   AND '00000000-0000-0000-0000-00000000c601' IN (SELECT public.kpi_ids('cases_missing_docs', public.lb_today(), public.lb_today())) AND '00000000-0000-0000-0000-00000000c604' NOT IN (SELECT public.kpi_ids('cases_missing_docs', public.lb_today(), public.lb_today()))
   AND '00000000-0000-0000-0000-00000000d601' IN (SELECT public.kpi_ids('reminders_overdue', public.lb_today(), public.lb_today()))
   AND '00000000-0000-0000-0000-00000000d602' NOT IN (SELECT public.kpi_ids('reminders_overdue', public.lb_today(), public.lb_today())) AND '00000000-0000-0000-0000-00000000d603' NOT IN (SELECT public.kpi_ids('reminders_overdue', public.lb_today(), public.lb_today()));
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('T5 active / completed / stale / unassigned / missing-documents cases and overdue reminders (snoozed one is not overdue)', a);
END $$;

-- T6 staff see only their own work and no finance
DO $$ DECLARE a boolean; fin_blocked boolean := false; rep_blocked boolean := false; d jsonb; nb int; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
  d := public.dashboard_kpis(public.lb_today() - 120, public.lb_today());
  BEGIN PERFORM public.finance_summary(public.lb_today() - 1, public.lb_today()); EXCEPTION WHEN OTHERS THEN fin_blocked := true; END;
  BEGIN PERFORM public.report_summary(public.lb_today() - 1, public.lb_today()); EXCEPTION WHEN OTHERS THEN rep_blocked := true; END;
  SELECT count(*) INTO nb FROM public.account_balances();
  a := d->'finance' = 'null'::jsonb AND d->>'scope' = 'mine' AND fin_blocked AND rep_blocked AND nb = 0
   AND '00000000-0000-0000-0000-00000000c601' IN (SELECT public.kpi_ids('cases_active', public.lb_today(), public.lb_today())) AND '00000000-0000-0000-0000-00000000c602' NOT IN (SELECT public.kpi_ids('cases_active', public.lb_today(), public.lb_today()))
   AND '00000000-0000-0000-0000-00000000c604' NOT IN (SELECT public.kpi_ids('cases_active', public.lb_today(), public.lb_today()))
   AND (SELECT count(*) FROM public.kpi_ids('cases_unassigned', public.lb_today(), public.lb_today())) = 0 AND (SELECT count(*) FROM public.kpi_ids('accounts_due', public.lb_today(), public.lb_today())) = 0
   AND '00000000-0000-0000-0000-00000000b606' IN (SELECT public.kpi_ids('q_pending', public.lb_today() - 120, public.lb_today())) AND '00000000-0000-0000-0000-00000000b602' NOT IN (SELECT public.kpi_ids('q_pending', public.lb_today() - 120, public.lb_today()))
   AND '00000000-0000-0000-0000-00000000f601' IN (SELECT public.kpi_ids('clients_total', public.lb_today(), public.lb_today())) AND '00000000-0000-0000-0000-00000000f603' NOT IN (SELECT public.kpi_ids('clients_total', public.lb_today(), public.lb_today()))
   AND '00000000-0000-0000-0000-00000000d601' IN (SELECT public.kpi_ids('reminders_overdue', public.lb_today(), public.lb_today())) AND (SELECT count(*) FROM public.staff_workload(public.lb_today() - 1, public.lb_today())) = 0;
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('T6 staff: no finance / reports / workload / account list; only assigned or own records in every KPI', a);
END $$;

-- T7 Pakistan-time boundaries: 00:30 today (Pakistan) is already today although it is still yesterday in UTC; 23:30 yesterday is yesterday
DO $$ DECLARE a boolean; BEGIN
  PERFORM pg_temp.claims('');
  INSERT INTO public.quotations (id, quotation_number, client_id, transaction_type, status, grand_total, created_by, created_at) VALUES
    ('00000000-0000-0000-0000-00000000b607', 'M6-Q7', '00000000-0000-0000-0000-00000000f603', 'transfer', 'rejected', 10, '00000000-0000-0000-0000-0000000000f2', ((public.lb_today())::timestamp + time '00:30') AT TIME ZONE 'Asia/Karachi'),
    ('00000000-0000-0000-0000-00000000b608', 'M6-Q8', '00000000-0000-0000-0000-00000000f603', 'transfer', 'rejected', 10, '00000000-0000-0000-0000-0000000000f2', ((public.lb_today() - 1)::timestamp + time '23:30') AT TIME ZONE 'Asia/Karachi');
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
  a := '00000000-0000-0000-0000-00000000b607' IN (SELECT public.kpi_ids('q_rejected', public.lb_today(), public.lb_today())) AND '00000000-0000-0000-0000-00000000b608' NOT IN (SELECT public.kpi_ids('q_rejected', public.lb_today(), public.lb_today()))
   AND '00000000-0000-0000-0000-00000000b608' IN (SELECT public.kpi_ids('q_rejected', public.lb_today() - 1, public.lb_today() - 1)) AND '00000000-0000-0000-0000-00000000b607' NOT IN (SELECT public.kpi_ids('q_rejected', public.lb_today() - 1, public.lb_today() - 1));
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('T7 date filters use Pakistan day boundaries (00:30 and 23:30 cases)', a);
END $$;

-- T8 staff workload and report summary for managers
DO $$ DECLARE w record; rs jsonb; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
  SELECT * INTO w FROM public.staff_workload(public.lb_today(), public.lb_today()) WHERE user_id = '00000000-0000-0000-0000-0000000000f1';
  rs := public.report_summary(public.lb_today() - 120, public.lb_today());
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('T8 workload per person (S: 1 open case, 1 overdue reminder) and report summary has quotations by status and finance',
    w.open_cases = 1 AND w.overdue_reminders = 1 AND jsonb_typeof(rs->'quotations_by_status') = 'array' AND rs->'finance' ? 'collected');
END $$;

SELECT current_setting('m6.r') AS results;   -- every line must say PASS
ROLLBACK;
