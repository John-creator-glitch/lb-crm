import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Search, X, Loader2, Users, Car, Building2 } from 'lucide-react';

interface SClient { id: string; name: string; phone: string | null; cnic: string | null; client_type: string | null; care_of: string | null; archived: boolean }
interface SVehicle { id: string; client_id: string | null; client_name: string | null; registration_number: string | null; chassis_number: string | null; engine_number: string | null; company: string | null; model: string | null; manufacturing_year: number | null }

/** One search for client name, phone, CNIC, C/O and vehicle registration / chassis / engine number.
 *  Runs as the signed-in user in the database (row level security), and never returns money amounts. */
export default function GlobalSearch({ open, onClose, onOpenClient, onOpenVehicleOnly }: {
  open: boolean; onClose: () => void; onOpenClient: (clientId: string, tab?: 'vehicles') => void; onOpenVehicleOnly: () => void;
}) {
  const [q, setQ] = useState('');
  const [clients, setClients] = useState<SClient[]>([]);
  const [vehicles, setVehicles] = useState<SVehicle[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setQ(''); setClients([]); setVehicles([]); setErr(''); setTimeout(() => input.current?.focus(), 30); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) { setClients([]); setVehicles([]); setBusy(false); setErr(''); return; }
    let cancelled = false; setBusy(true);
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('global_search', { p_q: q.trim(), p_limit: 12 });
      if (cancelled) return;
      setBusy(false);
      if (error || !data) { setErr(error?.message.includes('global_search') ? 'Search is not switched on yet. Run migration 20261117090000_m2_client_360_vehicles.sql once.' : 'Search failed: ' + (error?.message ?? 'no answer') + '. Check your connection and try again.'); setClients([]); setVehicles([]); return; }
      setErr(''); setClients((data as any).clients ?? []); setVehicles((data as any).vehicles ?? []);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, open]);

  if (!open) return null;
  const empty = q.trim().length >= 2 && !busy && !err && clients.length === 0 && vehicles.length === 0;
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center p-3 sm:pt-[10vh]" onClick={onClose} role="dialog" aria-modal="true" aria-label="Search">
      <div className="w-full max-w-xl bg-white rounded-xl shadow-2xl overflow-hidden self-start" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 border-b border-slate-200">
          <Search className="w-4 h-4 text-slate-500" />
          <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder="Client name, phone, CNIC, or vehicle number / chassis..." aria-label="Search clients and vehicles"
            className="flex-1 py-3.5 text-base sm:text-sm outline-none bg-transparent" />
          {busy && <Loader2 className="w-4 h-4 animate-spin text-slate-500" />}
          <button onClick={onClose} className="p-2 -mr-2 text-slate-500 hover:text-slate-700" aria-label="Close search"><X className="w-4 h-4" /></button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto">
          {q.trim().length < 2 && <p className="px-4 py-6 text-sm text-slate-500">Type at least 2 characters. Phone numbers match however they were written (0300, +92 300...).</p>}
          {err && <p className="px-4 py-4 text-sm text-rose-600">{err}</p>}
          {empty && <p className="px-4 py-6 text-sm text-slate-500">Nothing found for "{q.trim()}".</p>}
          {clients.length > 0 && <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Clients</p>}
          {clients.map(c => (
            <button key={c.id} onClick={() => { onOpenClient(c.id); onClose(); }} className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
              <span className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0">{c.client_type === 'showroom' ? <Building2 className="w-4 h-4" /> : <Users className="w-4 h-4" />}</span>
              <span className="min-w-0"><span className="block text-sm font-medium text-slate-900 truncate">{c.name}{c.archived && <span className="ml-2 text-xs font-normal text-slate-500">archived</span>}</span>
                <span className="block text-xs text-slate-500 truncate">{[c.phone, c.cnic, c.care_of && `C/O ${c.care_of}`].filter(Boolean).join(' · ') || 'No contact details'}</span></span>
            </button>
          ))}
          {vehicles.length > 0 && <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Vehicles</p>}
          {vehicles.map(v => (
            <button key={v.id} onClick={() => { if (v.client_id) onOpenClient(v.client_id, 'vehicles'); else onOpenVehicleOnly(); onClose(); }} className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
              <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center flex-shrink-0"><Car className="w-4 h-4" /></span>
              <span className="min-w-0"><span className="block text-sm font-medium text-slate-900 truncate">{v.registration_number || v.chassis_number || 'No registration yet'} <span className="font-normal text-slate-500">{[v.company, v.model, v.manufacturing_year].filter(Boolean).join(' ')}</span></span>
                <span className="block text-xs text-slate-500 truncate">{v.client_name ? `Owner: ${v.client_name}` : 'No owner linked (opens Vehicles)'}{v.chassis_number && v.registration_number ? ` · chassis ${v.chassis_number}` : ''}</span></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
