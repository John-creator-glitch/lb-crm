-- M5: Reminders, in-app notifications and delivery log. Additive and safe to run more than once.
-- Reminders are separate from tasks (tasks = work to do; reminders = something that must alert a person at a time). A reminder may link to a task.
-- Only the IN-APP channel is live. email / whatsapp reminders can be created but are recorded as "failed: not enabled" and NOTHING external is ever sent
-- until provider, templates, consent and opt-out rules are approved (see docs/M5_provider_plan.md).
-- Notifications are created by process_due_reminders(), which is idempotent: one notification per (reminder, due time, person), enforced by a unique key.

CREATE TABLE IF NOT EXISTS public.reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  notes text,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  quotation_id uuid REFERENCES public.quotations(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  due_at timestamptz NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  channel text NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'email', 'whatsapp')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
  snoozed_until timestamptz,
  recurrence text NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly')),
  escalate_after_hours integer CHECK (escalate_after_hours IS NULL OR escalate_after_hours > 0),
  escalated_at timestamptz,
  completed_at timestamptz, completed_by uuid, cancel_reason text,
  parent_id uuid REFERENCES public.reminders(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reminders_owner_status ON public.reminders (owner_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON public.reminders (status, due_at);
CREATE INDEX IF NOT EXISTS idx_reminders_links ON public.reminders (client_id, case_id, quotation_id);

CREATE TABLE IF NOT EXISTS public.reminder_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id uuid NOT NULL REFERENCES public.reminders(id) ON DELETE CASCADE,
  event text NOT NULL,           -- created, due_notified, send_failed, snoozed, completed, cancelled, escalated, recurred, reassigned, retried
  detail text,
  actor uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reminder_events ON public.reminder_events (reminder_id, created_at);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reminder_id uuid REFERENCES public.reminders(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('due', 'escalated', 'assigned')),
  title text NOT NULL, body text,
  channel text NOT NULL DEFAULT 'in_app',
  delivery_status text NOT NULL DEFAULT 'delivered' CHECK (delivery_status IN ('delivered', 'failed')),
  failure_reason text,
  attempts integer NOT NULL DEFAULT 1,
  idempotency_key text NOT NULL UNIQUE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications (user_id, read_at, created_at DESC);

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminders TO authenticated;
GRANT SELECT ON public.reminder_events, public.notifications TO authenticated;
GRANT ALL ON public.reminders, public.reminder_events, public.notifications TO service_role;

DROP POLICY IF EXISTS reminders_select ON public.reminders;
CREATE POLICY reminders_select ON public.reminders FOR SELECT TO authenticated USING (public.app_rank() >= 1);
DROP POLICY IF EXISTS reminders_insert ON public.reminders;
CREATE POLICY reminders_insert ON public.reminders FOR INSERT TO authenticated WITH CHECK (public.app_rank() >= 1 AND created_by = auth.uid());
DROP POLICY IF EXISTS reminders_update ON public.reminders;
CREATE POLICY reminders_update ON public.reminders FOR UPDATE TO authenticated
  USING (public.app_rank() >= 2 OR owner_id = auth.uid() OR created_by = auth.uid()) WITH CHECK (public.app_rank() >= 1);
DROP POLICY IF EXISTS reminders_delete ON public.reminders;
CREATE POLICY reminders_delete ON public.reminders FOR DELETE TO authenticated USING (public.app_rank() >= 3);   -- others cancel; history is kept
DROP POLICY IF EXISTS reminder_events_select ON public.reminder_events;
CREATE POLICY reminder_events_select ON public.reminder_events FOR SELECT TO authenticated USING (public.app_rank() >= 1);
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.app_rank() >= 2);

-- guard: state fields change only through the functions below; log creation and reassignment ---------------------------------------
CREATE OR REPLACE FUNCTION public.reminders_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'open'; NEW.snoozed_until := NULL; NEW.escalated_at := NULL; NEW.completed_at := NULL; NEW.completed_by := NULL; NEW.cancel_reason := NULL;
    RETURN NEW;
  END IF;
  IF coalesce(current_setting('lb.rem', true), '') <> '1' AND (
       NEW.status IS DISTINCT FROM OLD.status OR NEW.snoozed_until IS DISTINCT FROM OLD.snoozed_until OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
       OR NEW.completed_by IS DISTINCT FROM OLD.completed_by OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason OR NEW.escalated_at IS DISTINCT FROM OLD.escalated_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by) THEN
    RAISE EXCEPTION 'Use Complete, Snooze or Cancel to change a reminder.';
  END IF;
  IF OLD.status <> 'open' AND coalesce(current_setting('lb.rem', true), '') <> '1' THEN RAISE EXCEPTION 'A completed or cancelled reminder is kept as history and cannot be edited.'; END IF;
  -- a new due time starts a fresh cycle
  IF NEW.due_at IS DISTINCT FROM OLD.due_at AND coalesce(current_setting('lb.rem', true), '') <> '1' THEN NEW.snoozed_until := NULL; NEW.escalated_at := NULL; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reminders_guard_trg ON public.reminders;
CREATE TRIGGER reminders_guard_trg BEFORE INSERT OR UPDATE ON public.reminders FOR EACH ROW EXECUTE FUNCTION public.reminders_guard();

CREATE OR REPLACE FUNCTION public.reminders_after() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.reminder_events (reminder_id, event, detail, actor) VALUES (NEW.id, 'created', CASE WHEN NEW.parent_id IS NOT NULL THEN 'Repeat of an earlier reminder' END, NEW.created_by);
    IF NEW.owner_id <> NEW.created_by THEN
      INSERT INTO public.notifications (user_id, reminder_id, kind, title, body, idempotency_key)
      VALUES (NEW.owner_id, NEW.id, 'assigned', 'Reminder assigned to you: ' || NEW.title, NEW.notes, 'asg:' || NEW.id || ':' || NEW.owner_id) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  ELSIF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    INSERT INTO public.reminder_events (reminder_id, event, detail, actor) VALUES (NEW.id, 'reassigned', (SELECT full_name FROM public.profiles WHERE id = NEW.owner_id), auth.uid());
    INSERT INTO public.notifications (user_id, reminder_id, kind, title, body, idempotency_key)
    VALUES (NEW.owner_id, NEW.id, 'assigned', 'Reminder assigned to you: ' || NEW.title, NEW.notes, 'asg:' || NEW.id || ':' || NEW.owner_id) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reminders_after_trg ON public.reminders;
CREATE TRIGGER reminders_after_trg AFTER INSERT OR UPDATE OF owner_id ON public.reminders FOR EACH ROW EXECUTE FUNCTION public.reminders_after();

-- actions -----------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lb_can_act_on_reminder(r public.reminders) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.app_rank() >= 2 OR (public.app_rank() >= 1 AND (r.owner_id = auth.uid() OR r.created_by = auth.uid()))
$$;

CREATE OR REPLACE FUNCTION public.snooze_reminder(p_id uuid, p_until timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.reminders;
BEGIN
  SELECT * INTO r FROM public.reminders WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reminder not found.'; END IF;
  IF NOT public.lb_can_act_on_reminder(r) THEN RAISE EXCEPTION 'You cannot change this reminder.'; END IF;
  IF r.status <> 'open' THEN RAISE EXCEPTION 'Only an open reminder can be snoozed.'; END IF;
  IF p_until IS NULL OR p_until <= now() THEN RAISE EXCEPTION 'Choose a time in the future.'; END IF;
  PERFORM set_config('lb.rem', '1', true);
  UPDATE public.reminders SET snoozed_until = p_until, escalated_at = NULL WHERE id = p_id;
  PERFORM set_config('lb.rem', '', true);
  INSERT INTO public.reminder_events (reminder_id, event, detail, actor) VALUES (p_id, 'snoozed', to_char(p_until AT TIME ZONE 'Asia/Karachi', 'DD Mon YYYY HH24:MI'), auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.complete_reminder(p_id uuid, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.reminders; v_next timestamptz; v_new uuid; v_step interval;
BEGIN
  SELECT * INTO r FROM public.reminders WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reminder not found.'; END IF;
  IF NOT public.lb_can_act_on_reminder(r) THEN RAISE EXCEPTION 'You cannot change this reminder.'; END IF;
  IF r.status <> 'open' THEN RAISE EXCEPTION 'This reminder is already %.', r.status; END IF;
  PERFORM set_config('lb.rem', '1', true);
  UPDATE public.reminders SET status = 'completed', completed_at = now(), completed_by = auth.uid() WHERE id = p_id;
  INSERT INTO public.reminder_events (reminder_id, event, detail, actor) VALUES (p_id, 'completed', nullif(btrim(coalesce(p_note, '')), ''), auth.uid());
  IF r.recurrence <> 'none' THEN
    v_step := CASE r.recurrence WHEN 'daily' THEN interval '1 day' WHEN 'weekly' THEN interval '7 days' ELSE interval '1 month' END;
    v_next := r.due_at + v_step;
    WHILE v_next <= now() LOOP v_next := v_next + v_step; END LOOP;
    INSERT INTO public.reminders (title, notes, client_id, case_id, quotation_id, task_id, owner_id, created_by, due_at, priority, channel, recurrence, escalate_after_hours, parent_id)
    VALUES (r.title, r.notes, r.client_id, r.case_id, r.quotation_id, r.task_id, r.owner_id, r.created_by, v_next, r.priority, r.channel, r.recurrence, r.escalate_after_hours, r.id) RETURNING id INTO v_new;
    INSERT INTO public.reminder_events (reminder_id, event, detail, actor) VALUES (p_id, 'recurred', 'Next: ' || to_char(v_next AT TIME ZONE 'Asia/Karachi', 'DD Mon YYYY HH24:MI'), auth.uid());
  END IF;
  PERFORM set_config('lb.rem', '', true);
  RETURN jsonb_build_object('next_id', v_new);
END $$;

CREATE OR REPLACE FUNCTION public.cancel_reminder(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.reminders;
BEGIN
  SELECT * INTO r FROM public.reminders WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reminder not found.'; END IF;
  IF NOT public.lb_can_act_on_reminder(r) THEN RAISE EXCEPTION 'You cannot change this reminder.'; END IF;
  IF r.status <> 'open' THEN RAISE EXCEPTION 'This reminder is already %.', r.status; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'A reason is required to cancel a reminder.'; END IF;
  PERFORM set_config('lb.rem', '1', true);
  UPDATE public.reminders SET status = 'cancelled', cancel_reason = btrim(p_reason) WHERE id = p_id;
  PERFORM set_config('lb.rem', '', true);
  INSERT INTO public.reminder_events (reminder_id, event, detail, actor) VALUES (p_id, 'cancelled', btrim(p_reason), auth.uid());
END $$;

-- the worker: safe to call as often as you like (every minute from the app; optionally pg_cron too) ------------------------------------
CREATE OR REPLACE FUNCTION public.process_due_reminders() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.reminders; v_eff timestamptz; v_n integer := 0; v_rows integer; m record; v_ok boolean; v_reason text;
BEGIN
  IF auth.uid() IS NOT NULL AND public.app_rank() < 1 THEN RAISE EXCEPTION 'Not allowed.'; END IF;
  FOR r IN SELECT * FROM public.reminders WHERE status = 'open' AND coalesce(snoozed_until, due_at) <= now() ORDER BY due_at LIMIT 500 FOR UPDATE SKIP LOCKED LOOP
    v_eff := coalesce(r.snoozed_until, r.due_at);
    v_ok := r.channel = 'in_app';
    v_reason := CASE WHEN v_ok THEN NULL ELSE 'The ' || r.channel || ' channel is not enabled yet: provider, message template and client consent are not approved. Nothing was sent.' END;
    INSERT INTO public.notifications (user_id, reminder_id, kind, title, body, channel, delivery_status, failure_reason, idempotency_key)
    VALUES (r.owner_id, r.id, 'due', 'Due: ' || r.title, r.notes, r.channel, CASE WHEN v_ok THEN 'delivered' ELSE 'failed' END, v_reason, 'due:' || r.id || ':' || extract(epoch FROM v_eff)::bigint || ':' || r.owner_id)
    ON CONFLICT (idempotency_key) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 1 THEN
      v_n := v_n + 1;
      INSERT INTO public.reminder_events (reminder_id, event, detail) VALUES (r.id, CASE WHEN v_ok THEN 'due_notified' ELSE 'send_failed' END, v_reason);
    END IF;
    -- escalation: still open this many hours after it was due -> tell every manager / the owner of the business, once
    IF r.escalate_after_hours IS NOT NULL AND r.escalated_at IS NULL AND v_eff + make_interval(hours => r.escalate_after_hours) <= now() THEN
      FOR m IN SELECT id FROM public.profiles WHERE active AND role IN ('manager', 'admin') AND id <> r.owner_id LOOP
        INSERT INTO public.notifications (user_id, reminder_id, kind, title, body, idempotency_key)
        VALUES (m.id, r.id, 'escalated', 'Overdue: ' || r.title, 'Not done ' || r.escalate_after_hours || ' hours after it was due. Assigned to ' || coalesce((SELECT full_name FROM public.profiles WHERE id = r.owner_id), 'someone'), 'esc:' || r.id || ':' || extract(epoch FROM v_eff)::bigint || ':' || m.id)
        ON CONFLICT (idempotency_key) DO NOTHING;
      END LOOP;
      PERFORM set_config('lb.rem', '1', true);
      UPDATE public.reminders SET escalated_at = now() WHERE id = r.id;
      PERFORM set_config('lb.rem', '', true);
      INSERT INTO public.reminder_events (reminder_id, event, detail) VALUES (r.id, 'escalated', 'After ' || r.escalate_after_hours || ' hours');
    END IF;
  END LOOP;
  RETURN v_n;
END $$;

-- safe retry of a failed delivery: never creates a second notification, only records another attempt
CREATE OR REPLACE FUNCTION public.retry_notification(p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n public.notifications;
BEGIN
  SELECT * INTO n FROM public.notifications WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR (n.user_id <> auth.uid() AND public.app_rank() < 2) THEN RAISE EXCEPTION 'Notification not found.'; END IF;
  IF n.delivery_status <> 'failed' THEN RETURN 'Already delivered.'; END IF;
  IF n.channel = 'in_app' THEN
    UPDATE public.notifications SET delivery_status = 'delivered', failure_reason = NULL, attempts = attempts + 1 WHERE id = p_id;
    RETURN 'Delivered.';
  END IF;
  UPDATE public.notifications SET attempts = attempts + 1, failure_reason = 'No sending provider is connected yet. Nothing was sent; it will be possible after the owner approves the provider, templates and consent rules.' WHERE id = p_id;
  IF n.reminder_id IS NOT NULL THEN INSERT INTO public.reminder_events (reminder_id, event, detail, actor) VALUES (n.reminder_id, 'retried', 'Still not sent: channel not enabled', auth.uid()); END IF;
  RETURN 'Still not sent: the ' || n.channel || ' channel is not enabled.';
END $$;

CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_ids uuid[] DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not allowed.'; END IF;
  UPDATE public.notifications SET read_at = now() WHERE user_id = auth.uid() AND read_at IS NULL AND (p_ids IS NULL OR id = ANY (p_ids));
  GET DIAGNOSTICS c = ROW_COUNT; RETURN c;
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['public.snooze_reminder(uuid,timestamptz)', 'public.complete_reminder(uuid,text)', 'public.cancel_reminder(uuid,text)', 'public.process_due_reminders()', 'public.retry_notification(uuid)', 'public.mark_notifications_read(uuid[])'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  REVOKE ALL ON FUNCTION public.lb_can_act_on_reminder(public.reminders) FROM public;
  GRANT EXECUTE ON FUNCTION public.lb_can_act_on_reminder(public.reminders) TO authenticated;
END $$;
-- Optional scheduler on the server (Supabase: enable the pg_cron extension, then run once):
--   select cron.schedule('lb-reminders', '* * * * *', $$select public.process_due_reminders()$$);
-- Without it the app runs the worker every minute while anyone has it open.
