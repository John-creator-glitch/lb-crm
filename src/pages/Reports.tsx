import { useEffect, useMemo, useState } from 'react';
import { supabase, CASE_STATUSES } from '@/lib/supabase';
import { PageHeader, Card, Spinner, Button, Field, Input, Select } from '@/components/ui';
import { formatPKR } from '@/lib/format';
import { downloadCSV } from '@/lib/csv';
import { Download, ShieldCheck, AlertTriangle } from 'lucide-react';
import AgeingReport from '@/components/AgeingReport';
import { useCan } from '@/lib/permissions';
import { PERIODS, rangeFor, type Period } from '@/lib/range';
import { stageLabel } from '@/lib/workflow';
import { friendlyError } from '@/lib/errors';

interface Fin {
  billed: number; billed_govt: number; billed_service: number; billed_additional: number; billed_count: number; billed_without_client: number; billed_without_client_count: number;
  collected: number; collected_by_method: Record<string, number>; net_opening: number; net_closing: number; reconciles: boolean; matches_ledger_now: boolean | null;
  outstanding_now: number; advances_now: number; net_now: number;
}
interface Summary {
  quotations_by_status: { status: string; count: number; total: number; govt: number; service: number }[];
  cases_opened: number; cases_by_status: Record<string, number>; cases_by_stage: Record<string, number>; cases_govt_fee: number; cases_service_charge: number; finance: Fin;
}
interface Work { user_id: string; full_name: string; role: string; open_cases: number; overdue_cases: number; completed_cases: number; open_reminders: number; overdue_reminders: number }

