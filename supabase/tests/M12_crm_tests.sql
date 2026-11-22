-- ======================================================================================================================
-- M12 tests: leads, activities, expenses, client documents (+ private storage), templates, renewals, KPIs.
-- Attacks every new table / function as: signed-out visitor, pending user, Staff, Manager, Owner.
-- RUN ON STAGING ONLY, as postgres. One transaction, ends with ROLLBACK. Every result line must say PASS.
-- (The storage tests need the Supabase "storage" schema; on a database without it they are skipped and reported as SKIP.)
-- ======================================================================================================================
BEGIN;
SELECT set_config('m12.r', '', true);
INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-0000-0000-0000000012b1', 'm12-owner@test.invalid',   'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000012b2', 'm12-manager@test.invalid', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000012b3', 'm12-staff@test.invalid',   'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000012b4', 'm12-pending@test.invalid', 'authenticated', 'authenticated');
UPDATE public.profiles SET role = 'admin',   active = true  WHERE id = '00000000-0000-0000-0000-0000000012b1';
UPDATE public.profiles SET role = 'manager', active = true  WHERE id = '00000000-0000-0000-0000-0000000012b2';
UPDATE public.profiles SET role = 'staff',   active = true  WHERE id = '00000000-0000-0000-0000-0000000012b3';
UPDATE public.profiles SET role = 'staff',   active = false WHERE id = '00000000-0000-0000-0000-0000000012b4';

CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN u IN ('', 'anon') THEN '' ELSE '{"sub":"' || u || '","role":"authenticated"}' END, true);
  EXECUTE 'RESET ROLE';
  IF u = 'anon' THEN EXECUTE 'SET LOCAL ROLE anon'; ELSIF u <> '' THEN EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.rec(name text, ok boolean) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN PERFORM set_config('m12.r', current_setting('m12.r') || CASE WHEN COALESCE(ok, false) THEN 'PASS' ELSE 'FAIL' END || ' ' || name || E'\n', true); END $f$;
-- run a statement as a user and undo it: returns the row count, or -1 when the database refused it
CREATE OR REPLACE FUNCTION pg_temp.try(u text, stmt text) RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE n bigint := -1;
BEGIN
  PERFORM pg_temp.as_user(u);
  BEGIN
    EXECUTE stmt; GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0099' THEN n := -1; END IF;
  END;
  PERFORM pg_temp.as_user('');
  RETURN n;
END $f$;
-- run a statement as a user and KEEP it (inside this test transaction)
CREATE OR REPLACE FUNCTION pg_temp.keep(u text, stmt text) RETURNS bigint LANGUAGE plpgsql AS $f$
DECLARE n bigint := -1;
BEGIN
  PERFORM pg_temp.as_user(u);
  BEGIN EXECUTE stmt; GET DIAGNOSTICS n = ROW_COUNT; EXCEPTION WHEN OTHERS THEN n := -1; END;
  PERFORM pg_temp.as_user('');
  RETURN n;
END $f$;

-- seed (as postgres): a client, two leads, one vehicle with three renewal situations, a registered document, templates exist from the migration
INSERT INTO public.clients (id, name, created_by) VALUES ('00000000-0000-0000-0000-0000000012c1', 'M12 Client', '00000000-0000-0000-0000-0000000012b1');
INSERT INTO public.leads (id, name, phone, source, status, next_follow_up, created_by) VALUES
  ('00000000-0000-0000-0000-0000000012d1', 'Lead Due',     '0300', 'whatsapp', 'new',       public.lb_today() - 1, '00000000-0000-0000-0000-0000000012b1'),
  ('00000000-0000-0000-0000-0000000012d2', 'Lead Future',  '0301', 'walk_in',  'contacted', public.lb_today() + 5, '00000000-0000-0000-0000-0000000012b1'),
  ('00000000-0000-0000-0000-0000000012d3', 'Lead Won Old', '0302', 'phone',    'won',       NULL,                  '00000000-0000-0000-0000-0000000012b1');
