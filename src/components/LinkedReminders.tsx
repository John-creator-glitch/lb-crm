import { useCallback, useEffect, useState } from 'react';
import { supabase, type Reminder } from '@/lib/supabase';
import { Card, Button } from '@/components/ui';
import ReminderForm, { type ReminderLinks } from '@/components/ReminderForm';
import ReminderRow from '@/components/ReminderRow';
import { Bell, Plus } from 'lucide-react';

/** Reminders linked to one case / quotation / client, with a quick "add reminder". Hides itself if the M5 tables are not installed. */
export default function LinkedReminders({ links, defaultTitle }: { links: ReminderLinks; defaultTitle?: string }) {
  const [rows, setRows] = useState<Reminder[] | null>(null);
  const [people, setPeople] = useState<{ id: string; full_name: string }[]>([]);
  const [adding, setAdding] = useState(false);
  const col = links.case_id ? 'case_id' : links.quotation_id ? 'quotation_id' : 'client_id';
  const val = (links.case_id ?? links.quotation_id ?? links.client_id) as string;
  const load = useCallback(async () => {
    const [r, p] = await Promise.all([supabase.from('reminders').select('*').eq(col, val).order('due_at'), supabase.from('profiles').select('id, full_name')]);
    setRows(r.error ? null : (r.data ?? []) as Reminder[]); setPeople((p.data ?? []) as typeof people);
  }, [col, val]);
  useEffect(() => { load(); }, [load]);
  if (rows === null) return null;
  const name = (id: string | null) => people.find(p => p.id === id)?.full_name ?? '';
  const shown = rows.filter(r => r.status === 'open').concat(rows.filter(r => r.status !== 'open').slice(-3));
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-slate-900 text-sm flex items-center gap-2"><Bell className="w-4 h-4 text-slate-500" /> Reminders</h3>
        {!adding && <Button size="sm" variant="secondary" onClick={() => setAdding(true)}><Plus className="w-4 h-4" /> Add</Button>}
      </div>
      {adding && <ReminderForm links={links} defaultTitle={defaultTitle} onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {shown.length === 0 ? <p className="text-sm text-slate-500">No reminders for this yet.</p> : <div className="-mx-4 divide-y divide-slate-100">{shown.map(r => <ReminderRow key={r.id} r={r} names={name} onChanged={load} />)}</div>}
    </Card>
  );
}
