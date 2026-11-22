import { pkToday, compactDate } from '@/lib/time';
import SearchSelect from '@/components/SearchSelect';
import { takePrefill } from '@/lib/prefill';
import { useCan } from '@/lib/permissions';
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, TRANSFER_STATUSES, TRANSFER_DOCS, type TransferRow, type TransferStatus, type Client } from '@/lib/supabase';
import { PageHeader, Card, Spinner, EmptyState, Button, Field, Input, Select, Textarea } from '@/components/ui';
import { downloadCSV } from '@/lib/csv';
import { buildHaystack, matchesQuery } from '@/lib/search';
import { maskCnic } from '@/lib/cnic';
import { FORM_F_PREFILL_KEY, type FormFValues } from '@/lib/formF';
import type { Route } from '@/components/Layout';
import { Repeat, Plus, Search, X, Download, Trash2, Printer, ArrowRight } from 'lucide-react';
import { friendlyError } from '@/lib/errors';
import { fetchAll } from '@/lib/fetchAll';

const blank = {
  client_id: '', status: 'in_process' as TransferStatus,
  prev_reg_no: '', new_reg_no: '', maker: '', model: '', mfg_year: '', colour: '', chassis_no: '', engine_no: '', engine_cc: '',
  seller_name: '', seller_father: '', seller_cnic: '', seller_phone: '', seller_address: '', seller_care_of: '',
  buyer_name: '', buyer_father: '', buyer_cnic: '', buyer_phone: '', buyer_address: '', buyer_care_of: '',
  sale_date: '', transfer_date: '', govt_fee: '', service_charge: '', notes: '',
};
type FormState = typeof blank;

