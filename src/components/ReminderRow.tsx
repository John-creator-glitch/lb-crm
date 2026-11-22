import { useState } from 'react';
import { supabase, type Reminder, type ReminderEvent, type AppNotification } from '@/lib/supabase';
import { Badge, Button } from '@/components/ui';
import { REM_PRIORITIES, EVENT_LABEL, bucketOf, effectiveDue, fmtPk, snoozePresets, pkLocalToIso } from '@/lib/reminders';
import { useCan } from '@/lib/permissions';
import { Check, Clock, X, History, AlertTriangle, Repeat } from 'lucide-react';
import { friendlyError } from '@/lib/errors';

/** One reminder with Done / Snooze / Cancel / History. `names` maps user ids to names; `links` are small chips (client, case, quotation). */
export default function ReminderRow({ r, names, links, onChanged }: { r: Reminder; names: (id: string | null) => string; links?: string[]; onChanged: () => void }) {
  const [snooze, setSnooze] = useState(false);
  const [custom, setCustom] = useState('');
  const [hist, setHist] = useState<{ events: ReminderEvent[]; notes: AppNotification[] } | null>(null);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const canSeeAll = useCan('manager');
  const b = bucketOf(r);
  const pr = REM_PRIORITIES.find(p => p.value === r.priority);
  const open = r.status === 'open';

  async function call(p: PromiseLike<{ error: { message: string } | null }>, after?: () => void) {
    const { error } = await p;
    if (error) { setErr(friendlyError(error)); return; }
    setErr(''); after?.(); onChanged();
  }
  const done = () => call(supabase.rpc('complete_reminder', { p_id: r.id, p_note: null }));
  const doSnooze = (iso: string) => call(supabase.rpc('snooze_reminder', { p_id: r.id, p_until: iso }), () => { setSnooze(false); setCustom(''); });
  async function cancel() {
    const why = window.prompt('Why is this reminder cancelled? (required, kept in the history)');
    if (why === null) return;
    if (!why.trim()) { setErr('A reason is needed to cancel.'); return; }
    await call(supabase.rpc('cancel_reminder', { p_id: r.id, p_reason: why.trim() }));
  }
  async function showHistory() {
    if (hist) { setHist(null); return; }
    const [e, n] = await Promise.all([
      supabase.from('reminder_events').select('*').eq('reminder_id', r.id).order('created_at', { ascending: false }),
      supabase.from('notifications').select('*').eq('reminder_id', r.id).order('created_at', { ascending: false }),
    ]);
    setHist({ events: (e.data ?? []) as ReminderEvent[], notes: (n.data ?? []) as AppNotification[] });
  }
  async function retry(id: string) {
    const { data, error } = await supabase.rpc('retry_notification', { p_id: id });
    if (error) { setErr(friendlyError(error)); return; }
    setMsg(String(data)); await showHistory(); await showHistory();
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-medium ${open ? 'text-slate-900' : 'text-slate-500 line-through'}`}>{r.title}</span>
            {pr && r.priority !== 'normal' && <Badge className={pr.color}>{pr.label}</Badge>}
            {b === 'overdue' && <Badge className="bg-rose-100 text-rose-700">Overdue</Badge>}
            {r.status === 'completed' && <Badge className="bg-emerald-100 text-emerald-700">Done</Badge>}
            {r.status === 'cancelled' && <Badge className="bg-slate-100 text-slate-500">Cancelled</Badge>}
            {r.recurrence !== 'none' && <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><Repeat className="w-3 h-3" />{r.recurrence}</span>}
            {r.channel !== 'in_app' && <Badge className="bg-amber-100 text-amber-700">{r.channel} (not sent: not enabled)</Badge>}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {r.snoozed_until && open ? <>Snoozed until <b>{fmtPk(effectiveDue(r))}</b> (was {fmtPk(r.due_at)})</> : <>Due {fmtPk(r.due_at)}</>} · {names(r.owner_id) || 'Unassigned'}
            {r.status === 'completed' && r.completed_at ? ` · done ${fmtPk(r.completed_at)}${r.completed_by ? ' by ' + names(r.completed_by) : ''}` : ''}
            {r.status === 'cancelled' ? ` · ${r.cancel_reason ?? ''}` : ''}
          </p>
          {r.notes && <p className="text-xs text-slate-500">{r.notes}</p>}
          {links && links.length > 0 && <p className="text-[11px] text-slate-500 mt-0.5">{links.join(' · ')}</p>}
          {r.escalated_at && open && <p className="text-[11px] text-rose-600 flex items-center gap-1 mt-0.5"><AlertTriangle className="w-3 h-3" /> Escalated to a manager</p>}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {open && <Button size="sm" onClick={done}><Check className="w-4 h-4" /> Done</Button>}
          {open && <button onClick={() => setSnooze(!snooze)} className="p-2 text-slate-500 hover:text-slate-700" aria-label="Snooze" title="Snooze"><Clock className="w-4 h-4" /></button>}
          {open && <button onClick={cancel} className="p-2 text-slate-300 hover:text-rose-600" aria-label="Cancel reminder" title="Cancel"><X className="w-4 h-4" /></button>}
          <button onClick={showHistory} className={`p-2 hover:text-slate-700 ${hist ? 'text-slate-700' : 'text-slate-500'}`} aria-label="History" title="History"><History className="w-4 h-4" /></button>
        </div>
      </div>
      {snooze && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {snoozePresets().map(p => <button key={p.label} onClick={() => doSnooze(p.at)} className="px-3 py-1.5 rounded-full border border-slate-300 text-xs text-slate-600 hover:border-amber-500 hover:text-amber-700">{p.label}</button>)}
          <input type="datetime-local" value={custom} onChange={e => setCustom(e.target.value)} className="px-2 py-1 border border-slate-300 rounded-lg text-xs" aria-label="Custom snooze time" />
          <Button size="sm" variant="secondary" disabled={!custom} onClick={() => doSnooze(pkLocalToIso(custom))}>Snooze</Button>
        </div>
      )}
      {msg && <p className="text-xs text-slate-600 mt-1" role="status">{msg}</p>}
      {err && <p className="text-xs text-rose-700 mt-1" role="alert">{err}</p>}
      {hist && (
        <div className="mt-2 rounded-lg bg-slate-50 p-3 space-y-2">
          <ol className="space-y-1">{hist.events.map(e => <li key={e.id} className="text-xs text-slate-600"><b>{EVENT_LABEL[e.event] ?? e.event}</b>{e.detail ? ` — ${e.detail}` : ''}<span className="text-slate-500"> · {fmtPk(e.created_at)}{e.actor && names(e.actor) ? ' · ' + names(e.actor) : ''}</span></li>)}</ol>
          {hist.notes.filter(n => canSeeAll || n.delivery_status === 'failed' || true).map(n => (
            <p key={n.id} className="text-xs text-slate-600">
              Notification to {names(n.user_id)}: {n.delivery_status === 'delivered' ? <span className="text-emerald-700">delivered</span> : <span className="text-rose-700">failed</span>} ({n.channel}{n.attempts > 1 ? `, ${n.attempts} attempts` : ''})
              {n.delivery_status === 'failed' && <> — {n.failure_reason} <button className="underline text-slate-500 hover:text-slate-800" onClick={() => retry(n.id)}>Retry</button></>}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
