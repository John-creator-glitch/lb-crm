-- =====================================================================================================================
-- CLEAN TEST DATA: empties every business table, keeps the system itself.
--   DELETED : clients, vehicles, quotations (+ lines), payments, on-account payments, transfers, cases (+ documents), tasks,
--             reminders, notifications, leads, CRM activities, expenses, client documents (records), HPA counts, inventory,
--             status history, audit log.
--   KEPT    : people who can sign in (profiles / Authentication users), Settings & Branding, fee rules, Punjab and Islamabad
--             rate tables, message templates.
-- THIS CANNOT BE UNDONE.  Take a backup first (Settings -> Backup in the app, or Supabase Dashboard -> Database -> Backups).
--
-- How to use:  Supabase Dashboard -> SQL Editor.
--   1) Run this whole file once as it is: it only shows how many rows each table has and then STOPS (nothing is deleted).
--   2) If the numbers are what you expect, change   confirm text := 'NO';   to   'YES'   below and run it again.
--   3) Then Storage -> bucket "lb-documents" -> select all -> Delete (uploaded scans are files, SQL cannot remove them).
-- =====================================================================================================================
DO $$
DECLARE
  confirm text := 'NO';          -- <<< change to 'YES' to really delete
  t text; n bigint; report text := '';
  tables text[] := ARRAY['payment_allocations','client_payments','payments','quotation_line_items','quotations','status_history',
    'case_documents','cases','transfers','tasks','reminder_events','reminders','notifications','crm_activities','leads','expenses',
    'client_documents','vehicles','clients','hpa_counts','inventory_items','audit_logs'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    report := report || format(E'\n  %-22s %s', t, n);
  END LOOP;
  IF confirm <> 'YES' THEN
    RAISE EXCEPTION E'NOTHING WAS DELETED. Rows that would be removed:%\n\nIf this is right, change confirm to ''YES'' and run again.', report;
  END IF;
  -- TRUNCATE does not fire the per-row audit/guard triggers, so it is fast and leaves no half-deleted state
  EXECUTE 'TRUNCATE TABLE ' || (SELECT string_agg(format('public.%I', x), ', ') FROM unnest(tables) x) || ' RESTART IDENTITY CASCADE';
  RAISE NOTICE 'Done. Business data removed. Users, settings, rates and templates are untouched.';
END $$;
