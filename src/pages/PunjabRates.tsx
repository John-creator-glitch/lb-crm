import { pkToday } from '@/lib/time';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { PageHeader, Card, Spinner, EmptyState, Badge, Button, Field, Input, Textarea, Select } from '@/components/ui';
import { calculatePunjab } from '@/lib/punjab';
import { DEFAULT_PUNJAB_RATES, PUNJAB_SOURCE_URL, diffRates, pickRateSet, rateReminders, validateRates, type PunjabRates, type RateSetRow } from '@/lib/punjabRates';
import { formatPKR } from '@/lib/format';
import { AlertTriangle, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { friendlyError } from '@/lib/errors';

const today = () => pkToday();
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

// ---------- generic editors ----------
type Col = { k: string; label: string; type: 'cc' | 'days' | 'money' | 'pct' | 'bool' | 'kind'; nullable?: boolean };
export type Section = { key: string; title: string; help: string; cols: Col[]; blank: Record<string, unknown> };

const SECTIONS: Section[] = [
  { key: 'reg_fee', title: 'Registration fee', help: 'Percent of invoice value by CC. Leave Rate empty if the rate is not known: the operator will then type the e-pay figure.', cols: [{ k: 'max_cc', label: 'Up to CC', type: 'cc' }, { k: 'rate', label: 'Rate %', type: 'pct', nullable: true }, { k: 'verified', label: 'Matched to a challan', type: 'bool' }], blank: { max_cc: null, rate: 0.01, verified: false } },
  { key: 'mvt', title: 'Motor vehicle (token) tax', help: 'lifetime = fixed one-time amount. percent = % of invoice price. manual = operator types the e-pay figure.', cols: [{ k: 'max_cc', label: 'Up to CC', type: 'cc' }, { k: 'kind', label: 'Type', type: 'kind' }, { k: 'value', label: 'Value (Rs, or % for percent)', type: 'money' }, { k: 'verified', label: 'Matched to a challan', type: 'bool' }], blank: { max_cc: null, kind: 'percent', value: 0.003, verified: false } },
  { key: 'income_tax', title: 'Income tax on the excise challan', help: 'Fixed rupees by CC band.', cols: [{ k: 'max_cc', label: 'Up to CC', type: 'cc' }, { k: 'filer', label: 'Filer (Rs)', type: 'money' }, { k: 'non_filer', label: 'Non-filer (Rs)', type: 'money' }, { k: 'verified', label: 'Filer matched to a challan', type: 'bool' }], blank: { max_cc: null, filer: 0, non_filer: 0, verified: false } },
  { key: 'reg_mark', title: 'Additional Reg Mark fee', help: 'Shown on real challans, not on the official page.', cols: [{ k: 'max_cc', label: 'Up to CC', type: 'cc' }, { k: 'amount', label: 'Amount (Rs)', type: 'money' }], blank: { max_cc: null, amount: 0 } },
  { key: 'transfer_fee', title: 'Transfer fee', help: 'By CC band.', cols: [{ k: 'max_cc', label: 'Up to CC', type: 'cc' }, { k: 'amount', label: 'Amount (Rs)', type: 'money' }], blank: { max_cc: null, amount: 0 } },
  { key: 'hire_purchase_fee', title: 'Hire purchase (bank financed) fee', help: 'Added when the vehicle is bank financed.', cols: [{ k: 'max_cc', label: 'Up to CC', type: 'cc' }, { k: 'amount', label: 'Amount (Rs)', type: 'money' }, { k: 'verified', label: 'Matched to a challan', type: 'bool' }], blank: { max_cc: null, amount: 0, verified: false } },
  { key: 'late_registration', title: 'Late registration fee', help: 'By days since the purchase date. Amount 0 = no fine (not included).', cols: [{ k: 'up_to_days', label: 'Up to days', type: 'days' }, { k: 'amount', label: 'Amount (Rs)', type: 'money' }, { k: 'verified', label: 'Matched to a challan', type: 'bool' }], blank: { up_to_days: null, amount: 0, verified: false } },
  { key: 'late_transfer', title: 'Late transfer penalty', help: 'By days since the sale date. Leave Amount empty if the figure is not published: the app then warns instead of guessing.', cols: [{ k: 'up_to_days', label: 'Up to days', type: 'days' }, { k: 'amount', label: 'Amount (Rs)', type: 'money', nullable: true }], blank: { up_to_days: null, amount: 0 } },
  { key: 'transfer_wht', title: 'Transfer withholding tax (first-year base)', help: 'Reduced every year by the rule below.', cols: [{ k: 'max_cc', label: 'Up to CC', type: 'cc' }, { k: 'filer', label: 'Filer (Rs)', type: 'money' }, { k: 'non_filer', label: 'Non-filer (Rs)', type: 'money' }], blank: { max_cc: null, filer: 0, non_filer: 0 } },
];
type ObjSection = { key: keyof PunjabRates; title: string; fields: { k: string; label: string; pct?: boolean }[] };
const OBJ_SECTIONS: ObjSection[] = [
  { key: 'fixed', title: 'Fixed fees (Rs)', fields: [{ k: 'arc_fee', label: 'Registration card' }, { k: 'platform_charges', label: 'Platform charges' }, { k: 'professional_tax', label: 'Professional tax' }] },
  { key: 'double_cabin', title: 'Double cabin goods vehicle', fields: [{ k: 'reg_fee_rate', label: 'Registration fee %', pct: true }, { k: 'mvt_rate', label: 'Motor vehicle tax %', pct: true }, { k: 'income_tax_filer', label: 'Income tax, filer (Rs)' }, { k: 'max_cc', label: 'Supported up to CC' }] },
  { key: 'ev', title: 'Electric vehicle discounts', fields: [{ k: 'reg_fee_discount', label: 'Registration fee discount %', pct: true }, { k: 'mvt_discount', label: 'Motor vehicle tax discount %', pct: true }] },
  { key: 'cvt', title: 'Capital value tax (transfer)', fields: [{ k: 'rate', label: 'Rate %', pct: true }, { k: 'above_cc', label: 'Applies above CC' }, { k: 'max_age_years', label: 'Up to age (years)' }, { k: 'yearly_depreciation', label: 'Yearly depreciation %', pct: true }] },
  { key: 'transfer_wht_rule', title: 'Transfer withholding tax rule', fields: [{ k: 'yearly_reduction', label: 'Reduction per year %', pct: true }, { k: 'zero_after_years', label: 'Zero after (years)' }] },
];

export const toNum = (s: string) => (s.trim() === '' ? null : Number(s));
export const pctShow = (v: number | null) => (v == null ? '' : String(+(v * 100).toFixed(6)));

export function BandTable({ section, rows, onChange, readOnly }: { section: Section; rows: any[]; onChange: (r: any[]) => void; readOnly: boolean }) {
  const set = (i: number, k: string, v: unknown) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <Card className="p-4">
      <h3 className="font-semibold text-slate-900">{section.title}</h3>
      <p className="text-xs text-slate-500 mb-3">{section.help}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500">{section.cols.map(c => <th key={c.k} className="pr-2 pb-1 font-medium">{c.label}</th>)}<th /></tr></thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {section.cols.map(c => (
                  <td key={c.k} className="pr-2 py-1">
                    {c.type === 'bool' ? (
                      <input type="checkbox" disabled={readOnly} checked={!!row[c.k]} onChange={e => set(i, c.k, e.target.checked)} />
                    ) : c.type === 'kind' ? (
                      <select disabled={readOnly} className="border border-slate-200 rounded px-2 py-1 text-sm" value={row[c.k]} onChange={e => set(i, c.k, e.target.value)}>
                        <option value="percent">percent</option><option value="lifetime">lifetime</option><option value="manual">manual</option>
                      </select>
                    ) : c.type === 'pct' ? (
                      <Input disabled={readOnly} value={pctShow(row[c.k])} placeholder={c.nullable ? 'not known' : ''} onChange={e => { const n = toNum(e.target.value); set(i, c.k, n == null ? null : n / 100); }} />
                    ) : c.k === 'value' && row.kind === 'percent' ? (
                      <Input disabled={readOnly} value={pctShow(row[c.k])} onChange={e => { const n = toNum(e.target.value); set(i, c.k, n == null ? 0 : n / 100); }} />
                    ) : (
                      <Input disabled={readOnly} value={row[c.k] ?? ''} placeholder={c.type === 'money' && c.nullable ? 'not published' : c.type === 'money' ? '' : 'no limit'} onChange={e => set(i, c.k, toNum(e.target.value))} />
                    )}
                  </td>
                ))}
                <td>{!readOnly && rows.length > 1 && <button className="text-slate-500 hover:text-rose-600" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove row"><Trash2 className="w-4 h-4" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <Button size="sm" variant="ghost" onClick={() => { const last = rows[rows.length - 1]; const before = rows.slice(0, -1); onChange([...before, { ...last, [section.cols[0].k]: ((before[before.length - 1]?.[section.cols[0].k] as number) ?? 0) + 1000 }, { ...section.blank, ...Object.fromEntries(Object.entries(last).filter(([k]) => k !== section.cols[0].k)), [section.cols[0].k]: null }]); }}>
          <Plus className="w-4 h-4" /> Add band
        </Button>
      )}
      <p className="text-[11px] text-slate-500 mt-1">The last row has no limit (leave "Up to" empty). New bands are added just before it.</p>
    </Card>
  );
}

