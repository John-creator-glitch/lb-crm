-- M6: Dashboard & reports computed in the database (full aggregates, no 100/1000-row subsets).
-- * Every date range is in Pakistan time (Asia/Karachi): a record belongs to the day it happened in Pakistan.
-- * kpi_ids(kind, from, to) is the ONE definition of each KPI: the dashboard count is the number of ids it returns, and clicking a KPI opens exactly those records.
-- * Finance figures come from the same rules as the client ledger (billed = every quotation with a client except draft/rejected; received = payments and
--   on-account payments that are not reversed). Staff get work KPIs for their own assigned work only and no finance.
-- All functions are SECURITY INVOKER: row-level security still applies on top.

CREATE OR REPLACE FUNCTION public.lb_pk_date(p timestamptz) RETURNS date LANGUAGE sql STABLE AS $$ SELECT (p AT TIME ZONE 'Asia/Karachi')::date $$;

-- one row per paying account: opening, billed, received, pending, the unpaid part split by age (0-30, 31-60, 61-90, 90+ days; oldest bills are paid first),
-- overdue (= everything older than 30 days) and any advance held
DROP FUNCTION IF EXISTS public.account_balances();
CREATE OR REPLACE FUNCTION public.account_balances() RETURNS TABLE (account_id uuid, name text, opening numeric, billed numeric, received numeric, pending numeric, overdue numeric, b0 numeric, b31 numeric, b61 numeric, b90 numeric, advance numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH acc AS (SELECT c.id, c.name, coalesce(c.opening_balance, 0) AS opening FROM public.clients c WHERE public.lb_payer(c.id) = c.id),
  bills AS (SELECT public.lb_payer(q.client_id) AS acc, q.id AS bid, q.grand_total AS amt, public.lb_pk_date(q.created_at) AS d
            FROM public.quotations q WHERE q.client_id IS NOT NULL AND q.status NOT IN ('draft', 'rejected')),
  rec AS (SELECT z.acc, sum(z.x) AS r FROM (
            SELECT public.lb_payer(q.client_id) AS acc, p.amount AS x FROM public.payments p JOIN public.quotations q ON q.id = p.quotation_id WHERE p.reversed_at IS NULL AND q.client_id IS NOT NULL
            UNION ALL SELECT cp.client_id, cp.amount FROM public.client_payments cp WHERE cp.reversed_at IS NULL) z GROUP BY z.acc),
  base AS (SELECT a.id, a.name, a.opening, coalesce((SELECT sum(amt) FROM bills b WHERE b.acc = a.id), 0) AS billed, coalesce((SELECT r FROM rec WHERE rec.acc = a.id), 0) AS received FROM acc a),
  items AS (  -- every bill, plus the opening balance as the oldest bill
    SELECT a.id AS acc, NULL::uuid AS bid, date '0001-01-01' AS d, a.opening AS amt FROM acc a WHERE a.opening > 0
    UNION ALL SELECT b.acc, b.bid, b.d, b.amt FROM bills b),
  fifo AS (SELECT i.acc, i.d, i.amt, coalesce(sum(i.amt) OVER (PARTITION BY i.acc ORDER BY i.d, i.bid ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before FROM items i),
  unpaid AS (SELECT f.acc, public.lb_today() - f.d AS age, greatest(0, least(f.amt, f.before + f.amt - (bs.received + greatest(-bs.opening, 0)))) AS u FROM fifo f JOIN base bs ON bs.id = f.acc),
  od AS (SELECT acc, sum(u) FILTER (WHERE age <= 30) AS b0, sum(u) FILTER (WHERE age BETWEEN 31 AND 60) AS b31, sum(u) FILTER (WHERE age BETWEEN 61 AND 90) AS b61, sum(u) FILTER (WHERE age > 90) AS b90 FROM unpaid GROUP BY acc)
  SELECT bs.id, bs.name, bs.opening, bs.billed, bs.received, bs.opening + bs.billed - bs.received,
         coalesce(od.b31, 0) + coalesce(od.b61, 0) + coalesce(od.b90, 0), coalesce(od.b0, 0), coalesce(od.b31, 0), coalesce(od.b61, 0), coalesce(od.b90, 0),
         greatest(0, bs.received + greatest(-bs.opening, 0) - (greatest(bs.opening, 0) + bs.billed))
  FROM base bs LEFT JOIN od ON od.acc = bs.id WHERE public.app_rank() >= 2
$$;
GRANT EXECUTE ON FUNCTION public.account_balances() TO authenticated;

-- the single definition of each KPI: the records it counts -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kpi_ids(p_kind text, p_from date, p_to date) RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_rank int := public.app_rank(); v_me uuid := auth.uid(); v_open text[] := ARRAY['pending', 'active']; v_status text;
BEGIN
  IF v_rank < 1 THEN RETURN; END IF;
  IF p_kind = 'clients_total' THEN RETURN QUERY SELECT id FROM public.clients WHERE archived_at IS NULL AND (v_rank >= 2 OR assigned_to = v_me);
  ELSIF p_kind = 'clients_new' THEN RETURN QUERY SELECT id FROM public.clients WHERE archived_at IS NULL AND public.lb_pk_date(created_at) BETWEEN p_from AND p_to AND (v_rank >= 2 OR assigned_to = v_me);
  ELSIF p_kind = 'vehicles_total' THEN RETURN QUERY SELECT v.id FROM public.vehicles v WHERE v_rank >= 2 OR v.client_id IN (SELECT id FROM public.clients WHERE assigned_to = v_me);
  ELSIF p_kind = 'cases_active' THEN RETURN QUERY SELECT id FROM public.cases WHERE status = ANY (v_open) AND (v_rank >= 2 OR assigned_to = v_me);
  ELSIF p_kind = 'cases_completed' THEN RETURN QUERY SELECT id FROM public.cases WHERE status = 'completed' AND closed_on BETWEEN p_from AND p_to AND (v_rank >= 2 OR assigned_to = v_me);
  ELSIF p_kind = 'cases_stale' THEN RETURN QUERY SELECT id FROM public.cases WHERE status = ANY (v_open) AND updated_at < now() - interval '7 days' AND (v_rank >= 2 OR assigned_to = v_me);
  ELSIF p_kind = 'cases_unassigned' THEN RETURN QUERY SELECT id FROM public.cases WHERE status = ANY (v_open) AND assigned_to IS NULL AND v_rank >= 2;
  ELSIF p_kind = 'cases_missing_docs' THEN RETURN QUERY SELECT c.id FROM public.cases c WHERE c.status = ANY (v_open) AND (v_rank >= 2 OR c.assigned_to = v_me)
      AND EXISTS (SELECT 1 FROM public.case_documents d WHERE d.case_id = c.id AND d.required AND NOT d.received);
  ELSIF p_kind LIKE 'q\_%' THEN
    v_status := substr(p_kind, 3);
    IF v_status NOT IN ('draft', 'pending', 'approved', 'rejected', 'completed') THEN RAISE EXCEPTION 'Unknown KPI %', p_kind; END IF;
    RETURN QUERY SELECT id FROM public.quotations WHERE status = v_status AND public.lb_pk_date(created_at) BETWEEN p_from AND p_to AND (v_rank >= 2 OR created_by = v_me);
  ELSIF p_kind = 'reminders_overdue' THEN RETURN QUERY SELECT id FROM public.reminders WHERE status = 'open' AND coalesce(snoozed_until, due_at) < now() AND (v_rank >= 2 OR owner_id = v_me);
  ELSIF p_kind = 'accounts_due' THEN RETURN QUERY SELECT account_id FROM public.account_balances() WHERE overdue > 0.004;   -- manager/owner only (empty for staff)
  ELSE RAISE EXCEPTION 'Unknown KPI %', p_kind;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.kpi_ids(text, date, date) TO authenticated;

-- finance summary for a date range (manager/owner) --------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finance_summary(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE r jsonb; v_open numeric; v_billed record; v_coll numeric; v_net_open numeric; v_net_close numeric; v_out numeric; v_adv numeric; v_net_now numeric; v_unlinked record; v_methods jsonb;
BEGIN
  IF public.app_rank() < 2 THEN RAISE EXCEPTION 'Finance figures are for managers and the owner.'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Choose a valid date range.'; END IF;
  SELECT coalesce(sum(coalesce(opening_balance, 0)), 0) INTO v_open FROM public.clients WHERE public.lb_payer(id) = id;
  SELECT coalesce(sum(grand_total), 0) AS total, coalesce(sum(subtotal_govt), 0) AS govt, coalesce(sum(subtotal_service), 0) AS service, coalesce(sum(subtotal_additional), 0) AS additional, count(*) AS n INTO v_billed
    FROM public.quotations WHERE client_id IS NOT NULL AND status NOT IN ('draft', 'rejected') AND public.lb_pk_date(created_at) BETWEEN p_from AND p_to;
  SELECT coalesce(sum(grand_total), 0) AS total, count(*) AS n INTO v_unlinked FROM public.quotations WHERE client_id IS NULL AND status NOT IN ('draft', 'rejected') AND public.lb_pk_date(created_at) BETWEEN p_from AND p_to;
  WITH rec AS (
    SELECT coalesce(p.payment_method, 'other') AS m, p.amount, p.payment_date AS d FROM public.payments p JOIN public.quotations q ON q.id = p.quotation_id WHERE p.reversed_at IS NULL AND q.client_id IS NOT NULL
    UNION ALL SELECT coalesce(cp.payment_method, 'other'), cp.amount, cp.payment_date FROM public.client_payments cp WHERE cp.reversed_at IS NULL)
  SELECT coalesce(sum(amount), 0), coalesce(jsonb_object_agg(m, s), '{}'::jsonb) INTO v_coll, v_methods FROM (SELECT m, sum(amount) AS amount, sum(amount) AS s FROM rec WHERE d BETWEEN p_from AND p_to GROUP BY m) z;
  -- net money owed to us across all paying accounts, as of the end of a day
  SELECT v_open + coalesce((SELECT sum(grand_total) FROM public.quotations WHERE client_id IS NOT NULL AND status NOT IN ('draft', 'rejected') AND public.lb_pk_date(created_at) <= p_from - 1), 0)
    - coalesce((SELECT sum(p.amount) FROM public.payments p JOIN public.quotations q ON q.id = p.quotation_id WHERE p.reversed_at IS NULL AND q.client_id IS NOT NULL AND p.payment_date <= p_from - 1), 0)
    - coalesce((SELECT sum(amount) FROM public.client_payments WHERE reversed_at IS NULL AND payment_date <= p_from - 1), 0) INTO v_net_open;
  SELECT v_open + coalesce((SELECT sum(grand_total) FROM public.quotations WHERE client_id IS NOT NULL AND status NOT IN ('draft', 'rejected') AND public.lb_pk_date(created_at) <= p_to), 0)
    - coalesce((SELECT sum(p.amount) FROM public.payments p JOIN public.quotations q ON q.id = p.quotation_id WHERE p.reversed_at IS NULL AND q.client_id IS NOT NULL AND p.payment_date <= p_to), 0)
    - coalesce((SELECT sum(amount) FROM public.client_payments WHERE reversed_at IS NULL AND payment_date <= p_to), 0) INTO v_net_close;
  SELECT coalesce(sum(pending) FILTER (WHERE pending > 0), 0), coalesce(-sum(pending) FILTER (WHERE pending < 0), 0), coalesce(sum(pending), 0) INTO v_out, v_adv, v_net_now FROM public.account_balances();
  RETURN jsonb_build_object(
    'from', p_from, 'to', p_to,
    'billed', v_billed.total, 'billed_govt', v_billed.govt, 'billed_service', v_billed.service, 'billed_additional', v_billed.additional, 'billed_count', v_billed.n,
    'billed_without_client', v_unlinked.total, 'billed_without_client_count', v_unlinked.n,
    'collected', v_coll, 'collected_by_method', v_methods,
    'net_opening', v_net_open, 'net_closing', v_net_close,
    'reconciles', round(v_net_open + v_billed.total - v_coll - v_net_close, 2) = 0,
    'outstanding_now', v_out, 'advances_now', v_adv, 'net_now', v_net_now,
    'matches_ledger_now', CASE WHEN p_to >= public.lb_today() THEN round(v_net_close - v_net_now, 2) = 0 ELSE NULL END);
END $$;
GRANT EXECUTE ON FUNCTION public.finance_summary(date, date) TO authenticated;

-- the dashboard in one call -------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_kpis(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE k text; n bigint; r jsonb := '{}'::jsonb;
BEGIN
  IF public.app_rank() < 1 THEN RAISE EXCEPTION 'Not allowed.'; END IF;
  FOREACH k IN ARRAY ARRAY['clients_total', 'clients_new', 'vehicles_total', 'cases_active', 'cases_completed', 'cases_stale', 'cases_unassigned', 'cases_missing_docs',
                           'q_draft', 'q_pending', 'q_approved', 'q_rejected', 'q_completed', 'reminders_overdue', 'accounts_due'] LOOP
    SELECT count(*) INTO n FROM public.kpi_ids(k, p_from, p_to);
    r := r || jsonb_build_object(k, n);
  END LOOP;
  RETURN jsonb_build_object('counts', r, 'scope', CASE WHEN public.app_rank() >= 2 THEN 'all' ELSE 'mine' END,
    'finance', CASE WHEN public.app_rank() >= 2 THEN public.finance_summary(p_from, p_to) ELSE NULL END);
END $$;
GRANT EXECUTE ON FUNCTION public.dashboard_kpis(date, date) TO authenticated;

-- reports -------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_summary(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF public.app_rank() < 2 THEN RAISE EXCEPTION 'Reports are for managers and the owner.'; END IF;
  RETURN jsonb_build_object(
    'quotations_by_status', coalesce((SELECT jsonb_agg(jsonb_build_object('status', status, 'count', n, 'total', t, 'govt', g, 'service', s) ORDER BY status) FROM
       (SELECT status, count(*) n, sum(grand_total) t, sum(subtotal_govt) g, sum(subtotal_service + subtotal_additional) s FROM public.quotations WHERE public.lb_pk_date(created_at) BETWEEN p_from AND p_to GROUP BY status) x), '[]'::jsonb),
    'cases_opened', (SELECT count(*) FROM public.cases WHERE opened_on BETWEEN p_from AND p_to),
    'cases_by_status', coalesce((SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM public.cases WHERE opened_on BETWEEN p_from AND p_to GROUP BY status) x), '{}'::jsonb),
    'cases_by_stage', coalesce((SELECT jsonb_object_agg(stage, n) FROM (SELECT coalesce(stage, 'new') AS stage, count(*) n FROM public.cases WHERE opened_on BETWEEN p_from AND p_to GROUP BY 1) x), '{}'::jsonb),
    'cases_govt_fee', (SELECT coalesce(sum(govt_fee), 0) FROM public.cases WHERE opened_on BETWEEN p_from AND p_to),
    'cases_service_charge', (SELECT coalesce(sum(service_charge), 0) FROM public.cases WHERE opened_on BETWEEN p_from AND p_to),
    'finance', public.finance_summary(p_from, p_to));
END $$;
GRANT EXECUTE ON FUNCTION public.report_summary(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_workload(p_from date, p_to date) RETURNS TABLE (user_id uuid, full_name text, role text, open_cases bigint, overdue_cases bigint, completed_cases bigint, open_reminders bigint, overdue_reminders bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.id, p.full_name, p.role,
    (SELECT count(*) FROM public.cases c WHERE c.assigned_to = p.id AND c.status IN ('pending', 'active')),
    (SELECT count(*) FROM public.cases c WHERE c.assigned_to = p.id AND c.status IN ('pending', 'active') AND c.due_date < public.lb_today()),
    (SELECT count(*) FROM public.cases c WHERE c.assigned_to = p.id AND c.status = 'completed' AND c.closed_on BETWEEN p_from AND p_to),
    (SELECT count(*) FROM public.reminders r WHERE r.owner_id = p.id AND r.status = 'open'),
    (SELECT count(*) FROM public.reminders r WHERE r.owner_id = p.id AND r.status = 'open' AND coalesce(r.snoozed_until, r.due_at) < now())
  FROM public.profiles p WHERE p.active AND public.app_rank() >= 2 ORDER BY p.full_name
$$;
GRANT EXECUTE ON FUNCTION public.staff_workload(date, date) TO authenticated;
