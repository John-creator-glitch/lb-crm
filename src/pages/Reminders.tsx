import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, type Reminder } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { PageHeader, Card, Spinner, EmptyState, Button } from '@/components/ui';
import ReminderForm from '@/components/ReminderForm';
import ReminderRow from '@/components/ReminderRow';
import { useDrillIds, DrillBanner } from '@/lib/drill';
import { bucketOf, effectiveDue } from '@/lib/reminders';
import { Bell, Plus } from 'lucide-react';
import { friendlyError } from '@/lib/errors';
import { fetchAll } from '@/lib/fetchAll';

type Tab = 'today' | 'upcoming' | 'overdue' | 'mine' | 'completed';
const TABS: { id: Tab; label: string }[] = [{ id: 'today', label: 'Today' }, { id: 'upcoming', label: 'Upcoming' }, { id: 'overdue', label: 'Overdue' }, { id: 'mine', label: 'Assigned to me' }, { id: 'completed', label: 'Completed' }];

export default function Reminders() {
  const { session } = useAuth();
  const me = session?.user.id ?? '';
  const [rows, setRows] = useState<Reminder[]>([]);
  const [people, setPeople] = useState<{ id: string; full_name: string }[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [cases, setCases] = useState<{ id: string; case_no: string }[]>([]);
  const [quotes, setQuotes] = useState<{ id: string; quotation_number: string }[]>([]);
  const [tab, setTab] = useState<Tab>('today');
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    await supabase.rpc('process_due_reminders');
    const [r, p, c, cs, q] = await Promise.all([
      supabase.from('reminders').select('*').order('due_at', { ascending: true }).limit(1000),
      supabase.from('profiles').select('id, full_name'),
      fetchAll<any>((a, b) => supabase.from('clients').select('id, name').order('name').order('id').range(a, b)),
      fetchAll<any>((a, b) => supabase.from('cases').select('id, case_no').order('id').range(a, b)),
      supabase.from('quotations').select('id, quotation_number').order('created_at', { ascending: false }).limit(500),
    ]);
    if (r.error) setErr(r.error.message.includes('reminders') ? 'The reminders tables are missing. Run the migration 20261120090000_m5_reminders_notifications.sql once.' : friendlyError(r.error)); else setErr('');
    setRows((r.data ?? []) as Reminder[]); setPeople((p.data ?? []) as typeof people); setClients((c.data ?? []) as typeof clients);
    setCases((cs.data ?? []) as typeof cases); setQuotes((q.data ?? []) as typeof quotes);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const { ids: drillIds } = useDrillIds('reminders');
  const now = new Date();
  const groups = useMemo(() => {
    const g: Record<Tab, Reminder[]> = { today: [], upcoming: [], overdue: [], mine: [], completed: [] };
    for (const r of rows) {
      if (drillIds && !drillIds.has(r.id)) continue;
      const b = bucketOf(r, now);
      if (b === 'completed' || b === 'cancelled') g.completed.push(r);
      else if (b === 'overdue') g.overdue.push(r);
      else if (b === 'today') g.today.push(r);
      else g.upcoming.push(r);
      if (r.status === 'open' && r.owner_id === me) g.mine.push(r);
    }
    g.completed.sort((a, b) => (b.completed_at ?? b.updated_at).localeCompare(a.completed_at ?? a.updated_at));
    g.mine.sort((a, b) => effectiveDue(a).localeCompare(effectiveDue(b)));
    return g;
  }, [rows, me, drillIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = (id: string | null) => people.find(p => p.id === id)?.full_name ?? '';
  const linksOf = (r: Reminder) => [r.client_id && clients.find(c => c.id === r.client_id)?.name, r.case_id && cases.find(c => c.id === r.case_id)?.case_no, r.quotation_id && quotes.find(q => q.id === r.quotation_id)?.quotation_number].filter(Boolean) as string[];
  const list = tab === 'today' ? [...groups.overdue, ...groups.today] : groups[tab];

  if (loading) return <Spinner label="Loading reminders..." />;
  return (
    <>
      <DrillBanner route="reminders" shown={drillIds ? rows.filter(r => drillIds.has(r.id)).length : undefined} />
      <PageHeader title="Reminders" subtitle="Things that must alert someone at a time. Tasks are separate: they are work to do." action={<Button onClick={() => setAdding(true)}><Plus className="w-4 h-4" /> New reminder</Button>} />
      {err && <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{err}</div>}
      {adding && <ReminderForm clients={clients} onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3" role="tablist">
        {TABS.map(t => {
          const n = t.id === 'today' ? groups.overdue.length + groups.today.length : groups[t.id].length;
          return <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap border ${tab === t.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>{t.label}<span className={`ml-1.5 text-xs ${t.id === 'overdue' && n > 0 && tab !== t.id ? 'text-rose-600 font-semibold' : 'opacity-70'}`}>{n}</span></button>;
        })}
      </div>
      <Card className="overflow-hidden">
        {list.length === 0 ? <EmptyState icon={Bell} title={tab === 'completed' ? 'Nothing completed yet' : 'Nothing here'} subtitle={tab === 'today' ? 'No reminders are due today.' : 'Add a reminder with the button above.'} /> : (
          <div className="divide-y divide-slate-100">{list.map(r => <ReminderRow key={r.id} r={r} names={name} links={linksOf(r)} onChanged={load} />)}</div>
        )}
      </Card>
      <p className="text-[11px] text-slate-500 mt-2">Completed, snoozed and cancelled reminders stay in the history (the clock icon). Only in-app reminders are active; email and WhatsApp stay off until approved.</p>
    </>
  );
}
