import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase, type QuotationStatus } from '@/lib/supabase';
import { useCan } from '@/lib/permissions';
import { useAuth } from '@/lib/auth';
import { pkToday, pkMonthStart } from '@/lib/time';
import { PERIODS, rangeFor, type Period } from '@/lib/range';
import { PageHeader, Card, Spinner, Badge, Field, Input, Select } from '@/components/ui';
import { formatPKR, formatDateTime, formatDate } from '@/lib/format';
import type { Route } from '@/components/Layout';
import { Landmark, FileText, Activity, ShieldCheck, AlertTriangle } from 'lucide-react';
import { friendlyError } from '@/lib/errors';

interface Finance {
  billed: number; billed_govt: number; billed_service: number; billed_additional: number; billed_count: number;
  billed_without_client: number; billed_without_client_count: number;
  collected: number; collected_by_method: Record<string, number>;
  outstanding_now: number; advances_now: number; net_now: number;
  reconciles: boolean; matches_ledger_now: boolean | null;
}
interface Kpis { counts: Record<string, number>; scope: 'all' | 'mine'; finance: Finance | null }
interface Recent { id: string; quotation_number: string; status: QuotationStatus; grand_total: number; created_at: string; client_name: string | null }

const STATUS_COLORS: Record<QuotationStatus, string> = { draft: 'bg-gray-100 text-gray-700', pending: 'bg-amber-100 text-amber-700', approved: 'bg-emerald-100 text-emerald-700', rejected: 'bg-rose-100 text-rose-700', completed: 'bg-blue-100 text-blue-700' };
type OnDrill = (kind: string, label: string, route: Route, from: string, to: string) => void;

