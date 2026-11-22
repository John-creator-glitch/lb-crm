-- M8: speed. account_balances() summed bills/payments with a correlated sub-select per account (accounts x rows). With ~6,000 accounts and ~30,000 quotations it ran for minutes;
-- the same figures are now produced with one GROUP BY + join each. Result columns and rules are IDENTICAL (tests M4/M6 unchanged and passing).
-- Idempotent: CREATE OR REPLACE. No data is changed.
CREATE OR REPLACE FUNCTION public.account_balances()
 RETURNS TABLE(account_id uuid, name text, opening numeric, billed numeric, received numeric, pending numeric, overdue numeric, b0 numeric, b31 numeric, b61 numeric, b90 numeric, advance numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH acc AS (SELECT c.id, c.name, coalesce(c.opening_balance, 0) AS opening FROM public.clients c WHERE NOT (c.bill_to_parent AND c.parent_id IS NOT NULL)),   -- = lb_payer(c.id) = c.id, inlined
  bills AS (SELECT CASE WHEN cl.bill_to_parent AND cl.parent_id IS NOT NULL THEN cl.parent_id ELSE cl.id END AS acc, q.id AS bid, q.grand_total AS amt, public.lb_pk_date(q.created_at) AS d
            FROM public.quotations q JOIN public.clients cl ON cl.id = q.client_id WHERE q.status NOT IN ('draft', 'rejected')),
  rec AS (SELECT z.acc, sum(z.x) AS r FROM (
            SELECT CASE WHEN cl.bill_to_parent AND cl.parent_id IS NOT NULL THEN cl.parent_id ELSE cl.id END AS acc, p.amount AS x FROM public.payments p JOIN public.quotations q ON q.id = p.quotation_id JOIN public.clients cl ON cl.id = q.client_id WHERE p.reversed_at IS NULL
            UNION ALL SELECT cp.client_id, cp.amount FROM public.client_payments cp WHERE cp.reversed_at IS NULL) z GROUP BY z.acc),
  billed_by AS (SELECT b.acc, sum(b.amt) AS billed FROM bills b GROUP BY b.acc),
  base AS (SELECT a.id, a.name, a.opening, coalesce(bb.billed, 0) AS billed, coalesce(rc.r, 0) AS received FROM acc a LEFT JOIN billed_by bb ON bb.acc = a.id LEFT JOIN rec rc ON rc.acc = a.id),
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
$function$;

-- M8: speed. Row-level-security rules called app_rank() / auth.uid() ONCE PER ROW (app_rank reads the profiles table each time), so every list, count
-- and report over tens of thousands of rows paid that cost per row. Writing it as (SELECT app_rank()) makes Postgres evaluate it once per query.
-- The rules mean exactly the same; only the form changes. Idempotent: policies already in the new form are skipped.
DO $$
DECLARE p record; q text; w text; sql text; n int := 0;
BEGIN
  SET LOCAL search_path = public;
  FOR p IN SELECT pol.polname, c.relname, pol.polcmd, pg_get_expr(pol.polqual, pol.polrelid) AS q, pg_get_expr(pol.polwithcheck, pol.polrelid) AS w
           FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public'
  LOOP
    q := p.q; w := p.w;
    IF q IS NOT NULL THEN q := regexp_replace(regexp_replace(q, '(?<!select )(?<!SELECT )app_rank\(\)', '(SELECT app_rank())', 'g'), '(?<!select )(?<!SELECT )auth\.uid\(\)', '(SELECT auth.uid())', 'g'); END IF;
    IF w IS NOT NULL THEN w := regexp_replace(regexp_replace(w, '(?<!select )(?<!SELECT )app_rank\(\)', '(SELECT app_rank())', 'g'), '(?<!select )(?<!SELECT )auth\.uid\(\)', '(SELECT auth.uid())', 'g'); END IF;
    IF q IS NOT DISTINCT FROM p.q AND w IS NOT DISTINCT FROM p.w THEN CONTINUE; END IF;
    sql := format('ALTER POLICY %I ON public.%I', p.polname, p.relname)
        || CASE WHEN q IS NOT NULL THEN ' USING (' || q || ')' ELSE '' END
        || CASE WHEN w IS NOT NULL THEN ' WITH CHECK (' || w || ')' ELSE '' END;
    EXECUTE sql; n := n + 1;
  END LOOP;
  RAISE NOTICE 'M8: % policies rewritten', n;
END $$;
