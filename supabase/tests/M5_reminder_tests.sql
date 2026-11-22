-- ======================================================================================================================
-- M5 tests: reminders, in-app notifications, no duplicates, snooze/complete/cancel/recurrence/escalation, no external sending.
-- RUN ON STAGING ONLY, in Supabase SQL Editor, as the postgres user. One transaction, ends with ROLLBACK: no test data stays.
-- Needs M1..M5 migrations. Every line of the final result must say PASS.
-- ======================================================================================================================
BEGIN;
SELECT set_config('m5.r', '', true);
INSERT INTO auth.users (id, email, aud, role) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'm5-staff1@test.invalid',  'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e2', 'm5-staff2@test.invalid',  'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e3',  'm5-manager@test.invalid', 'authenticated', 'authenticated');
UPDATE public.profiles SET role = 'staff',   active = true, full_name = 'Staff One'  WHERE id = '00000000-0000-0000-0000-0000000000e1';
UPDATE public.profiles SET role = 'staff',   active = true, full_name = 'Staff Two'  WHERE id = '00000000-0000-0000-0000-0000000000e2';
UPDATE public.profiles SET role = 'manager', active = true, full_name = 'Manager M5' WHERE id = '00000000-0000-0000-0000-0000000000e3';
INSERT INTO public.clients (id, name, created_by) VALUES ('00000000-0000-0000-0000-00000000d301', 'M5 Client', '00000000-0000-0000-0000-0000000000e3');

CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN u = '' THEN '' ELSE '{"sub":"' || u || '","role":"authenticated"}' END, true);
  IF u = '' THEN EXECUTE 'RESET ROLE'; ELSE EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
END $f$;
CREATE OR REPLACE FUNCTION pg_temp.rec(name text, ok boolean) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN PERFORM set_config('m5.r', current_setting('m5.r') || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' ' || name || E'\n', true); END $f$;

-- T1 staff1 creates reminders for himself (due now), for staff2 (due now) and a future one; the worker notifies exactly the assigned person, once
DO $$ DECLARE n1 int; n2 int; a int; b int; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
  INSERT INTO public.reminders (id, title, client_id, owner_id, due_at) VALUES ('00000000-0000-0000-0000-00000000d311', 'Call client about CNIC', '00000000-0000-0000-0000-00000000d301', '00000000-0000-0000-0000-0000000000e1', now() - interval '1 minute');
  INSERT INTO public.reminders (id, title, owner_id, due_at) VALUES ('00000000-0000-0000-0000-00000000d312', 'Collect cheque', '00000000-0000-0000-0000-0000000000e2', now() - interval '1 minute');
  INSERT INTO public.reminders (id, title, owner_id, due_at) VALUES ('00000000-0000-0000-0000-00000000d313', 'Future one', '00000000-0000-0000-0000-0000000000e1', now() + interval '2 days');
  SELECT public.process_due_reminders() INTO n1;
  SELECT public.process_due_reminders() INTO n2;     -- second run: nothing new
  PERFORM pg_temp.as_user('');
  SELECT count(*) INTO a FROM public.notifications WHERE kind = 'due' AND user_id = '00000000-0000-0000-0000-0000000000e1' AND reminder_id = '00000000-0000-0000-0000-00000000d311';
  SELECT count(*) INTO b FROM public.notifications WHERE kind = 'due' AND user_id = '00000000-0000-0000-0000-0000000000e2' AND reminder_id = '00000000-0000-0000-0000-00000000d312';
  PERFORM pg_temp.rec('T1 due reminder notifies the assignee exactly once (worker run twice)', n1 = 2 AND n2 = 0 AND a = 1 AND b = 1
    AND (SELECT count(*) FROM public.notifications WHERE reminder_id = '00000000-0000-0000-0000-00000000d313' AND kind = 'due') = 0
    AND (SELECT count(*) FROM public.reminder_events WHERE reminder_id = '00000000-0000-0000-0000-00000000d311' AND event = 'due_notified') = 1);
END $$;

-- T2 assigning to somebody else tells them; creating for yourself does not
DO $$ BEGIN
  PERFORM pg_temp.rec('T2 assignee gets an "assigned" notification, self-created does not',
    (SELECT count(*) FROM public.notifications WHERE kind = 'assigned' AND user_id = '00000000-0000-0000-0000-0000000000e2' AND reminder_id = '00000000-0000-0000-0000-00000000d312') = 1
    AND (SELECT count(*) FROM public.notifications WHERE kind = 'assigned' AND reminder_id = '00000000-0000-0000-0000-00000000d311') = 0);
END $$;

