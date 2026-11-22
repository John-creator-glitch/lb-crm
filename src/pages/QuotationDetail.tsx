import { useCan } from '@/lib/permissions';
import { useEffect, useState } from 'react';
import { supabase, type Quotation, type QuotationLineItem, type Client, type Vehicle, type Payment, type QuotationStatus, type StatusHistoryRow, type PaymentAllocation, QUOTATION_STATUSES } from '@/lib/supabase';
import { pkToday } from '@/lib/time';
import LinkedReminders from '@/components/LinkedReminders';
import { allowedQuotationMoves, isQuotationExpired, followUpState, FIELD_LABEL } from '@/lib/workflow';
import { PageHeader, Breadcrumbs, ContactActions, Card, Spinner, Badge, Button, Field, Input, Select, Textarea } from '@/components/ui';
import { usePageTitle } from '@/lib/pageTitle';
import { formatPKR, formatDate, formatDateTime } from '@/lib/format';
import { buildQuotationPdf } from '@/lib/quotationPdf';
import { shareFile, downloadBlob, pdfToPng, normalizePkPhone } from '@/lib/share';
import { useSettings } from '@/lib/settings';
import { FIELD_KIND_LABEL, newField, type CustomField } from '@/lib/customFields';
import { ArrowLeft, Briefcase, History, Download, MessageCircle, Plus, AlertTriangle, Edit3, Image as ImageIcon, X, Trash2 } from 'lucide-react';
import { friendlyError } from '@/lib/errors';

