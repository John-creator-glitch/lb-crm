import { pkToday } from '@/lib/time';
import SearchSelect from '@/components/SearchSelect';
import { takePrefill } from '@/lib/prefill';
import { useCan } from '@/lib/permissions';
import { useAuth } from '@/lib/auth';
import { useEffect, useMemo, useState } from 'react';
import { supabase, CASE_STATUSES, CASE_SERVICES, type CaseRow, type CaseStatus, type CaseService, type Client, type Vehicle, type Quotation } from '@/lib/supabase';
import { PAGE_SIZE, Pager, PageHeader, Card, Spinner, EmptyState, Button, Field, Input, Select, Textarea, Badge } from '@/components/ui';
import { formatDate, formatPKR } from '@/lib/format';
import { downloadCSV, newCaseNumber } from '@/lib/csv';
import { buildHaystack, matchesQuery } from '@/lib/search';
import { useDrillIds, DrillBanner } from '@/lib/drill';
import { stageLabel, CASE_PRIORITIES, docProgress, caseOverdue } from '@/lib/workflow';
import { FolderOpen, Plus, Search, X, Download, Trash2, Pencil, ChevronRight } from 'lucide-react';
import { friendlyError } from '@/lib/errors';
import { fetchAll } from '@/lib/fetchAll';

const blank = { client_id: '', vehicle_id: '', quotation_id: '', service_type: 'new_registration' as CaseService, status: 'pending' as CaseStatus, govt_fee: '', service_charge: '', notes: '' };

