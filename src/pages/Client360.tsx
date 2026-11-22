import { pkToday } from '@/lib/time';
import { useEffect, useMemo, useState } from 'react';
import { supabase, QUOTATION_STATUSES, CASE_STATUSES, CASE_SERVICES, type Client, type ClientPayment, type Vehicle } from '@/lib/supabase';
import { PageHeader, Breadcrumbs, ContactActions, Card, EmptyState, Button, Field, Input, Select, Badge } from '@/components/ui';
import { usePageTitle } from '@/lib/pageTitle';
import { formatDate, formatPKR } from '@/lib/format';
import { downloadCSV } from '@/lib/csv';
import { useSettings } from '@/lib/settings';
import { buildLedger, payerOf, payState, NOT_BILLED, paidOnQuotation, unallocated, ageingFor, type LClient } from '@/lib/ledger';
import { useCan } from '@/lib/permissions';
import type { Prefill } from '@/lib/prefill';
import { buildActivity } from '@/lib/activity';
import { useDuplicates, useDupAck } from '@/lib/useDuplicates';
import DuplicateWarning from '@/components/DuplicateWarning';
import VehicleFields, { blankVehicle, vehicleToForm, vehiclePayload, vehicleProblem, type VehicleFormState } from '@/components/VehicleFields';
import { ClientForm, clientPayload, clientProblem, typeMeta, type AllData, type CType } from '@/components/clientShared';
import type { Route } from '@/components/Layout';
import { stageLabel } from '@/lib/workflow';
import { Phone, Mail, Plus, ArrowLeft, Car, FileText, MapPin, IdCard, Pencil, Wallet, Archive, Trash2, Printer, Download, Building2, UserRound, RotateCcw, ChevronRight, FolderOpen, Repeat, History, UserCheck, X, Link2 } from 'lucide-react';
import { friendlyError } from '@/lib/errors';
import DocumentsPanel from '@/components/DocumentsPanel';