// ---------- challan checker ----------
function ChallanChecker({ rates }: { rates: PunjabRates }) {
  const [cc, setCc] = useState('');
  const [price, setPrice] = useState('');
  const [filer, setFiler] = useState<'filer' | 'non_filer'>('filer');
  const [hp, setHp] = useState(false);
  const [late, setLate] = useState('');
  const [mvt, setMvt] = useState('');
  const [reg, setReg] = useState('');
  const [actual, setActual] = useState('');
  type CheckRes = { error: string } | { items: ReturnType<typeof calculatePunjab>['items']; total: number } | null;
  const res: CheckRes = useMemo((): CheckRes => {
    if (!cc || !price) return null;
    try {
      const r = calculatePunjab({ transaction_type: 'new_registration', engine_cc: Number(cc), invoice_value: Number(price), filer_status: filer, hire_purchase: hp, late_fee: late === '' ? 0 : Number(late), mvt_manual: mvt === '' ? null : Number(mvt), reg_fee_manual: reg === '' ? null : Number(reg) }, rates);
      return { items: r.items, total: r.items.reduce((s, x) => s + x.amount, 0) };
    } catch (e: any) { return { error: String(e.message || e) }; }
  }, [cc, price, filer, hp, late, mvt, reg, rates]);
  const diff = res && 'total' in res && actual !== '' ? Number(actual) - res.total : null;
  return (
    <Card className="p-5">
      <h2 className="font-semibold text-slate-900">Check against a real challan</h2>
      <p className="text-xs text-slate-500 mb-3">Enter a vehicle and the total printed on its e-pay challan (new registration). If the totals differ, Punjab has changed a fee: find the line on the challan that differs and update the table above.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Engine CC"><Input value={cc} onChange={e => setCc(e.target.value)} /></Field>
        <Field label="Invoice price (Rs)"><Input value={price} onChange={e => setPrice(e.target.value)} /></Field>
        <Field label="Filer status"><Select value={filer} onChange={e => setFiler(e.target.value as any)}><option value="filer">Filer</option><option value="non_filer">Non-filer</option></Select></Field>
        <Field label="Late fee on challan (Rs)"><Input value={late} onChange={e => setLate(e.target.value)} placeholder="0" /></Field>
        <Field label="Token tax from challan (if band is manual)"><Input value={mvt} onChange={e => setMvt(e.target.value)} /></Field>
        <Field label="Reg fee from challan (if band is manual)"><Input value={reg} onChange={e => setReg(e.target.value)} /></Field>
        <Field label="Bank financed"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hp} onChange={e => setHp(e.target.checked)} /> Hire purchase</label></Field>
        <Field label="Total on e-pay challan (Rs)"><Input value={actual} onChange={e => setActual(e.target.value)} /></Field>
      </div>
      {res && 'error' in res && <p className="text-sm text-amber-700 mt-3">{res.error}</p>}
      {res && 'total' in res && (
        <div className="mt-3 text-sm">
          <p>App total: <span className="font-semibold tabular-nums">{formatPKR(res.total)}</span></p>
          {diff !== null && (diff === 0
            ? <p className="text-emerald-700 font-medium">Matches the challan exactly.</p>
            : <p className="text-rose-700 font-medium">Differs from the challan by {formatPKR(Math.abs(diff))} ({diff > 0 ? 'challan is higher' : 'challan is lower'}). Compare each line below with the challan.</p>)}
          <ul className="mt-2 text-slate-600 columns-1 md:columns-2">{res.items.filter(x => x.amount !== 0).map(x => <li key={x.fee_type}>{x.label}: {formatPKR(x.amount)}</li>)}</ul>
        </div>
      )}
    </Card>
  );
}

