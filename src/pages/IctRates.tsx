import { pkToday } from '@/lib/time';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { PageHeader, Card, Spinner, EmptyState, Badge, Button, Field, Input, Textarea } from '@/components/ui';
import { BandTable, toNum, pctShow, type Section } from '@/pages/PunjabRates';
import { diffRates } from '@/lib/punjabRates';
import { DEFAULT_ICT_RATES, ICT_SOURCE_URL, pickIctRateSet, validateIctRates, type IctRates, type IctRateSetRow } from '@/lib/ictRates';
import { AlertTriangle, ExternalLink, Plus } from 'lucide-react';
import { friendlyError } from '@/lib/errors';

const today = () => pkToday();
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

const SECTIONS: Section[] = [
  { key: 'reg_fee', title: 'Registration fee', help: 'Percent of invoice value by CC. Leave Rate empty if not known: the operator must then type the ICT figure.', cols: [{ k: 'max_cc', label: 'Up to CC', type: 'cc' }, { k: 'rate', label: 'Rate %', type: 'pct', nullable: true }, { k: 'verified', label: 'Matched to a challan', type: 'bool' }], blank: { max_cc: null, rate: 0.02, verified: false } },
  { key: 'token', title: 'Token (motor vehicle) tax', help: 'lifetime = fixed rupees. percent = % of invoice price. manual = operator types the ICT figure.', cols: [{ k: 'max_cc', label: 'Up to CC', type: 'cc' }, { k: 'kind', label: 'Type', type: 'kind' }, { k: 'value', label: 'Value (Rs, or % for percent)', type: 'money' }, { k: 'verified', label: 'Matched to a challan', type: 'bool' }], blank: { max_cc: null, kind: 'percent', value: 0.0025, verified: false } },
  { key: 'income_tax', title: 'Income tax on the challan', help: 'Fixed rupees by CC band.', cols: [{ k: 'max_cc', label: 'Up to CC', type: 'cc' }, { k: 'filer', label: 'Filer (Rs)', type: 'money' }, { k: 'non_filer', label: 'Non-filer (Rs)', type: 'money' }, { k: 'verified', label: 'Filer matched to a challan', type: 'bool' }], blank: { max_cc: null, filer: 0, non_filer: 0, verified: false } },
  { key: 'hire_purchase_fee', title: 'Hire purchase (bank financed) fee', help: 'Added when the vehicle is bank financed.', cols: [{ k: 'max_cc', label: 'Up to CC', type: 'cc' }, { k: 'amount', label: 'Amount (Rs)', type: 'money' }, { k: 'verified', label: 'Matched to a challan', type: 'bool' }], blank: { max_cc: null, amount: 0, verified: false } },
];
const OBJ_SECTIONS: { key: keyof IctRates; title: string; fields: { k: string; label: string; pct?: boolean }[] }[] = [
  { key: 'fixed', title: 'Fixed fees (Rs)', fields: [{ k: 'professional_tax', label: 'Professional tax' }, { k: 'smart_card', label: 'Smart card' }, { k: 'number_plate', label: 'Number plate' }] },
  { key: 'late', title: 'Late registration', fields: [{ k: 'after_days', label: 'Late after (days from invoice date)' }] },
  { key: 'ev', title: 'Electric vehicle relief', fields: [{ k: 'reg_fee_discount', label: 'Registration fee discount %', pct: true }, { k: 'mvt_discount', label: 'Token tax discount %', pct: true }, { k: 'confirmed', label: 'Confirmed on a real ICT challan (1 = yes, 0 = no)' }] },
];

