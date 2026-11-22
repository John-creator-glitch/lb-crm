// Client ledger: what was billed, what was received, what is still pending.
// Pure functions (no database calls) so the numbers can be tested.
//
// Billing rules
// - A quotation is billed to the client on it, OR to that client's parent (showroom / contact person) when bill_to_parent is set.
// - Draft and Rejected quotations are not billed. Every other status is.
// - Money received counts whatever the quotation status is: payments recorded on a quotation, and on-account payments from the client.
// - A REVERSED payment (reversed_at set) is shown in the statement but counts for nothing. Wrong entries are reversed, never edited or deleted.
// - Allocating an on-account payment to a quotation does NOT change the account balance: the money was counted once when received.
//   Allocation only decides which quotation shows as paid (see paidOnQuotation).
// - Pending = opening balance + billed - received. A negative pending means the client has paid in advance.

export interface LClient { id: string; parent_id?: string | null; bill_to_parent?: boolean; opening_balance?: number | null; name?: string }
export interface LQuotation { id: string; client_id: string | null; grand_total: number; status: string; created_at: string; quotation_number: string }
export interface LPayment { id: string; quotation_id: string; amount: number; payment_date: string; payment_method?: string | null; reference?: string | null; reversed_at?: string | null; reversal_reason?: string | null }
export interface LClientPayment { id: string; client_id: string; amount: number; payment_date: string; payment_method?: string | null; reference?: string | null; reversed_at?: string | null; reversal_reason?: string | null }
export interface LAllocation { id: string; client_payment_id: string; quotation_id: string; amount: number; voided_at?: string | null }

export const NOT_BILLED = new Set(['draft', 'rejected']);

export interface LedgerLine {
  key: string;
  date: string;
  kind: 'opening' | 'bill' | 'payment';
  text: string;
  detail: string;
  debit: number;   // adds to what the client owes
  credit: number;  // received
  balance: number; // running pending after this line
  quotationId?: string;
  customerName?: string;
  reversed?: boolean;      // shown for the record, counts for nothing
  paymentId?: string;
  onAccount?: boolean;
}
export interface Ledger { billed: number; received: number; opening: number; pending: number; lines: LedgerLine[] }

/** Which account pays for this client's bills. */
export function payerOf(c: LClient | undefined | null): string | null {
  if (!c) return null;
  return c.bill_to_parent && c.parent_id ? c.parent_id : c.id;
}

export function buildLedger(accountId: string, d: { clients: LClient[]; quotations: LQuotation[]; payments: LPayment[]; clientPayments: LClientPayment[] }): Ledger {
  const byId = new Map(d.clients.map(c => [c.id, c]));
  const me = byId.get(accountId);
  const opening = Number(me?.opening_balance ?? 0) || 0;
  const mine = d.quotations.filter(q => q.client_id && payerOf(byId.get(q.client_id)) === accountId);
  const mineIds = new Set(mine.map(q => q.id));
  const qNo = new Map(mine.map(q => [q.id, q.quotation_number]));

  const raw: Omit<LedgerLine, 'balance'>[] = [];
  for (const q of mine) {
    if (NOT_BILLED.has(q.status)) continue;
    const owner = q.client_id !== accountId ? byId.get(q.client_id!)?.name : undefined;
    raw.push({ key: 'q' + q.id, date: q.created_at.slice(0, 10), kind: 'bill', text: `Quotation ${q.quotation_number}`, detail: owner ? `Customer: ${owner}` : '', debit: Number(q.grand_total) || 0, credit: 0, quotationId: q.id, customerName: owner });
  }
  for (const p of d.payments) {
    if (!mineIds.has(p.quotation_id)) continue;
    const rev = !!p.reversed_at;
    raw.push({ key: 'p' + p.id, date: p.payment_date, kind: 'payment', text: `Payment for ${qNo.get(p.quotation_id) ?? 'quotation'}${rev ? ' (reversed)' : ''}`, detail: rev ? `Reversed: ${p.reversal_reason ?? ''}` : [p.payment_method, p.reference].filter(Boolean).join(' · '), debit: 0, credit: rev ? 0 : Number(p.amount) || 0, quotationId: p.quotation_id, reversed: rev, paymentId: p.id });
  }
  for (const p of d.clientPayments) {
    if (p.client_id !== accountId) continue;
    const rev = !!p.reversed_at;
    raw.push({ key: 'c' + p.id, date: p.payment_date, kind: 'payment', text: `Payment received (on account)${rev ? ' (reversed)' : ''}`, detail: rev ? `Reversed: ${p.reversal_reason ?? ''}` : [p.payment_method, p.reference].filter(Boolean).join(' · '), debit: 0, credit: rev ? 0 : Number(p.amount) || 0, reversed: rev, paymentId: p.id, onAccount: true });
  }
  // oldest first; on the same day bills come before payments
  raw.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'bill' ? -1 : 1) || a.key.localeCompare(b.key));

  const lines: LedgerLine[] = [];
  let bal = opening;
  if (opening !== 0) lines.push({ key: 'open', date: '', kind: 'opening', text: 'Opening balance (before this system)', detail: '', debit: opening > 0 ? opening : 0, credit: opening < 0 ? -opening : 0, balance: opening });
  let billed = 0, received = 0;
  for (const r of raw) {
    bal += r.debit - r.credit; billed += r.debit; received += r.credit;
    lines.push({ ...r, balance: bal });
  }
  return { billed, received, opening, pending: bal, lines };
}