const PAY_METHODS = ['Cash', 'Bank transfer', 'Easypaisa / JazzCash', 'Cheque', 'Other'];
const today = () => pkToday();
const esc = (t: string) => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
const vText = (v: Pick<Vehicle, 'registration_number' | 'company' | 'model' | 'manufacturing_year'>) => [v.registration_number, [v.company, v.model, v.manufacturing_year].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || 'Vehicle';

export type Client360Tab = 'overview' | 'vehicles' | 'quotations' | 'cases' | 'payments' | 'customers' | 'activity' | 'documents';

const KIND_STYLE: Record<string, string> = { client: 'bg-slate-100 text-slate-600', vehicle: 'bg-indigo-100 text-indigo-700', quotation: 'bg-amber-100 text-amber-700', case: 'bg-blue-100 text-blue-700', payment: 'bg-emerald-100 text-emerald-700', audit: 'bg-slate-100 text-slate-500' };

export default function Client360({ client, data, reload, onBack, onOpen, onOpenQuotation, onOpenCase, onStart, initialTab }: {
  client: Client; data: AllData; reload: () => Promise<void>; onBack: () => void; onOpen: (id: string) => void;
  onOpenQuotation?: (id: string) => void; onOpenCase?: (id: string) => void; onStart: (route: Route, prefill?: Prefill) => void; initialTab?: Client360Tab;
}) {
  const s = useSettings();
  const canManage = useCan('manager');
  const isOwner = useCan('admin');
  const parent = client.parent_id ? data.clients.find(c => c.id === client.parent_id) : undefined;
  const billedToParent = !!(client.bill_to_parent && parent);
  const children = data.clients.filter(c => c.parent_id === client.id);
  const isHub = client.client_type === 'showroom' || client.client_type === 'agent' || children.length > 0;
  const [tab, setTab] = useState<Client360Tab>(initialTab ?? 'overview');
  useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab, client.id]);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState({ amount: '', date: today(), method: 'Cash', reference: '', notes: '' });
  const [custOpen, setCustOpen] = useState(false);
  const [cust, setCust] = useState({ name: '', phone: '', care_of: '', bill: true });
  const formFrom = (c: Client) => ({ name: c.name, phone: c.phone ?? '', email: c.email ?? '', cnic: c.cnic ?? '', address: c.address ?? '', notes: c.notes ?? '', care_of: c.care_of ?? '', client_type: (c.client_type ?? 'direct') as CType, parent_id: c.parent_id ?? '', bill_to_parent: c.bill_to_parent ?? true, opening_balance: c.opening_balance ? String(c.opening_balance) : '', business_type: c.business_type ?? '' });
  const [form, setForm] = useState(() => formFrom(client));
  useEffect(() => { setForm(formFrom(client)); setEditing(false); setMsg(''); setErr(''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [client.id]);
  const parents = data.clients.filter(c => !c.archived_at && (c.client_type === 'showroom' || c.client_type === 'agent'));

  const lc: LClient[] = data.clients;
  const ledger = useMemo(() => buildLedger(client.id, { clients: lc, quotations: data.quotations, payments: data.payments, clientPayments: data.clientPayments }), [client.id, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const ageing = useMemo(() => ageingFor(client.id, { clients: lc, quotations: data.quotations, payments: data.payments, clientPayments: data.clientPayments }, today()), [client.id, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const ownQuotes = data.quotations.filter(q => q.client_id === client.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const hubQuotes = isHub ? data.quotations.filter(q => q.client_id && payerOf(data.clients.find(c => c.id === q.client_id)) === client.id && q.client_id !== client.id) : [];
  const quoteRows = [...ownQuotes, ...hubQuotes].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const paidOn = (qid: string) => paidOnQuotation(qid, { payments: data.payments, allocations: data.allocations }).paid;
  const [allocFor, setAllocFor] = useState<ClientPayment | null>(null);
  const [allocQ, setAllocQ] = useState('');
  const [allocAmt, setAllocAmt] = useState('');
  const vehicles = data.vehicles.filter(v => v.client_id === client.id);
  const childIds = new Set(children.map(c => c.id));
  const customerVehicles = data.vehicles.filter(v => v.client_id && childIds.has(v.client_id));
  const nameOf = (id: string | null) => data.clients.find(c => c.id === id)?.name ?? '';
  const caseRows = data.cases.filter(c => c.client_id === client.id || (isHub && c.client_id && childIds.has(c.client_id))).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const openCases = caseRows.filter(c => c.status === 'pending' || c.status === 'active').length;
  const openQuotes = ownQuotes.filter(q => q.status === 'pending' || q.status === 'approved').length;
  const assignee = data.profiles.find(p => p.id === client.assigned_to);
  const inactive = client.status === 'inactive';

  async function audit(action: string, details: Record<string, unknown>, entityType = 'client', entityId = client.id) {
    await supabase.from('audit_logs').insert({ action, entity_type: entityType, entity_id: entityId, details: { client_id: client.id, name: client.name, ...details } });
  }

  // ---- client details (edit) with duplicate warning ----
  const clientDup = useDuplicates(editing ? { phone: form.phone, cnic: form.cnic, excludeClient: client.id } : {});
  const clientAck = useDupAck(clientDup.result);
  async function save() {
    const problem = clientProblem(form); if (problem) { setErr(problem); return; }
    if (clientAck.needsConfirm) { clientAck.confirm(); setErr(''); return; }
    const { error } = await supabase.from('clients').update(clientPayload(form, data)).eq('id', client.id);
    if (error) { setErr('Could not save: ' + friendlyError(error)); return; }
    await audit('client_updated', {});
    setErr(''); setMsg('Saved.'); setEditing(false); await reload();
  }

  // ---- status and assignment ----
  async function setStatus(status: 'active' | 'inactive') {
    const { error } = await supabase.from('clients').update({ status }).eq('id', client.id);
    if (error) { setErr(friendlyError(error)); return; }
    await audit('client_status_changed', { status }); setErr(''); setMsg(status === 'inactive' ? 'Client marked inactive. All records stay.' : 'Client is active again.'); await reload();
  }
  async function assignTo(id: string) {
    const { error } = await supabase.from('clients').update({ assigned_to: id || null }).eq('id', client.id);
    if (error) { setErr(friendlyError(error)); return; }
    await audit('client_assigned', { assigned_to_name: data.profiles.find(p => p.id === id)?.full_name ?? 'nobody' }); setErr(''); setMsg('Assignment saved.'); await reload();
  }

  // ---- vehicles ----
  const [vEdit, setVEdit] = useState<Vehicle | 'new' | null>(null);
  const [vForm, setVForm] = useState<VehicleFormState>(blankVehicle(client.id));
  const [vErr, setVErr] = useState('');
  const vDup = useDuplicates(vEdit ? { registration: vForm.registration_number, chassis: vForm.chassis_number, excludeVehicle: vEdit === 'new' ? null : vEdit.id } : {});
  const vAck = useDupAck(vDup.result);
  function openVehicleForm(v: Vehicle | 'new') { setVForm(v === 'new' ? blankVehicle(client.id) : vehicleToForm(v)); setVEdit(v); setVErr(''); setTab('vehicles'); }
  async function saveVehicle() {
    const problem = vehicleProblem(vForm); if (problem) { setVErr(problem); return; }
    if (vAck.needsConfirm) { vAck.confirm(); setVErr(''); return; }
    const payload = vehiclePayload({ ...vForm, client_id: vEdit === 'new' ? client.id : vForm.client_id }, data.m2);
    if (vEdit === 'new') {
      const { data: row, error } = await supabase.from('vehicles').insert(payload).select().maybeSingle();
      if (error || !row) { setVErr('Vehicle was not saved: ' + (error?.message ?? 'no row returned') + '. Nothing was changed.'); return; }
      await audit('vehicle_added', { registration: vForm.registration_number.trim().toUpperCase() }, 'vehicle', (row as Vehicle).id);
    } else {
      const { error } = await supabase.from('vehicles').update(payload).eq('id', vEdit!.id);
      if (error) { setVErr('Vehicle was not saved: ' + friendlyError(error)); return; }
      await audit('vehicle_updated', { registration: vForm.registration_number.trim().toUpperCase() }, 'vehicle', vEdit!.id);
    }
    setVEdit(null); setVErr(''); setMsg('Vehicle saved.'); await reload();
  }
  async function deleteVehicle(v: Vehicle) {
    const q = data.quotations.filter(x => x.vehicle_id === v.id).length; const c = data.cases.filter(x => x.vehicle_id === v.id).length;
    if (!window.confirm(`Delete ${vText(v)}?${q || c ? `\n\n${q} quotation(s) and ${c} case(s) use this vehicle. They stay, but will show no vehicle.` : ''}`)) return;
    const { error } = await supabase.from('vehicles').delete().eq('id', v.id);
    if (error) { setErr(friendlyError(error)); return; }
    await audit('vehicle_deleted', { registration: v.registration_number ?? '' }, 'vehicle', v.id); await reload();
  }

  // ---- payments (unchanged rules from the client ledger) ----
  async function recordPayment() {
    const amount = Number(pay.amount);
    if (!(amount > 0)) { setErr('Enter the amount received.'); return; }
    const { data: row, error } = await supabase.from('client_payments').insert({ client_id: client.id, amount, payment_date: pay.date, payment_method: pay.method, reference: pay.reference || null, notes: pay.notes || null }).select().maybeSingle();
    if (error || !row) { setErr('Could not record payment: ' + (error?.message ?? 'unknown')); return; }
    await audit('client_payment_recorded', { amount, method: pay.method });
    setErr(''); setMsg(`Payment of ${formatPKR(amount)} recorded.`); setPayOpen(false); setPay({ amount: '', date: today(), method: 'Cash', reference: '', notes: '' });
    await reload();
    printReceipt(row as ClientPayment);
  }

  /** Wrong payments are reversed (kept in the statement, counted for nothing), never deleted. */
  async function reversePayment(kind: 'quotation' | 'on_account', id: string, amount: number) {
    const why = window.prompt(`Reverse this payment of ${formatPKR(amount)}? The pending balance will go up by that amount and the payment stays in the statement as reversed.\n\nReason (required):`);
    if (why === null) return;
    if (!why.trim()) { setErr('A reason is needed to reverse a payment.'); return; }
    const { error } = await supabase.rpc('reverse_payment', { p_kind: kind, p_id: id, p_reason: why.trim() });
    if (error) { setErr(friendlyError(error)); return; }
    setErr(''); setMsg(`Payment of ${formatPKR(amount)} reversed.`);
    await reload();
  }

  /** Open candidates for an on-account payment: this account's billed quotations that still owe something. */
  const allocCandidates = (cp: ClientPayment) => data.quotations
    .filter(q => q.client_id && payerOf(data.clients.find(c => c.id === q.client_id)) === cp.client_id && !NOT_BILLED.has(q.status))
    .map(q => ({ q, out: q.grand_total - paidOn(q.id) })).filter(x => x.out > 0.004).sort((a, b) => a.q.created_at.localeCompare(b.q.created_at));
  function startAlloc(cp: ClientPayment) {
    const free = unallocated(cp, data.allocations); const first = allocCandidates(cp)[0];
    setAllocFor(cp); setAllocQ(first?.q.id ?? ''); setAllocAmt(first ? String(Math.min(free, first.out)) : '');
  }
  async function saveAlloc() {
    if (!allocFor || !allocQ) return;
    const { error } = await supabase.rpc('allocate_client_payment', { p_payment: allocFor.id, p_quotation: allocQ, p_amount: Number(allocAmt) });
    if (error) { setErr(friendlyError(error)); return; }
    setErr(''); setMsg('Payment allocated. The account balance is unchanged: this money was already counted when it was received.'); setAllocFor(null);
    await reload();
  }
  async function voidAlloc(id: string) {
    const why = window.prompt('Undo this allocation? Reason (required):');
    if (why === null) return; if (!why.trim()) { setErr('A reason is needed.'); return; }
    const { error } = await supabase.rpc('void_allocation', { p_id: id, p_reason: why.trim() });
    if (error) { setErr(friendlyError(error)); return; }
    setErr(''); await reload();
  }

  function printReceipt(p: ClientPayment) {
    const w = window.open('', '_blank', 'width=520,height=680');
    if (!w) { setMsg('Payment saved. Allow pop-ups to print the receipt.'); return; }
    const info = buildLedger(client.id, { clients: lc, quotations: data.quotations, payments: data.payments, clientPayments: [...data.clientPayments.filter(x => x.id !== p.id), p] });
    w.document.write(`<html><head><title>RC-${p.id.slice(0, 6).toUpperCase()}</title><style>body{font-family:Arial,sans-serif;padding:28px;color:#0f172a}h1{font-size:20px;margin:0}table{width:100%;border-collapse:collapse;margin-top:18px}td{padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:14px}td:first-child{color:#64748b;width:40%}.amt{font-size:22px;font-weight:700;margin-top:18px}</style></head><body>
      <h1>${esc(s.business_name)}</h1><p style="color:#64748b;margin:2px 0 18px">Payment Receipt</p>
      <table><tr><td>Receipt No</td><td>RC-${p.id.slice(0, 6).toUpperCase()}</td></tr><tr><td>Date</td><td>${formatDate(p.payment_date)}</td></tr>
      <tr><td>Received from</td><td>${esc(client.name)}</td></tr><tr><td>Mode</td><td>${esc(p.payment_method || '-')}</td></tr><tr><td>Reference</td><td>${esc(p.reference || '-')}</td></tr>
      <tr><td>Remaining balance</td><td>${info.pending > 0 ? formatPKR(info.pending) : info.pending < 0 ? formatPKR(-info.pending) + ' advance' : 'Nil (paid up)'}</td></tr></table>
      <p class="amt">${formatPKR(p.amount)}</p><script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  }

  function printStatement() {
    const w = window.open('', '_blank', 'width=900,height=720');
    if (!w) return;
    const rows = ledger.lines.map(l => `<tr><td>${l.date ? formatDate(l.date) : ''}</td><td>${esc(l.text)}${l.detail ? `<br><small>${esc(l.detail)}</small>` : ''}</td><td class="n">${l.debit ? formatPKR(l.debit) : ''}</td><td class="n">${l.credit ? formatPKR(l.credit) : ''}</td><td class="n">${formatPKR(l.balance)}</td></tr>`).join('');
    w.document.write(`<html><head><title>Statement ${esc(client.name)}</title><style>body{font-family:Arial,sans-serif;padding:28px;color:#0f172a;font-size:13px}h1{font-size:20px;margin:0}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:7px 6px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}th{background:#f1f5f9;font-size:12px}.n{text-align:right;white-space:nowrap}small{color:#64748b}.tot{margin-top:16px;font-size:15px;font-weight:700;text-align:right}</style></head><body>
      <h1>${esc(s.business_name)}</h1><p style="color:#64748b;margin:2px 0 4px">Account statement</p><p><b>${esc(client.name)}</b>${client.phone ? ' · ' + esc(client.phone) : ''}${client.care_of ? ' · C/O ' + esc(client.care_of) : ''}<br>Printed ${formatDate(today())}</p>
      <table><tr><th>Date</th><th>Description</th><th class="n">Billed</th><th class="n">Received</th><th class="n">Balance</th></tr>${rows}</table>
      <p class="tot">Billed ${formatPKR(ledger.billed + Math.max(0, ledger.opening))} · Received ${formatPKR(ledger.received)} · ${ledger.pending >= 0 ? 'Pending' : 'Advance'} ${formatPKR(Math.abs(ledger.pending))}</p>
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  }

  function exportLedger() {
    downloadCSV(`ledger-${client.name.replace(/\s+/g, '_')}.csv`, [['Date', 'Description', 'Detail', 'Billed', 'Received', 'Balance'], ...ledger.lines.map(l => [l.date, l.text, l.detail, l.debit || '', l.credit || '', l.balance])]);
  }

  async function toggleArchive() {
    const archiving = !client.archived_at;
    if (archiving && ledger.pending > 0 && !window.confirm(`${client.name} still has ${formatPKR(ledger.pending)} pending. Archive anyway? Nothing is deleted, you can bring the client back any time.`)) return;
    const { error } = await supabase.from('clients').update({ archived_at: archiving ? new Date().toISOString() : null }).eq('id', client.id);
    if (error) { setErr(friendlyError(error)); return; }
    await audit(archiving ? 'client_archived' : 'client_restored', {});
    await reload(); if (archiving) onBack();
  }

  async function deleteClient() {
    const hasQuotes = data.quotations.some(q => q.client_id === client.id);
    const hasPays = data.clientPayments.some(p => p.client_id === client.id);
    if (hasQuotes || hasPays || children.length) {
      setErr(`${client.name} cannot be deleted because ${[hasQuotes && 'quotations', hasPays && 'payments', children.length && 'linked customers'].filter(Boolean).join(', ')} are attached. Deleting would break the ledger. Use Archive instead: the client disappears from the list but all records stay safe.`);
      return;
    }
    const t = await supabase.from('transfers').select('id', { count: 'exact', head: true }).eq('client_id', client.id);
    const links = [vehicles.length && `${vehicles.length} vehicle(s)`, t.count && `${t.count} transfer(s)`, caseRows.length && `${caseRows.length} case(s)`].filter(Boolean).join(', ');
    if (!window.confirm(`Permanently delete ${client.name}? This cannot be undone.${links ? `\n\n${links} will stay but will no longer be linked to a client.` : ''}\n\nTip: take a backup first.`)) return;
    const { error } = await supabase.from('clients').delete().eq('id', client.id);
    if (error) { setErr(friendlyError(error)); return; }
    await supabase.from('audit_logs').insert({ action: 'client_deleted', entity_type: 'client', entity_id: client.id, details: { name: client.name } });
    await reload(); onBack();
  }

  async function addCustomer() {
    if (!cust.name.trim()) return;
    const { error } = await supabase.from('clients').insert({ name: cust.name.trim(), phone: cust.phone || null, care_of: cust.care_of.trim() || null, client_type: 'direct', parent_id: client.id, bill_to_parent: cust.bill });
    if (error) { setErr(friendlyError(error)); return; }
    setCust({ name: '', phone: '', care_of: '', bill: true }); setCustOpen(false); setErr(''); await reload();
  }

  // ---- activity ----
  const [auditRows, setAuditRows] = useState<{ id: string; action: string; details: Record<string, unknown> | null; created_at: string }[]>([]);
  useEffect(() => {
    if (tab !== 'activity' || !isOwner) return;
    let off = false;
    supabase.from('audit_logs').select('id, action, details, created_at').or(`entity_id.eq.${client.id},details->>client_id.eq.${client.id}`).order('created_at', { ascending: false }).limit(60)
      .then(({ data: rows }) => { if (!off) setAuditRows((rows ?? []) as typeof auditRows); });
    return () => { off = true; };
  }, [tab, client.id, isOwner, data]);
  const activity = useMemo(() => buildActivity({
    client, vehicles, quotations: ownQuotes, cases: caseRows,
    payments: [
      ...data.clientPayments.filter(p => p.client_id === client.id).map(p => ({ id: 'c' + p.id, amount: p.amount, payment_date: p.payment_date, created_at: p.created_at, text: 'Payment received (on account)', detail: formatPKR(p.amount) })),
      ...data.payments.filter(p => ownQuotes.some(q => q.id === p.quotation_id)).map(p => ({ id: 'q' + p.id, amount: p.amount, payment_date: p.payment_date, created_at: p.created_at, text: `Payment for ${ownQuotes.find(q => q.id === p.quotation_id)?.quotation_number ?? 'quotation'}`, detail: formatPKR(p.amount) })),
    ],
    audit: auditRows,
  }), [client, vehicles, ownQuotes, caseRows, data, auditRows]);

  const tabs: [Client360Tab, string][] = [
    ['overview', 'Overview'], ['vehicles', `Vehicles (${vehicles.length})`], ['quotations', `Quotations (${quoteRows.length})`], ['cases', `Cases (${caseRows.length})`],
    ['payments', 'Payments'], ['documents', 'Files'], ...(isHub ? [['customers', `Customers (${children.length})`] as [Client360Tab, string]] : []), ['activity', 'Activity'],
  ];
  const t = typeMeta(client.client_type);
  usePageTitle(client.name);
  const go = (route: Route, p?: Prefill) => onStart(route, p ?? { clientId: client.id });

  return (
    <>
      <Breadcrumbs items={[{ label: 'Clients', onClick: onBack }, { label: client.name }]} />
      <PageHeader title={client.name}
        subtitle={[t.label, client.business_type, client.care_of && `C/O ${client.care_of}`, parent && `via ${parent.name}`, assignee && `assigned to ${assignee.full_name}`, `client since ${formatDate(client.created_at)}`, inactive && 'INACTIVE', client.archived_at && 'ARCHIVED'].filter(Boolean).join(' · ')}
        action={<div className="flex flex-wrap gap-2">
          <Button onClick={() => go('calculator')}><Plus className="w-4 h-4" /> Quotation</Button>
          <Button variant="secondary" onClick={() => go('cases')}><FolderOpen className="w-4 h-4" /> Case</Button>
          <Button variant="secondary" onClick={() => go('transfers')}><Repeat className="w-4 h-4" /> Transfer</Button>
          {data.migrated && !billedToParent && <Button variant="secondary" onClick={() => { setPayOpen(true); setTab('payments'); }}><Wallet className="w-4 h-4" /> Payment</Button>}
        </div>} />
      {msg && <p className="text-sm text-emerald-700 mb-3" role="status">{msg}</p>}
      {err && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">{err}</div>}

      <div className="flex gap-1 border-b border-slate-200 mb-4 overflow-x-auto" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition ${tab === k ? 'border-amber-500 text-amber-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{l}</button>)}
      </div>

      {/* ================= OVERVIEW ================= */}
      {tab === 'overview' && (
        <>
          <Card className={`p-4 mb-4 text-sm ${billedToParent ? 'bg-indigo-50 border-indigo-200 text-indigo-900' : 'bg-slate-50'}`}>
            <p className="font-semibold flex items-center gap-2 mb-1"><Link2 className="w-4 h-4" /> Relationship and billing</p>
            {parent ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>Came through <b>{parent.name}</b> ({typeMeta(parent.client_type).label}). {client.bill_to_parent ? <>Bills go to <b>{parent.name}</b>'s account and payments are recorded there.</> : <>This client <b>pays by themselves</b>; the showroom is only shown for reference.</>}</span>
                <Button size="sm" variant="secondary" onClick={() => onOpen(parent.id)}>Open {parent.name}</Button>
              </div>
            ) : isHub ? (
              <span>{t.label} with <b>{children.length}</b> linked customer{children.length === 1 ? '' : 's'}. {children.filter(c => c.bill_to_parent).length} of them are billed to this account, so this ledger covers all their quotations.</span>
            ) : (
              <span>Independent client. <b>Pays by themselves</b>; all bills and payments are in this client's own account.</span>
            )}
          </Card>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <button onClick={() => setTab('vehicles')} className="text-left"><Card className="p-3 sm:p-4 hover:border-amber-300 transition"><p className="text-[11px] sm:text-xs text-slate-500">Vehicles</p><p className="text-xl font-bold text-slate-900">{vehicles.length}</p></Card></button>
            <button onClick={() => setTab('quotations')} className="text-left"><Card className="p-3 sm:p-4 hover:border-amber-300 transition"><p className="text-[11px] sm:text-xs text-slate-500">Open quotations</p><p className="text-xl font-bold text-slate-900">{openQuotes}<span className="text-xs font-normal text-slate-500"> of {ownQuotes.length}</span></p></Card></button>
            <button onClick={() => setTab('cases')} className="text-left"><Card className="p-3 sm:p-4 hover:border-amber-300 transition"><p className="text-[11px] sm:text-xs text-slate-500">Active cases</p><p className="text-xl font-bold text-slate-900">{openCases}<span className="text-xs font-normal text-slate-500"> of {caseRows.length}</span></p></Card></button>
            <button onClick={() => setTab('payments')} className="text-left"><Card className="p-3 sm:p-4 hover:border-amber-300 transition">
              <p className="text-[11px] sm:text-xs text-slate-500">{billedToParent ? 'Account' : ledger.pending < 0 ? 'Advance' : 'Pending'}</p>
              {billedToParent ? <p className="text-sm font-semibold text-indigo-700">with {parent?.name}</p> : <p className={`text-xl font-bold tabular-nums ${ledger.pending > 0 ? 'text-rose-600' : ledger.pending < 0 ? 'text-blue-600' : 'text-emerald-600'}`}>{formatPKR(Math.abs(ledger.pending))}</p>}
            </Card></button>
          </div>

          <Card className="p-4 sm:p-5 mb-4">
            {editing ? (
              <>
                <ClientForm form={form} setForm={setForm} parents={parents} migrated={data.migrated} m2={data.m2} selfId={client.id} />
                <div className="mt-4 space-y-3">
                  <DuplicateWarning result={clientDup.result} checking={clientDup.checking} onOpenClient={onOpen} acknowledged={!clientAck.needsConfirm} />
                  <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => { setEditing(false); setForm(formFrom(client)); setErr(''); }}>Cancel</Button><Button onClick={save} disabled={!form.name.trim()}>{clientAck.needsConfirm ? 'Save (I checked the duplicate)' : 'Save changes'}</Button></div>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-end -mt-1 mb-2"><Button size="sm" variant="secondary" onClick={() => setEditing(true)}><Pencil className="w-4 h-4" /> Edit</Button></div>
                <div className="grid sm:grid-cols-2 gap-3 text-sm text-slate-700">
                  <div className="flex items-center gap-2"><Phone className="w-4 h-4 text-slate-500" />{client.phone || '—'}</div>
                  <ContactActions phone={client.phone} whatsappText={`Assalam o Alaikum ${client.name},`} className="mt-1" />
                  <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-slate-500" />{client.email || '—'}</div>
                  <div className="flex items-center gap-2"><IdCard className="w-4 h-4 text-slate-500" />{client.cnic || '—'}</div>
                  <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-slate-500" />{client.address || '—'}</div>
                  {client.care_of && <div className="flex items-center gap-2"><UserRound className="w-4 h-4 text-slate-500" />C/O {client.care_of}</div>}
                  {client.business_type && <div className="flex items-center gap-2"><Building2 className="w-4 h-4 text-slate-500" />{client.business_type}</div>}
                  {!billedToParent && client.opening_balance ? <div className="text-slate-500">Opening balance: {formatPKR(client.opening_balance)}</div> : null}
                  {client.notes && <div className="sm:col-span-2 text-slate-500">{client.notes}</div>}
                </div>
              </>
            )}
          </Card>

          <Card className="p-4 sm:p-5 mb-4">
            <h3 className="font-semibold text-slate-900 text-sm mb-3 flex items-center gap-2"><UserCheck className="w-4 h-4 text-slate-500" /> Status and assignment</h3>
            {!data.m2 ? <p className="text-sm text-amber-800">Switch on Client 360 first: run <span className="font-mono text-xs">20261117090000_m2_client_360_vehicles.sql</span> once in the Supabase SQL Editor.</p> : (
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Status" hint="Inactive clients stay in every list and ledger, they are only marked.">
                  <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1" role="radiogroup" aria-label="Client status">
                    {(['active', 'inactive'] as const).map(st => <button key={st} type="button" role="radio" aria-checked={(client.status ?? 'active') === st} onClick={() => (client.status ?? 'active') !== st && setStatus(st)} className={`px-2 py-2 text-sm font-medium rounded-md transition capitalize ${(client.status ?? 'active') === st ? 'bg-white text-amber-700 shadow-sm ring-1 ring-amber-300' : 'text-slate-500'}`}>{st}</button>)}
                  </div>
                </Field>
                <Field label="Assigned to" hint={canManage ? 'The staff member who looks after this client.' : 'Only a manager or the owner can change this.'}>
                  <Select value={client.assigned_to ?? ''} onChange={e => assignTo(e.target.value)} disabled={!canManage}>
                    <option value="">Not assigned</option>
                    {data.profiles.filter(p => p.active !== false || p.id === client.assigned_to).map(p => <option key={p.id} value={p.id}>{p.full_name || 'Unnamed user'}</option>)}
                  </Select>
                </Field>
              </div>
            )}
          </Card>

          <Card className="p-4 border-slate-200">
            <h3 className="font-semibold text-slate-900 text-sm mb-1">Archive or delete</h3>
            <p className="text-xs text-slate-500 mb-3">Archive hides the client from the list but keeps every quotation, payment and ledger entry. Delete is only possible for a client with no quotations or payments.</p>
            <div className="flex flex-wrap gap-2">
              {data.migrated && <Button variant="secondary" onClick={toggleArchive}>{client.archived_at ? <><RotateCcw className="w-4 h-4" /> Bring back</> : <><Archive className="w-4 h-4" /> Archive client</>}</Button>}
              {canManage && <Button variant="danger" onClick={deleteClient}><Trash2 className="w-4 h-4" /> Delete client</Button>}
            </div>
          </Card>
        </>
      )}

      {/* ================= VEHICLES ================= */}
      {tab === 'vehicles' && (
        <>
          <div className="flex justify-between items-center mb-3">
            <p className="text-sm text-slate-500">{vehicles.length === 0 ? 'No vehicle yet.' : `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'} of ${client.name}.`} One client can have many vehicles.</p>
            <Button size="sm" onClick={() => openVehicleForm('new')}><Plus className="w-4 h-4" /> Add vehicle</Button>
          </div>
          {vEdit && (
            <Card className="p-4 sm:p-5 mb-4">
              <div className="flex items-center justify-between mb-4"><h2 className="font-semibold text-slate-900">{vEdit === 'new' ? `New vehicle for ${client.name}` : 'Edit vehicle'}</h2><button onClick={() => setVEdit(null)} className="p-1 text-slate-500 hover:text-slate-600" aria-label="Close"><X className="w-4 h-4" /></button></div>
              <VehicleFields form={vForm} setForm={setVForm} lockOwner migrated={data.m2} />
              <div className="mt-4 space-y-3">
                <DuplicateWarning result={vDup.result} checking={vDup.checking} onOpenClient={id => { setVEdit(null); onOpen(id); }} acknowledged={!vAck.needsConfirm} />
                {vErr && <p className="text-sm text-rose-600" role="alert">{vErr}</p>}
                <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setVEdit(null)}>Cancel</Button><Button onClick={saveVehicle}>{vAck.needsConfirm ? 'Save (I checked the duplicate)' : 'Save vehicle'}</Button></div>
              </div>
            </Card>
          )}
          <Card className="overflow-hidden">
            {vehicles.length === 0 ? <EmptyState icon={Car} title="No vehicles yet" subtitle="Add the client's vehicle here, or it is added automatically when you save a quotation." /> : (
              <div className="divide-y divide-slate-100">
                {vehicles.map(v => {
                  const qn = data.quotations.filter(x => x.vehicle_id === v.id).length; const cn = data.cases.filter(x => x.vehicle_id === v.id).length;
                  return (
                    <div key={v.id} className="px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{v.registration_number || 'No registration yet'} <span className="font-normal text-slate-600">{[v.company, v.model, v.manufacturing_year].filter(Boolean).join(' ')}</span></p>
                        <p className="text-xs text-slate-500">{[v.engine_cc && `${v.engine_cc}cc`, v.chassis_number && `chassis ${v.chassis_number}`, v.engine_number && `engine ${v.engine_number}`, `${qn} quotation${qn === 1 ? '' : 's'}`, `${cn} case${cn === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => go('calculator', { clientId: client.id, vehicleId: v.id })}><FileText className="w-4 h-4" /> Quotation</Button>
                        <Button size="sm" variant="secondary" onClick={() => go('cases', { clientId: client.id, vehicleId: v.id })}><FolderOpen className="w-4 h-4" /> Case</Button>
                        <Button size="sm" variant="secondary" onClick={() => openVehicleForm(v)}><Pencil className="w-4 h-4" /> Edit</Button>
                        {canManage && <button onClick={() => deleteVehicle(v)} className="p-2 text-slate-300 hover:text-rose-500" aria-label={`Delete ${vText(v)}`}><Trash2 className="w-4 h-4" /></button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
          {customerVehicles.length > 0 && (
            <>
              <p className="text-sm font-semibold text-slate-700 mt-5 mb-2">Vehicles of customers who came through {client.name}</p>
              <Card className="divide-y divide-slate-100">
                {customerVehicles.map(v => (
                  <button key={v.id} onClick={() => onOpen(v.client_id!)} className="w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-3 text-left hover:bg-slate-50">
                    <span className="text-sm text-slate-800">{vText(v)} <span className="text-xs text-slate-500">· {nameOf(v.client_id)}</span></span><ChevronRight className="w-4 h-4 text-slate-300" />
                  </button>
                ))}
              </Card>
            </>
          )}
        </>
      )}

      {/* ================= QUOTATIONS ================= */}
      {tab === 'quotations' && (
        <Card className="overflow-hidden">
          {quoteRows.length === 0 ? <EmptyState icon={FileText} title="No quotations yet" subtitle="Use the Quotation button above: this client is already selected." /> : (
            <div className="divide-y divide-slate-100">
              {quoteRows.map(q => {
                const meta = QUOTATION_STATUSES.find(x => x.value === q.status);
                const veh = data.vehicles.find(v => v.id === q.vehicle_id);
                const paid = paidOn(q.id);
                const st = payState(q.grand_total, paid);
                const counted = !NOT_BILLED.has(q.status);
                return (
                  <button key={q.id} onClick={() => onOpenQuotation?.(q.id)} className="w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-3 hover:bg-slate-50 text-left">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{q.quotation_number}{q.client_id !== client.id && <span className="ml-2 text-xs font-normal text-slate-500">{nameOf(q.client_id)}</span>}</p>
                      <p className="text-xs text-slate-500 truncate">{[veh?.registration_number, [veh?.company, veh?.model].filter(Boolean).join(' '), formatDate(q.created_at)].filter(Boolean).join(' · ')}</p>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                      <Badge className={meta?.color ?? 'bg-gray-100 text-gray-700'}>{meta?.label ?? q.status}</Badge>
                      {counted && <Badge className={st === 'paid' ? 'bg-emerald-100 text-emerald-700' : st === 'partial' ? 'bg-amber-100 text-amber-700' : st === 'advance' ? 'bg-blue-100 text-blue-700' : 'bg-rose-100 text-rose-700'}>{st === 'paid' ? 'Paid' : st === 'partial' ? `Paid ${formatPKR(paid)}` : st === 'advance' ? 'Overpaid' : 'Unpaid'}</Badge>}
                      <span className="text-sm font-bold tabular-nums">{formatPKR(q.grand_total)}</span>
                      <ChevronRight className="w-4 h-4 text-slate-300" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* ================= CASES ================= */}
      {tab === 'cases' && (
        <>
          <div className="flex justify-between items-center mb-3"><p className="text-sm text-slate-500">{isHub ? `Cases of ${client.name} and the customers who came through it.` : `Cases of ${client.name}.`}</p><Button size="sm" onClick={() => go('cases')}><Plus className="w-4 h-4" /> New case</Button></div>
          <Card className="overflow-hidden">
            {caseRows.length === 0 ? <EmptyState icon={FolderOpen} title="No cases yet" subtitle="A case tracks the work after a quotation is accepted." /> : (
              <div className="divide-y divide-slate-100">
                {caseRows.map(c => {
                  const meta = CASE_STATUSES.find(x => x.value === c.status); const veh = data.vehicles.find(v => v.id === c.vehicle_id);
                  return (
                    <button key={c.id} onClick={() => onOpenCase?.(c.id)} className="w-full text-left flex items-center justify-between gap-3 px-4 sm:px-5 py-3 hover:bg-slate-50">
                      <div className="min-w-0"><p className="text-sm font-semibold text-slate-900">{c.case_no}{c.client_id !== client.id && <span className="ml-2 text-xs font-normal text-slate-500">{nameOf(c.client_id)}</span>}</p>
                        <p className="text-xs text-slate-500 truncate">{[CASE_SERVICES.find(x => x.value === c.service_type)?.label ?? c.service_type, veh && vText(veh), `opened ${formatDate(c.opened_on)}`].filter(Boolean).join(' · ')}</p></div>
                      <div className="flex items-center gap-2 flex-shrink-0">{c.stage && <Badge className="bg-slate-100 text-slate-700">{stageLabel(c.stage)}</Badge>}<Badge className={meta?.color ?? 'bg-gray-100 text-gray-700'}>{meta?.label ?? c.status}</Badge></div>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
          <p className="text-[11px] text-slate-500 mt-2">Open a case to see its stage, document checklist and history.</p>
        </>
      )}

      {/* ================= PAYMENTS ================= */}
      {tab === 'payments' && (
        <>
          {billedToParent && parent ? (
            <Card className="p-4 mb-4 bg-indigo-50 border-indigo-200 text-sm text-indigo-900 flex items-center justify-between gap-3">
              <span>This client's bills go to the account of <b>{parent.name}</b>. Payments are recorded there.</span>
              <Button size="sm" variant="secondary" onClick={() => onOpen(parent.id)}>Open {parent.name}</Button>
            </Card>
          ) : (
            <div className="grid grid-cols-3 gap-3 mb-4">
              <Card className="p-3 sm:p-4"><p className="text-[11px] sm:text-xs text-slate-500">Total billed</p><p className="text-base sm:text-xl font-bold text-slate-900 tabular-nums">{formatPKR(ledger.billed + Math.max(0, ledger.opening))}</p></Card>
              <Card className="p-3 sm:p-4"><p className="text-[11px] sm:text-xs text-slate-500">Received</p><p className="text-base sm:text-xl font-bold text-emerald-600 tabular-nums">{formatPKR(ledger.received + Math.max(0, -ledger.opening))}</p></Card>
              <Card className="p-3 sm:p-4"><p className="text-[11px] sm:text-xs text-slate-500">{ledger.pending < 0 ? 'Advance' : 'Pending'}</p><p className={`text-base sm:text-xl font-bold tabular-nums ${ledger.pending > 0 ? 'text-rose-600' : ledger.pending < 0 ? 'text-blue-600' : 'text-emerald-600'}`}>{formatPKR(Math.abs(ledger.pending))}</p></Card>
              {ageing.total > 0.004 && <p className="col-span-3 text-xs text-slate-500">Outstanding by age: 0–30 days {formatPKR(ageing.current)} · 31–60 {formatPKR(ageing.d31)} · 61–90 {formatPKR(ageing.d61)} · 90+ <span className={ageing.d90 > 0 ? 'text-rose-600 font-medium' : ''}>{formatPKR(ageing.d90)}</span>. Payments clear the oldest bill first.</p>}
            </div>
          )}

          {payOpen && (
            <Card className="p-4 mb-4 border-amber-200">
              <h2 className="font-semibold text-slate-900 mb-3">Record payment received from {client.name}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label="Amount (PKR)" required><Input type="number" inputMode="numeric" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} autoFocus /></Field>
                <Field label="Date"><Input type="date" value={pay.date} onChange={e => setPay({ ...pay, date: e.target.value })} /></Field>
                <Field label="Method"><Select value={pay.method} onChange={e => setPay({ ...pay, method: e.target.value })}>{PAY_METHODS.map(m => <option key={m}>{m}</option>)}</Select></Field>
                <Field label="Reference"><Input value={pay.reference} onChange={e => setPay({ ...pay, reference: e.target.value })} placeholder="Txn / cheque no." /></Field>
                <div className="col-span-2 sm:col-span-4"><Field label="Note"><Input value={pay.notes} onChange={e => setPay({ ...pay, notes: e.target.value })} placeholder="e.g. against 3 cars, or advance" /></Field></div>
              </div>
              {ledger.pending > 0 && <button type="button" className="text-xs text-blue-700 mt-2" onClick={() => setPay({ ...pay, amount: String(ledger.pending) })}>Fill full pending amount ({formatPKR(ledger.pending)})</button>}
              <div className="flex justify-end gap-2 mt-3"><Button variant="secondary" onClick={() => setPayOpen(false)}>Cancel</Button><Button onClick={recordPayment}>Save & print receipt</Button></div>
              <p className="text-[11px] text-slate-500 mt-2">This payment is on account: it reduces the total pending, it is not tied to one quotation. To pay one particular quotation, record it inside that quotation.</p>
            </Card>
          )}

          {allocFor && (
            <Card className="p-4 mb-4 border-amber-200">
              <h2 className="font-semibold text-slate-900 mb-1">Allocate payment of {formatPKR(allocFor.amount)}</h2>
              <p className="text-xs text-slate-500 mb-3">Still unallocated: {formatPKR(unallocated(allocFor, data.allocations))}. This only marks which quotation the money paid; the account balance does not change.</p>
              {allocCandidates(allocFor).length === 0 ? <p className="text-sm text-slate-500">No billed quotation of this account has anything outstanding.</p> : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2"><Field label="Quotation"><Select value={allocQ} onChange={e => { setAllocQ(e.target.value); const c = allocCandidates(allocFor).find(x => x.q.id === e.target.value); if (c) setAllocAmt(String(Math.min(unallocated(allocFor, data.allocations), c.out))); }}>
                    {allocCandidates(allocFor).map(c => <option key={c.q.id} value={c.q.id}>{c.q.quotation_number} · {nameOf(c.q.client_id)} · owes {formatPKR(c.out)}</option>)}
                  </Select></Field></div>
                  <Field label="Amount"><Input type="number" inputMode="numeric" value={allocAmt} onChange={e => setAllocAmt(e.target.value)} /></Field>
                </div>
              )}
              <div className="flex justify-end gap-2 mt-3"><Button variant="secondary" onClick={() => setAllocFor(null)}>Cancel</Button><Button onClick={saveAlloc} disabled={!allocQ || !(Number(allocAmt) > 0)}>Allocate</Button></div>
            </Card>
          )}

          {billedToParent ? (
            <Card className="p-6 text-sm text-slate-500">The ledger of this client is kept in the account of {parent?.name}.</Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <h3 className="font-semibold text-slate-900 text-sm">Account ledger</h3>
                <div className="flex gap-2">
                  {data.migrated && !payOpen && <Button size="sm" onClick={() => setPayOpen(true)}><Wallet className="w-4 h-4" /> Record payment</Button>}
                  <Button size="sm" variant="secondary" onClick={printStatement}><Printer className="w-4 h-4" /> Statement</Button><Button size="sm" variant="secondary" onClick={exportLedger}><Download className="w-4 h-4" /> CSV</Button>
                </div>
              </div>
              {ledger.lines.length === 0 ? <EmptyState icon={Wallet} title="No entries yet" subtitle="Quotations and payments will appear here." /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="text-left font-medium px-4 py-2">Date</th><th className="text-left font-medium px-2 py-2">Description</th><th className="text-right font-medium px-2 py-2">Billed</th><th className="text-right font-medium px-2 py-2">Received</th><th className="text-right font-medium px-4 py-2">Balance</th><th /></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {[...ledger.lines].reverse().map(l => (
                        <tr key={l.key} className={`align-top ${l.reversed ? 'opacity-60' : ''}`}>
                          <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{l.date ? formatDate(l.date) : '—'}</td>
                          <td className="px-2 py-2.5">
                            {l.quotationId && l.kind === 'bill' ? <button className="text-left text-slate-900 hover:text-amber-700 font-medium" onClick={() => onOpenQuotation?.(l.quotationId!)}>{l.text}</button> : <span className={`text-slate-900 font-medium ${l.reversed ? 'line-through' : ''}`}>{l.text}</span>}
                            {l.detail && <p className="text-xs text-slate-500">{l.detail}</p>}
                            {l.onAccount && !l.reversed && data.allocations.filter(a => a.client_payment_id === l.paymentId && !a.voided_at).map(a => (
                              <p key={a.id} className="text-xs text-blue-700">Allocated {formatPKR(a.amount)} to {data.quotations.find(x => x.id === a.quotation_id)?.quotation_number ?? 'quotation'}{canManage && <button className="ml-2 underline text-slate-500 hover:text-rose-600" onClick={() => voidAlloc(a.id)}>undo</button>}</p>
                            ))}
                          </td>
                          <td className="px-2 py-2.5 text-right tabular-nums">{l.debit ? formatPKR(l.debit) : ''}</td>
                          <td className="px-2 py-2.5 text-right tabular-nums text-emerald-700">{l.credit ? formatPKR(l.credit) : ''}</td>
                          <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${l.balance > 0 ? 'text-rose-600' : l.balance < 0 ? 'text-blue-600' : 'text-emerald-600'}`}>{formatPKR(l.balance)}</td>
                          <td className="pr-3">
                            {data.m4 && l.onAccount && !l.reversed && (() => { const cp = data.clientPayments.find(x => x.id === l.paymentId); return cp && unallocated(cp, data.allocations) > 0 ? <button className="p-1.5 text-slate-300 hover:text-blue-600" aria-label="Allocate payment" title="Allocate to a quotation" onClick={() => startAlloc(cp)}><Link2 className="w-3.5 h-3.5" /></button> : null; })()}
                            {canManage && data.m4 && l.paymentId && !l.reversed && <button className="p-1.5 text-slate-300 hover:text-rose-600" aria-label="Reverse payment" title="Reverse payment" onClick={() => reversePayment(l.onAccount ? 'on_account' : 'quotation', l.paymentId!, l.credit)}><RotateCcw className="w-3.5 h-3.5" /></button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="px-4 py-2 text-[11px] text-slate-500 border-t border-slate-100">Draft and rejected quotations are not counted. Balance: red = client owes, blue = client paid in advance. A wrong payment is reversed (manager), not deleted: it stays here, struck through.</p>
            </Card>
          )}
        </>
      )}

      {/* ================= CUSTOMERS (showroom / contact person) ================= */}
      {tab === 'customers' && (
        <>
          <div className="flex justify-between items-center mb-3">
            <p className="text-sm text-slate-500">Customers who came through {client.name}.</p>
            {data.migrated && <Button size="sm" onClick={() => setCustOpen(!custOpen)}><Plus className="w-4 h-4" /> Add customer</Button>}
          </div>
          {custOpen && (
            <Card className="p-4 mb-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Customer name" required><Input value={cust.name} onChange={e => setCust({ ...cust, name: e.target.value })} /></Field>
                <Field label="Phone"><Input value={cust.phone} onChange={e => setCust({ ...cust, phone: e.target.value })} inputMode="tel" /></Field>
                <Field label="C/O"><Input value={cust.care_of} onChange={e => setCust({ ...cust, care_of: e.target.value })} /></Field>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700 mt-3"><input type="checkbox" checked={cust.bill} onChange={e => setCust({ ...cust, bill: e.target.checked })} /> {client.name} pays for this customer</label>
              <div className="flex justify-end mt-3"><Button size="sm" onClick={addCustomer} disabled={!cust.name.trim()}>Add</Button></div>
            </Card>
          )}
          <Card className="overflow-hidden">
            {children.length === 0 ? <EmptyState icon={UserRound} title="No customers linked yet" subtitle="When you add a client, choose this showroom under 'Came through'." /> : (
              <div className="divide-y divide-slate-100">
                {children.map(c => {
                  const own = data.quotations.filter(q => q.client_id === c.id && !NOT_BILLED.has(q.status));
                  const billed = own.reduce((a, q) => a + q.grand_total, 0);
                  const vc = data.vehicles.filter(v => v.client_id === c.id).length;
                  return (
                    <button key={c.id} onClick={() => onOpen(c.id)} className="w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-3 hover:bg-slate-50 text-left">
                      <div className="min-w-0"><p className="text-sm font-semibold text-slate-900">{c.name}</p><p className="text-xs text-slate-500">{[c.phone, c.care_of && `C/O ${c.care_of}`, `${vc} vehicle${vc === 1 ? '' : 's'}`, `${own.length} quotations`, c.bill_to_parent ? 'billed to showroom' : 'pays by self'].filter(Boolean).join(' · ')}</p></div>
                      <div className="flex items-center gap-3"><span className="text-sm font-semibold tabular-nums">{formatPKR(billed)}</span><ChevronRight className="w-4 h-4 text-slate-300" /></div>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}

      {tab === 'documents' && <DocumentsPanel clientId={client.id} />}

      {/* ================= ACTIVITY ================= */}
      {tab === 'activity' && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2"><History className="w-4 h-4 text-slate-500" /><h3 className="font-semibold text-slate-900 text-sm">Activity</h3></div>
          <ol className="divide-y divide-slate-100">
            {activity.map(a => (
              <li key={a.key} className="flex items-start gap-3 px-4 sm:px-5 py-2.5">
                <span className={`mt-0.5 text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${KIND_STYLE[a.kind]}`}>{a.kind === 'audit' ? 'change' : a.kind}</span>
                <div className="min-w-0 flex-1">
                  {a.ref?.type === 'quotation' ? <button className="text-sm text-slate-900 hover:text-amber-700 text-left" onClick={() => onOpenQuotation?.(a.ref!.id)}>{a.text}</button> : <p className="text-sm text-slate-900">{a.text}</p>}
                  {a.detail && <p className="text-xs text-slate-500">{a.detail}</p>}
                </div>
                <span className="text-xs text-slate-500 whitespace-nowrap">{formatDate(a.at)}</span>
              </li>
            ))}
          </ol>
          <p className="px-4 py-2 text-[11px] text-slate-500 border-t border-slate-100">{isOwner ? 'Shows records and the changes logged for this client.' : 'Shows this client\'s records. The detailed change log is visible to the owner only.'}</p>
        </Card>
      )}
    </>
  );
}
