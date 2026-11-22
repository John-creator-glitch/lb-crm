import { useEffect, useState } from 'react';
import SearchSelect from '@/components/SearchSelect';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Card, Field, Input, Select, Textarea, Button } from '@/components/ui';
import { pkLocalToIso, REM_PRIORITIES, REM_RECURRENCES, REM_CHANNELS } from '@/lib/reminders';
import { pkToday, addDays } from '@/lib/time';
import { friendlyError } from '@/lib/errors';

export interface ReminderLinks { client_id?: string | null; case_id?: string | null; quotation_id?: string | null; task_id?: string | null; label?: string }
interface Person { id: string; full_name: string; active?: boolean }

/** New reminder. Links (client / case / quotation) are fixed when it is opened from one of those pages. */
export default function ReminderForm({ links, clients, defaultTitle = '', onSaved, onCancel }: { links?: ReminderLinks; clients?: { id: string; name: string }[]; defaultTitle?: string; onSaved: () => void; onCancel: () => void }) {
  const { session } = useAuth();
  const me = session?.user.id ?? '';
  const [people, setPeople] = useState<Person[]>([]);
  const [f, setF] = useState({ title: defaultTitle, due: `${addDays(pkToday(), 1)}T09:00`, owner: me, priority: 'normal', recurrence: 'none', channel: 'in_app', escalate: false, hours: '4', notes: '', client_id: links?.client_id ?? '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { supabase.from('profiles').select('id, full_name, active').then(({ data }) => setPeople(((data ?? []) as Person[]).filter(p => p.active !== false))); }, []);

  async function save() {
    setErr('');
    if (!f.title.trim()) { setErr('Write what the reminder is for.'); return; }
    if (!f.due) { setErr('Choose the date and time.'); return; }
    const hrs = Number(f.hours);
    if (f.escalate && !(hrs > 0)) { setErr('Escalation hours must be more than zero.'); return; }
    setBusy(true);
    const { error } = await supabase.from('reminders').insert({
      title: f.title.trim(), notes: f.notes.trim() || null, due_at: pkLocalToIso(f.due), owner_id: f.owner || me, priority: f.priority, recurrence: f.recurrence, channel: f.channel,
      escalate_after_hours: f.escalate ? hrs : null, client_id: links?.client_id ?? (f.client_id || null), case_id: links?.case_id ?? null, quotation_id: links?.quotation_id ?? null, task_id: links?.task_id ?? null,
    });
    setBusy(false);
    if (error) { setErr(friendlyError(error)); return; }
    onSaved();
  }

  return (
    <Card className="p-4 sm:p-5 mb-4 border-amber-200">
      <h3 className="font-semibold text-slate-900 text-sm mb-3">New reminder{links?.label ? ` · ${links.label}` : ''}</h3>
      {err && <p className="text-sm text-rose-700 mb-3" role="alert">{err}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2"><Field label="Reminder" required><Input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="e.g. Call client for missing CNIC copy" autoFocus /></Field></div>
        <Field label="When (Pakistan time)" required><Input type="datetime-local" value={f.due} onChange={e => setF({ ...f, due: e.target.value })} /></Field>
        <Field label="Assigned to"><Select value={f.owner} onChange={e => setF({ ...f, owner: e.target.value })}>{people.map(p => <option key={p.id} value={p.id}>{p.full_name || 'Unnamed user'}{p.id === me ? ' (me)' : ''}</option>)}</Select></Field>
        <Field label="Priority"><Select value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })}>{REM_PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>
        <Field label="Repeat"><Select value={f.recurrence} onChange={e => setF({ ...f, recurrence: e.target.value })}>{REM_RECURRENCES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></Field>
        {!links && clients && <Field label="Client (optional)"><SearchSelect value={f.client_id} onChange={v => setF({ ...f, client_id: v })} emptyLabel="No client" options={clients.map(c => ({ value: c.id, label: c.name }))} /></Field>}
        <Field label="How to remind"><Select value={f.channel} onChange={e => setF({ ...f, channel: e.target.value })}>{REM_CHANNELS.map(c => <option key={c.value} value={c.value} disabled={!c.enabled}>{c.label}</option>)}</Select></Field>
        <div className="sm:col-span-2 flex items-center gap-2 text-sm text-slate-700">
          <input id="esc" type="checkbox" checked={f.escalate} onChange={e => setF({ ...f, escalate: e.target.checked })} /><label htmlFor="esc">Tell a manager if not done</label>
          {f.escalate && <><Input className="!w-20" type="number" min={1} value={f.hours} onChange={e => setF({ ...f, hours: e.target.value })} aria-label="Hours" /><span>hours after it is due</span></>}
        </div>
        <div className="sm:col-span-2"><Field label="Notes"><Textarea rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field></div>
      </div>
      <div className="flex justify-end gap-2 mt-3"><Button variant="secondary" onClick={onCancel}>Cancel</Button><Button onClick={save} disabled={busy}>Save reminder</Button></div>
    </Card>
  );
}
