import { PROVINCES, VEHICLE_CATEGORIES, type Client, type Province, type Vehicle, type VehicleCategory } from '@/lib/supabase';
import SearchSelect from '@/components/SearchSelect';
import { Field, Input, Select } from '@/components/ui';

export interface VehicleFormState {
  client_id: string; registration_number: string; chassis_number: string; engine_number: string; company: string; model: string;
  manufacturing_year: string; engine_cc: string; province: Province; vehicle_category: VehicleCategory;
  token_tax_due: string; registration_due: string;
}
export const blankVehicle = (clientId = ''): VehicleFormState => ({
  client_id: clientId, registration_number: '', chassis_number: '', engine_number: '', company: '', model: '',
  manufacturing_year: '', engine_cc: '', province: 'punjab', vehicle_category: 'car', token_tax_due: '', registration_due: '',
});
export const vehicleToForm = (v: Vehicle): VehicleFormState => ({
  client_id: v.client_id ?? '', registration_number: v.registration_number ?? '', chassis_number: v.chassis_number ?? '', engine_number: v.engine_number ?? '',
  company: v.company ?? '', model: v.model ?? '', manufacturing_year: String(v.manufacturing_year ?? ''), engine_cc: String(v.engine_cc ?? ''),
  province: (v.province ?? 'punjab') as Province, vehicle_category: (v.vehicle_category ?? 'car') as VehicleCategory,
  token_tax_due: v.token_tax_due ?? '', registration_due: v.registration_due ?? '',
});
/** chassis / engine are only sent once the M2 migration exists (migrated), so the form also works before it is run. */
export function vehiclePayload(f: VehicleFormState, migrated: boolean): Record<string, unknown> {
  const p: Record<string, unknown> = {
    client_id: f.client_id || null, registration_number: f.registration_number.trim().toUpperCase() || null,
    company: f.company.trim() || null, model: f.model.trim() || null,
    manufacturing_year: f.manufacturing_year ? Number(f.manufacturing_year) : null, engine_cc: f.engine_cc ? Number(f.engine_cc) : null,
    province: f.province, vehicle_category: f.vehicle_category,
  };
  if (migrated) { p.chassis_number = f.chassis_number.trim().toUpperCase() || null; p.engine_number = f.engine_number.trim().toUpperCase() || null; }
  // renewal dates need migration M12; sent only when filled so the form still works before it is run
  if (f.token_tax_due) p.token_tax_due = f.token_tax_due;
  if (f.registration_due) p.registration_due = f.registration_due;
  return p;
}
/** Returns a message when the form should not be saved, otherwise ''. */
export function vehicleProblem(f: VehicleFormState): string {
  if (!f.registration_number.trim() && !f.chassis_number.trim() && !f.company.trim() && !f.model.trim()) return 'Enter at least a registration number, chassis number, make or model.';
  const y = Number(f.manufacturing_year);
  if (f.manufacturing_year && (!Number.isInteger(y) || y < 1950 || y > new Date().getFullYear() + 1)) return 'Check the manufacturing year.';
  if (f.engine_cc && !(Number(f.engine_cc) > 0 && Number(f.engine_cc) < 20000)) return 'Check the engine CC.';
  return '';
}

export default function VehicleFields({ form, setForm, clients, lockOwner, migrated }: {
  form: VehicleFormState; setForm: (f: VehicleFormState) => void; clients?: Client[]; lockOwner?: boolean; migrated: boolean;
}) {
  const set = <K extends keyof VehicleFormState>(k: K, v: VehicleFormState[K]) => setForm({ ...form, [k]: v });
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {clients && !lockOwner && (
        <Field label="Owner (client)">
          <SearchSelect value={form.client_id} onChange={v => set('client_id', v)} emptyLabel="No owner linked" placeholder="Type owner name…"
            options={clients.filter(c => !c.archived_at || c.id === form.client_id).map(c => ({ value: c.id, label: c.name, hint: c.phone ?? undefined }))} />
        </Field>
      )}
      <Field label="Registration No."><Input value={form.registration_number} onChange={e => set('registration_number', e.target.value)} placeholder="LEA-21-1234" className="uppercase" /></Field>
      {migrated && <Field label="Chassis No."><Input value={form.chassis_number} onChange={e => set('chassis_number', e.target.value)} className="uppercase" /></Field>}
      {migrated && <Field label="Engine No."><Input value={form.engine_number} onChange={e => set('engine_number', e.target.value)} className="uppercase" /></Field>}
      <Field label="Token tax due" hint="For renewal reminders"><Input type="date" value={form.token_tax_due} onChange={e => set('token_tax_due', e.target.value)} /></Field>
      <Field label="Registration renewal due"><Input type="date" value={form.registration_due} onChange={e => set('registration_due', e.target.value)} /></Field>
      <Field label="Make"><Input value={form.company} onChange={e => set('company', e.target.value)} placeholder="Toyota" /></Field>
      <Field label="Model"><Input value={form.model} onChange={e => set('model', e.target.value)} placeholder="Corolla" /></Field>
      <Field label="Year"><Input type="number" inputMode="numeric" value={form.manufacturing_year} onChange={e => set('manufacturing_year', e.target.value)} /></Field>
      <Field label="Engine CC"><Input type="number" inputMode="numeric" value={form.engine_cc} onChange={e => set('engine_cc', e.target.value)} /></Field>
      <Field label="Province"><Select value={form.province} onChange={e => set('province', e.target.value as Province)}>{PROVINCES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>
      <Field label="Category"><Select value={form.vehicle_category} onChange={e => set('vehicle_category', e.target.value as VehicleCategory)}>{VEHICLE_CATEGORIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>
    </div>
  );
}
