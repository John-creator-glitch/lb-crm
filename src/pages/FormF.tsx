import { useEffect, useMemo, useState } from 'react';
import SearchSelect from '@/components/SearchSelect';
import { supabase, type Client, type Vehicle } from '@/lib/supabase';
import { PageHeader, Card, Button, Field, Input, Select } from '@/components/ui';
import { buildFormFPdf, EMPTY_FORM_F, FORM_F_PREFILL_KEY, type FormFValues } from '@/lib/formF';
import { maskCnic } from '@/lib/cnic';
import { Download, Printer, Eraser } from 'lucide-react';
import { fetchAll } from '@/lib/fetchAll';

const cap = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

export default function FormF() {
  const [v, setV] = useState<FormFValues>(EMPTY_FORM_F);
  const [clients, setClients] = useState<Client[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [clientId, setClientId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Data sent from the Transfers page ("Form F" button)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(FORM_F_PREFILL_KEY);
      if (raw) { sessionStorage.removeItem(FORM_F_PREFILL_KEY); setV({ ...EMPTY_FORM_F, ...(JSON.parse(raw) as Partial<FormFValues>) }); }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    (async () => {
      const [c, ve] = await Promise.all([
        fetchAll<any>((a, b) => supabase.from('clients').select('*').order('name').order('id').range(a, b)),
        fetchAll<any>((a, b) => supabase.from('vehicles').select('*').order('created_at', { ascending: false }).order('id').range(a, b)),
      ]);
      setClients((c.data as Client[]) ?? []);
      setVehicles((ve.data as Vehicle[]) ?? []);
    })();
  }, []);

  const set = (k: keyof FormFValues, val: string) => setV(p => ({ ...p, [k]: val }));
  const text = (k: keyof FormFValues, label: string, hint?: string) => (
    <Field label={label} hint={hint}><Input value={v[k]} onChange={e => set(k, e.target.value)} /></Field>
  );

  const clientVehicles = useMemo(() => vehicles.filter(x => !clientId || x.client_id === clientId), [vehicles, clientId]);

  function fillFromClient(id: string) {
    setClientId(id); setVehicleId('');
    const c = clients.find(x => x.id === id); if (!c) return;
    setV(p => ({ ...p, full_name: c.name.toUpperCase(), cnic: maskCnic(c.cnic ?? ''), phone: c.phone ?? '', postal_address: c.address ?? '', permanent_address: p.permanent_address || (c.address ?? '') }));
  }
  function fillFromVehicle(id: string) {
    setVehicleId(id);
    const x = vehicles.find(q => q.id === id); if (!x) return;
    if (x.client_id && x.client_id !== clientId) fillFromClient(x.client_id);
    setVehicleId(id);
    setV(p => ({
      ...p, maker: x.company ?? p.maker, make: x.model ?? p.make, year: x.manufacturing_year ? String(x.manufacturing_year) : p.year,
      cc: x.engine_cc ? String(x.engine_cc) : p.cc, fuel: cap(x.fuel_type) || p.fuel, ownership: p.ownership || 'Private',
      prev_reg: x.registration_type === 'transfer' && x.registration_number ? x.registration_number : p.prev_reg,
    }));
  }

  async function make(mode: 'download' | 'print') {
    setError(''); setBusy(true);
    const win = mode === 'print' ? window.open('', '_blank') : null; // opened first so the browser does not block it
    try {
      const { blob, filename } = await buildFormFPdf(v);
      const url = URL.createObjectURL(blob);
      if (mode === 'print' && win) { win.location.href = url; }
      else {
        const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      win?.close();
      setError('Could not create the PDF: ' + (e instanceof Error ? e.message : String(e)));
    } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader
        title="Form F"
        subtitle="Form of application for registration of motor vehicles [see section 25(1)]. The printed form is the same as the government form; only your typed details are added."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => { setV(EMPTY_FORM_F); setClientId(''); setVehicleId(''); }}><Eraser className="w-4 h-4" /> Clear</Button>
            <Button variant="secondary" disabled={busy} onClick={() => make('download')}><Download className="w-4 h-4" /> Download PDF</Button>
            <Button disabled={busy} onClick={() => make('print')}><Printer className="w-4 h-4" /> Print</Button>
          </div>
        }
      />
      {error && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm p-3">{error}</div>}

      <Card className="p-4 mb-4">
        <div className="text-sm font-semibold text-slate-800 mb-1">Fill from saved data (optional)</div>
        <p className="text-xs text-slate-500 mb-3">Pick a client and/or vehicle to fill the matching boxes. You can change anything afterwards. Leave a box empty to write it by hand on the printout.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Client"><SearchSelect value={clientId} onChange={fillFromClient} emptyLabel="Select client" options={clients.map(c => ({ value: c.id, label: c.name, hint: c.cnic ?? c.phone ?? undefined }))} /></Field>
          <Field label="Vehicle"><Select value={vehicleId} onChange={e => fillFromVehicle(e.target.value)}>
            <option value="">Select vehicle</option>{clientVehicles.map(x => <option key={x.id} value={x.id}>{[x.registration_number, x.company, x.model].filter(Boolean).join(' ') || 'Vehicle'}</option>)}
          </Select></Field>
        </div>
      </Card>

      <Card className="p-4 mb-4">
        <div className="text-sm font-semibold text-slate-800 mb-3">Owner details (1 to 6)</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="1. Full Name (block letters)"><Input value={v.full_name} onChange={e => set('full_name', e.target.value.toUpperCase())} /></Field>
          <Field label="2. Father's / Husband's Name (block letters)"><Input value={v.father_name} onChange={e => set('father_name', e.target.value.toUpperCase())} /></Field>
          {text('postal_address', '3. Postal Address', 'Long addresses continue on the second line automatically.')}
          {text('permanent_address', 'Permanent Address')}
          {text('phone', '4. Phone No.')}
          {text('ntn', '5. NTN')}
          <Field label="6. CNIC"><Input value={v.cnic} inputMode="numeric" placeholder="12345-1234567-1" onChange={e => set('cnic', maskCnic(e.target.value))} /></Field>
        </div>
      </Card>

      <Card className="p-4 mb-4">
        <div className="text-sm font-semibold text-slate-800 mb-3">Vehicle details (7 to 16)</div>
        <div className="grid sm:grid-cols-2 gap-3">
          {text('maker', "7. Maker's Name", 'e.g. Toyota')}
          {text('make', '8. Make', 'e.g. Corolla')}
          {text('year', '9. Year of manufacture')}
          {text('colour', '10. Colour')}
          {text('chassis', '11. Chassis Number')}
          {text('engine_no', '12. Engine Number')}
          {text('cc', '13. Engine Capacity (CC)')}
          {text('kws', '13. Engine Capacity (Kws)', 'Only if given in Kws')}
          {text('fuel', '14. Type of Fuel')}
          {text('seats', '15. Seating Capacity (Including Driver)')}
          <Field label="16. Type of ownership">
            <Select value={v.ownership} onChange={e => set('ownership', e.target.value)}>
              <option value="">Leave empty</option><option>Private</option><option>Government</option><option>Semi Government</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card className="p-4 mb-4">
        <div className="text-sm font-semibold text-slate-800 mb-3">17. Possessor of vehicle (in case of financing) and 19. Previous registration</div>
        <div className="grid sm:grid-cols-2 gap-3">
          {text('poss_name', 'I. Name')}
          {text('poss_cnic', 'II. CNIC')}
          {text('poss_contact', 'III. Contact')}
          {text('prev_reg', '19. Previous registration number and date of registration (if any)')}
          {text('hire_purchase_with', 'Hire Purchase: agreement with', 'Bank / company name, only if financed')}
        </div>
      </Card>

      <Card className="p-4 mb-4">
        <div className="text-sm font-semibold text-slate-800 mb-1">Commercial vehicles only</div>
        <p className="text-xs text-slate-500 mb-3">Leave these empty for private cars.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {text('tyre', '1. Number, description and size of tyre')}
          {text('laden_total', '2. Maximum laden weight (Lbs.)')}
          {text('laden_front', '2(a). Front axle (Lbs.)')}
          {text('laden_rear_b', '2(b). Rear axle (Lbs.)')}
          {text('laden_rear_c', '2(c). Rear axle (Lbs.)')}
          {text('axle_total', '3. Maximum axel weight (Lbs.)')}
          {text('axle_front', '3(a). Front axle (Lbs.)')}
          {text('axle_rear_b', '3(b). Rear axle (Lbs.)')}
          {text('axle_rear_c', '3(c). Rear axle (Lbs.)')}
        </div>
        <div className="text-sm font-semibold text-slate-800 mt-4 mb-3">Additional trailer</div>
        <div className="grid sm:grid-cols-2 gap-3">
          {text('trailer_body', '(a) Type of Body')}
          {text('trailer_unladen', '(b) Unladen weight')}
          {text('trailer_tyres', '(c) Number, description and size of tyres on the axle')}
          {text('trailer_axle', '(d) Maximum axel weight')}
        </div>
      </Card>
    </div>
  );
}
