// Client 360 "Activity" tab: one timeline built from the records the person is allowed to read (no audit-log access needed).
// Pure function so it can be tested.
export type ActivityKind = 'client' | 'vehicle' | 'quotation' | 'case' | 'payment' | 'audit';
export interface ActivityItem { key: string; at: string; kind: ActivityKind; text: string; detail?: string; ref?: { type: 'quotation' | 'vehicle' | 'case'; id: string } }

export interface ActivityInput {
  client: { id: string; name: string; created_at: string };
  vehicles: { id: string; registration_number: string | null; company: string | null; model: string | null; created_at: string }[];
  quotations: { id: string; quotation_number: string; status: string; grand_total: number; created_at: string }[];
  cases: { id: string; case_no: string; status: string; created_at: string }[];
  payments: { id: string; amount: number; payment_date: string; created_at?: string | null; text: string; detail?: string }[];
  audit?: { id: string; action: string; details: Record<string, unknown> | null; created_at: string }[];
}

const AUDIT_TEXT: Record<string, string> = {
  client_archived: 'Client archived', client_restored: 'Client brought back', client_status_changed: 'Client status changed',
  client_assigned: 'Client assignment changed', client_updated: 'Client details changed', vehicle_added: 'Vehicle added', vehicle_updated: 'Vehicle details changed',
  vehicle_deleted: 'Vehicle deleted', client_payment_recorded: 'Payment recorded', client_payment_deleted: 'Payment deleted',
};
const vehicleLabel = (v: { registration_number: string | null; company: string | null; model: string | null }) => [v.registration_number, [v.company, v.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || 'vehicle';

export function buildActivity(i: ActivityInput, limit = 60): ActivityItem[] {
  const out: ActivityItem[] = [{ key: 'c' + i.client.id, at: i.client.created_at, kind: 'client', text: 'Client created' }];
  for (const v of i.vehicles) out.push({ key: 'v' + v.id, at: v.created_at, kind: 'vehicle', text: 'Vehicle added', detail: vehicleLabel(v), ref: { type: 'vehicle', id: v.id } });
  for (const q of i.quotations) out.push({ key: 'q' + q.id, at: q.created_at, kind: 'quotation', text: `Quotation ${q.quotation_number} created`, detail: q.status, ref: { type: 'quotation', id: q.id } });
  for (const c of i.cases) out.push({ key: 'k' + c.id, at: c.created_at, kind: 'case', text: `Case ${c.case_no} opened`, detail: c.status, ref: { type: 'case', id: c.id } });
  for (const p of i.payments) out.push({ key: 'p' + p.id, at: p.created_at || p.payment_date, kind: 'payment', text: p.text, detail: p.detail });
  // audit rows only exist for the owner; entries about things already shown above (created quotation etc.) are skipped to avoid doubles
  for (const a of i.audit ?? []) {
    if (!AUDIT_TEXT[a.action] || a.action === 'vehicle_added' || a.action === 'client_payment_recorded') continue;
    const d = a.details ?? {};
    const detail = ['name', 'registration', 'to', 'assigned_to_name', 'status'].map(k => d[k]).filter(x => typeof x === 'string' && x).join(' · ');
    out.push({ key: 'a' + a.id, at: a.created_at, kind: 'audit', text: AUDIT_TEXT[a.action], detail: detail || undefined });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key)).slice(0, limit);
}