-- T3 inbox privacy: staff2 sees only his own notifications; manager sees all
DO $$ DECLARE n2 int; nm int; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000e2'); SELECT count(*) INTO n2 FROM public.notifications WHERE user_id <> '00000000-0000-0000-0000-0000000000e2';
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');  SELECT count(*) INTO nm FROM public.notifications;
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('T3 staff cannot read others'' notifications', n2 = 0 AND nm >= 3);
END $$;

-- T4 snooze: leaves the due list; after the snooze time passes it notifies once more (a new due time), not twice
DO $$ DECLARE past boolean := false; c1 int; c2 int; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
  BEGIN PERFORM public.snooze_reminder('00000000-0000-0000-0000-00000000d311', now() - interval '1 hour'); EXCEPTION WHEN OTHERS THEN past := true; END;
  PERFORM public.snooze_reminder('00000000-0000-0000-0000-00000000d311', now() + interval '3 hours');
  PERFORM public.process_due_reminders();
  PERFORM pg_temp.as_user('');
  SELECT count(*) INTO c1 FROM public.notifications WHERE kind = 'due' AND reminder_id = '00000000-0000-0000-0000-00000000d311';
  PERFORM set_config('lb.rem', '1', true);
  UPDATE public.reminders SET snoozed_until = now() - interval '1 second' WHERE id = '00000000-0000-0000-0000-00000000d311';   -- time passes (simulated)
  PERFORM set_config('lb.rem', '', true);
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000e1'); PERFORM public.process_due_reminders(); PERFORM public.process_due_reminders(); PERFORM pg_temp.as_user('');
  SELECT count(*) INTO c2 FROM public.notifications WHERE kind = 'due' AND reminder_id = '00000000-0000-0000-0000-00000000d311';
  PERFORM pg_temp.rec('T4 snooze must be in the future; snoozed reminder alerts once more, not repeatedly', past AND c1 = 1 AND c2 = 2
    AND (SELECT count(*) FROM public.reminder_events WHERE reminder_id = '00000000-0000-0000-0000-00000000d311' AND event = 'snoozed') = 1);
END $$;

-- T5 only the assignee, creator or a manager may act; completion keeps the record and the history; cannot complete twice
DO $$ DECLARE other boolean := false; twice boolean := false; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
  BEGIN PERFORM public.complete_reminder('00000000-0000-0000-0000-00000000d311', 'not mine'); EXCEPTION WHEN OTHERS THEN other := true; END;      -- S2 is neither owner nor creator of r11
  PERFORM public.complete_reminder('00000000-0000-0000-0000-00000000d312', 'cheque collected');
  BEGIN PERFORM public.complete_reminder('00000000-0000-0000-0000-00000000d312', 'again'); EXCEPTION WHEN OTHERS THEN twice := true; END;
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('T5 only permitted people complete; completed stays in history; no double complete', other AND twice
    AND (SELECT status FROM public.reminders WHERE id = '00000000-0000-0000-0000-00000000d312') = 'completed'
    AND (SELECT completed_by FROM public.reminders WHERE id = '00000000-0000-0000-0000-00000000d312') = '00000000-0000-0000-0000-0000000000e2'
    AND (SELECT count(*) FROM public.reminder_events WHERE reminder_id = '00000000-0000-0000-0000-00000000d312' AND event = 'completed') = 1);
END $$;

-- T6 cancel needs a reason; manager may cancel anyone's; a closed reminder cannot be edited
DO $$ DECLARE noreason boolean := false; edit boolean := false; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000e3');
  BEGIN PERFORM public.cancel_reminder('00000000-0000-0000-0000-00000000d313', '  '); EXCEPTION WHEN OTHERS THEN noreason := true; END;
  PERFORM public.cancel_reminder('00000000-0000-0000-0000-00000000d313', 'Client cancelled the job');
  BEGIN UPDATE public.reminders SET title = 'edited' WHERE id = '00000000-0000-0000-0000-00000000d313'; EXCEPTION WHEN OTHERS THEN edit := true; END;
  PERFORM pg_temp.as_user('');
  PERFORM pg_temp.rec('T6 cancel needs a reason, manager may cancel, closed reminders are read-only', noreason AND edit
    AND (SELECT status FROM public.reminders WHERE id = '00000000-0000-0000-0000-00000000d313') = 'cancelled');
END $$;