const up = (s: string) => s.toUpperCase();
const statusInfo = (s: string) => TRANSFER_STATUSES.find(x => x.value === s) ?? TRANSFER_STATUSES[0];
const docCount = (r: TransferRow) => TRANSFER_DOCS.filter(d => r.docs?.[d.key]).length;
function newTransferNo() {
  const ymd = compactDate();
  return `TR-${ymd}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}
const nul = (s: string) => (s.trim() ? s.trim() : null);

export default function Transfers({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TransferStatus>('all');
  const [editing, setEditing] = useState<TransferRow | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(blank);
  const [docs, setDocs] = useState<Record<string, boolean>>({});

  async function load() {
    setLoading(true);
    const [t, c] = await Promise.all([
      supabase.from('transfers').select('*').order('created_at', { ascending: false }),
      fetchAll<any>((a, b) => supabase.from('clients').select('*').order('name').order('id').range(a, b)),
    ]);
    if (t.error) setError(t.error.message.includes('transfers') ? 'The transfers table is missing. Run the new migration (20261108120000_transfers.sql) in Supabase.' : friendlyError(t.error));
    setRows((t.data as TransferRow[]) ?? []);
    setClients((c.data as Client[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);
  // Opened from Client 360: open a new transfer with the client's details already filled in as the buyer
  const pfRef = useRef<ReturnType<typeof takePrefill>>(null);
  useEffect(() => { if (!pfRef.current) pfRef.current = takePrefill(); }, []);   // taken once, also under React StrictMode's double run
  useEffect(() => {
    const pf = pfRef.current;
    if (loading || !pf?.clientId) return;
    pfRef.current = null;
    const c = clients.find(x => x.id === pf.clientId); if (!c) return;
    setForm({ ...blank, client_id: c.id, buyer_name: up(c.name), buyer_cnic: maskCnic(c.cnic ?? ''), buyer_phone: c.phone ?? '', buyer_address: c.address ?? '' });
    setDocs({}); setEditing('new');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const filtered = useMemo(() => rows.filter(r =>
    (statusFilter === 'all' || r.status === statusFilter) &&
    (!search.trim() || matchesQuery(search, buildHaystack([
      r.transfer_no, r.prev_reg_no, r.new_reg_no, r.maker, r.model, r.chassis_no, r.engine_no,
      r.seller_name, r.seller_cnic, r.seller_phone, r.buyer_name, r.buyer_cnic, r.buyer_phone, r.buyer_care_of, r.seller_care_of, r.notes,
    ]))),
  ), [rows, search, statusFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    TRANSFER_STATUSES.forEach(s => { c[s.value] = rows.filter(r => r.status === s.value).length; });
    return c;
  }, [rows]);

  // Earlier transfers of the same vehicle (same chassis, or the same registration number on either side)
  const history = useMemo(() => {
    if (!editing) return [];
    const ch = form.chassis_no.trim().toLowerCase(); const pr = form.prev_reg_no.trim().toLowerCase(); const nr = form.new_reg_no.trim().toLowerCase();
    return rows.filter(r => (editing === 'new' || r.id !== editing.id) && (
      (ch && r.chassis_no?.toLowerCase() === ch) ||
      (pr && (r.prev_reg_no?.toLowerCase() === pr || r.new_reg_no?.toLowerCase() === pr)) ||
      (nr && (r.prev_reg_no?.toLowerCase() === nr || r.new_reg_no?.toLowerCase() === nr))));
  }, [rows, editing, form.chassis_no, form.prev_reg_no, form.new_reg_no]);

  const set = (k: keyof FormState, v: string) => setForm(f => ({ ...f, [k]: v }));
  const txt = (k: keyof FormState, label: string, o: { upper?: boolean; ph?: string; type?: string } = {}) => (
    <Field label={label}><Input type={o.type} value={form[k] as string} placeholder={o.ph}
      onChange={e => set(k, o.upper ? up(e.target.value) : e.target.value)} /></Field>
  );

  function openNew() { setForm(blank); setDocs({}); setEditing('new'); setError(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function openEdit(r: TransferRow) {
    const f: Record<string, string> = {};
    (Object.keys(blank) as (keyof FormState)[]).forEach(k => { const val = (r as unknown as Record<string, unknown>)[k === 'mfg_year' ? 'mfg_year' : k]; f[k] = val == null ? '' : String(val); });
    f.status = r.status; f.govt_fee = r.govt_fee ? String(r.govt_fee) : ''; f.service_charge = r.service_charge ? String(r.service_charge) : '';
    setForm(f as unknown as FormState); setDocs(r.docs ?? {}); setEditing(r); setError(''); window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function fillBuyerFromClient(id: string) {
    set('client_id', id);
    const c = clients.find(x => x.id === id); if (!c) return;
    setForm(f => ({ ...f, client_id: id, buyer_name: up(c.name), buyer_cnic: maskCnic(c.cnic ?? ''), buyer_phone: c.phone ?? '', buyer_address: c.address ?? '' }));
  }

  async function save() {
    if (!form.prev_reg_no.trim() && !form.new_reg_no.trim() && !form.chassis_no.trim()) { setError('Enter at least the previous number, the new number or the chassis number.'); return; }
    const payload = {
      client_id: form.client_id || null, status: form.status,
      prev_reg_no: nul(up(form.prev_reg_no)), new_reg_no: nul(up(form.new_reg_no)),
      maker: nul(form.maker), model: nul(form.model), mfg_year: form.mfg_year ? Number(form.mfg_year) : null, colour: nul(form.colour),
      chassis_no: nul(up(form.chassis_no)), engine_no: nul(up(form.engine_no)), engine_cc: form.engine_cc ? Number(form.engine_cc) : null,
      seller_name: nul(form.seller_name), seller_father: nul(form.seller_father), seller_cnic: nul(form.seller_cnic), seller_phone: nul(form.seller_phone),
      seller_address: nul(form.seller_address), seller_care_of: nul(form.seller_care_of),
      buyer_name: nul(form.buyer_name), buyer_father: nul(form.buyer_father), buyer_cnic: nul(form.buyer_cnic), buyer_phone: nul(form.buyer_phone),
      buyer_address: nul(form.buyer_address), buyer_care_of: nul(form.buyer_care_of),
      sale_date: form.sale_date || null,
      transfer_date: form.transfer_date || (form.status === 'completed' ? pkToday() : null),
      govt_fee: Number(form.govt_fee) || 0, service_charge: Number(form.service_charge) || 0,
      docs, notes: nul(form.notes),
    };
    const res = editing === 'new'
      ? await supabase.from('transfers').insert({ ...payload, transfer_no: newTransferNo() })
      : await supabase.from('transfers').update(payload).eq('id', (editing as TransferRow).id);
    if (res.error) { setError(friendlyError(res.error)); return; }
    setEditing(null); setError(''); load();
  }

  const canDelete = useCan('manager');
  async function remove(r: TransferRow) {
    if (!confirm(`Delete transfer ${r.transfer_no}?`)) return;
    const { error: e } = await supabase.from('transfers').delete().eq('id', r.id);
    if (e) setError(e.message); else setRows(rs => rs.filter(x => x.id !== r.id));
  }

  // Open Form F with the buyer (new owner) and the vehicle already filled in
  function makeFormF(r: TransferRow) {
    const v: Partial<FormFValues> = {
      full_name: up(r.buyer_name ?? ''), father_name: up(r.buyer_father ?? ''),
      postal_address: r.buyer_address ?? '', permanent_address: r.buyer_address ?? '',
      phone: r.buyer_phone ?? '', cnic: r.buyer_cnic ?? '',
      maker: r.maker ?? '', make: r.model ?? '', year: r.mfg_year ? String(r.mfg_year) : '', colour: r.colour ?? '',
      chassis: r.chassis_no ?? '', engine_no: r.engine_no ?? '', cc: r.engine_cc ? String(r.engine_cc) : '', ownership: 'Private',
      prev_reg: r.prev_reg_no ?? '',
    };
    try { sessionStorage.setItem(FORM_F_PREFILL_KEY, JSON.stringify(v)); } catch { /* storage blocked: the page just opens empty */ }
    onNavigate('form-f');
  }

  function exportCsv() {
    downloadCSV('transfers.csv', [
      ['Transfer No', 'Status', 'Previous Reg No', 'New Reg No', 'Maker', 'Model', 'Year', 'Colour', 'Chassis', 'Engine No', 'CC',
        'Seller', 'Seller Father', 'Seller CNIC', 'Seller Phone', 'Seller C/O', 'Seller Address',
        'Buyer', 'Buyer Father', 'Buyer CNIC', 'Buyer Phone', 'Buyer C/O', 'Buyer Address',
        'Sale Date', 'Transfer Date', 'Govt Fee', 'Service Charge', 'Documents', 'Notes'],
      ...filtered.map(r => [r.transfer_no, statusInfo(r.status).label, r.prev_reg_no, r.new_reg_no, r.maker, r.model, r.mfg_year, r.colour, r.chassis_no, r.engine_no, r.engine_cc,
        r.seller_name, r.seller_father, r.seller_cnic, r.seller_phone, r.seller_care_of, r.seller_address,
        r.buyer_name, r.buyer_father, r.buyer_cnic, r.buyer_phone, r.buyer_care_of, r.buyer_address,
        r.sale_date, r.transfer_date, r.govt_fee, r.service_charge, `${docCount(r)}/${TRANSFER_DOCS.length}`, r.notes]),
    ]);
  }

  if (loading) return <Spinner label="Loading transfers..." />;

  return (
    <>
      <PageHeader title="Transfers" subtitle={`${rows.length} vehicle transfers recorded`}
        action={<div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={exportCsv}><Download className="w-4 h-4" /> Export</Button>
          <Button onClick={openNew}><Plus className="w-4 h-4" /> New Transfer</Button>
        </div>} />
      {error && <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>}

      {editing && (
        <Card className="p-4 sm:p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">{editing === 'new' ? 'New Transfer' : `Edit Transfer ${editing.transfer_no}`}</h2>
            <button onClick={() => setEditing(null)} className="text-slate-500 hover:text-slate-600" aria-label="Close"><X className="w-4 h-4" /></button>
          </div>

          {history.length > 0 && (
            <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900">
              <div className="font-medium mb-1">This vehicle was transferred before ({history.length})</div>
              {history.map(h => (
                <div key={h.id} className="text-xs">{h.transfer_no}: {h.prev_reg_no || '?'} → {h.new_reg_no || '?'} · {h.seller_name || '?'} to {h.buyer_name || '?'}{h.transfer_date ? ` · ${h.transfer_date}` : ''}</div>
              ))}
            </div>
          )}

          <h3 className="text-sm font-semibold text-slate-800 mb-2">Registration numbers and vehicle</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
            {txt('prev_reg_no', 'Previous number (old)', { upper: true, ph: 'LEA-21-1234' })}
            {txt('new_reg_no', 'New number (after transfer)', { upper: true, ph: 'LEB-26-5678' })}
            {txt('maker', 'Maker', { ph: 'Toyota' })}
            {txt('model', 'Model / Make', { ph: 'Corolla' })}
            {txt('mfg_year', 'Year', { type: 'number' })}
            {txt('colour', 'Colour')}
            {txt('chassis_no', 'Chassis number', { upper: true })}
            {txt('engine_no', 'Engine number', { upper: true })}
            {txt('engine_cc', 'Engine CC', { type: 'number' })}
          </div>

          <h3 className="text-sm font-semibold text-slate-800 mb-2">Seller (old owner)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
            {txt('seller_name', 'Name', { upper: true })}
            {txt('seller_father', 'Father / Husband name', { upper: true })}
            <Field label="CNIC"><Input value={form.seller_cnic} inputMode="numeric" placeholder="12345-1234567-1" onChange={e => set('seller_cnic', maskCnic(e.target.value))} /></Field>
            {txt('seller_phone', 'Phone')}
            {txt('seller_care_of', 'C/O (care of)')}
            {txt('seller_address', 'Address')}
          </div>

          <h3 className="text-sm font-semibold text-slate-800 mb-2">Buyer (new owner)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
            <Field label="Fill from saved client (optional)">
              <SearchSelect value={form.client_id} onChange={fillBuyerFromClient} emptyLabel="Select client" options={clients.map(c => ({ value: c.id, label: c.name, hint: c.cnic ?? c.phone ?? undefined }))} />
            </Field>
            <div className="hidden sm:block" />
            {txt('buyer_name', 'Name', { upper: true })}
            {txt('buyer_father', 'Father / Husband name', { upper: true })}
            <Field label="CNIC"><Input value={form.buyer_cnic} inputMode="numeric" placeholder="12345-1234567-1" onChange={e => set('buyer_cnic', maskCnic(e.target.value))} /></Field>
            {txt('buyer_phone', 'Phone')}
            {txt('buyer_care_of', 'C/O (care of)')}
            {txt('buyer_address', 'Address')}
          </div>

          <h3 className="text-sm font-semibold text-slate-800 mb-2">Status, dates and fees</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
            <Field label="Status">
              <Select value={form.status} onChange={e => set('status', e.target.value)}>
                {TRANSFER_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </Select>
            </Field>
            {txt('sale_date', 'Sale date (buyer took the car)', { type: 'date' })}
            {txt('transfer_date', 'Transfer completed on', { type: 'date' })}
            {txt('govt_fee', 'Government fee paid (Rs)', { type: 'number' })}
            {txt('service_charge', 'Our service charge (Rs)', { type: 'number' })}
          </div>

          <h3 className="text-sm font-semibold text-slate-800 mb-2">Documents ({TRANSFER_DOCS.filter(d => docs[d.key]).length}/{TRANSFER_DOCS.length})</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mb-5">
            {TRANSFER_DOCS.map(d => (
              <label key={d.key} className="flex items-center gap-2 py-1.5 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 accent-amber-600" checked={!!docs[d.key]} onChange={e => setDocs(p => ({ ...p, [d.key]: e.target.checked }))} />
                {d.label}
              </label>
            ))}
          </div>

          <Field label="Notes"><Textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save}>Save Transfer</Button>
          </div>
        </Card>
      )}

      <Card className="p-4 mb-4">
        <div className="flex flex-wrap gap-2 mb-3">
          {([['all', 'All'], ...TRANSFER_STATUSES.map(s => [s.value, s.label])] as [string, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setStatusFilter(k as 'all' | TransferStatus)}
              className={`px-3 py-1 rounded-full text-xs font-medium border ${statusFilter === k ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-300'}`}>
              {label} ({counts[k] ?? 0})
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search old or new number, chassis, name, CNIC, phone, c/o..."
            className="w-full pl-10 pr-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30" />
        </div>
      </Card>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? <EmptyState icon={Repeat} title={rows.length ? 'No transfer matches' : 'No transfers recorded yet'} subtitle={rows.length ? undefined : 'Tap New Transfer to record the first one.'} /> : (
          <div className="divide-y divide-slate-100">
            {filtered.map(r => {
              const st = statusInfo(r.status);
              return (
                <div key={r.id} className="px-4 py-3 hover:bg-slate-50">
                  <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                    <button onClick={() => openEdit(r)} className="flex-1 min-w-[14rem] text-left">
                      <p className="text-sm font-semibold text-slate-900 flex flex-wrap items-center gap-1.5">
                        <span>{r.prev_reg_no || 'No old number'}</span><ArrowRight className="w-3.5 h-3.5 text-slate-500" /><span>{r.new_reg_no || 'No new number'}</span>
                      </p>
                      <p className="text-sm text-slate-600">{[r.maker, r.model, r.mfg_year, r.colour].filter(Boolean).join(' ') || 'No vehicle details'}{r.chassis_no ? ` · Chassis ${r.chassis_no}` : ''}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {r.seller_name || '?'} → {r.buyer_name || '?'}{r.buyer_care_of ? ` (C/O ${r.buyer_care_of})` : ''}
                        {r.transfer_date ? ` · ${r.transfer_date}` : r.sale_date ? ` · sold ${r.sale_date}` : ''}
                      </p>
                    </button>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
                      <span className="text-xs text-slate-500">{docCount(r)}/{TRANSFER_DOCS.length} docs</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <Button size="sm" variant="secondary" onClick={() => makeFormF(r)}><Printer className="w-3.5 h-3.5" /> Form F</Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>Edit</Button>
                    {canDelete && <button onClick={() => remove(r)} className="ml-auto p-2 text-slate-300 hover:text-rose-500" aria-label="Delete"><Trash2 className="w-4 h-4" /></button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