INSERT INTO public.vehicles (id, client_id, registration_number, token_tax_due, created_by) VALUES
  ('00000000-0000-0000-0000-0000000012e1', '00000000-0000-0000-0000-0000000012c1', 'M12-OVERDUE', public.lb_today() - 3,  '00000000-0000-0000-0000-0000000012b1'),
  ('00000000-0000-0000-0000-0000000012e2', '00000000-0000-0000-0000-0000000012c1', 'M12-SOON',    public.lb_today() + 10, '00000000-0000-0000-0000-0000000012b1'),
  ('00000000-0000-0000-0000-0000000012e3', '00000000-0000-0000-0000-0000000012c1', 'M12-LATER',   public.lb_today() + 90, '00000000-0000-0000-0000-0000000012b1');
INSERT INTO public.client_documents (id, client_id, doc_type, file_name, storage_path, mime_type, size_bytes, created_by) VALUES
  ('00000000-0000-0000-0000-0000000012f1', '00000000-0000-0000-0000-0000000012c1', 'cnic', 'cnic.pdf', '00000000-0000-0000-0000-0000000012c1/seed-cnic.pdf', 'application/pdf', 1000, '00000000-0000-0000-0000-0000000012b1');

DO $$
DECLARE
  o text := '00000000-0000-0000-0000-0000000012b1'; m text := '00000000-0000-0000-0000-0000000012b2'; s text := '00000000-0000-0000-0000-0000000012b3'; p text := '00000000-0000-0000-0000-0000000012b4';
  c text := '00000000-0000-0000-0000-0000000012c1'; l1 text := '00000000-0000-0000-0000-0000000012d1';
  n bigint; who uuid; k jsonb; es jsonb; has_storage boolean := to_regclass('storage.objects') IS NOT NULL; tbl text; ok boolean;