-- T7 recurrence: completing a daily reminder creates exactly one next reminder in the future
DO $$ DECLARE nid uuid; n int; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
  INSERT INTO public.reminders (id, title, owner_id, due_at, recurrence) VALUES ('00000000-0000-0000-0000-00000000d314', 'Daily cash count', '00000000-0000-0000-0000-0000000000e1', now() - interval '3 days', 'daily');
  PERFORM public.complete_reminder('00000000-0000-0000-0000-00000000d314');
  PERFORM pg_temp.as_user('');
  SELECT count(*) INTO n FROM public.reminders WHERE parent_id = '00000000-0000-0000-0000-00000000d314' AND status = 'open' AND due_at > now();
  PERFORM pg_temp.rec('T7 recurring reminder creates exactly one next occurrence in the future', n = 1
    AND (SELECT count(*) FROM public.reminder_events WHERE reminder_id = '00000000-0000-0000-0000-00000000d314' AND event = 'recurred') = 1);
END $$;

-- T8 escalation: unfinished 2 hours after due -> manager is told once (even if the worker runs often)
DO $$ DECLARE c int; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
  INSERT INTO public.reminders (id, title, owner_id, due_at, escalate_after_hours) VALUES ('00000000-0000-0000-0000-00000000d315', 'Submit file to Excise', '00000000-0000-0000-0000-0000000000e1', now() - interval '3 hours', 2);
  PERFORM public.process_due_reminders(); PERFORM public.process_due_reminders();
  PERFORM pg_temp.as_user('');
  SELECT count(*) INTO c FROM public.notifications WHERE kind = 'escalated' AND reminder_id = '00000000-0000-0000-0000-00000000d315' AND user_id = '00000000-0000-0000-0000-0000000000e3';
  PERFORM pg_temp.rec('T8 escalation tells the manager once', c = 1 AND (SELECT count(*) FROM public.reminder_events WHERE reminder_id = '00000000-0000-0000-0000-00000000d315' AND event = 'escalated') = 1
    AND (SELECT count(*) FROM public.notifications WHERE kind = 'escalated' AND reminder_id = '00000000-0000-0000-0000-00000000d315' AND user_id = '00000000-0000-0000-0000-0000000000e1') = 0);
END $$;

-- T9 external channels: recorded as failed with a reason, retry is safe (no second notification, never "delivered"), nothing sent
DO $$ DECLARE nid uuid; c int; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
  INSERT INTO public.reminders (id, title, owner_id, due_at, channel) VALUES ('00000000-0000-0000-0000-00000000d316', 'WhatsApp the client', '00000000-0000-0000-0000-0000000000e1', now() - interval '1 minute', 'whatsapp');
  PERFORM public.process_due_reminders();
  SELECT id INTO nid FROM public.notifications WHERE reminder_id = '00000000-0000-0000-0000-00000000d316' AND kind = 'due';
  PERFORM public.retry_notification(nid); PERFORM public.retry_notification(nid);
  PERFORM pg_temp.as_user('');
  SELECT count(*) INTO c FROM public.notifications WHERE reminder_id = '00000000-0000-0000-0000-00000000d316' AND kind = 'due';
  PERFORM pg_temp.rec('T9 external channel fails with reason, retry never sends or duplicates', c = 1
    AND (SELECT delivery_status FROM public.notifications WHERE id = nid) = 'failed'
    AND (SELECT attempts FROM public.notifications WHERE id = nid) = 3
    AND (SELECT failure_reason FROM public.notifications WHERE id = nid) ILIKE '%Nothing was sent%'
    AND (SELECT count(*) FROM public.notifications WHERE channel <> 'in_app' AND delivery_status = 'delivered') = 0);
END $$;

-- T10 state fields cannot be changed by a direct UPDATE; staff cannot delete; mark-read affects only own notifications
DO $$ DECLARE blocked boolean := false; del int; mine int; theirs int; BEGIN
  PERFORM pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
  BEGIN UPDATE public.reminders SET status = 'completed' WHERE id = '00000000-0000-0000-0000-00000000d315'; EXCEPTION WHEN OTHERS THEN blocked := true; END;
  DELETE FROM public.reminders WHERE id = '00000000-0000-0000-0000-00000000d315'; GET DIAGNOSTICS del = ROW_COUNT;
  PERFORM public.mark_notifications_read();
  PERFORM pg_temp.as_user('');
  SELECT count(*) INTO mine FROM public.notifications WHERE user_id = '00000000-0000-0000-0000-0000000000e1' AND read_at IS NULL;
  SELECT count(*) INTO theirs FROM public.notifications WHERE user_id <> '00000000-0000-0000-0000-0000000000e1' AND read_at IS NOT NULL;
  PERFORM pg_temp.rec('T10 status only via functions, staff cannot delete, mark-read is per person', blocked AND del = 0 AND mine = 0 AND theirs = 0);
END $$;

SELECT current_setting('m5.r') AS results;   -- every line must say PASS
ROLLBACK;