// ---------- page ----------
export default function PunjabRates() {
  const { profile, user } = useAuth() as any;
  const isAdmin = profile?.role === 'admin';
  const [rows, setRows] = useState<RateSetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [draft, setDraft] = useState<{ id: string | null; rates: PunjabRates; base: PunjabRates } | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from('punjab_rate_sets').select('*').order('effective_from', { ascending: false }).order('created_at', { ascending: false });
    if (error) setTableMissing(true); else { setTableMissing(false); setRows((data as RateSetRow[]) ?? []); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const inForce = useMemo(() => pickRateSet(rows, today()), [rows]);
  const reminders = rateReminders(inForce.rates);
  const audit = (action: string, id: string | null, details: Record<string, unknown>) => supabase.from('audit_logs').insert({ action, entity_type: 'punjab_rate_set', entity_id: id, details });

  function startNew(from: PunjabRates) {
    const r = clone(from);
    r.version = ''; r.effective_from = today(); r.last_verified = today(); r.notes = '';
    setDraft({ id: null, rates: r, base: clone(from) }); setMsg('');
  }
  function editDraft(row: RateSetRow) {
    setDraft({ id: row.id, rates: { ...clone(row.rates), version: row.version, effective_from: row.effective_from, last_verified: row.last_verified, notes: row.notes ?? '' }, base: clone(inForce.rates) });
    setMsg('');
  }

  async function save(activate: boolean) {
    if (!draft) return;
    const problems = validateRates(draft.rates);
    if (problems.length) { setMsg(problems.join('\n')); return; }
    setBusy(true); setMsg('');
    const { version, effective_from, last_verified, notes, ...rest } = draft.rates;
    const payload = { version: version.trim(), effective_from, last_verified, notes: notes || null, status: activate ? 'active' : 'draft', rates: { ...rest, version: version.trim(), effective_from, last_verified, notes } };
    const res = draft.id
      ? await supabase.from('punjab_rate_sets').update(payload).eq('id', draft.id).select().maybeSingle()
      : await supabase.from('punjab_rate_sets').insert(payload).select().maybeSingle();
    setBusy(false);
    if (res.error) { setMsg(friendlyError(res.error)); return; }
    await audit(activate ? 'punjab_rates_activated' : 'punjab_rates_saved_draft', (res.data as any)?.id ?? null, { version: payload.version, effective_from, changes: diffRates(draft.base, draft.rates).slice(0, 60) });
    setDraft(null); load();
  }

  async function setStatus(row: RateSetRow, status: 'active' | 'archived') {
    const { error } = await supabase.from('punjab_rate_sets').update({ status }).eq('id', row.id);
    if (error) { setMsg(friendlyError(error)); return; }
    await audit(status === 'active' ? 'punjab_rates_activated' : 'punjab_rates_archived', row.id, { version: row.version });
    load();
  }
  async function deleteDraft(row: RateSetRow) {
    if (!window.confirm(`Delete draft ${row.version}?`)) return;
    await supabase.from('punjab_rate_sets').delete().eq('id', row.id);
    load();
  }
  async function markVerified() {
    if (!inForce.row) { setMsg('Save the built-in rates as a first version before marking them verified.'); return; }
    const { error } = await supabase.from('punjab_rate_sets').update({ last_verified: today() }).eq('id', inForce.row.id);
    if (error) { setMsg(friendlyError(error)); return; }
    await audit('punjab_rates_verified', inForce.row.id, { version: inForce.row.version, checked_against: PUNJAB_SOURCE_URL });
    load();
  }

  if (loading) return <Spinner label="Loading Punjab rates..." />;
  if (!isAdmin) return (<><PageHeader title="Punjab Rates" /><Card className="p-8"><EmptyState icon={AlertTriangle} title="Admin access required" subtitle="Only administrators can manage Punjab rates." /></Card></>);

  const dProblems = draft ? validateRates(draft.rates) : [];
  const dDiff = draft ? diffRates(draft.base, draft.rates) : [];
  const setR = (patch: Partial<PunjabRates>) => draft && setDraft({ ...draft, rates: { ...draft.rates, ...patch } });

  return (
    <>
      <PageHeader title="Punjab Rates" subtitle="The fee rates the Punjab car calculator uses. Change them here when Punjab Excise changes a fee. No code change needed." />

      {tableMissing && (
        <Card className="p-4 mb-4 bg-amber-50 border-amber-200 text-sm text-amber-800">
          The rate table is not in the database yet. Run the migration <code>supabase/migrations/20261106100000_punjab_rate_sets.sql</code>. Until then the built-in rates below are used and cannot be edited here.
        </Card>
      )}
      {msg && <Card className="p-3 mb-4 bg-rose-50 border-rose-200 text-sm text-rose-800 whitespace-pre-line">{msg}</Card>}

      <Card className="p-5 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500">In force today</p>
            <p className="font-semibold text-slate-900">{inForce.rates.version} <Badge className="bg-slate-100 text-slate-600 ml-1">{inForce.source}</Badge></p>
            <p className="text-sm text-slate-500">Effective {inForce.rates.effective_from} · last verified {inForce.rates.last_verified}</p>
            {inForce.rates.notes && <p className="text-sm text-slate-500 mt-1">{inForce.rates.notes}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={PUNJAB_SOURCE_URL} target="_blank" rel="noopener noreferrer"><Button variant="secondary" size="sm"><ExternalLink className="w-4 h-4" /> Official page</Button></a>
            {!tableMissing && <Button variant="secondary" size="sm" onClick={markVerified}>Mark re-verified today</Button>}
            {!tableMissing && !draft && <Button size="sm" onClick={() => startNew(inForce.rates)}><Plus className="w-4 h-4" /> New version</Button>}
          </div>
        </div>
        {inForce.problems.length > 0 && <p className="text-sm text-rose-700 mt-3">The saved active set is invalid ({inForce.problems[0]}), so built-in rates are being used. Fix it by creating a new version.</p>}
        {reminders.map(r => <p key={r} className="text-sm text-amber-700 mt-2"><AlertTriangle className="inline w-4 h-4 mr-1" />{r}</p>)}
      </Card>

      {draft && (
        <div className="space-y-4 mb-6">
          <Card className="p-5">
            <h2 className="font-semibold text-slate-900 mb-3">{draft.id ? 'Edit draft' : 'New version'}</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Version label" required><Input value={draft.rates.version} onChange={e => setR({ version: e.target.value })} placeholder="e.g. PB-2027-07-01" /></Field>
              <Field label="Effective from" required><Input type="date" value={draft.rates.effective_from} onChange={e => setR({ effective_from: e.target.value })} /></Field>
              <Field label="Checked against the official source on" required><Input type="date" value={draft.rates.last_verified} onChange={e => setR({ last_verified: e.target.value })} /></Field>
            </div>
            <Field label="What changed and where it came from"><Textarea rows={2} value={draft.rates.notes} onChange={e => setR({ notes: e.target.value })} placeholder="e.g. Finance Act 2027 / Excise notification no. ... / challan DXX 123" /></Field>
            <p className="text-xs text-slate-500 mt-2">A future "Effective from" date schedules the change: the app keeps using the old rates until that day.</p>
          </Card>

          {SECTIONS.map(sec => (
            <BandTable key={sec.key} section={sec} rows={(draft.rates as any)[sec.key] as any[]} readOnly={false} onChange={r => setR({ [sec.key]: r } as any)} />
          ))}
          <Card className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {OBJ_SECTIONS.map(sec => (
                <div key={sec.key}>
                  <h3 className="font-semibold text-slate-900 mb-2">{sec.title}</h3>
                  <div className="space-y-2">
                    {sec.fields.map(f => {
                      const obj = draft.rates[sec.key] as any;
                      return (
                        <Field key={f.k} label={f.label}>
                          <Input value={f.pct ? pctShow(obj[f.k]) : obj[f.k] ?? ''} onChange={e => { const n = toNum(e.target.value); setR({ [sec.key]: { ...obj, [f.k]: n == null ? 0 : f.pct ? n / 100 : n } } as any); }} />
                        </Field>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <ChallanChecker rates={draft.rates} />

          <Card className="p-5">
            <h3 className="font-semibold text-slate-900 mb-2">Review before saving</h3>
            {dDiff.length === 0 ? <p className="text-sm text-slate-500">No rate changes compared with the version in force.</p> : (
              <ul className="text-sm text-slate-700 space-y-0.5 max-h-48 overflow-y-auto font-mono">{dDiff.map(d => <li key={d}>{d}</li>)}</ul>
            )}
            {dProblems.length > 0 && <ul className="mt-3 text-sm text-rose-700 list-disc pl-5">{dProblems.map(p => <li key={p}>{p}</li>)}</ul>}
            <div className="flex flex-wrap gap-2 mt-4">
              <Button onClick={() => save(true)} disabled={busy || dProblems.length > 0}>Save and activate</Button>
              <Button variant="secondary" onClick={() => save(false)} disabled={busy || dProblems.length > 0}>Save as draft</Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            </div>
            <p className="text-xs text-slate-500 mt-2">Activated versions cannot be edited later, so every old quotation can be traced to the exact rates used. To change again, create a new version.</p>
          </Card>
        </div>
      )}

      {!draft && <div className="mb-6"><ChallanChecker rates={inForce.rates} /></div>}

      <Card className="p-5">
        <h2 className="font-semibold text-slate-900 mb-3">Versions</h2>
        {rows.length === 0 ? (
          <div className="text-sm text-slate-600">
            <p>No saved versions yet, so the built-in rates are in use.</p>
            {!tableMissing && <Button className="mt-3" size="sm" onClick={() => startNew(DEFAULT_PUNJAB_RATES)}>Start managing from the built-in rates</Button>}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map(row => (
              <div key={row.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-900">{row.version}
                    <Badge className={`ml-2 ${row.status === 'active' ? 'bg-emerald-100 text-emerald-700' : row.status === 'draft' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{row.status}</Badge>
                    {inForce.row?.id === row.id && <Badge className="ml-1 bg-blue-100 text-blue-700">in force</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">Effective {row.effective_from} · verified {row.last_verified}{row.notes ? ` · ${row.notes}` : ''}</p>
                </div>
                <div className="flex gap-2">
                  {row.status === 'draft' && <><Button size="sm" variant="secondary" onClick={() => editDraft(row)}>Edit</Button><Button size="sm" onClick={() => setStatus(row, 'active')}>Activate</Button><Button size="sm" variant="ghost" onClick={() => deleteDraft(row)}>Delete</Button></>}
                  {row.status === 'active' && <Button size="sm" variant="secondary" onClick={() => setStatus(row, 'archived')}>Archive</Button>}
                  <Button size="sm" variant="ghost" onClick={() => startNew({ ...row.rates, version: row.version, effective_from: row.effective_from, last_verified: row.last_verified, notes: row.notes ?? '' })}>Copy to new</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