/** Pending for every account (clients that are not billed to a parent), in one pass. */
export function pendingByAccount(d: { clients: LClient[]; quotations: LQuotation[]; payments: LPayment[]; clientPayments: LClientPayment[] }): Map<string, { billed: number; received: number; pending: number }> {
  const out = new Map<string, { billed: number; received: number; pending: number }>();
  const byId = new Map(d.clients.map(c => [c.id, c]));
  const get = (id: string) => { let v = out.get(id); if (!v) { v = { billed: 0, received: 0, pending: Number(byId.get(id)?.opening_balance ?? 0) || 0 }; out.set(id, v); } return v; };
  d.clients.forEach(c => get(c.id));
  const qOwner = new Map<string, string>();
  for (const q of d.quotations) {
    const payer = q.client_id ? payerOf(byId.get(q.client_id)) : null;
    if (!payer) continue;
    qOwner.set(q.id, payer);
    if (NOT_BILLED.has(q.status)) continue;
    const v = get(payer); const a = Number(q.grand_total) || 0; v.billed += a; v.pending += a;
  }
  for (const p of d.payments) { if (p.reversed_at) continue; const payer = qOwner.get(p.quotation_id); if (!payer) continue; const v = get(payer); const a = Number(p.amount) || 0; v.received += a; v.pending -= a; }
  for (const p of d.clientPayments) { if (p.reversed_at) continue; const v = get(p.client_id); const a = Number(p.amount) || 0; v.received += a; v.pending -= a; }
  return out;
}

export type PayState = 'paid' | 'partial' | 'unpaid' | 'advance';
export function payState(billed: number, received: number): PayState {
  if (received > billed && billed >= 0) return 'advance';
  if (billed <= 0) return 'paid';
  if (received <= 0) return 'unpaid';
  return received >= billed ? 'paid' : 'partial';
}

/** What a quotation has received: payments recorded on it plus on-account money allocated to it. Reversed payments and voided allocations count for nothing. */
export function paidOnQuotation(quotationId: string, d: { payments: LPayment[]; allocations?: LAllocation[] }): { direct: number; allocated: number; paid: number } {
  const direct = d.payments.filter(p => p.quotation_id === quotationId && !p.reversed_at).reduce((t, p) => t + (Number(p.amount) || 0), 0);
  const allocated = (d.allocations ?? []).filter(a => a.quotation_id === quotationId && !a.voided_at).reduce((t, a) => t + (Number(a.amount) || 0), 0);
  return { direct, allocated, paid: direct + allocated };
}
/** How much of an on-account payment is not yet allocated to a quotation. */
export function unallocated(p: LClientPayment, allocations: LAllocation[]): number {
  if (p.reversed_at) return 0;
  return Math.max(0, (Number(p.amount) || 0) - allocations.filter(a => a.client_payment_id === p.id && !a.voided_at).reduce((t, a) => t + (Number(a.amount) || 0), 0));
}

// ---- Outstanding ageing ----------------------------------------------------------------------------------------------------------
// Money received is applied to the OLDEST bills first (opening balance is the oldest). What is left on each bill is aged from the quotation date.
export interface Ageing { current: number; d31: number; d61: number; d90: number; total: number; advance: number }
const dayNo = (ymd: string) => { const [y, m, d] = ymd.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86400000); };
export function ageingFor(accountId: string, d: { clients: LClient[]; quotations: LQuotation[]; payments: LPayment[]; clientPayments: LClientPayment[] }, today: string): Ageing {
  const led = buildLedger(accountId, d);
  const bills: { date: string; amount: number }[] = [];
  let credit = led.received;
  if (led.opening > 0) bills.push({ date: '', amount: led.opening }); else credit += -led.opening;
  for (const l of led.lines) if (l.kind === 'bill') bills.push({ date: l.date, amount: l.debit });
  bills.sort((a, b) => a.date.localeCompare(b.date));   // '' (opening) sorts first
  const out: Ageing = { current: 0, d31: 0, d61: 0, d90: 0, total: 0, advance: 0 };
  for (const b of bills) {
    const used = Math.min(credit, b.amount); credit -= used;
    const left = b.amount - used; if (left <= 0) continue;
    const age = b.date ? dayNo(today) - dayNo(b.date) : Infinity;
    if (age <= 30) out.current += left; else if (age <= 60) out.d31 += left; else if (age <= 90) out.d61 += left; else out.d90 += left;
    out.total += left;
  }
  out.advance = credit > 0 ? credit : 0;
  return out;
}
/** One row per paying account that owes money or holds an advance. */
export function ageingAll(d: { clients: LClient[]; quotations: LQuotation[]; payments: LPayment[]; clientPayments: LClientPayment[] }, today: string): { account: LClient; age: Ageing }[] {
  return d.clients.filter(c => payerOf(c) === c.id).map(c => ({ account: c, age: ageingFor(c.id, d, today) })).filter(r => r.age.total > 0.004 || r.age.advance > 0.004).sort((a, b) => b.age.total - a.age.total);
}
