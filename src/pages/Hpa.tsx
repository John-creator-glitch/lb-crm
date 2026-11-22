import { pkToday } from '@/lib/time';
import { useCan } from '@/lib/permissions';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { PageHeader, Card, Spinner, Button, Field, Input, EmptyState } from '@/components/ui';
import { Landmark, Plus, Trash2 } from 'lucide-react';
import { friendlyError } from '@/lib/errors';

interface Entry { id: string; entry_date: string; count: number; note: string | null; quotation_id: string | null; created_at: string }
const today = () => pkToday();

// Manual HPA (hire purchase) application counter. Completely separate from quotations / regular application counts.
export default function Hpa() {
  const [rows, setRows] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [n, setN] = useState('1');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [month, setMonth] = useState(today().slice(0, 7));

  async function load() {
    const { data, error } = await supabase.from('hpa_counts').select('*').order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(1000);
    if (error) setMissing(true); else { setMissing(false); setRows((data as Entry[]) ?? []); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function add(count: number, d = date, nt = note) {
    setErr('');
    if (!(count >= 1 && count <= 1000)) { setErr('Enter a number between 1 and 1000.'); return; }
    const { error } = await supabase.from('hpa_counts').insert({ count, entry_date: d, note: nt.trim() || null });
    if (error) { setErr(friendlyError(error)); return; }
    setNote(''); setN('1'); load();
  }
  const canDelete = useCan('manager');
  async function remove(e: Entry) {
    if (!window.confirm(`Remove this entry (${e.count} on ${e.entry_date})?`)) return;
    const { error } = await supabase.from('hpa_counts').delete().eq('id', e.id);
    if (error) setErr(friendlyError(error)); else load();
  }

  const t = today();
  const sum = (f: (r: Entry) => boolean) => rows.filter(f).reduce((s, r) => s + r.count, 0);
  const stats = useMemo(() => ({ today: sum(r => r.entry_date === t), month: sum(r => r.entry_date.slice(0, 7) === month), total: sum(() => true) }), [rows, month]);
  const monthRows = rows.filter(r => r.entry_date.slice(0, 7) === month);

  if (loading) return <Spinner label="Loading HPA tracker..." />;
  return (
    <>
      <PageHeader title="HPA Tracker" subtitle="Manual count of HPA (bank financed) applications, separate from normal applications" />
      {missing && <Card className="p-4 mb-4 bg-amber-50 border-amber-200 text-sm text-amber-800">The HPA table is not in the database yet. Run <code>supabase/migrations/20261106120000_settings_and_hpa.sql</code> in Supabase.</Card>}
      {err && <Card className="p-3 mb-4 bg-rose-50 border-rose-200 text-sm text-rose-800">{err}</Card>}

      <div className="grid grid-cols-3 gap-3 mb-4">
        {[['Today', stats.today], [month === t.slice(0, 7) ? 'This month' : month, stats.month], ['All time', stats.total]].map(([l, v]) => (
          <Card key={l as string} className="p-4 text-center"><p className="text-3xl font-bold text-slate-900 tabular-nums">{v}</p><p className="text-xs text-slate-500 mt-1">{l}</p></Card>
        ))}
      </div>

      <Card className="p-5 mb-4">
        <Button className="w-full !py-5 text-lg" onClick={() => add(1, t, '')} disabled={missing}><Plus className="w-6 h-6" /> Add 1 HPA application</Button>
        <p className="text-xs text-slate-500 text-center mt-2">One tap counts one application for today.</p>
        <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-100">
          <Field label="How many"><Input type="number" inputMode="numeric" min={1} value={n} onChange={e => setN(e.target.value)} /></Field>
          <Field label="Date"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
          <div className="col-span-2"><Field label="Note (optional)"><Input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. MCB lease cases" /></Field></div>
          <Button variant="secondary" className="col-span-2" onClick={() => add(Number(n), date, note)} disabled={missing}>Add entry</Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <h2 className="font-semibold text-slate-900">Entries</h2>
          <input type="month" value={month} onChange={e => setMonth(e.target.value || t.slice(0, 7))} className="px-3 py-2 border border-slate-300 rounded-lg text-base sm:text-sm" />
        </div>
        {monthRows.length === 0 ? <EmptyState icon={Landmark} title="No HPA entries this month" /> : (
          <div className="divide-y divide-slate-100">
            {monthRows.map(r => (
              <div key={r.id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0"><p className="text-sm font-medium text-slate-900">{r.count} application{r.count > 1 ? 's' : ''} <span className="text-slate-500 font-normal">· {r.entry_date}</span></p>{r.note && <p className="text-xs text-slate-500 truncate">{r.note}{r.quotation_id ? ' (from quotation)' : ''}</p>}</div>
                {canDelete && <button className="text-slate-300 hover:text-rose-600 p-2" onClick={() => remove(r)} aria-label="Remove entry"><Trash2 className="w-4 h-4" /></button>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