export default function Cases({ onOpen }: { onOpen?: (id: string) => void }) {
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<CaseRow[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [quotes, setQuotes] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | CaseStatus>('all');
  const [editing, setEditing] = useState<CaseRow | 'new' | null>(null);
  const [form, setForm] = useState(blank);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [people, setPeople] = useState<{ id: string; full_name: string }[]>([]);
  const [docs, setDocs] = useState<Record<string, { required: boolean; received: boolean }[]>>({});
  const [mine, setMine] = useState(false);

  async function load() {
    setLoading(true);
    const [c, cl, v, q, pp, dd] = await Promise.all([
      fetchAll<any>((a, b) => supabase.from('cases').select('*').order('created_at', { ascending: false }).order('id').range(a, b)),
      fetchAll<any>((a, b) => supabase.from('clients').select('*').order('name').order('id').range(a, b)),
      fetchAll<any>((a, b) => supabase.from('vehicles').select('*').order('id').range(a, b)),
      supabase.from('quotations').select('*').order('created_at', { ascending: false }).limit(300),
      supabase.from('profiles').select('id, full_name'),
      fetchAll<any>((a, b) => supabase.from('case_documents').select('case_id, required, received').order('id').range(a, b)),
    ]);
    setPeople((pp.data ?? []) as { id: string; full_name: string }[]);
    const dm: Record<string, { required: boolean; received: boolean }[]> = {};
    for (const d of (dd.data ?? []) as { case_id: string; required: boolean; received: boolean }[]) (dm[d.case_id] ??= []).push(d);
    setDocs(dm);
    if (c.error) setError(c.error.message.includes('cases') ? 'The cases table is missing. Run the new migration (20261107090000_crm_cases_tasks_inventory.sql) in Supabase.' : friendlyError(c.error));
    setRows((c.data as CaseRow[]) ?? []);
    setClients((cl.data as Client[]) ?? []);
    setVehicles((v.data as Vehicle[]) ?? []);
    setQuotes((q.data as Quotation[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);
  // Opened from Client 360: start a new case with the client (and vehicle) already chosen
  useEffect(() => { const p = takePrefill(); if (p) { setForm({ ...blank, client_id: p.clientId ?? '', vehicle_id: p.vehicleId ?? '' }); setEditing('new'); } }, []);

  const clientName = (id: string | null) => clients.find(c => c.id === id)?.name ?? '';
  const vehicleText = (id: string | null) => { const v = vehicles.find(x => x.id === id); return v ? [v.registration_number, v.company, v.model].filter(Boolean).join(' ') : ''; };
  const personName = (id: string | null | undefined) => people.find(p => p.id === id)?.full_name ?? '';
  const { user } = useAuth();
  const today = pkToday();
  const serviceLabel = (s: string) => CASE_SERVICES.find(x => x.value === s)?.label ?? s;

  const { ids: drillIds } = useDrillIds('cases');
  const filtered = useMemo(() => rows.filter(r =>
    (!drillIds || drillIds.has(r.id)) &&
    (statusFilter === 'all' || r.status === statusFilter) &&
    (!mine || r.assigned_to === user?.id) &&
    (!search.trim() || matchesQuery(search, buildHaystack([r.case_no, clientName(r.client_id), vehicleText(r.vehicle_id), serviceLabel(r.service_type), r.notes]))),
  ), [rows, search, statusFilter, mine, clients, vehicles, people, drillIds]);

  function openNew() { setForm(blank); setEditing('new'); }
  function openEdit(r: CaseRow) {
    setForm({ client_id: r.client_id ?? '', vehicle_id: r.vehicle_id ?? '', quotation_id: r.quotation_id ?? '', service_type: r.service_type, status: r.status, govt_fee: String(r.govt_fee || ''), service_charge: String(r.service_charge || ''), notes: r.notes ?? '' });
    setEditing(r);
  }

  function pickQuotation(id: string) {
    const q = quotes.find(x => x.id === id);
    if (!q) { setForm({ ...form, quotation_id: '' }); return; }
    setForm({
      ...form, quotation_id: id,
      client_id: q.client_id ?? form.client_id,
      vehicle_id: q.vehicle_id ?? form.vehicle_id,
      service_type: (q.transaction_type as CaseService) ?? form.service_type,
      govt_fee: String(q.subtotal_govt || ''),
      service_charge: String((q.subtotal_service || 0) + (q.subtotal_additional || 0) || ''),
    });
  }

  async function save() {
    const payload = {
      client_id: form.client_id || null, vehicle_id: form.vehicle_id || null, quotation_id: form.quotation_id || null,
      service_type: form.service_type, status: form.status,
      govt_fee: Number(form.govt_fee) || 0, service_charge: Number(form.service_charge) || 0,
      notes: form.notes || null,
      closed_on: form.status === 'completed' || form.status === 'cancelled' ? pkToday() : null,
    };
    const res = editing === 'new'
      ? await supabase.from('cases').insert({ ...payload, case_no: newCaseNumber() })
      : await supabase.from('cases').update(payload).eq('id', (editing as CaseRow).id);
    if (res.error) { setError(friendlyError(res.error)); return; }
    setEditing(null); setError(''); load();
  }

  const canDelete = useCan('manager');
  async function remove(r: CaseRow) {
    if (!confirm(`Delete case ${r.case_no}?`)) return;
    await supabase.from('cases').delete().eq('id', r.id);
    setRows(rs => rs.filter(x => x.id !== r.id));
  }

  async function bulkStatus(status: CaseStatus) {
    if (!picked.size) return;
    const closed = status === 'completed' || status === 'cancelled' ? pkToday() : null;
    await supabase.from('cases').update({ status, closed_on: closed }).in('id', [...picked]);
    setPicked(new Set()); load();
  }

  const togglePick = (id: string) => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  function exportCSV() {
    downloadCSV('cases.csv', [
      ['Case No', 'Client', 'Service', 'Vehicle', 'Status', 'Opened', 'Govt Fee', 'Service Charge'],
      ...filtered.map(r => [r.case_no, clientName(r.client_id), serviceLabel(r.service_type), vehicleText(r.vehicle_id), r.status, r.opened_on, r.govt_fee, r.service_charge]),
    ]);
  }

  if (loading) return <Spinner label="Loading cases..." />;
  const clientVehicles = vehicles.filter(v => !form.client_id || v.client_id === form.client_id);

  return (
    <>
      <DrillBanner route="cases" shown={drillIds ? rows.filter(r => drillIds.has(r.id)).length : undefined} />
      <PageHeader title="Cases" subtitle={`${rows.length} cases`}
        action={<div className="flex gap-2"><Button variant="secondary" onClick={exportCSV}><Download className="w-4 h-4" /> CSV</Button><Button onClick={openNew}><Plus className="w-4 h-4" /> New Case</Button></div>} />
      {error && <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>}

      {editing && (
        <Card className="p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">{editing === 'new' ? 'New Case' : `Edit ${editing.case_no}`}</h2>
            <button onClick={() => setEditing(null)} className="text-slate-500 hover:text-slate-600"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Field label="Link a quotation (fills client, vehicle and fees)">
                <Select value={form.quotation_id} onChange={e => pickQuotation(e.target.value)}>
                  <option value="">No quotation</option>
                  {quotes.map(q => <option key={q.id} value={q.id}>{q.quotation_number} · {clientName(q.client_id) || 'No client'} · {formatPKR(q.grand_total)}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Client">
              <SearchSelect value={form.client_id} onChange={v => setForm({ ...form, client_id: v, vehicle_id: '' })} emptyLabel="Select client" options={clients.map(c => ({ value: c.id, label: c.name, hint: c.phone ?? undefined }))} />
            </Field>
            <Field label="Vehicle">
              <Select value={form.vehicle_id} onChange={e => setForm({ ...form, vehicle_id: e.target.value })}>
                <option value="">Select vehicle</option>
                {clientVehicles.map(v => <option key={v.id} value={v.id}>{[v.registration_number, v.company, v.model].filter(Boolean).join(' ') || 'Unnamed vehicle'}</option>)}
              </Select>
            </Field>
            <Field label="Service">
              <Select value={form.service_type} onChange={e => setForm({ ...form, service_type: e.target.value as CaseService })}>
                {CASE_SERVICES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </Select>
            </Field>
            <Field label="Status">
              <Select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as CaseStatus })}>
                {CASE_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </Select>
            </Field>
            <Field label="Govt. Fee (PKR)"><Input type="number" value={form.govt_fee} onChange={e => setForm({ ...form, govt_fee: e.target.value })} /></Field>
            <Field label="Service Charge (PKR)"><Input type="number" value={form.service_charge} onChange={e => setForm({ ...form, service_charge: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Field label="Notes"><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field></div>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={save}>Save Case</Button>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search case, client, vehicle..."
              className="w-full pl-10 pr-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30" />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm">
            <option value="all">All status</option>
            {CASE_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-600 whitespace-nowrap"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> Assigned to me</label>
          {picked.size > 0 && (
            <select value="" onChange={e => bulkStatus(e.target.value as CaseStatus)} className="px-3 py-2 bg-amber-50 border border-amber-300 rounded-lg text-sm">
              <option value="">Set {picked.size} selected to...</option>
              {CASE_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? <EmptyState icon={FolderOpen} title="No cases found" subtitle="Create a case for each job you take on." /> : (
          <div className="divide-y divide-slate-100">
            {filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(r => {
              const st = CASE_STATUSES.find(s => s.value === r.status)!;
              return (
                <div key={r.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50">
                  <input type="checkbox" className="mt-1.5" checked={picked.has(r.id)} onChange={() => togglePick(r.id)} />
                  <button onClick={() => onOpen ? onOpen(r.id) : openEdit(r)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-slate-500">{r.case_no}</span>
                      <Badge className={st.color}>{st.label}</Badge>
                      {r.stage && <Badge className="bg-slate-100 text-slate-700">{stageLabel(r.stage)}</Badge>}
                      {r.priority && r.priority !== 'normal' && <Badge className={CASE_PRIORITIES.find(p => p.value === r.priority)?.color ?? ''}>{CASE_PRIORITIES.find(p => p.value === r.priority)?.label}</Badge>}
                      {caseOverdue(r, today) && <Badge className="bg-rose-100 text-rose-700">Overdue</Badge>}
                      <span className="text-sm font-medium text-slate-900">{serviceLabel(r.service_type)}</span>
                    </div>
                    <p className="text-sm text-slate-600 truncate">{clientName(r.client_id) || 'No client'}{vehicleText(r.vehicle_id) ? ` · ${vehicleText(r.vehicle_id)}` : ''}</p>
                    <p className="text-xs text-slate-500">{[personName(r.assigned_to) && `Assigned: ${personName(r.assigned_to)}`, r.due_date && `Due ${formatDate(r.due_date)}`, (() => { const p = docProgress(docs[r.id] ?? []); return p.required ? `Docs ${p.received}/${p.required}` : ''; })(), r.next_action && `Next: ${r.next_action}`].filter(Boolean).join(' · ')}</p>
                    <p className="text-xs text-slate-500">{formatDate(r.opened_on)} · Govt {formatPKR(r.govt_fee)} · Service {formatPKR(r.service_charge)}</p>
                  </button>
                  {onOpen && <button onClick={() => openEdit(r)} className="p-2 text-slate-300 hover:text-slate-600" aria-label="Edit fees and service"><Pencil className="w-4 h-4" /></button>}
                  {canDelete && <button onClick={() => remove(r)} className="p-2 text-slate-300 hover:text-rose-500" aria-label="Delete"><Trash2 className="w-4 h-4" /></button>}
                </div>
              );
            })}
          </div>
        )}
        <div className="px-4 pb-4"><Pager page={page} total={filtered.length} onPage={setPage} resetKey={filtered.length} /></div>
      </Card>
    </>
  );
}