BEGIN
  -- ---------- LEADS ----------
  PERFORM pg_temp.rec('L1 staff can add a lead', pg_temp.try(s, $q$INSERT INTO public.leads (name, source) VALUES ('X', 'phone')$q$) = 1);
  PERFORM pg_temp.keep(s, format($q$INSERT INTO public.leads (id, name, created_by) VALUES ('00000000-0000-0000-0000-0000000012d9', 'Forged', %L)$q$, o));
  SELECT created_by INTO who FROM public.leads WHERE id = '00000000-0000-0000-0000-0000000012d9';
  PERFORM pg_temp.rec('L2 created_by is the real user, a forged owner id is ignored', who = s::uuid);
  PERFORM pg_temp.rec('L2b staff cannot reassign created_by of a lead later', pg_temp.try(s, format($q$UPDATE public.leads SET name = 'Y', created_by = %L WHERE id = %L$q$, o, l1)) = 1
    AND (SELECT created_by FROM public.leads WHERE id = l1::uuid) = o::uuid);
  PERFORM pg_temp.rec('L3 a lost lead needs a reason', pg_temp.try(s, format($q$UPDATE public.leads SET status = 'lost' WHERE id = %L$q$, l1)) = -1
    AND pg_temp.try(s, format($q$UPDATE public.leads SET status = 'lost', lost_reason = 'Price' WHERE id = %L$q$, l1)) = 1);
  PERFORM pg_temp.rec('L4 invalid source / status / giant text refused', pg_temp.try(s, $q$INSERT INTO public.leads (name, source) VALUES ('X', 'hacked')$q$) = -1
    AND pg_temp.try(s, $q$INSERT INTO public.leads (name, status) VALUES ('X', 'whatever')$q$) = -1
    AND pg_temp.try(s, $q$INSERT INTO public.leads (name, notes) VALUES ('X', repeat('a', 5000))$q$) = -1);
  PERFORM pg_temp.rec('L5 pending user sees and adds no leads', pg_temp.try(p, 'SELECT * FROM public.leads') = 0 AND pg_temp.try(p, $q$INSERT INTO public.leads (name) VALUES ('X')$q$) = -1);
  PERFORM pg_temp.rec('L6 signed-out visitor: nothing', pg_temp.try('anon', 'SELECT * FROM public.leads') = -1 AND pg_temp.try('anon', $q$INSERT INTO public.leads (name) VALUES ('X')$q$) = -1);
  PERFORM pg_temp.rec('L7 staff cannot delete a lead, manager can', pg_temp.try(s, format($q$DELETE FROM public.leads WHERE id = %L$q$, l1)) <= 0 AND pg_temp.try(m, format($q$DELETE FROM public.leads WHERE id = %L$q$, l1)) = 1);
  -- convert
  PERFORM pg_temp.keep(s, format($q$SELECT public.convert_lead_to_client(%L)$q$, l1));
  PERFORM pg_temp.rec('L8 staff converts a lead: client created once, lead marked won', (SELECT count(*) FROM public.clients WHERE name = 'Lead Due') = 1
    AND (SELECT status FROM public.leads WHERE id = l1::uuid) = 'won' AND (SELECT client_id FROM public.leads WHERE id = l1::uuid) IS NOT NULL);
  PERFORM pg_temp.keep(s, format($q$SELECT public.convert_lead_to_client(%L)$q$, l1));
  PERFORM pg_temp.rec('L8b converting twice does not create a second client', (SELECT count(*) FROM public.clients WHERE name = 'Lead Due') = 1);
  PERFORM pg_temp.rec('L9 pending user and visitor cannot convert', pg_temp.try(p, format($q$SELECT public.convert_lead_to_client(%L)$q$, '00000000-0000-0000-0000-0000000012d2')) = -1
    AND pg_temp.try('anon', format($q$SELECT public.convert_lead_to_client(%L)$q$, '00000000-0000-0000-0000-0000000012d2')) = -1);

  -- ---------- ACTIVITIES ----------
  PERFORM pg_temp.rec('A1 staff logs a call on a lead and on a client', pg_temp.try(s, format($q$INSERT INTO public.crm_activities (lead_id, kind, note) VALUES (%L, 'call', 'Spoke, will decide Friday')$q$, '00000000-0000-0000-0000-0000000012d2')) = 1
    AND pg_temp.try(s, format($q$INSERT INTO public.crm_activities (client_id, kind, note) VALUES (%L, 'whatsapp', 'Sent documents list')$q$, c)) = 1);
  PERFORM pg_temp.keep(s, format($q$INSERT INTO public.crm_activities (lead_id, note, created_by) VALUES (%L, 'forged author', %L)$q$, '00000000-0000-0000-0000-0000000012d2', o));
  PERFORM pg_temp.rec('A1b activity author cannot be forged', (SELECT created_by FROM public.crm_activities WHERE note = 'forged author') = s::uuid);
  PERFORM pg_temp.rec('A2 an activity belongs to exactly one lead or client', pg_temp.try(s, format($q$INSERT INTO public.crm_activities (lead_id, client_id, note) VALUES (%L, %L, 'x')$q$, '00000000-0000-0000-0000-0000000012d2', c)) = -1
    AND pg_temp.try(s, $q$INSERT INTO public.crm_activities (note) VALUES ('x')$q$) = -1 AND pg_temp.try(s, format($q$INSERT INTO public.crm_activities (lead_id, kind, note) VALUES (%L, 'bad', 'x')$q$, '00000000-0000-0000-0000-0000000012d2')) = -1);
  PERFORM pg_temp.rec('A3 the log cannot be edited or erased by staff / manager', pg_temp.try(s, 'UPDATE public.crm_activities SET note = ''x''') = -1 AND pg_temp.try(m, 'UPDATE public.crm_activities SET note = ''x''') = -1
    AND pg_temp.try(s, 'DELETE FROM public.crm_activities') <= 0 AND pg_temp.try(m, 'DELETE FROM public.crm_activities') <= 0);
  PERFORM pg_temp.rec('A4 only the owner can delete a log entry', pg_temp.try(o, 'DELETE FROM public.crm_activities') >= 1);
  PERFORM pg_temp.rec('A5 pending user and visitor: no activities', pg_temp.try(p, 'SELECT * FROM public.crm_activities') = 0 AND pg_temp.try('anon', 'SELECT * FROM public.crm_activities') = -1);

  -- ---------- EXPENSES ----------
  PERFORM pg_temp.rec('E1 staff cannot read or add expenses', pg_temp.try(s, 'SELECT * FROM public.expenses') = 0
    AND pg_temp.try(s, $q$INSERT INTO public.expenses (category, amount) VALUES ('rent', 100)$q$) = -1);
  PERFORM pg_temp.rec('E1b pending user and visitor: nothing', pg_temp.try(p, $q$INSERT INTO public.expenses (category, amount) VALUES ('rent', 100)$q$) = -1
    AND pg_temp.try('anon', 'SELECT * FROM public.expenses') = -1);
  PERFORM pg_temp.keep(m, format($q$INSERT INTO public.expenses (id, category, amount, paid_from, description, created_by) VALUES ('00000000-0000-0000-0000-0000000012a1', 'rent', 100, 'cash', 'Office rent', %L)$q$, o));
  PERFORM pg_temp.keep(m, $q$INSERT INTO public.expenses (id, category, amount) VALUES ('00000000-0000-0000-0000-0000000012a2', 'other', 50)$q$);
  PERFORM pg_temp.rec('E2 manager adds expenses; author is the real user', (SELECT count(*) FROM public.expenses) = 2 AND (SELECT created_by FROM public.expenses WHERE id = '00000000-0000-0000-0000-0000000012a1') = m::uuid);
  PERFORM pg_temp.rec('E3 bad expenses refused: zero, negative, future, ancient, unknown category', pg_temp.try(m, $q$INSERT INTO public.expenses (category, amount) VALUES ('rent', 0)$q$) = -1
    AND pg_temp.try(m, $q$INSERT INTO public.expenses (category, amount) VALUES ('rent', -5)$q$) = -1
    AND pg_temp.try(m, $q$INSERT INTO public.expenses (category, amount, expense_date) VALUES ('rent', 5, public.lb_today() + 30)$q$) = -1
    AND pg_temp.try(m, $q$INSERT INTO public.expenses (category, amount, expense_date) VALUES ('rent', 5, public.lb_today() - 2000)$q$) = -1
    AND pg_temp.try(m, $q$INSERT INTO public.expenses (category, amount) VALUES ('hackers', 5)$q$) = -1);
  PERFORM pg_temp.rec('E4 nobody can edit or delete an expense directly (manager, owner)', pg_temp.try(m, 'UPDATE public.expenses SET amount = 1') = -1 AND pg_temp.try(o, 'UPDATE public.expenses SET amount = 1') = -1
    AND pg_temp.try(m, 'DELETE FROM public.expenses') = -1 AND pg_temp.try(o, 'DELETE FROM public.expenses') = -1 AND pg_temp.try(o, 'TRUNCATE public.expenses') = -1);
  PERFORM pg_temp.rec('E5 staff cannot void; a reason is required', pg_temp.try(s, $q$SELECT public.void_expense('00000000-0000-0000-0000-0000000012a2', 'x')$q$) = -1
    AND pg_temp.try(m, $q$SELECT public.void_expense('00000000-0000-0000-0000-0000000012a2', '   ')$q$) = -1);
  PERFORM pg_temp.keep(m, $q$SELECT public.void_expense('00000000-0000-0000-0000-0000000012a2', 'Entered by mistake')$q$);
  PERFORM pg_temp.rec('E5b manager voids; the row stays; voiding twice is refused', (SELECT voided_at IS NOT NULL AND voided_by = m::uuid AND void_reason = 'Entered by mistake' FROM public.expenses WHERE id = '00000000-0000-0000-0000-0000000012a2')
    AND pg_temp.try(m, $q$SELECT public.void_expense('00000000-0000-0000-0000-0000000012a2', 'again')$q$) = -1);
  PERFORM pg_temp.as_user(m); es := public.expense_summary(public.lb_today() - 1, public.lb_today() + 1); k := public.crm_kpis(public.lb_today() - 1, public.lb_today() + 1); PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('E6 summary counts only live expenses (voided one excluded)', (es ->> 'total')::numeric = 100 AND (es ->> 'count')::int = 1
    AND (es -> 'by_category' -> 0 ->> 'category') = 'rent' AND (k ->> 'expenses_total')::numeric = 100);
  PERFORM pg_temp.rec('E6b staff, pending user and visitor cannot read expense figures', pg_temp.try(s, 'SELECT public.expense_summary(public.lb_today() - 1, public.lb_today())') = -1
    AND pg_temp.try(p, 'SELECT public.expense_summary(public.lb_today() - 1, public.lb_today())') = -1 AND pg_temp.try('anon', 'SELECT public.expense_summary(public.lb_today() - 1, public.lb_today())') = -1);
  PERFORM pg_temp.rec('E7 the database logged the expense and the void under the real user', (SELECT count(*) FROM public.audit_logs WHERE action = 'db.insert.expenses' AND user_id = m::uuid) = 2
    AND (SELECT count(*) FROM public.audit_logs WHERE action = 'db.update.expenses' AND user_id = m::uuid AND details ? 'void_reason') = 1);

  -- ---------- DOCUMENTS ----------
  PERFORM pg_temp.rec('D1 staff registers a document in the client folder', pg_temp.try(s, format($q$INSERT INTO public.client_documents (client_id, doc_type, file_name, storage_path, mime_type, size_bytes) VALUES (%L, 'cnic', 'a.jpg', %L, 'image/jpeg', 2000)$q$, c, c || '/new-a.jpg')) = 1);
  PERFORM pg_temp.rec('D2 refused: program file, over 5 MB, empty, other client folder, path trick, unknown type',
        pg_temp.try(s, format($q$INSERT INTO public.client_documents (client_id, file_name, storage_path, mime_type, size_bytes) VALUES (%L, 'a.exe', %L, 'application/x-msdownload', 100)$q$, c, c || '/a.exe')) = -1
    AND pg_temp.try(s, format($q$INSERT INTO public.client_documents (client_id, file_name, storage_path, mime_type, size_bytes) VALUES (%L, 'big.pdf', %L, 'application/pdf', 6000000)$q$, c, c || '/big.pdf')) = -1
    AND pg_temp.try(s, format($q$INSERT INTO public.client_documents (client_id, file_name, storage_path, mime_type, size_bytes) VALUES (%L, 'e.pdf', %L, 'application/pdf', 0)$q$, c, c || '/e.pdf')) = -1
    AND pg_temp.try(s, format($q$INSERT INTO public.client_documents (client_id, file_name, storage_path, mime_type, size_bytes) VALUES (%L, 'o.pdf', %L, 'application/pdf', 10)$q$, c, '00000000-0000-0000-0000-0000000099ff/o.pdf')) = -1
    AND pg_temp.try(s, format($q$INSERT INTO public.client_documents (client_id, file_name, storage_path, mime_type, size_bytes) VALUES (%L, 't.pdf', %L, 'application/pdf', 10)$q$, c, c || '/../x/t.pdf')) = -1
    AND pg_temp.try(s, format($q$INSERT INTO public.client_documents (client_id, doc_type, file_name, storage_path, mime_type, size_bytes) VALUES (%L, 'secret', 'u.pdf', %L, 'application/pdf', 10)$q$, c, c || '/u.pdf')) = -1);
  PERFORM pg_temp.keep(s, format($q$INSERT INTO public.client_documents (client_id, file_name, storage_path, mime_type, size_bytes, created_by) VALUES (%L, 'f.pdf', %L, 'application/pdf', 10, %L)$q$, c, c || '/f.pdf', o));
  PERFORM pg_temp.rec('D2b document author cannot be forged', (SELECT count(*) FROM public.client_documents) = 2
    AND (SELECT created_by FROM public.client_documents WHERE file_name = 'f.pdf') = s::uuid);
  PERFORM pg_temp.rec('D3 pending user and visitor: no documents', pg_temp.try(p, 'SELECT * FROM public.client_documents') = 0 AND pg_temp.try('anon', 'SELECT * FROM public.client_documents') = -1
    AND pg_temp.try(p, format($q$INSERT INTO public.client_documents (client_id, file_name, storage_path, mime_type, size_bytes) VALUES (%L, 'p.pdf', %L, 'application/pdf', 10)$q$, c, c || '/p.pdf')) = -1);
  PERFORM pg_temp.rec('D4 staff cannot remove a document, manager can', pg_temp.try(s, 'DELETE FROM public.client_documents') <= 0 AND pg_temp.try(m, 'DELETE FROM public.client_documents') >= 1);
  PERFORM pg_temp.rec('D5 nobody can edit a document record (cannot point it at another client)', pg_temp.try(s, 'UPDATE public.client_documents SET file_name = ''x''') = -1 AND pg_temp.try(o, 'UPDATE public.client_documents SET storage_path = ''x''') = -1);
  PERFORM pg_temp.rec('D6 document add and remove are in the audit log', (SELECT count(*) FROM public.audit_logs WHERE action = 'db.insert.client_documents' AND user_id = s::uuid) >= 1);

  -- ---------- STORAGE ----------
  IF has_storage THEN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('lb-documents', c || '/seed-cnic.pdf'), ('lb-documents', c || '/stray-unregistered.pdf');
    PERFORM pg_temp.rec('S1 staff can upload into an existing client folder', pg_temp.try(s, format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('lb-documents', %L)$q$, c || '/up.pdf')) = 1);
    PERFORM pg_temp.rec('S1b upload refused: unknown client folder, bad folder, no folder, other bucket, pending user, visitor',
          pg_temp.try(s, $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('lb-documents', '00000000-0000-0000-0000-0000000099ff/x.pdf')$q$) = -1
      AND pg_temp.try(s, $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('lb-documents', 'somefolder/x.pdf')$q$) = -1
      AND pg_temp.try(s, $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('lb-documents', 'x.pdf')$q$) = -1
      AND pg_temp.try(s, format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('public', %L)$q$, c || '/x.pdf')) = -1
      AND pg_temp.try(p, format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('lb-documents', %L)$q$, c || '/x.pdf')) = -1
      AND pg_temp.try('anon', format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('lb-documents', %L)$q$, c || '/x.pdf')) = -1);
    -- the seeded document row was removed by D4 only inside its own rolled-back statement, so it is still registered
    PERFORM pg_temp.rec('S2 staff can download a registered file but not a stray upload', pg_temp.try(s, format($q$SELECT * FROM storage.objects WHERE name = %L$q$, c || '/seed-cnic.pdf')) = 1
      AND pg_temp.try(s, format($q$SELECT * FROM storage.objects WHERE name = %L$q$, c || '/stray-unregistered.pdf')) = 0);
    PERFORM pg_temp.rec('S2b pending user and visitor cannot download', pg_temp.try(p, 'SELECT * FROM storage.objects') = 0 AND pg_temp.try('anon', 'SELECT * FROM storage.objects') = 0);
    PERFORM pg_temp.rec('S3 staff cannot delete a stored file, manager can', pg_temp.try(s, 'DELETE FROM storage.objects') <= 0 AND pg_temp.try(m, 'DELETE FROM storage.objects') >= 1);
    PERFORM pg_temp.rec('S4 nobody can overwrite or rename a stored file', pg_temp.try(s, 'UPDATE storage.objects SET name = ''x''') <= 0 AND pg_temp.try(o, 'UPDATE storage.objects SET name = ''x''') <= 0);
    PERFORM pg_temp.rec('S5 the bucket is private with a 5 MB limit and only images / PDF', (SELECT NOT public AND file_size_limit = 5242880 AND allowed_mime_types @> ARRAY['application/pdf', 'image/jpeg'] AND NOT (allowed_mime_types && ARRAY['text/html', 'application/x-msdownload']) FROM storage.buckets WHERE id = 'lb-documents'));
  ELSE
    PERFORM pg_temp.rec('S0 SKIP storage tests (no storage schema on this database)', true);
  END IF;

  -- ---------- TEMPLATES ----------
  PERFORM pg_temp.rec('T1 staff can read the templates but not change them', pg_temp.try(s, 'SELECT * FROM public.message_templates') >= 6 AND pg_temp.try(s, 'UPDATE public.message_templates SET body = ''x''') <= 0
    AND pg_temp.try(s, $q$INSERT INTO public.message_templates (key, title, body) VALUES ('evil', 'e', 'b')$q$) = -1 AND pg_temp.try(s, 'DELETE FROM public.message_templates') <= 0);
  PERFORM pg_temp.rec('T1b manager cannot change templates, owner can', pg_temp.try(m, 'UPDATE public.message_templates SET body = ''x''') <= 0 AND pg_temp.try(o, 'UPDATE public.message_templates SET body = ''New text''') >= 6);
  PERFORM pg_temp.rec('T1c bad template keys / empty text refused', pg_temp.try(o, $q$INSERT INTO public.message_templates (key, title, body) VALUES ('Bad Key!', 't', 'b')$q$) = -1 AND pg_temp.try(o, $q$INSERT INTO public.message_templates (key, title, body) VALUES ('ok_key', 't', '   ')$q$) = -1);
  PERFORM pg_temp.rec('T2 pending user and visitor: no templates', pg_temp.try(p, 'SELECT * FROM public.message_templates') = 0 AND pg_temp.try('anon', 'SELECT * FROM public.message_templates') = -1);

  -- ---------- RENEWALS + KPIs ----------
  PERFORM pg_temp.rec('R1 staff can set renewal dates on a vehicle', pg_temp.try(s, format($q$UPDATE public.vehicles SET token_tax_due = public.lb_today() + 7, registration_due = public.lb_today() + 200 WHERE id = %L$q$, '00000000-0000-0000-0000-0000000012e3')) = 1);
  PERFORM pg_temp.as_user(s); k := public.crm_kpis(public.lb_today() - 30, public.lb_today()); PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('K1 renewals: 1 overdue, 1 due within 30 days (the 90-day one is not counted)', (k ->> 'renewals_overdue')::int = 1 AND (k ->> 'renewals_30')::int = 1);
  PERFORM pg_temp.rec('K2 leads: due follow-up counts only open leads with a date up to today', (k ->> 'leads_followup_due')::int = 0 AND (k ->> 'leads_open')::int >= 1);
  PERFORM pg_temp.rec('K3 staff see no expense figure', k -> 'expenses_total' = 'null'::jsonb);
  PERFORM pg_temp.rec('K4 pending user and visitor cannot read KPIs', pg_temp.try(p, 'SELECT public.crm_kpis(public.lb_today(), public.lb_today())') = -1 AND pg_temp.try('anon', 'SELECT public.crm_kpis(public.lb_today(), public.lb_today())') = -1);

  -- ---------- EVERY NEW TABLE / FUNCTION ----------
  ok := true;
  FOREACH tbl IN ARRAY ARRAY['leads', 'crm_activities', 'expenses', 'client_documents', 'message_templates'] LOOP
    ok := ok AND (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || tbl)::regclass)
             AND NOT has_table_privilege('anon', 'public.' || tbl, 'SELECT') AND NOT has_table_privilege('anon', 'public.' || tbl, 'INSERT')
             AND NOT has_table_privilege('authenticated', 'public.' || tbl, 'TRUNCATE');
  END LOOP;
  PERFORM pg_temp.rec('Z1 every new table has row-level security, no rights for visitors, no TRUNCATE for anyone', ok);
  PERFORM pg_temp.rec('Z2 visitors cannot run the new functions; internal helper is closed to everyone',
        NOT has_function_privilege('anon', 'public.crm_kpis(date,date)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.expense_summary(date,date)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.convert_lead_to_client(uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.void_expense(uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.lb_expense_guard()', 'EXECUTE'));
END $$;
SELECT current_setting('m12.r');
ROLLBACK;