function Kpi({ label, value, sub, tone = 'text-slate-900', onClick }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string; onClick?: () => void }) {
  const body = (<><p className="text-xs text-slate-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone}`}>{value}</p>{sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}</>);
  return onClick
    ? <button onClick={onClick} className="text-left bg-white rounded-xl border border-slate-200 p-4 hover:border-amber-400 hover:shadow-sm transition focus:outline-none focus:ring-2 focus:ring-amber-500" aria-label={`${label}: open the records`}>{body}</button>
    : <Card className="p-4">{body}</Card>;
}
const Section = ({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) => (
  <section className="mb-6"><div className="flex items-baseline gap-2 mb-2"><h2 className="text-sm font-semibold text-slate-700">{title}</h2>{hint && <span className="text-xs text-slate-500">{hint}</span>}</div>{children}</section>
);

export default function Dashboard({ onDrill, onNavigate }: { onDrill: OnDrill; onNavigate: (r: Route) => void }) {
  const isManager = useCan('manager');
  const { session } = useAuth();
  const [period, setPeriod] = useState<Period>('month');
  const [cFrom, setCFrom] = useState(''); const [cTo, setCTo] = useState('');
  const [from, to] = useMemo(() => rangeFor(period, cFrom, cTo), [period, cFrom, cTo]);
  const [k, setK] = useState<Kpis | null>(null);
  const [err, setErr] = useState('');
  const [recent, setRecent] = useState<Recent[]>([]);
  const [hpa, setHpa] = useState<{ today: number; month: number } | null>(null);
  const [crm, setCrm] = useState<Record<string, number | null> | null>(null);
  const [misc, setMisc] = useState<{ openTasks: number; overdueTasks: number; lowStock: number } | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data, error } = await supabase.rpc('dashboard_kpis', { p_from: from, p_to: to });
      if (!live) return;
      if (error) { setErr(error.message.includes('dashboard_kpis') ? 'The dashboard database update is not installed yet. Run migration 20261121090000_m6_dashboard_reports.sql once.' : friendlyError(error)); setK(null); return; }
      setErr(''); setK(data as Kpis);
    })();
    return () => { live = false; };
  }, [from, to]);

  useEffect(() => {
    let live = true;
    supabase.rpc('crm_kpis', { p_from: from, p_to: to }).then(({ data, error }) => { if (live) setCrm(error ? null : (data as Record<string, number | null>)); });
    return () => { live = false; };
  }, [from, to]);

  useEffect(() => {
    (async () => {
      const today = pkToday();
      let q = supabase.from('quotations').select('id, quotation_number, status, grand_total, created_at, client_id').order('created_at', { ascending: false }).limit(8);
      if (!isManager && session) q = q.eq('created_by', session.user.id);
      const { data: quots } = await q;
      const ids = [...new Set((quots ?? []).map(x => x.client_id).filter(Boolean))] as string[];
      const names: Record<string, string> = {};
      if (ids.length) { const { data: cl } = await supabase.from('clients').select('id, name').in('id', ids); (cl ?? []).forEach(c => { names[c.id] = c.name; }); }
      setRecent((quots ?? []).map(x => ({ id: x.id, quotation_number: x.quotation_number, status: x.status, grand_total: x.grand_total, created_at: x.created_at, client_name: x.client_id ? names[x.client_id] ?? null : null })));
      const { data: h, error: he } = await supabase.from('hpa_counts').select('entry_date, count').gte('entry_date', pkMonthStart(today));
      if (!he && h) setHpa({ today: h.filter(r => r.entry_date === today).reduce((s, r) => s + r.count, 0), month: h.reduce((s, r) => s + r.count, 0) });
      const [ts, inv] = await Promise.all([supabase.from('tasks').select('due_date').eq('status', 'pending'), supabase.from('inventory_items').select('quantity, min_level')]);
      if (!ts.error && !inv.error) setMisc({ openTasks: (ts.data ?? []).length, overdueTasks: (ts.data ?? []).filter(t => t.due_date && t.due_date < today).length, lowStock: (inv.data ?? []).filter(i => i.quantity <= i.min_level).length });
    })();
  }, [isManager, session]);

  if (!k && !err) return <Spinner label="Loading dashboard..." />;
  const c = k?.counts ?? {};
  const f = k?.finance ?? null;
  const go = (kind: string, label: string, route: Route) => () => onDrill(kind, label, route, from, to);
  const warn = (n: number) => (n > 0 ? 'text-rose-600' : 'text-slate-900');
  const mine = k?.scope === 'mine';
  const openRoute = (r: Route) => () => onNavigate(r);
  const range = from === to ? formatDate(from) : `${formatDate(from)} to ${formatDate(to)}`;

  return (
    <>
      <PageHeader title="Dashboard" subtitle={mine ? 'Your work: cases assigned to you, your quotations and reminders' : 'Overview of the whole office'}
        action={<div className="flex gap-2 items-end">
          {period === 'custom' && <><Field label="From"><Input type="date" value={cFrom} onChange={e => setCFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={cTo} onChange={e => setCTo(e.target.value)} /></Field></>}
          <Field label="Period"><Select value={period} onChange={e => setPeriod(e.target.value as Period)}>{PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>
        </div>} />
      {err && <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{err}</div>}
      {k && (<>
        <Section title="Needs action" hint="click a card to open exactly those records">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Kpi label="Overdue reminders" value={c.reminders_overdue ?? 0} tone={warn(c.reminders_overdue ?? 0)} onClick={go('reminders_overdue', 'Overdue reminders', 'reminders')} />
            <Kpi label="Cases missing documents" value={c.cases_missing_docs ?? 0} tone={warn(c.cases_missing_docs ?? 0)} onClick={go('cases_missing_docs', 'Cases missing required documents', 'cases')} />
            <Kpi label="Stale cases" value={c.cases_stale ?? 0} sub="no update for 7+ days" tone={warn(c.cases_stale ?? 0)} onClick={go('cases_stale', 'Stale cases (no update for 7+ days)', 'cases')} />
            {crm && <Kpi label="Lead follow-ups due" value={crm.leads_followup_due ?? 0} tone={warn(Number(crm.leads_followup_due ?? 0))} sub="call these people today" onClick={openRoute('leads')} />}
            {crm && <Kpi label="Renewals due" value={Number(crm.renewals_overdue ?? 0) + Number(crm.renewals_30 ?? 0)} tone={warn(Number(crm.renewals_overdue ?? 0))} sub={`${crm.renewals_overdue ?? 0} overdue, next 30 days included`} onClick={openRoute('vehicles')} />}
            {!mine && <Kpi label="Unassigned cases" value={c.cases_unassigned ?? 0} tone={warn(c.cases_unassigned ?? 0)} onClick={go('cases_unassigned', 'Unassigned open cases', 'cases')} />}
            {!mine && <Kpi label="Payments overdue" value={c.accounts_due ?? 0} sub="accounts with bills older than 30 days unpaid" tone={warn(c.accounts_due ?? 0)} onClick={go('accounts_due', 'Accounts with overdue payments', 'clients')} />}
          </div>
        </Section>

        <Section title="Work" hint={`new clients and completed cases are for ${range}`}>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <Kpi label={mine ? 'My active cases' : 'Active cases'} value={c.cases_active ?? 0} sub="pending + in progress" onClick={go('cases_active', 'Active cases', 'cases')} />
            <Kpi label="Cases completed" value={c.cases_completed ?? 0} sub="closed in this period" onClick={go('cases_completed', `Cases completed ${range}`, 'cases')} />
          </div>
        </Section>

        <Section title={mine ? 'My quotations' : 'Quotation pipeline'} hint={`quotations created ${range}, by their status now`}>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {(['draft', 'pending', 'approved', 'rejected', 'completed'] as QuotationStatus[]).map(s => <Kpi key={s} label={s[0].toUpperCase() + s.slice(1)} value={c['q_' + s] ?? 0} onClick={go('q_' + s, `${s[0].toUpperCase() + s.slice(1)} quotations ${range}`, 'quotations')} />)}
          </div>
        </Section>

        {f && (
          <Section title="Money" hint={`billed and collected are for ${range}; outstanding is as of now`}>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi label="Service revenue" value={formatPKR(f.billed_service)} sub={f.billed_additional ? `plus ${formatPKR(f.billed_additional)} additional charges` : 'our own charges'} tone="text-emerald-700" />
              <Kpi label="Collected" value={formatPKR(f.collected)} sub={Object.entries(f.collected_by_method).map(([m, v]) => `${m} ${formatPKR(v)}`).join(' · ') || 'no payments in this period'} />
              <Kpi label="Outstanding now" value={formatPKR(f.outstanding_now)} sub="owed by clients" tone={f.outstanding_now > 0 ? 'text-rose-600' : 'text-slate-900'} />
              {isManager && crm && crm.expenses_total != null && <Kpi label="Expenses" value={formatPKR(Number(crm.expenses_total))} sub={`${crm.expenses_count ?? 0} entries`} onClick={openRoute('expenses')} />}
              {isManager && crm && crm.expenses_total != null && <Kpi label="Profit (service − expenses)" value={formatPKR(f.billed_service + f.billed_additional - Number(crm.expenses_total))} sub="before government fees; billed basis" tone={f.billed_service + f.billed_additional - Number(crm.expenses_total) >= 0 ? 'text-emerald-700' : 'text-rose-600'} />}
              <Kpi label="Advances held" value={formatPKR(f.advances_now)} sub="paid ahead by clients" tone="text-blue-600" />
            </div>
            <p className={`text-xs mt-2 flex items-center gap-1.5 ${f.reconciles && f.matches_ledger_now !== false ? 'text-emerald-700' : 'text-rose-700'}`}>
              {f.reconciles && f.matches_ledger_now !== false ? <><ShieldCheck className="w-4 h-4" /> Opening + billed − collected equals the client ledgers{f.matches_ledger_now ? ' (checked against today\'s ledger total)' : ''}.</> : <><AlertTriangle className="w-4 h-4" /> Totals do not match the client ledgers. Do not rely on these figures; tell the developer.</>}
            </p>
            {f.billed_without_client_count > 0 && <p className="text-xs text-amber-700 mt-1 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {f.billed_without_client_count} walk-in quotation{f.billed_without_client_count === 1 ? '' : 's'} worth {formatPKR(f.billed_without_client)} have no client, so they are not in any ledger or in the figures above. Link them to a client.</p>}
          </Section>
        )}

        {((hpa && (hpa.today > 0 || hpa.month > 0)) || (misc && (misc.openTasks > 0 || misc.lowStock > 0))) && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {misc && misc.openTasks > 0 && <Kpi label="Open tasks" value={misc.openTasks} sub={`${misc.overdueTasks} overdue`} tone={warn(misc.overdueTasks)} />}
            {misc && misc.lowStock > 0 && <Kpi label="Low stock items" value={misc.lowStock} />}
            {hpa && (hpa.today > 0 || hpa.month > 0) && <Card className="p-4 col-span-2 flex items-center gap-3"><Landmark className="w-5 h-5 text-violet-600" /><div><p className="text-xs text-slate-500">HPA applications (counted separately)</p><p className="text-lg font-bold text-slate-900 tabular-nums">{hpa.today} today · {hpa.month} this month</p></div></Card>}
          </div>
        )}
      </>)}

      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2"><Activity className="w-4 h-4 text-slate-500" /><h2 className="font-semibold text-slate-900">{mine ? 'My recent quotations' : 'Recent Activity'}</h2></div>
        {recent.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">No quotations yet. Create one from the Fee Calculator.</div> : (
          <div className="divide-y divide-slate-100">
            {recent.map(r => (
              <div key={r.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 sm:px-5 py-3">
                <div className="flex items-center gap-3 min-w-0"><div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0"><FileText className="w-4 h-4 text-slate-500" /></div>
                  <div className="min-w-0"><p className="text-sm font-medium text-slate-900 truncate">{r.quotation_number}</p><p className="text-xs text-slate-500">{r.client_name ?? 'No client'} · {formatDateTime(r.created_at)}</p></div></div>
                <div className="flex items-center gap-3 flex-shrink-0 pl-12 sm:pl-0"><Badge className={STATUS_COLORS[r.status]}>{r.status}</Badge>{isManager && <span className="text-sm font-semibold text-slate-900 tabular-nums">{formatPKR(r.grand_total)}</span>}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
