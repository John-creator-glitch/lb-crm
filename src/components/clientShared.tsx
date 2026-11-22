import { CLIENT_TYPES, type Client, type ClientPayment, type Payment, type PaymentAllocation, type Quotation, type Vehicle, type CaseRow } from '@/lib/supabase';
import { Field, Input, Select, Textarea } from '@/components/ui';
import { formatPKR } from '@/lib/format';

export type CType = 'direct' | 'showroom' | 'agent';
export const typeMeta = (t?: string) => CLIENT_TYPES.find(x => x.value === (t ?? 'direct')) ?? CLIENT_TYPES[0];
export const BUSINESS_TYPE_SUGGESTIONS = ['Garage / workshop', 'Leasing / bank', 'Company / fleet', 'Rent-a-car', 'Transporter', 'Other'];

export interface ProfileLite { id: string; full_name: string; role: string; active?: boolean }
export interface AllData {
  clients: Client[]; quotations: Quotation[]; payments: Payment[]; clientPayments: ClientPayment[]; allocations: PaymentAllocation[]; vehicles: Vehicle[];
  cases: Pick<CaseRow, 'id' | 'case_no' | 'client_id' | 'vehicle_id' | 'quotation_id' | 'service_type' | 'status' | 'opened_on' | 'created_at' | 'stage'>[];
  profiles: ProfileLite[];
  migrated: boolean;     // client ledger migration (20261108150000)
  m2: boolean;           // Client 360 migration (20261117090000)
  m4: boolean;           // payments & ledger migration (20261119090000)
}

export const blankForm = { name: '', phone: '', email: '', cnic: '', address: '', notes: '', care_of: '', client_type: 'direct' as CType, parent_id: '', bill_to_parent: true, opening_balance: '', business_type: '' };
export type ClientFormState = typeof blankForm;

export function Balance({ amount, big }: { amount: number; big?: boolean }) {
  const cls = amount > 0 ? 'text-rose-600' : amount < 0 ? 'text-blue-600' : 'text-emerald-600';
  const label = amount > 0 ? 'Pending' : amount < 0 ? 'Advance' : 'Paid up';
  return (
    <div className="text-right">
      <p className={`${big ? 'text-lg' : 'text-sm'} font-bold tabular-nums ${cls}`}>{amount === 0 ? 'Rs 0' : formatPKR(Math.abs(amount))}</p>
      <p className={`text-[11px] font-medium ${cls}`}>{label}</p>
    </div>
  );
}

/** The fields written to the clients table. M2 fields (business type) are only sent once that migration exists. */
export function clientPayload(form: ClientFormState, d: { migrated: boolean; m2: boolean }): Record<string, unknown> {
  const row: Record<string, unknown> = { name: form.name.trim(), phone: form.phone.trim() || null, email: form.email.trim() || null, cnic: form.cnic.trim() || null, address: form.address.trim() || null, notes: form.notes.trim() || null };
  if (d.migrated) Object.assign(row, { client_type: form.client_type, care_of: form.care_of.trim() || null, parent_id: form.parent_id || null, bill_to_parent: !!form.parent_id && form.bill_to_parent, opening_balance: Number(form.opening_balance) || 0 });
  if (d.m2) row.business_type = form.business_type.trim() || null;
  return row;
}
/** Message when the form must not be saved, otherwise ''. */
export function clientProblem(form: ClientFormState): string {
  if (!form.name.trim()) return 'Enter the client name.';
  if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) return 'The email address does not look right.';
  if (form.opening_balance && !Number.isFinite(Number(form.opening_balance))) return 'The opening balance must be a number.';
  return '';
}

export function ClientForm({ form, setForm, parents, migrated, m2, selfId }: { form: ClientFormState; setForm: (f: ClientFormState) => void; parents: Client[]; migrated: boolean; m2?: boolean; selfId?: string }) {
  const set = (k: keyof ClientFormState, v: string | boolean) => setForm({ ...form, [k]: v });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {migrated && (
        <div className="sm:col-span-2">
          <Field label="Client type">
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1" role="radiogroup" aria-label="Client type">
              {CLIENT_TYPES.map(t => (
                <button key={t.value} type="button" role="radio" aria-checked={form.client_type === t.value} onClick={() => set('client_type', t.value)} className={`px-2 py-2 text-xs sm:text-sm font-medium rounded-md transition ${form.client_type === t.value ? 'bg-white text-amber-700 shadow-sm ring-1 ring-amber-300' : 'text-slate-500'}`}>{t.label}</button>
              ))}
            </div>
          </Field>
        </div>
      )}
      <Field label={form.client_type === 'showroom' ? 'Showroom name' : 'Full Name'} required><Input value={form.name} onChange={e => set('name', e.target.value)} /></Field>
      <Field label="Phone"><Input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="03xx-xxxxxxx" inputMode="tel" /></Field>
      <Field label="CNIC"><Input value={form.cnic} onChange={e => set('cnic', e.target.value)} placeholder="xxxxx-xxxxxxx-x" inputMode="numeric" /></Field>
      <Field label="Email"><Input value={form.email} onChange={e => set('email', e.target.value)} type="email" /></Field>
      {m2 && (
        <Field label="Business type (optional)" hint="For example Garage, Leasing, Fleet. Type your own if none fits">
          <Input value={form.business_type} onChange={e => set('business_type', e.target.value)} list="lb-business-types" />
          <datalist id="lb-business-types">{BUSINESS_TYPE_SUGGESTIONS.map(s => <option key={s} value={s} />)}</datalist>
        </Field>
      )}
      {migrated && (
        <>
          <Field label="Came through (showroom / contact person)" hint="Leave empty for an individual client">
            <Select value={form.parent_id} onChange={e => set('parent_id', e.target.value)}>
              <option value="">None (direct)</option>
              {parents.filter(p => p.id !== selfId).map(p => <option key={p.id} value={p.id}>{p.name} ({typeMeta(p.client_type).label})</option>)}
            </Select>
          </Field>
          <Field label="Care of (C/O)" hint="Name of the person who sent or looks after this client"><Input value={form.care_of} onChange={e => set('care_of', e.target.value)} /></Field>
          {form.parent_id && (
            <label className="sm:col-span-2 flex items-start gap-2 text-sm text-slate-700 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <input type="checkbox" className="mt-0.5" checked={form.bill_to_parent} onChange={e => set('bill_to_parent', e.target.checked)} />
              <span><span className="font-medium">The showroom / contact person pays for this client.</span><br /><span className="text-xs text-slate-500">All quotations of this client go into the showroom's ledger and the pending amount is collected from the showroom. Untick if the client pays by themselves.</span></span>
            </label>
          )}
          <Field label="Opening balance (PKR)" hint="Old pending amount from before this system. Leave 0 if none. Use a minus sign for an advance already paid">
            <Input type="number" value={form.opening_balance} onChange={e => set('opening_balance', e.target.value)} placeholder="0" />
          </Field>
        </>
      )}
      <div className="sm:col-span-2"><Field label="Address"><Input value={form.address} onChange={e => set('address', e.target.value)} /></Field></div>
      <div className="sm:col-span-2"><Field label="Notes"><Textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field></div>
    </div>
  );
}
