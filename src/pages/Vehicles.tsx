import { useCan } from '@/lib/permissions';
import { useEffect, useState } from 'react';
import { supabase, type Vehicle, type Client } from '@/lib/supabase';
import { useDrillIds, DrillBanner } from '@/lib/drill';
import { PAGE_SIZE, Pager, PageHeader, Card, Spinner, EmptyState, Button } from '@/components/ui';
import { downloadCSV } from '@/lib/csv';
import { buildHaystack, matchesQuery } from '@/lib/search';
import { useDuplicates, useDupAck } from '@/lib/useDuplicates';
import DuplicateWarning from '@/components/DuplicateWarning';
import VehicleFields, { blankVehicle, vehicleToForm, vehiclePayload, vehicleProblem, type VehicleFormState } from '@/components/VehicleFields';
import { whatsappUrl } from '@/lib/errors';
import { fillTemplate } from '@/lib/crm';
import { useSettings } from '@/lib/settings';
import { pkToday, addDays } from '@/lib/time';
import { Car, Plus, Search, X, Download, Trash2, UserRound } from 'lucide-react';
import { friendlyError } from '@/lib/errors';
import { fetchAll } from '@/lib/fetchAll';

export default function Vehicles({ onOpenClient }: { onOpenClient?: (clientId: string, tab?: 'vehicles') => void }) {
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Vehicle[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [caseCount, setCaseCount] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Vehicle | 'new' | null>(null);
  const [form, setForm] = useState<VehicleFormState>(blankVehicle());
  const [m2, setM2] = useState(false);
  const [renewOnly, setRenewOnly] = useState(false);
  const biz = useSettings().business_name;
  const soon = addDays(pkToday(), 30);
  const dueOf = (v: Vehicle) => [v.token_tax_due, v.registration_due].filter((d): d is string => !!d).sort()[0] ?? null;

  async function load() {
    setLoading(true);
    const [v, c, cs] = await Promise.all([
      fetchAll<any>((a, b) => supabase.from('vehicles').select('*').order('created_at', { ascending: false }).order('id').range(a, b)),
      fetchAll<any>((a, b) => supabase.from('clients').select('*').order('name').order('id').range(a, b)),
      fetchAll<any>((a, b) => supabase.from('cases').select('vehicle_id').order('id').range(a, b)),
    ]);
    if (v.error) setError('Vehicles could not be loaded: ' + friendlyError(v.error));
    const vs = (v.data as Vehicle[]) ?? [];
    setRows(vs);
    setClients((c.data as Client[]) ?? []);
    setM2(vs.length === 0 ? true : 'chassis_number' in vs[0]); // the chassis column exists only after the M2 migration
    const counts: Record<string, number> = {};
    (cs.data ?? []).forEach((r: any) => { if (r.vehicle_id) counts[r.vehicle_id] = (counts[r.vehicle_id] ?? 0) + 1; });
    setCaseCount(counts);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const dup = useDuplicates(editing ? { registration: form.registration_number, chassis: form.chassis_number, excludeVehicle: editing === 'new' ? null : editing.id } : {});
  const ack = useDupAck(dup.result);

  const owner = (id: string | null) => clients.find(c => c.id === id)?.name ?? '';
  const { ids: drillIds } = useDrillIds('vehicles');
  const filtered = rows.filter(v => (!drillIds || drillIds.has(v.id)) && (!renewOnly || (dueOf(v) !== null && dueOf(v)! <= soon)) && (!search.trim() || matchesQuery(search, buildHaystack([v.registration_number, v.chassis_number, v.engine_number, v.company, v.model, owner(v.client_id)]))));

  function openEdit(v: Vehicle) { setForm(vehicleToForm(v)); setEditing(v); setError(''); }

  async function save() {
    const problem = vehicleProblem(form); if (problem) { setError(problem); return; }
    if (ack.needsConfirm) { ack.confirm(); setError(''); return; }
    const payload = vehiclePayload(form, m2);
    if (rows[0] && 'token_tax_due' in rows[0]) { payload.token_tax_due = form.token_tax_due || null; payload.registration_due = form.registration_due || null; }
    const res = editing === 'new' ? await supabase.from('vehicles').insert(payload).select().maybeSingle() : await supabase.from('vehicles').update(payload).eq('id', (editing as Vehicle).id).select().maybeSingle();
    if (res.error) { setError('Vehicle was not saved: ' + friendlyError(res.error)); return; }
    const id = (res.data as Vehicle | null)?.id ?? (editing as Vehicle).id;
    await supabase.from('audit_logs').insert({ action: editing === 'new' ? 'vehicle_added' : 'vehicle_updated', entity_type: 'vehicle', entity_id: id, details: { client_id: form.client_id || null, registration: form.registration_number.trim().toUpperCase() } });
    setEditing(null); setError(''); load();
  }

  const canDelete = useCan('manager');
  async function remove(v: Vehicle) {
    if (!confirm(`Delete this vehicle${v.registration_number ? ' (' + v.registration_number + ')' : ''}?${caseCount[v.id] ? `\n\n${caseCount[v.id]} case(s) use it and will show no vehicle.` : ''}`)) return;
    const { error: e } = await supabase.from('vehicles').delete().eq('id', v.id);
    if (e) { setError(e.message); return; }
    await supabase.from('audit_logs').insert({ action: 'vehicle_deleted', entity_type: 'vehicle', entity_id: v.id, details: { client_id: v.client_id, registration: v.registration_number ?? '' } });
    setRows(rs => rs.filter(x => x.id !== v.id));
  }

  if (loading) return <Spinner label="Loading vehicles..." />;

  return (
    <>
      <DrillBanner route="vehicles" shown={drillIds ? rows.filter(r => drillIds.has(r.id)).length : undefined} />
      <PageHeader title="Vehicles" subtitle={`${rows.length} vehicles`}
        action={<div className="flex gap-2">
          <Button variant="secondary" onClick={() => downloadCSV('vehicles.csv', [['Registration', 'Chassis', 'Engine No', 'Owner', 'Make', 'Model', 'Year', 'CC', 'Cases'], ...filtered.map(v => [v.registration_number, v.chassis_number, v.engine_number, owner(v.client_id), v.company, v.model, v.manufacturing_year, v.engine_cc, caseCount[v.id] ?? 0])])}><Download className="w-4 h-4" /> CSV</Button>
          <Button onClick={() => { setForm(blankVehicle()); setEditing('new'); setError(''); }}><Plus className="w-4 h-4" /> Add Vehicle</Button>
        </div>} />
      {error && <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700" role="alert">{error}</div>}
      {!m2 && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Chassis / engine number and duplicate warnings need the Client 360 database update: run <span className="font-mono text-xs">20261117090000_m2_client_360_vehicles.sql</span> once on staging.</div>}

      {editing && (
        <Card className="p-4 sm:p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">{editing === 'new' ? 'New Vehicle' : 'Edit Vehicle'}</h2>
            <button onClick={() => setEditing(null)} className="p-1 text-slate-500 hover:text-slate-600" aria-label="Close"><X className="w-4 h-4" /></button>
          </div>
          <VehicleFields form={form} setForm={setForm} clients={clients} migrated={m2} />
          <div className="mt-4 space-y-3">
            <DuplicateWarning result={dup.result} checking={dup.checking} onOpenClient={id => onOpenClient?.(id, 'vehicles')} acknowledged={!ack.needsConfirm} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={save}>{ack.needsConfirm ? 'Save (I checked the duplicate)' : 'Save Vehicle'}</Button>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-4 mb-4">
        <label className="flex items-center gap-2 text-sm text-slate-600 mb-3"><input type="checkbox" checked={renewOnly} onChange={e => { setRenewOnly(e.target.checked); setPage(0); }} /> Renewals due in 30 days (or overdue)</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search registration, chassis, make, model, owner..." aria-label="Search vehicles"
            className="w-full pl-10 pr-3 py-2 bg-white border border-slate-300 rounded-lg text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30" />
        </div>
      </Card>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? <EmptyState icon={Car} title={search.trim() ? 'No vehicle matches your search' : 'No vehicles yet'} subtitle={search.trim() ? undefined : 'Vehicles are added here, from a client\'s page, or when a quotation is saved.'} /> : (
          <div className="divide-y divide-slate-100">
            {filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(v => (
              <div key={v.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                <button onClick={() => openEdit(v)} className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-semibold text-slate-900">{v.registration_number || v.chassis_number || 'No registration yet'}</p>
                  <p className="text-sm text-slate-600 truncate">{[v.company, v.model, v.manufacturing_year].filter(Boolean).join(' ') || 'No details'}{owner(v.client_id) ? ` · ${owner(v.client_id)}` : ' · no owner linked'}</p>
                </button>
                {dueOf(v) && <span className={`text-xs px-2 py-0.5 rounded-full ${dueOf(v)! < pkToday() ? 'bg-red-100 text-red-700' : dueOf(v)! <= soon ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>Renewal {dueOf(v)}</span>}
                {dueOf(v) && (() => { const c = clients.find(x => x.id === v.client_id); const u = c ? whatsappUrl(c.phone, fillTemplate('Assalam o Alaikum {name}, aap ki gari {vehicle} ka token tax / registration {date} ko due hai. Hum se rabta karein. {business}', { name: c.name, vehicle: v.registration_number ?? [v.company, v.model].filter(Boolean).join(' '), date: dueOf(v)!, business: biz })) : null; return u ? <a href={u} target="_blank" rel="noopener noreferrer" className="p-2 text-emerald-600" aria-label="Send renewal reminder on WhatsApp" title="WhatsApp reminder">WA</a> : null; })()}
                <span className="text-xs text-slate-500 hidden sm:inline">{caseCount[v.id] ?? 0} cases</span>
                {v.client_id && onOpenClient && <button onClick={() => onOpenClient(v.client_id!, 'vehicles')} className="p-2 text-slate-300 hover:text-amber-600" aria-label={`Open client ${owner(v.client_id)}`} title="Open client"><UserRound className="w-4 h-4" /></button>}
                {canDelete && <button onClick={() => remove(v)} className="p-2 text-slate-300 hover:text-rose-500" aria-label="Delete vehicle"><Trash2 className="w-4 h-4" /></button>}
              </div>
            ))}
          </div>
        )}
        <div className="px-4 pb-4"><Pager page={page} total={filtered.length} onPage={setPage} resetKey={filtered.length} /></div>
      </Card>
    </>
  );
}
