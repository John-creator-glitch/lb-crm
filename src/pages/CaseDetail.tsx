import { useCallback, useEffect, useState } from 'react';
import { pkToday } from '@/lib/time';
import { supabase, CASE_STATUSES, CASE_SERVICES, type CaseRow, type CaseDocument, type Client, type Vehicle, type Quotation, type StatusHistoryRow, type CaseStage, type CasePriority, type TaskRow } from '@/lib/supabase';
import { PageHeader, Breadcrumbs, ContactActions, Card, Spinner, Badge, Button, Field, Input, Select, Textarea } from '@/components/ui';
import { usePageTitle } from '@/lib/pageTitle';
import { formatDate, formatDateTime, formatPKR } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { CASE_STAGES, CASE_PRIORITIES, nextStage, stageLabel, docProgress, caseOverdue, isClosed, FIELD_LABEL } from '@/lib/workflow';
import LinkedReminders from '@/components/LinkedReminders';
import { ArrowLeft, Check, Plus, Trash2, FileText, UserRound, Car, ListChecks, History, AlertTriangle, ChevronRight, Ban, RotateCcw } from 'lucide-react';
import { friendlyError } from '@/lib/errors';

interface Person { id: string; full_name: string; role: string; active?: boolean }

export default function CaseDetail({ caseId, onBack, onOpenClient, onOpenQuotation }: { caseId: string; onBack: () => void; onOpenClient?: (id: string) => void; onOpenQuotation?: (id: string) => void }) {
  const canManage = useCan('manager');
  const [row, setRow] = useState<CaseRow | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [docs, setDocs] = useState<CaseDocument[]>([]);
  const [history, setHistory] = useState<StatusHistoryRow[]>([]);
  const [tasks, setTasks] = useState<Pick<TaskRow, 'id' | 'title' | 'due_date' | 'status'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [note, setNote] = useState('');
  const [newDoc, setNewDoc] = useState('');
  const [f, setF] = useState({ assigned_to: '', priority: 'normal' as CasePriority, due_date: '', next_action: '', next_action_on: '', excise_reference: '', excise_submitted_on: '', notes: '' });

  const load = useCallback(async () => {
    const { data: c, error } = await supabase.from('cases').select('*').eq('id', caseId).maybeSingle();
    if (error || !c) { setRow(null); setLoading(false); return; }
    const r = c as CaseRow;
    setRow(r);
    setF({ assigned_to: r.assigned_to ?? '', priority: r.priority ?? 'normal', due_date: r.due_date ?? '', next_action: r.next_action ?? '', next_action_on: r.next_action_on ?? '', excise_reference: r.excise_reference ?? '', excise_submitted_on: r.excise_submitted_on ?? '', notes: r.notes ?? '' });
    const [cl, v, q, p, d, h, t] = await Promise.all([
      r.client_id ? supabase.from('clients').select('*').eq('id', r.client_id).maybeSingle() : Promise.resolve({ data: null }),
      r.vehicle_id ? supabase.from('vehicles').select('*').eq('id', r.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
      r.quotation_id ? supabase.from('quotations').select('*').eq('id', r.quotation_id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from('profiles').select('id, full_name, role, active'),
      supabase.from('case_documents').select('*').eq('case_id', caseId).order('sort_order').order('created_at'),
      supabase.from('status_history').select('*').eq('entity_type', 'case').eq('entity_id', caseId).order('changed_at', { ascending: false }),
      supabase.from('tasks').select('id, title, due_date, status').eq('case_id', caseId).order('due_date'),
    ]);
    setClient(cl.data as Client | null); setVehicle(v.data as Vehicle | null); setQuotation(q.data as Quotation | null);
    setPeople((p.data ?? []) as Person[]); setDocs((d.data ?? []) as CaseDocument[]); setHistory((h.data ?? []) as StatusHistoryRow[]); setTasks((t.data ?? []) as typeof tasks);
    setLoading(false);
  }, [caseId]);
  useEffect(() => { load(); }, [load]);

  usePageTitle(row?.case_no);
  if (loading) return <Spinner label="Loading case..." />;
  if (!row) return <div className="text-center py-12 text-slate-500">Case not found. <button className="underline" onClick={onBack}>Back to cases</button></div>;

  const m3 = row.stage !== undefined;
  const st = CASE_STATUSES.find(s => s.value === row.status);
  const stage = (row.stage ?? 'new') as CaseStage;
  const closed = isClosed(row.status);
  const lockedForStaff = closed && !canManage;
  const nxt = nextStage(stage);
  const prog = docProgress(docs);
  const today = pkToday();
  const overdue = caseOverdue(row, today);
  const nameOf = (id: string | null) => people.find(p => p.id === id)?.full_name ?? '';
  const vText = vehicle ? [vehicle.registration_number, vehicle.company, vehicle.model, vehicle.manufacturing_year].filter(Boolean).join(' ') : '';

  async function run(p: PromiseLike<{ error: { message: string } | null }>, ok?: string) {
    const { error } = await p;
    if (error) { setErr(friendlyError(error)); setMsg(''); return false; }
    setErr(''); if (ok) setMsg(ok); await load(); return true;
  }
  const moveStage = (to: CaseStage) => {
    if (to === stage) return;
    const backwards = CASE_STAGES.findIndex(s => s.value === to) < CASE_STAGES.findIndex(s => s.value === stage);
    if (backwards && !window.confirm(`Move this case back to "${stageLabel(to)}"?`)) return;
    return run(supabase.rpc('set_case_stage', { p_id: row.id, p_stage: to, p_note: note.trim() || null }), `Moved to ${stageLabel(to)}.`).then(ok => { if (ok) setNote(''); });
  };
  async function cancelCase() {
    const why = window.prompt('Why is this case cancelled? (required, kept in the history)');
    if (why === null) return;
    await run(supabase.rpc('set_case_status', { p_id: row!.id, p_status: 'cancelled', p_note: why.trim() }), 'Case cancelled.');
  }
  const reopen = () => run(supabase.rpc('set_case_status', { p_id: row.id, p_status: 'active', p_note: note.trim() || 'Reopened' }), 'Case reopened.');
  async function saveDetails() {
    if (f.excise_submitted_on && f.excise_submitted_on > today) { setErr('The Excise submission date cannot be in the future.'); return; }
    await run(supabase.from('cases').update({
      assigned_to: f.assigned_to || null, priority: f.priority, due_date: f.due_date || null, next_action: f.next_action.trim() || null, next_action_on: f.next_action_on || null,
      excise_reference: f.excise_reference.trim() || null, excise_submitted_on: f.excise_submitted_on || null, notes: f.notes.trim() || null,
    }).eq('id', row!.id), 'Saved.');
  }
  const toggleDoc = (d: CaseDocument) => run(supabase.from('case_documents').update({ received: !d.received }).eq('id', d.id));
  const toggleRequired = (d: CaseDocument) => run(supabase.from('case_documents').update({ required: !d.required }).eq('id', d.id));
  const removeDoc = (d: CaseDocument) => window.confirm(`Remove "${d.label}" from the checklist?`) ? run(supabase.from('case_documents').delete().eq('id', d.id)) : undefined;
  async function addDoc() {
    if (!newDoc.trim()) return;
    const ok = await run(supabase.from('case_documents').insert({ case_id: row!.id, label: newDoc.trim(), sort_order: docs.length + 1 }));
    if (ok) setNewDoc('');
  }
  async function addSuggested() {
    const { data, error } = await supabase.rpc('default_case_documents', { p_service: row!.service_type });
    if (error) { setErr(friendlyError(error)); return; }
    const have = new Set(docs.map(d => d.label.toLowerCase()));
    const rowsToAdd = ((data as string[]) ?? []).filter(l => !have.has(l.toLowerCase())).map((label, i) => ({ case_id: row!.id, label, sort_order: docs.length + i + 1 }));
    if (!rowsToAdd.length) { setMsg('The suggested list is already on this case.'); return; }
    await run(supabase.from('case_documents').insert(rowsToAdd), 'Suggested documents added. Remove any your office does not ask for.');
  }

  return (
    <>
      <Breadcrumbs items={[{ label: 'Cases', onClick: onBack }, ...(client ? [{ label: client.name, onClick: onOpenClient ? () => onOpenClient(client.id) : undefined }] : []), { label: row.case_no }]} />
      <PageHeader title={row.case_no}
        subtitle={[CASE_SERVICES.find(s => s.value === row.service_type)?.label, client?.name, `opened ${formatDate(row.opened_on)}`, row.closed_on && `closed ${formatDate(row.closed_on)}`].filter(Boolean).join(' · ')}
        action={<div className="flex flex-wrap gap-2 items-center"><Badge className={st?.color ?? ''}>{st?.label}</Badge>{m3 && <Badge className={CASE_PRIORITIES.find(p => p.value === (row.priority ?? 'normal'))?.color ?? ''}>{CASE_PRIORITIES.find(p => p.value === (row.priority ?? 'normal'))?.label}</Badge>}{overdue && <Badge className="bg-rose-100 text-rose-700">Overdue</Badge>}</div>} />
      {msg && <p className="text-sm text-emerald-700 mb-3" role="status">{msg}</p>}
      {err && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">{err}</div>}
      {!m3 && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /><span>Case workflow database update is not run yet. Run <span className="font-mono text-xs">20261118090000_m3_quotation_case_workflow.sql</span> once on staging.</span></div>}

      {m3 && (
        <Card className="p-4 sm:p-5 mb-4">
          <ol className="flex gap-1 overflow-x-auto pb-1" aria-label="Case stage">
            {CASE_STAGES.map((s, i) => {
              const idx = CASE_STAGES.findIndex(x => x.value === stage);
              const done = i < idx; const current = i === idx;
              return (
                <li key={s.value} className="flex-1 min-w-[84px]">
                  <button disabled={lockedForStaff || row.status === 'cancelled'} onClick={() => moveStage(s.value)} title={s.hint}
                    className={`w-full rounded-lg px-2 py-2 text-xs font-medium border transition ${current ? 'bg-amber-500 border-amber-500 text-slate-900' : done ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'} disabled:opacity-60`}>
                    {done && <Check className="w-3 h-3 inline mr-1" />}{s.label}
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="text-xs text-slate-500 mt-2">{CASE_STAGES.find(s => s.value === stage)?.hint}.{row.status === 'cancelled' ? ' This case is cancelled.' : ''}</p>
          {!lockedForStaff && row.status !== 'cancelled' && (
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Note for the history (optional)" aria-label="Note for the history" />
              {nxt && <Button onClick={() => moveStage(nxt)} className="whitespace-nowrap">Move to {stageLabel(nxt)} <ChevronRight className="w-4 h-4" /></Button>}
            </div>
          )}
          {lockedForStaff && <p className="text-xs text-slate-500 mt-2">This case is closed. A manager or the owner can reopen it.</p>}
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-4 sm:p-5">
            <div className="grid sm:grid-cols-2 gap-4 text-sm">
              <div><p className="text-xs text-slate-500 mb-1 flex items-center gap-1"><UserRound className="w-3.5 h-3.5" /> Client</p>
                {client ? <button className="font-medium text-slate-900 hover:text-amber-700 text-left" onClick={() => onOpenClient?.(client.id)}>{client.name}</button> : <span className="text-rose-600">No client linked</span>}
                {client?.phone && <p className="text-xs text-slate-500">{client.phone}</p>}<ContactActions phone={client?.phone} whatsappText={`Assalam o Alaikum, regarding case ${row.case_no}:`} className="mt-2" /></div>
              <div><p className="text-xs text-slate-500 mb-1 flex items-center gap-1"><Car className="w-3.5 h-3.5" /> Vehicle</p>
                {vText ? <span className="font-medium text-slate-900">{vText}</span> : <span className="text-slate-500">No vehicle linked</span>}</div>
              <div><p className="text-xs text-slate-500 mb-1 flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> Quotation</p>
                {quotation ? <button className="font-medium text-slate-900 hover:text-amber-700" onClick={() => onOpenQuotation?.(quotation.id)}>{quotation.quotation_number}</button> : <span className="text-slate-500">None linked</span>}</div>
              <div><p className="text-xs text-slate-500 mb-1">Fees</p><span className="text-slate-900">Govt {formatPKR(row.govt_fee)} · Service {formatPKR(row.service_charge)}</span></div>
            </div>
          </Card>

          {m3 && (
            <Card className="p-4 sm:p-5">
              <h3 className="font-semibold text-slate-900 text-sm mb-3">Work and Excise submission</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Assigned to"><Select value={f.assigned_to} onChange={e => setF({ ...f, assigned_to: e.target.value })} disabled={lockedForStaff}><option value="">Not assigned</option>{people.filter(p => p.active !== false || p.id === f.assigned_to).map(p => <option key={p.id} value={p.id}>{p.full_name || 'Unnamed user'}</option>)}</Select></Field>
                <Field label="Priority"><Select value={f.priority} onChange={e => setF({ ...f, priority: e.target.value as CasePriority })} disabled={lockedForStaff}>{CASE_PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>
                <Field label="Due date"><Input type="date" value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} disabled={lockedForStaff} /></Field>
                <div />
                <Field label="Next action"><Input value={f.next_action} onChange={e => setF({ ...f, next_action: e.target.value })} placeholder="e.g. Call client for missing CNIC copy" disabled={lockedForStaff} /></Field>
                <Field label="Next action date"><Input type="date" value={f.next_action_on} onChange={e => setF({ ...f, next_action_on: e.target.value })} disabled={lockedForStaff} /></Field>
                <Field label="Excise reference / receipt no."><Input value={f.excise_reference} onChange={e => setF({ ...f, excise_reference: e.target.value })} disabled={lockedForStaff} /></Field>
                <Field label="Submitted to Excise on"><Input type="date" max={today} value={f.excise_submitted_on} onChange={e => setF({ ...f, excise_submitted_on: e.target.value })} disabled={lockedForStaff} /></Field>
                <div className="sm:col-span-2"><Field label="Notes"><Textarea rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} disabled={lockedForStaff} /></Field></div>
              </div>
              {!lockedForStaff && <div className="flex justify-end mt-3"><Button onClick={saveDetails}>Save details</Button></div>}
            </Card>
          )}

          <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2"><ListChecks className="w-4 h-4 text-slate-500" /> Required documents</h3>
              <span className={`text-xs font-medium ${prog.complete ? 'text-emerald-600' : prog.missing ? 'text-amber-700' : 'text-slate-500'}`}>{prog.required ? `${prog.received} of ${prog.required} received` : 'No checklist yet'}</span>
            </div>
            {docs.length === 0 ? (
              <div className="text-sm text-slate-500 mb-3">No documents listed. <button onClick={addSuggested} className="underline text-amber-700">Add the suggested list for this service</button>, or add your own below.</div>
            ) : (
              <ul className="divide-y divide-slate-100 mb-3">
                {docs.map(d => (
                  <li key={d.id} className="flex items-center gap-3 py-2">
                    <input type="checkbox" checked={d.received} onChange={() => toggleDoc(d)} className="w-4 h-4" aria-label={`${d.label} received`} disabled={lockedForStaff} />
                    <div className="flex-1 min-w-0"><p className={`text-sm ${d.received ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{d.label}{!d.required && <span className="ml-2 text-[11px] text-slate-500 no-underline">optional</span>}</p>
                      {d.received_on && <p className="text-[11px] text-slate-500">received {formatDate(d.received_on)}</p>}</div>
                    <button onClick={() => toggleRequired(d)} disabled={lockedForStaff} className="text-[11px] text-slate-500 hover:text-slate-700">{d.required ? 'make optional' : 'make required'}</button>
                    {!lockedForStaff && <button onClick={() => removeDoc(d)} className="p-1.5 text-slate-300 hover:text-rose-500" aria-label={`Remove ${d.label}`}><Trash2 className="w-4 h-4" /></button>}
                  </li>
                ))}
              </ul>
            )}
            {!lockedForStaff && (
              <div className="flex gap-2">
                <Input value={newDoc} onChange={e => setNewDoc(e.target.value)} onKeyDown={e => e.key === 'Enter' && addDoc()} placeholder="Add a document, e.g. Original invoice" aria-label="New document" />
                <Button variant="secondary" onClick={addDoc} disabled={!newDoc.trim()}><Plus className="w-4 h-4" /> Add</Button>
              </div>
            )}
            {m3 && stage === 'submitted' && !prog.complete && prog.required > 0 && <p className="text-xs text-amber-700 mt-2 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Submitted to Excise with {prog.missing} required document{prog.missing === 1 ? '' : 's'} still missing.</p>}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4 sm:p-5">
            <h3 className="font-semibold text-slate-900 text-sm mb-3 flex items-center gap-2"><History className="w-4 h-4 text-slate-500" /> History</h3>
            {history.length === 0 ? <p className="text-sm text-slate-500">{m3 ? 'No changes recorded yet. Every stage, status and assignment change is listed here.' : 'Available after the M3 database update.'}</p> : (
              <ol className="space-y-3">
                {history.map(h => (
                  <li key={h.id} className="text-sm">
                    <p className="text-slate-900"><span className="text-slate-500">{FIELD_LABEL[h.field] ?? h.field}:</span> {h.field === 'stage' ? stageLabel(h.from_value) : h.from_value || '—'} → <b>{h.field === 'stage' ? stageLabel(h.to_value) : h.to_value}</b></p>
                    {h.note && <p className="text-xs text-slate-600">“{h.note}”</p>}
                    <p className="text-[11px] text-slate-500">{formatDateTime(h.changed_at)}{h.changed_by && nameOf(h.changed_by) ? ` · ${nameOf(h.changed_by)}` : ''}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <LinkedReminders links={{ case_id: row.id, client_id: row.client_id, label: row.case_no }} defaultTitle={`${row.case_no}: `} />

          {tasks.length > 0 && (
            <Card className="p-4 sm:p-5">
              <h3 className="font-semibold text-slate-900 text-sm mb-2">Linked tasks</h3>
              <ul className="space-y-1.5 text-sm">{tasks.map(t => <li key={t.id} className={t.status === 'completed' ? 'text-slate-500 line-through' : 'text-slate-800'}>{t.title}{t.due_date && <span className="text-xs text-slate-500"> · {formatDate(t.due_date)}</span>}</li>)}</ul>
            </Card>
          )}

          {m3 && (
            <Card className="p-4 sm:p-5">
              <h3 className="font-semibold text-slate-900 text-sm mb-2">Close or reopen</h3>
              <div className="flex flex-wrap gap-2">
                {!closed && <Button variant="secondary" onClick={cancelCase}><Ban className="w-4 h-4" /> Cancel case</Button>}
                {closed && canManage && <Button variant="secondary" onClick={reopen}><RotateCcw className="w-4 h-4" /> Reopen case</Button>}
              </div>
              <p className="text-xs text-slate-500 mt-2">A cancelled case needs a reason. To finish a case move it to Delivered.</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