export default function QuotationDetail({ quotationId, onBack, onOpenCase }: { quotationId: string; onBack: () => void; onOpenCase?: (id: string) => void }) {
  const [quotation, setQuotation] = useState<Quotation | null>(null);
  const [items, setItems] = useState<QuotationLineItem[]>([]);
  const [client, setClient] = useState<Client | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [payErr, setPayErr] = useState('');
  const [newPayment, setNewPayment] = useState({ amount: '', method: 'cash', reference: '', notes: '' });
  const [showEditTerms, setShowEditTerms] = useState(false);
  const [editTerms, setEditTerms] = useState('');
  const [allocs, setAllocs] = useState<PaymentAllocation[]>([]);
  const [m4, setM4] = useState(false);
  const [history, setHistory] = useState<StatusHistoryRow[]>([]);
  const [linkedCase, setLinkedCase] = useState<{ id: string; case_no: string } | null>(null);
  const [follow, setFollow] = useState({ date: '', note: '' });
  const [wfMsg, setWfMsg] = useState('');
  const [wfErr, setWfErr] = useState('');
  const isManager = useCan('manager');
  const rank = isManager ? 2 : 1;

  async function loadWorkflow() {
    const [h, c, al, pays] = await Promise.all([
      supabase.from('status_history').select('*').eq('entity_type', 'quotation').eq('entity_id', quotationId).order('changed_at', { ascending: false }),
      supabase.from('cases').select('id, case_no, status').eq('quotation_id', quotationId).neq('status', 'cancelled').order('created_at').limit(1),
      supabase.from('payment_allocations').select('*').eq('quotation_id', quotationId),
      supabase.from('payments').select('*').eq('quotation_id', quotationId).order('payment_date', { ascending: false }),
    ]);
    setAllocs(al.error ? [] : (al.data ?? []) as PaymentAllocation[]); setM4(!al.error);
    if (!pays.error) setPayments((pays.data ?? []) as Payment[]);
    setHistory((h.data ?? []) as StatusHistoryRow[]);
    const first = (c.data ?? [])[0] as { id: string; case_no: string } | undefined;
    setLinkedCase(first ?? null);
  }

  useEffect(() => {
    (async () => {
      const { data: q } = await supabase.from('quotations').select('*').eq('id', quotationId).maybeSingle();
      if (!q) { setLoading(false); return; }
      setQuotation(q as Quotation);
      setEditTerms((q as Quotation).payment_terms ?? '');
      setFollow({ date: (q as Quotation).follow_up_on ?? '', note: (q as Quotation).follow_up_note ?? '' });
      loadWorkflow();

      const [{ data: li }, { data: c }, { data: v }, { data: pays }] = await Promise.all([
        supabase.from('quotation_line_items').select('*').eq('quotation_id', quotationId).order('sort_order'),
        q.client_id ? supabase.from('clients').select('*').eq('id', q.client_id).maybeSingle() : Promise.resolve({ data: null }),
        q.vehicle_id ? supabase.from('vehicles').select('*').eq('id', q.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from('payments').select('*').eq('quotation_id', quotationId).order('payment_date', { ascending: false }),
      ]);

      setItems((li as QuotationLineItem[]) ?? []);
      setClient(c as Client | null);
      setVehicle(v as Vehicle | null);
      setPayments((pays as Payment[]) ?? []);
      setLoading(false);
    })();
  }, [quotationId]);

  async function updateStatus(status: QuotationStatus) {
    if (!quotation || status === quotation.status) return;
    setWfErr(''); setWfMsg('');
    let why: string | null = null;
    if (status === 'rejected') {
      why = window.prompt('Why is this quotation rejected? (required, kept in the history)');
      if (why === null) return;
      if (!why.trim()) { setWfErr('A reason is needed to reject a quotation.'); return; }
    }
    if (status === 'approved' && isQuotationExpired(quotation, pkToday()) && !window.confirm(`This quotation's validity ended on ${formatDate(quotation.validity_date!)}. Approve anyway? Fees may have changed.`)) return;
    const { error } = await supabase.rpc('set_quotation_status', { p_id: quotation.id, p_status: status, p_note: why?.trim() || null });
    if (error) { setWfErr('Status was not changed: ' + friendlyError(error)); return; }
    setQuotation({ ...quotation, status });
    setWfMsg(`Status changed to ${QUOTATION_STATUSES.find(s => s.value === status)?.label}.`);
    loadWorkflow();
  }

  async function saveFollowUp() {
    if (!quotation) return;
    setWfErr(''); setWfMsg('');
    const { error } = await supabase.from('quotations').update({ follow_up_on: follow.date || null, follow_up_note: follow.note.trim() || null }).eq('id', quotation.id);
    if (error) { setWfErr(friendlyError(error)); return; }
    setQuotation({ ...quotation, follow_up_on: follow.date || null, follow_up_note: follow.note.trim() || null });
    setWfMsg('Follow-up saved.');
  }

  async function createCase() {
    if (!quotation) return;
    setWfErr(''); setWfMsg('');
    const { data, error } = await supabase.rpc('create_case_from_quotation', { p_quotation_id: quotation.id });
    if (error) { setWfErr(friendlyError(error)); return; }
    const r = (Array.isArray(data) ? data[0] : data) as { case_id: string; case_no: string; already_existed: boolean } | null;
    if (!r) { setWfErr('The case was not created. Please try again.'); return; }
    setLinkedCase({ id: r.case_id, case_no: r.case_no });
    setWfMsg(r.already_existed ? `Case ${r.case_no} already exists for this quotation.` : `Case ${r.case_no} created.`);
    loadWorkflow();
  }

  async function addPayment() {
    if (!quotation || !newPayment.amount) return;
    setPayErr('');
    const amt = Number(newPayment.amount);
    if (!Number.isFinite(amt) || amt <= 0) { setPayErr('Amount must be more than zero.'); return; }
    const owing = quotation.grand_total - totalPaidNow();
    if (amt > owing + 0.004 && !window.confirm(`This quotation has only ${formatPKR(Math.max(0, owing))} outstanding. Record ${formatPKR(amt)} anyway? The extra will show as an overpayment.`)) return;
    const { data, error } = await supabase
      .from('payments')
      .insert({
        quotation_id: quotation.id,
        amount: amt,
        payment_method: newPayment.method,
        reference: newPayment.reference || null,
        notes: newPayment.notes || null,
      })
      .select()
      .maybeSingle();
    if (error || !data) { setPayErr('Payment was not saved: ' + (error?.message ?? 'no response from the server') + '. Please try again.'); return; }
    if (data) {
      setPayments([data as Payment, ...payments]);
      setNewPayment({ amount: '', method: 'cash', reference: '', notes: '' });
      setShowAddPayment(false);
    }
  }

  const totalPaidNow = () => payments.filter(p => !p.reversed_at).reduce((t, p) => t + p.amount, 0) + allocs.filter(a => !a.voided_at).reduce((t, a) => t + a.amount, 0);
  async function reversePay(p: Payment) {
    const why = window.prompt(`Reverse this payment of ${formatPKR(p.amount)}? It stays on record as reversed and the balance goes back up.\n\nReason (required):`);
    if (why === null) return;
    if (!why.trim()) { setPayErr('A reason is needed to reverse a payment.'); return; }
    const { error } = await supabase.rpc('reverse_payment', { p_kind: 'quotation', p_id: p.id, p_reason: why.trim() });
    if (error) { setPayErr(friendlyError(error)); return; }
    setPayErr(''); setPayments(payments.map(x => x.id === p.id ? { ...x, reversed_at: new Date().toISOString(), reversal_reason: why.trim() } : x));
  }

  async function saveTerms() {
    if (!quotation) return;
    const { error } = await supabase.from('quotations').update({ payment_terms: editTerms }).eq('id', quotation.id);
    if (!error) {
      setQuotation({ ...quotation, payment_terms: editTerms });
      setShowEditTerms(false);
    }
  }

  const settings = useSettings();
  const [fields, setFields] = useState<CustomField[]>([]);
  const [fieldsDirty, setFieldsDirty] = useState(false);
  const [hpaLinked, setHpaLinked] = useState(false);
  const [sendPhone, setSendPhone] = useState<string | null>(null); // null = use client's saved phone
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [chargeForm, setChargeForm] = useState({ label: '', amount: '', kind: 'government' as 'government' | 'additional' });
  const phoneValue = sendPhone ?? client?.phone ?? '';
  const snapshot: Record<string, any> = quotation?.calculation_snapshot ?? {};
  const isHpa = snapshot.hire_purchase === true || items.some(i => i.fee_type === 'hire_purchase_fee');

  useEffect(() => {
    setFields(Array.isArray(quotation?.calculation_snapshot?.custom_fields) ? quotation!.calculation_snapshot!.custom_fields : []);
    setFieldsDirty(false);
  }, [quotation?.id]);
  useEffect(() => {
    if (!quotationId) return;
    supabase.from('hpa_counts').select('id').eq('quotation_id', quotationId).maybeSingle().then(({ data }) => setHpaLinked(!!data));
  }, [quotationId]);

  function makePdf() {
    return buildQuotationPdf({ quotation: quotation!, items, client, vehicle, settings, customFields: fields, hirePurchase: isHpa });
  }

  async function rememberPhone() {
    if (!client || !sendPhone || sendPhone === client.phone) return;
    await supabase.from('clients').update({ phone: sendPhone }).eq('id', client.id);
    setClient({ ...client, phone: sendPhone });
  }

  async function handleShare(kind: 'pdf' | 'png') {
    if (!quotation) return;
    setBusy('share-' + kind); setNote('');
    try {
      const pdf = makePdf();
      const blob = kind === 'pdf' ? pdf.blob : await pdfToPng(pdf.blob);
      const file = new File([blob], kind === 'pdf' ? pdf.filename : pdf.filename.replace(/\.pdf$/, '.png'), { type: kind === 'pdf' ? 'application/pdf' : 'image/png' });
      await rememberPhone();
      const r = await shareFile(file, { title: `${settings.business_name} quotation ${quotation.quotation_number}`, phone: phoneValue });
      setNote(r.message);
    } catch (e: any) { setNote('Could not create the file: ' + (e?.message ?? e)); }
    setBusy('');
  }

  async function handleDownload(kind: 'pdf' | 'png') {
    if (!quotation) return;
    setBusy('dl-' + kind); setNote('');
    try {
      const pdf = makePdf();
      if (kind === 'pdf') downloadBlob(pdf.blob, pdf.filename);
      else downloadBlob(await pdfToPng(pdf.blob), pdf.filename.replace(/\.pdf$/, '.png'));
    } catch (e: any) { setNote('Could not create the file: ' + (e?.message ?? e)); }
    setBusy('');
  }

  async function saveFields() {
    if (!quotation) return;
    const clean = fields.filter(f => f.label.trim());
    const snap = { ...snapshot, custom_fields: clean };
    const { error } = await supabase.from('quotations').update({ calculation_snapshot: snap }).eq('id', quotation.id);
    if (error) { setNote(friendlyError(error)); return; }
    setQuotation({ ...quotation, calculation_snapshot: snap });
    setFields(clean); setFieldsDirty(false);
    await supabase.from('audit_logs').insert({ action: 'quotation_details_updated', entity_type: 'quotation', entity_id: quotation.id, details: { fields: clean.map(f => f.label) } });
  }
  const editField = (id: string, patch: Partial<CustomField>) => { setFields(fields.map(f => (f.id === id ? { ...f, ...patch } : f))); setFieldsDirty(true); };

  async function retotal(next: QuotationLineItem[]) {
    if (!quotation) return;
    const sum = (c: string) => next.filter(i => i.category === c).reduce((t, i) => t + i.amount, 0);
    const patch = { subtotal_govt: sum('government'), subtotal_service: sum('service'), subtotal_additional: sum('additional'), grand_total: next.reduce((t, i) => t + i.amount, 0) };
    const { error } = await supabase.from('quotations').update(patch).eq('id', quotation.id);
    if (error) { setNote(friendlyError(error)); return false; }
    setItems(next); setQuotation({ ...quotation, ...patch });
    return true;
  }
  async function addCharge() {
    if (!quotation || !chargeForm.label.trim() || !(Number(chargeForm.amount) > 0)) return;
    const row = { quotation_id: quotation.id, fee_type: chargeForm.kind === 'government' ? 'custom_govt' : 'custom_other', label: chargeForm.label.trim(), category: chargeForm.kind, amount: Number(chargeForm.amount), formula: 'Custom charge added by operator', source: null, rule_version: null, is_override: false, override_reason: null, sort_order: 200 + items.length };
    const { data, error } = await supabase.from('quotation_line_items').insert(row).select().maybeSingle();
    if (error || !data) { setNote(error?.message ?? 'Could not add the charge'); return; }
    if (await retotal([...items, data as QuotationLineItem])) {
      await supabase.from('audit_logs').insert({ action: 'quotation_charge_added', entity_type: 'quotation', entity_id: quotation.id, details: { label: row.label, amount: row.amount } });
      setChargeForm({ label: '', amount: '', kind: 'government' });
    }
  }
  const canDelete = useCan('manager');
  async function removeCharge(li: QuotationLineItem) {
    if (!quotation || !li.fee_type.startsWith('custom_')) return;
    if (!window.confirm(`Remove "${li.label}" (${formatPKR(li.amount)})?`)) return;
    const { error } = await supabase.from('quotation_line_items').delete().eq('id', li.id);
    if (error) { setNote(friendlyError(error)); return; }
    await retotal(items.filter(i => i.id !== li.id));
    await supabase.from('audit_logs').insert({ action: 'quotation_charge_removed', entity_type: 'quotation', entity_id: quotation.id, details: { label: li.label, amount: li.amount } });
  }

  async function countHpa() {
    if (!quotation) return;
    const { error } = await supabase.from('hpa_counts').insert({ count: 1, quotation_id: quotation.id, note: quotation.quotation_number });
    if (error && !/duplicate|unique/i.test(error.message)) { setNote(friendlyError(error)); return; }
    setHpaLinked(true);
  }

  usePageTitle(quotation?.quotation_number);
  if (loading) return <Spinner label="Loading quotation..." />;
  if (!quotation) return <div className="text-center py-12 text-slate-500">Quotation not found.</div>;

  const today = pkToday();
  const m3 = quotation.follow_up_on !== undefined;
  const moves = allowedQuotationMoves(quotation.status, rank);
  const fu = followUpState(quotation.follow_up_on, quotation.status, today);
  const statusMeta = QUOTATION_STATUSES.find(s => s.value === quotation.status);
  const livePays = payments.filter(p => !p.reversed_at);
  const liveAllocs = allocs.filter(a => !a.voided_at);
  const totalPaid = livePays.reduce((s, p) => s + p.amount, 0) + liveAllocs.reduce((s, a) => s + a.amount, 0);
  const balance = quotation.grand_total - totalPaid;

  const govtItems = items.filter(li => li.category === 'government');
  const serviceItems = items.filter(li => li.category === 'service');
  const additionalItems = items.filter(li => li.category === 'additional');

  const renderItems = (list: QuotationLineItem[], title: string, subtotal: number) =>
    list.length === 0 ? null : (
      <div className="mb-4">
        {!(list.length === 1 && list[0].label.trim().toLowerCase() === title.toLowerCase()) && <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{title}</h3>}
        <div className="space-y-2">
          {list.map(li => (
            <div key={li.id} className="flex items-start justify-between py-2 border-b border-slate-50">
              <div className="min-w-0 pr-3">
                <p className="text-sm font-medium text-slate-900">{li.label}</p>
                {li.formula && <p className="text-xs text-slate-500 mt-0.5">{li.formula}</p>}
                {li.is_override && (
                  <p className="text-xs text-rose-600 mt-0.5">Overridden: {li.override_reason}</p>
                )}
                {li.source && <p className="text-[11px] text-slate-500 mt-0.5">Source: {li.source}</p>}
              </div>
              <span className="text-sm font-semibold text-slate-900 tabular-nums flex-shrink-0 flex items-center gap-2">
                {formatPKR(li.amount)}
                {li.fee_type.startsWith('custom_') && canDelete && (
                  <button onClick={() => removeCharge(li)} className="text-slate-300 hover:text-rose-600 p-1 -m-1" aria-label={`Remove ${li.label}`}><Trash2 className="w-4 h-4" /></button>
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="flex justify-between pt-2 text-sm font-medium text-slate-700">
          <span>Subtotal</span>
          <span className="tabular-nums">{formatPKR(subtotal)}</span>
        </div>
      </div>
    );

  return (
    <>
      <Breadcrumbs items={[{ label: 'Quotations', onClick: onBack }, { label: quotation.quotation_number }]} />

      <PageHeader
        title={quotation.quotation_number}
        subtitle={`Created ${formatDateTime(quotation.created_at)}`}
        action={<div className="flex gap-2 items-center"><Badge className={statusMeta?.color ?? ''}>{statusMeta?.label}</Badge>{isQuotationExpired(quotation, today) && <Badge className="bg-rose-100 text-rose-700">Expired</Badge>}</div>}
      />
      {wfMsg && <p className="text-sm text-emerald-700 mb-3" role="status">{wfMsg}</p>}
      {wfErr && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">{wfErr}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Items */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-5 space-y-3">
            <h2 className="font-semibold text-slate-900">Send quotation to owner</h2>
            <Input value={phoneValue} onChange={e => setSendPhone(e.target.value)} placeholder="Owner WhatsApp: 03xx-xxxxxxx" inputMode="tel" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Button onClick={() => handleShare('pdf')} disabled={!!busy} className="w-full !bg-emerald-500 !text-white hover:!bg-emerald-600">
                <MessageCircle className="w-5 h-5" /> {busy === 'share-pdf' ? 'Preparing...' : 'Share PDF on WhatsApp'}
              </Button>
              <Button onClick={() => handleShare('png')} disabled={!!busy} variant="secondary" className="w-full">
                <ImageIcon className="w-5 h-5" /> {busy === 'share-png' ? 'Preparing...' : 'Share as Image'}
              </Button>
              <Button onClick={() => handleDownload('pdf')} disabled={!!busy} variant="secondary" className="w-full"><Download className="w-4 h-4" /> Download PDF</Button>
              <Button onClick={() => handleDownload('png')} disabled={!!busy} variant="secondary" className="w-full"><Download className="w-4 h-4" /> Download Image</Button>
            </div>
            {note && <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3">{note}</p>}
            <p className="text-xs text-slate-500">The branded one-page PDF is sent as a file, not as typed text. On a phone the share sheet attaches it in WhatsApp; on a computer the file downloads and WhatsApp Web opens so you can attach it.</p>
          </Card>

          <Card className="p-5">
            {renderItems(govtItems, 'Government Fees', quotation.subtotal_govt)}
            {renderItems(serviceItems, 'Service Charges', quotation.subtotal_service)}
            {renderItems(additionalItems, 'Additional Expenses', quotation.subtotal_additional)}

            <div className="mt-4 pt-4 border-t-2 border-slate-200 space-y-2">
              <div className="flex justify-between text-sm"><span className="text-slate-600">Government Fees</span><span className="font-medium tabular-nums">{formatPKR(quotation.subtotal_govt)}</span></div>
              {quotation.subtotal_service > 0 && <div className="flex justify-between text-sm"><span className="text-slate-600">Service Charges</span><span className="font-medium tabular-nums">{formatPKR(quotation.subtotal_service)}</span></div>}
              {quotation.subtotal_additional > 0 && <div className="flex justify-between text-sm"><span className="text-slate-600">Additional</span><span className="font-medium tabular-nums">{formatPKR(quotation.subtotal_additional)}</span></div>}
              <div className="flex justify-between text-lg font-bold pt-2"><span className="text-slate-900">Grand Total</span><span className="text-amber-600 tabular-nums">{formatPKR(quotation.grand_total)}</span></div>
            </div>
          </Card>

          {/* Payments */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-slate-900">Payment Records</h2>
              <Button size="sm" variant="secondary" onClick={() => setShowAddPayment(!showAddPayment)}>
                <Plus className="w-4 h-4" /> Add Payment
              </Button>
            </div>

            {showAddPayment && (
              <div className="grid grid-cols-2 gap-3 mb-4 p-4 bg-slate-50 rounded-lg">
                {payErr && <p className="col-span-2 text-xs text-rose-600">{payErr}</p>}
                <Field label="Amount (PKR)" required>
                  <Input type="number" value={newPayment.amount} onChange={e => setNewPayment({ ...newPayment, amount: e.target.value })} />
                </Field>
                <Field label="Method">
                  <Select value={newPayment.method} onChange={e => setNewPayment({ ...newPayment, method: e.target.value })}>
                    <option value="cash">Cash</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="cheque">Cheque</option>
                    <option value="other">Other</option>
                  </Select>
                </Field>
                <Field label="Reference">
                  <Input value={newPayment.reference} onChange={e => setNewPayment({ ...newPayment, reference: e.target.value })} placeholder="Transaction ID / cheque #" />
                </Field>
                <Field label="Notes">
                  <Input value={newPayment.notes} onChange={e => setNewPayment({ ...newPayment, notes: e.target.value })} />
                </Field>
                <div className="col-span-2 flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowAddPayment(false)}>Cancel</Button>
                  <Button size="sm" onClick={addPayment} disabled={!newPayment.amount}>Save Payment</Button>
                </div>
              </div>
            )}

            {payments.length === 0 && liveAllocs.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">No payments recorded yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {payments.map(p => (
                  <div key={p.id} className={`flex items-center justify-between py-3 ${p.reversed_at ? 'opacity-60' : ''}`}>
                    <div>
                      <p className={`text-sm font-medium text-slate-900 ${p.reversed_at ? 'line-through' : ''}`}>{formatPKR(p.amount)}</p>
                      <p className="text-xs text-slate-500">{p.payment_method} · {formatDate(p.payment_date)}{p.reference ? ` · Ref: ${p.reference}` : ''}</p>
                      {p.reversed_at && <p className="text-xs text-rose-600">Reversed {formatDate(p.reversed_at)}: {p.reversal_reason}</p>}
                    </div>
                    {isManager && m4 && !p.reversed_at && <button onClick={() => reversePay(p)} className="text-xs text-slate-500 hover:text-rose-600 underline">Reverse</button>}
                  </div>
                ))}
                {liveAllocs.map(a => (
                  <div key={a.id} className="flex items-center justify-between py-3">
                    <div><p className="text-sm font-medium text-slate-900">{formatPKR(a.amount)}</p><p className="text-xs text-blue-700">From the client's on-account payment · {formatDate(a.created_at)}</p></div>
                  </div>
                ))}
              </div>
            )}

            {(payments.length > 0 || liveAllocs.length > 0) && (
              <div className="mt-4 pt-3 border-t border-slate-100 space-y-1">
                <div className="flex justify-between text-sm"><span className="text-slate-600">Total Paid</span><span className="font-medium text-emerald-600 tabular-nums">{formatPKR(totalPaid)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-600">Balance</span><span className="font-medium text-rose-600 tabular-nums">{formatPKR(balance)}</span></div>
              </div>
            )}
          </Card>
        </div>

        {/* Right: Sidebar */}
        <div className="space-y-6">
          {/* Client & Vehicle */}
          <Card className="p-5">
            <h2 className="font-semibold text-slate-900 mb-3">Client</h2>
            {client ? (
              <div className="space-y-1 text-sm">
                <p className="font-medium text-slate-900">{client.name}</p>
                {client.phone && <p className="text-slate-500">{client.phone}</p>}
                {client.email && <p className="text-slate-500">{client.email}</p>}
                {client.cnic && <p className="text-slate-500">CNIC: {client.cnic}</p>}
              </div>
            ) : <p className="text-sm text-slate-500">Walk-in client</p>}

            <h2 className="font-semibold text-slate-900 mb-3 mt-5">Vehicle</h2>
            {vehicle ? (
              <div className="space-y-1 text-sm">
                {vehicle.company && <p className="text-slate-700">{vehicle.company} {vehicle.model}</p>}
                {vehicle.engine_cc && <p className="text-slate-500">{vehicle.engine_cc} cc · {vehicle.fuel_type}</p>}
                {vehicle.manufacturing_year && <p className="text-slate-500">Year: {vehicle.manufacturing_year}</p>}
                {vehicle.registration_number && <p className="text-slate-500">Reg: {vehicle.registration_number}</p>}
              </div>
            ) : <p className="text-sm text-slate-500">No vehicle linked</p>}
          </Card>

          {/* Status and case */}
          <Card className="p-5">
            <h2 className="font-semibold text-slate-900 mb-1">Status</h2>
            <p className="text-xs text-slate-500 mb-3">Now: <b>{statusMeta?.label}</b>. {moves.length ? 'Move it to:' : 'No further moves.'}</p>
            <div className="grid grid-cols-2 gap-2">
              {moves.map(sv => (
                <button key={sv} onClick={() => updateStatus(sv)} className="px-3 py-2 text-xs font-medium rounded-lg border bg-white text-slate-700 border-slate-200 hover:border-amber-500 transition">
                  {QUOTATION_STATUSES.find(s => s.value === sv)?.label}
                </button>
              ))}
            </div>
            {m3 && quotation.status === 'approved' && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                {linkedCase
                  ? <Button size="sm" variant="secondary" className="w-full" onClick={() => onOpenCase?.(linkedCase.id)}><Briefcase className="w-4 h-4" /> Open case {linkedCase.case_no}</Button>
                  : <Button size="sm" className="w-full" onClick={createCase}><Briefcase className="w-4 h-4" /> Create case from this quotation</Button>}
                <p className="text-xs text-slate-500 mt-2">One click creates one case with the same client, vehicle and fees. Pressing it again never makes a second case.</p>
              </div>
            )}
            {m3 && quotation.status !== 'approved' && linkedCase && <Button size="sm" variant="secondary" className="w-full mt-4" onClick={() => onOpenCase?.(linkedCase.id)}><Briefcase className="w-4 h-4" /> Open case {linkedCase.case_no}</Button>}
          </Card>

          <LinkedReminders links={{ quotation_id: quotation.id, client_id: quotation.client_id, label: quotation.quotation_number }} defaultTitle={`Follow up ${quotation.quotation_number}: `} />

          {m3 && (
            <Card className="p-5">
              <h2 className="font-semibold text-slate-900 mb-1">Follow-up</h2>
              <p className="text-xs text-slate-500 mb-3">{quotation.validity_date ? `Valid until ${formatDate(quotation.validity_date)}. ` : ''}{fu === 'overdue' ? 'Follow-up is overdue.' : fu === 'today' ? 'Follow up today.' : ''}</p>
              <div className="space-y-2">
                <Input type="date" value={follow.date} onChange={e => setFollow({ ...follow, date: e.target.value })} aria-label="Follow-up date" />
                <Input value={follow.note} onChange={e => setFollow({ ...follow, note: e.target.value })} placeholder="e.g. Client will confirm after salary" aria-label="Follow-up note" />
                <Button size="sm" variant="secondary" className="w-full" onClick={saveFollowUp} disabled={follow.date === (quotation.follow_up_on ?? '') && follow.note === (quotation.follow_up_note ?? '')}>Save follow-up</Button>
              </div>
            </Card>
          )}

          {m3 && (
            <Card className="p-5">
              <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2"><History className="w-4 h-4 text-slate-500" /> Status history</h2>
              {history.length === 0 ? <p className="text-sm text-slate-500">No status changes yet.</p> : (
                <ol className="space-y-3">
                  {history.map(h => (
                    <li key={h.id} className="text-sm">
                      <p className="text-slate-900"><span className="text-slate-500">{FIELD_LABEL[h.field] ?? h.field}:</span> {h.from_value || '—'} → <b>{h.to_value}</b></p>
                      {h.note && <p className="text-xs text-slate-600">“{h.note}”</p>}
                      <p className="text-[11px] text-slate-500">{formatDateTime(h.changed_at)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          )}

          {/* Payment terms */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-slate-900">Payment Terms</h2>
              <button onClick={() => setShowEditTerms(!showEditTerms)} className="text-slate-500 hover:text-amber-600">
                <Edit3 className="w-4 h-4" />
              </button>
            </div>
            {showEditTerms ? (
              <div className="space-y-2">
                <Textarea rows={3} value={editTerms} onChange={e => setEditTerms(e.target.value)} />
                <Button size="sm" onClick={saveTerms}>Save</Button>
              </div>
            ) : (
              <p className="text-sm text-slate-600">{quotation.payment_terms ?? 'Not specified'}</p>
            )}
          </Card>

          {/* HPA */}
          {isHpa && (
            <Card className="p-5">
              <h2 className="font-semibold text-slate-900 mb-1">HPA (bank financed)</h2>
              <p className="text-xs text-slate-500 mb-3">Counted separately from normal applications in the HPA tracker.</p>
              {hpaLinked
                ? <p className="text-sm text-emerald-700 font-medium">Counted in the HPA tracker.</p>
                : <Button size="sm" variant="secondary" onClick={countHpa} className="w-full">Count this as 1 HPA application</Button>}
            </Card>
          )}

          {/* Details & remarks (custom fields) */}
          <Card className="p-5">
            <h2 className="font-semibold text-slate-900 mb-1">Details &amp; remarks</h2>
            <p className="text-xs text-slate-500 mb-3">For your own records: token tax status, pending documents, instructions. These are not printed on the PDF.</p>
            <div className="space-y-3">
              {fields.filter(f => f.kind === 'text' || f.kind === 'choice').map(f => (
                <div key={f.id} className="flex gap-2 items-start">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-500 mb-1">{f.label}</p>
                    {f.kind === 'choice'
                      ? <Select value={f.value ?? ''} onChange={e => editField(f.id, { value: e.target.value })}>{(f.options?.length ? f.options : ['Yes', 'No']).map(o => <option key={o}>{o}</option>)}</Select>
                      : <Textarea rows={2} value={f.value ?? ''} onChange={e => editField(f.id, { value: e.target.value })} />}
                  </div>
                  <button className="text-slate-300 hover:text-rose-600 p-2 mt-5" onClick={() => { setFields(fields.filter(x => x.id !== f.id)); setFieldsDirty(true); }} aria-label={`Remove ${f.label}`}><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {settings.field_presets.filter(p => p.kind === 'text' || p.kind === 'choice').filter(p => !fields.some(f => f.label === p.label)).map(p => (
                <button key={p.label} onClick={() => { setFields([...fields, newField(p)]); setFieldsDirty(true); }} className="px-3 py-1.5 rounded-full border border-slate-300 text-xs text-slate-600 hover:border-amber-500 hover:text-amber-700">+ {p.label}</button>
              ))}
              <button onClick={() => { setFields([...fields, newField({ label: '', kind: 'text' })]); setFieldsDirty(true); }} className="px-3 py-1.5 rounded-full border border-dashed border-slate-300 text-xs text-slate-500 hover:border-amber-500">+ Custom</button>
            </div>
            {fields.some(f => f.kind === 'text' && f.label === '') && <p className="text-xs text-amber-700 mt-2">Give the new field a name below by typing it in the first box.</p>}
            {fields.filter(f => (f.kind === 'text' || f.kind === 'choice') && !settings.field_presets.some(p => p.label === f.label)).map(f => (
              <Input key={f.id} className="mt-2" value={f.label} onChange={e => editField(f.id, { label: e.target.value })} placeholder="Field name" />
            ))}
            {fieldsDirty && <Button size="sm" className="mt-3 w-full" onClick={saveFields}>Save details</Button>}
          </Card>

          {/* Extra charge */}
          <Card className="p-5">
            <h2 className="font-semibold text-slate-900 mb-1">Add extra charge</h2>
            <p className="text-xs text-slate-500 mb-3">Adds a line to the quotation and updates the totals.</p>
            <div className="space-y-2">
              <Input value={chargeForm.label} onChange={e => setChargeForm({ ...chargeForm, label: e.target.value })} placeholder="e.g. Additional government charges" />
              <div className="flex gap-2">
                <Input type="number" inputMode="numeric" value={chargeForm.amount} onChange={e => setChargeForm({ ...chargeForm, amount: e.target.value })} placeholder="Amount" />
                <Select value={chargeForm.kind} onChange={e => setChargeForm({ ...chargeForm, kind: e.target.value as any })}><option value="government">Govt. charge</option><option value="additional">Other charge</option></Select>
              </div>
              <Button size="sm" onClick={addCharge} disabled={!chargeForm.label.trim() || !(Number(chargeForm.amount) > 0)} className="w-full"><Plus className="w-4 h-4" /> Add charge</Button>
            </div>
          </Card>

          {/* Estimation warning */}
          <Card className="p-4 bg-amber-50 border-amber-200">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                Government fees are based on admin-maintained rate schedules. Always verify against the official
                excise source before final collection.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