export default function Reports() {
  const allowed = useCan('manager');
  const [period, setPeriod] = useState<Period>('month');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [r0, r1] = useMemo(() => rangeFor(period, from, to), [period, from, to]);
  const [sum, setSum] = useState<Summary | null>(null);
  const [work, setWork] = useState<Work[]>([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!allowed) return;
    let live = true;
    (async () => {
      setLoading(true);
      const [s, w] = await Promise.all([supabase.rpc('report_summary', { p_from: r0, p_to: r1 }), supabase.rpc('staff_workload', { p_from: r0, p_to: r1 })]);
      if (!live) return;
      if (s.error) { setErr(s.error.message.includes('report_summary') ? 'The reports database update is not installed yet. Run migration 20261121090000_m6_dashboard_reports.sql once.' : friendlyError(s.error)); setSum(null); }
      else { setErr(''); setSum(s.data as Summary); }
      setWork((w.data ?? []) as Work[]);
      setLoading(false);
    })();
    return () => { live = false; };
  }, [r0, r1, allowed]);

  function exportCSV() {
    if (!sum) return;
    const f = sum.finance;
    downloadCSV(`report_${r0}_${r1}.csv`, [
      ['Period (Pakistan dates)', `${r0} to ${r1}`], [],
      ['RECONCILIATION'], ['Net owed at start of period', f.net_opening], ['+ Billed in period', f.billed], ['- Collected in period', f.collected], ['= Net owed at end of period', f.net_closing],
      ['Check: start + billed - collected = end', f.reconciles ? 'OK' : 'MISMATCH'], ['Check: end equals live ledger total (only when period ends today)', f.matches_ledger_now === null ? 'n/a' : f.matches_ledger_now ? 'OK' : 'MISMATCH'],
      ['Walk-in quotations without a client (not in ledger)', f.billed_without_client], [],
      ['BILLED'], ['Government fees (pass-through)', f.billed_govt], ['Service revenue', f.billed_service], ['Additional charges', f.billed_additional], ['Total billed', f.billed], [],
      ['COLLECTED BY MODE'], ...Object.entries(f.collected_by_method).map(([k, v]) => [k, v]), ['Total collected', f.collected], [],
      ['QUOTATIONS BY STATUS (created in period)'], ['Status', 'Count', 'Total', 'Govt', 'Service'], ...sum.quotations_by_status.map(q => [q.status, q.count, q.total, q.govt, q.service]), [],
      ['CASES OPENED', sum.cases_opened], ...CASE_STATUSES.map(s => [`  ${s.label}`, sum.cases_by_status[s.value] ?? 0]), ['Govt fee on these cases', sum.cases_govt_fee], ['Service charge on these cases', sum.cases_service_charge], [],
      ['STAFF WORKLOAD'], ['Name', 'Open cases', 'Overdue cases', 'Completed in period', 'Open reminders', 'Overdue reminders'], ...work.map(w => [w.full_name, w.open_cases, w.overdue_cases, w.completed_cases, w.open_reminders, w.overdue_reminders]),
    ]);
  }

  const tile = (label: string, value: string, sub?: string) => (
    <Card className="p-4 bg-white shadow-sm border border-slate-200/80 rounded-xl">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-2xl font-bold text-slate-900 tabular-nums mt-1 tracking-tight">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </Card>
  );
  if (!allowed) return (<><PageHeader title="Reports" /><Card className="p-8 text-center text-sm text-slate-500">Reports are available to managers and the owner.</Card></>);
  const f = sum?.finance;
  const okLedger = !!f && f.reconciles && f.matches_ledger_now !== false;

  return (
    <>
      <PageHeader title="Reports" subtitle={`${r0} to ${r1} (Pakistan dates)`} action={<Button variant="secondary" onClick={exportCSV} disabled={!sum}><Download className="w-4 h-4" /> CSV</Button>} />
      <Card className="p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Period"><Select value={period} onChange={e => setPeriod(e.target.value as Period)}>{PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>
          {period === 'custom' && (<><Field label="From"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field><Field label="To"><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field></>)}
        </div>
      </Card>
      {err && <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{err}</div>}
      {loading ? <Spinner label="Building report..." /> : sum && f && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
            {tile('Billed', formatPKR(f.billed), `${f.billed_count} quotations`)}
            {tile('Government fees', formatPKR(f.billed_govt), 'pass-through')}
            {tile('Service revenue', formatPKR(f.billed_service), f.billed_additional ? `+ ${formatPKR(f.billed_additional)} additional` : undefined)}
            {tile('Collected', formatPKR(f.collected))}
            {tile('Cases opened', String(sum.cases_opened))}
          </div>

          <Card className={`p-4 mb-4 ${okLedger ? 'border-emerald-200 bg-emerald-50/20' : 'border-rose-300 bg-rose-50/20'}`}>
            <h2 className="font-semibold text-slate-900 text-sm mb-3 flex items-center gap-2">{okLedger ? <ShieldCheck className="w-4 h-4 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 text-rose-600" />} Reconciliation with the client ledgers</h2>
            <div className="bg-white rounded-lg border border-slate-200/60 p-3 max-w-xl">
              <table className="text-sm w-full"><tbody>
                <tr><td className="py-1 text-slate-600">Owed to us at start of period</td><td className="text-right tabular-nums font-medium text-slate-800">{formatPKR(f.net_opening)}</td></tr>
                <tr><td className="py-1 text-slate-600">+ Billed in period</td><td className="text-right tabular-nums font-medium text-slate-800">{formatPKR(f.billed)}</td></tr>
                <tr><td className="py-1 text-slate-600">− Collected in period</td><td className="text-right tabular-nums font-medium text-emerald-700">{formatPKR(f.collected)}</td></tr>
                <tr className="border-t border-slate-200 font-semibold"><td className="py-1.5 text-slate-900">= Owed to us at end of period</td><td className="text-right tabular-nums text-slate-900">{formatPKR(f.net_closing)}</td></tr>
              </tbody></table>
            </div>
            <p className="text-xs text-slate-500 mt-2.5">Billed = quotations with a client that are not draft or rejected. Collected = payments and on-account payments that were not reversed. {f.matches_ledger_now ? 'The end figure equals the total of all client ledgers today.' : f.matches_ledger_now === false ? 'MISMATCH with the ledger total today: do not rely on these figures.' : 'Pick a period that ends today to also compare with the live ledger total.'}</p>
            {f.billed_without_client_count > 0 && <p className="text-xs text-amber-700 mt-1 font-medium">{f.billed_without_client_count} walk-in quotation(s) worth {formatPKR(f.billed_without_client)} have no client and are outside the ledger.</p>}
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <Card className="p-4 bg-white shadow-sm border border-slate-200">
              <h2 className="font-semibold text-slate-900 text-sm mb-3">Quotations created in period</h2>
              {sum.quotations_by_status.length === 0 ? <p className="text-sm text-slate-500">None.</p> : (
                <table className="w-full text-sm"><thead><tr className="text-xs text-slate-400 border-b border-slate-100 pb-1.5"><th className="text-left font-semibold pb-1.5">Status</th><th className="text-right font-semibold pb-1.5">Count</th><th className="text-right font-semibold pb-1.5">Total</th></tr></thead>
                  <tbody>{sum.quotations_by_status.map(q => <tr key={q.status} className="border-t border-slate-50 hover:bg-slate-50/50"><td className="py-2 capitalize text-slate-700 font-medium">{q.status}</td><td className="text-right tabular-nums py-2 text-slate-600">{q.count}</td><td className="text-right tabular-nums py-2 font-semibold text-slate-900">{formatPKR(q.total)}</td></tr>)}</tbody></table>)}
            </Card>
            <Card className="p-4 bg-white shadow-sm border border-slate-200">
              <h2 className="font-semibold text-slate-900 text-sm mb-3">Collection by mode</h2>
              {Object.keys(f.collected_by_method).length === 0 ? <p className="text-sm text-slate-500">No payments in this period.</p> :
                Object.entries(f.collected_by_method).map(([k, v]) => <div key={k} className="flex justify-between text-sm py-2 border-b border-slate-100 last:border-0"><span className="capitalize text-slate-600 font-medium">{k.replace('_', ' ')}</span><span className="font-semibold tabular-nums text-slate-900">{formatPKR(v)}</span></div>)}
              <div className="flex justify-between text-sm pt-2.5 mt-1 border-t-2 border-slate-100 font-bold text-slate-900"><span>Total collected</span><span className="tabular-nums text-emerald-700">{formatPKR(f.collected)}</span></div>
            </Card>
            <Card className="p-4 bg-white shadow-sm border border-slate-200">
              <h2 className="font-semibold text-slate-900 text-sm mb-3">Cases opened in period</h2>
              {CASE_STATUSES.map(s => { const n = sum.cases_by_status[s.value] ?? 0; return (
                <div key={s.value} className="mb-2.5"><div className="flex justify-between text-sm mb-1"><span className="text-slate-600 text-xs font-medium">{s.label}</span><span className="font-semibold tabular-nums text-xs text-slate-800">{n}</span></div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-amber-500 rounded-full" style={{ width: `${sum.cases_opened ? (n / sum.cases_opened) * 100 : 0}%` }} /></div></div>); })}
              <p className="text-xs text-slate-500 mt-3 pt-2 border-t border-slate-100">By stage: {Object.entries(sum.cases_by_stage).map(([k, v]) => `${stageLabel(k)} (${v})`).join(' · ') || 'none'}</p>
              <p className="text-xs text-slate-500 mt-1">Fees on these cases: government {formatPKR(sum.cases_govt_fee)} · service {formatPKR(sum.cases_service_charge)}</p>
            </Card>
            <Card className="p-4 bg-white shadow-sm border border-slate-200 overflow-x-auto">
              <h2 className="font-semibold text-slate-900 text-sm mb-3">Staff workload</h2>
              {work.length === 0 ? <p className="text-sm text-slate-500">No active staff.</p> : (
                <table className="w-full text-sm"><thead><tr className="text-xs text-slate-400 border-b border-slate-100 pb-1.5"><th className="text-left font-semibold pb-1.5">Person</th><th className="text-right font-semibold pb-1.5">Open</th><th className="text-right font-semibold pb-1.5">Overdue</th><th className="text-right font-semibold pb-1.5">Done</th><th className="text-right font-semibold pb-1.5">Reminders</th></tr></thead>
                  <tbody>{work.map(w => <tr key={w.user_id} className="border-t border-slate-50 hover:bg-slate-50/50"><td className="py-2 text-slate-800 font-medium">{w.full_name || 'Unnamed'}</td><td className="text-right tabular-nums py-2">{w.open_cases}</td><td className={`text-right tabular-nums py-2 font-medium ${w.overdue_cases ? 'text-rose-600' : 'text-slate-500'}`}>{w.overdue_cases}</td><td className="text-right tabular-nums py-2 font-medium text-emerald-700">{w.completed_cases}</td><td className={`text-right tabular-nums py-2 ${w.overdue_reminders ? 'text-rose-600 font-medium' : 'text-slate-500'}`}>{w.open_reminders}{w.overdue_reminders ? ` (${w.overdue_reminders} late)` : ''}</td></tr>)}</tbody></table>)}
              <p className="text-xs text-slate-500 mt-3 pt-2 border-t border-slate-100">Done = cases closed in the period.</p>
            </Card>
          </div>
        </>
      )}
      <AgeingReport />
    </>
  );
}