export default function IctRatesPage() {
  const { profile } = useAuth() as any;
  const isAdmin = profile?.role === 'admin';
  const [rows, setRows] = useState<IctRateSetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [draft, setDraft] = useState<{ id: string | null; rates: IctRates; base: IctRates } | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from('ict_rate_sets').select('*').order('effective_from', { ascending: false }).order('created_at', { ascending: false });
    if (error) setTableMissing(true); else { setTableMissing(false); setRows((data as IctRateSetRow[]) ?? []); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const inForce = useMemo(() => pickIctRateSet(rows, today()), [rows]);
  const audit = (action: string, id: string | null, details: Record<string, unknown>) => supabase.from('audit_logs').insert({ action, entity_type: 'ict_rate_set', entity_id: id, details });

  function startNew(from: IctRates) {
    const r = clone(from); r.version = ''; r.effective_from = today(); r.last_verified = today(); r.notes = '';
    setDraft({ id: null, rates: r, base: clone(from) }); setMsg('');
  }
  function editDraft(row: IctRateSetRow) {
    setDraft({ id: row.id, rates: { ...clone(row.rates), version: row.version, effective_from: row.effective_from, last_verified: row.last_verified, notes: row.notes ?? '' }, base: clone(inForce.rates) });
    setMsg('');
  }
  async function save(activate: boolean) {
    if (!draft) return;
    const problems = validateIctRates(draft.rates);
    if (problems.length) { setMsg(problems.join('\n')); return; }
    setBusy(true); setMsg('');
    const { version, effective_from, last_verified, notes, ...rest } = draft.rates;
    const payload = { version: version.trim(), effective_from, last_verified, notes: notes || null, status: activate ? 'active' : 'draft', rates: { ...rest, version: version.trim(), effective_from, last_verified, notes } };
    const res = draft.id
      ? await supabase.from('ict_rate_sets').update(payload).eq('id', draft.id).select().maybeSingle()
      : await supabase.from('ict_rate_sets').insert(payload).select().maybeSingle();
    setBusy(false);
    if (res.error) { setMsg(friendlyError(res.error)); return; }
    await audit(activate ? 'ict_rates_activated' : 'ict_rates_saved_draft', (res.data as any)?.id ?? null, { version: payload.version, effective_from, changes: diffRates(draft.base as any, draft.rates as any).slice(0, 60) });
    setDraft(null); load();
  }
  async function setStatus(row: IctRateSetRow, status: 'active' | 'archived') {
    const { error } = await supabase.from('ict_rate_sets').update({ status }).eq('id', row.id);
    if (error) { setMsg(friendlyError(error)); return; }
    await audit(status === 'active' ? 'ict_rates_activated' : 'ict_rates_archived', row.id, { version: row.version });
    load();
  }
  async function deleteDraft(row: IctRateSetRow) {
    if (!window.confirm(`Delete draft ${row.version}?`)) return;
    await supabase.from('ict_rate_sets').delete().eq('id', row.id);
    load();
  }
  async function markVerified() {
    if (!inForce.row) { setMsg('Save the built-in rates as a first version before marking them verified.'); return; }
    const { error } = await supabase.from('ict_rate_sets').update({ last_verified: today() }).eq('id', inForce.row.id);
    if (error) { setMsg(friendlyError(error)); return; }
    await audit('ict_rates_verified', inForce.row.id, { version: inForce.row.version, checked_against: ICT_SOURCE_URL });
    load();
  }

  if (loading) return <Spinner label="Loading Islamabad rates..." />;
  if (!isAdmin) return (<><PageHeader title="Islamabad Rates" /><Card className="p-8"><EmptyState icon={AlertTriangle} title="Admin access required" subtitle="Only administrators can manage Islamabad rates." /></Card></>);

  const dProblems = draft ? validateIctRates(draft.rates) : [];
  const dDiff = draft ? diffRates(draft.base as any, draft.rates as any) : [];
  const setR = (patch: Partial<IctRates>) => draft && setDraft({ ...draft, rates: { ...draft.rates, ...patch } });

  return (
    <>
      <PageHeader title="Islamabad Rates" subtitle="The fee rates the Islamabad (ICT) car calculator uses. Change them here when ICT Excise or the Finance Act changes a fee, or when electric vehicle relief changes. No code change needed." />
      {tableMissing && (
        <Card className="p-4 mb-4 bg-amber-50 border-amber-200 text-sm text-amber-800">
          The rate table is not in the database yet. Run the migration <code>supabase/migrations/20261108100000_ict_rate_sets.sql</code>. Until then the built-in rates are used and cannot be edited here.
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
            <a href={ICT_SOURCE_URL} target="_blank" rel="noopener noreferrer"><Button variant="secondary" size="sm"><ExternalLink className="w-4 h-4" /> ICT Excise site</Button></a>
            {!tableMissing && <Button variant="secondary" size="sm" onClick={markVerified}>Mark re-verified today</Button>}
            {!tableMissing && !draft && <Button size="sm" onClick={() => startNew(inForce.rates)}><Plus className="w-4 h-4" /> New version</Button>}
          </div>
        </div>
        {inForce.problems.length > 0 && <p className="text-sm text-rose-700 mt-3">The saved active set is invalid ({inForce.problems[0]}), so built-in rates are being used. Fix it by creating a new version.</p>}
      </Card>

      {draft && (
        <div className="space-y-4 mb-6">
          <Card className="p-5">
            <h2 className="font-semibold text-slate-900 mb-3">{draft.id ? 'Edit draft' : 'New version'}</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Version label" required><Input value={draft.rates.version} onChange={e => setR({ version: e.target.value })} placeholder="e.g. ICT-2027-07-01" /></Field>
              <Field label="Effective from" required><Input type="date" value={draft.rates.effective_from} onChange={e => setR({ effective_from: e.target.value })} /></Field>
              <Field label="Checked against a real challan / notification on" required><Input type="date" value={draft.rates.last_verified} onChange={e => setR({ last_verified: e.target.value })} /></Field>
            </div>
            <Field label="What changed and where it came from"><Textarea rows={2} value={draft.rates.notes} onChange={e => setR({ notes: e.target.value })} placeholder="e.g. Finance Act 2027 / ICT notification no. ... / challan CDU-691" /></Field>
            <p className="text-xs text-slate-500 mt-2">A future "Effective from" date schedules the change: the app keeps using the old rates until that day.</p>
          </Card>
          {SECTIONS.map(sec => (
            <BandTable key={sec.key} section={sec} rows={(draft.rates as any)[sec.key] as any[]} readOnly={false} onChange={r => setR({ [sec.key]: r } as any)} />
          ))}
          <Card className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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

      <Card className="p-5">
        <h2 className="font-semibold text-slate-900 mb-3">Versions</h2>
        {rows.length === 0 ? (
          <div className="text-sm text-slate-600">
            <p>No saved versions yet, so the built-in rates are in use.</p>
            {!tableMissing && <Button className="mt-3" size="sm" onClick={() => startNew(DEFAULT_ICT_RATES)}>Start managing from the built-in rates</Button>}
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
