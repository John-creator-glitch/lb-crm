// Reminder rules that the screens need. PURE (no database). The database does the real work (migration 20261120090000);
// this decides which inbox a reminder sits in and how times are typed and shown (always Pakistan time, UTC+5).
import { PK_TZ, pkDateOf, addDays } from './time';

export interface RemLike { status: string; due_at: string; snoozed_until?: string | null }
export type RemBucket = 'overdue' | 'today' | 'upcoming' | 'completed' | 'cancelled';
export type RemPriority = 'low' | 'normal' | 'high' | 'urgent';

export const effectiveDue = (r: RemLike): string => r.snoozed_until ?? r.due_at;

/** Which inbox: Overdue = open and the (snoozed) due time has passed; Today = open, due later today; Upcoming = a later day. */
export function bucketOf(r: RemLike, now: Date = new Date()): RemBucket {
  if (r.status === 'completed') return 'completed';
  if (r.status === 'cancelled') return 'cancelled';
  const due = new Date(effectiveDue(r));
  if (due.getTime() <= now.getTime()) return 'overdue';
  return pkDateOf(due) === pkDateOf(now) ? 'today' : 'upcoming';
}

/** "2026-11-20T09:30" typed in a datetime-local box (Pakistan time) -> ISO instant for the database. */
export function pkLocalToIso(v: string): string { return new Date(`${v}:00+05:00`).toISOString(); }
/** ISO instant -> "YYYY-MM-DDTHH:mm" in Pakistan time, for a datetime-local box. */
export function isoToPkLocal(iso: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: PK_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const g = (t: string) => p.find(x => x.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}
export function fmtPk(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString('en-PK', { timeZone: PK_TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
}

const dow = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();   // 0 = Sunday
/** Quick snooze choices, all in the future. */
export function snoozePresets(now: Date = new Date()): { label: string; at: string }[] {
  const today = pkDateOf(now);
  const at = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00+05:00`).toISOString();
  const out: { label: string; at: string }[] = [{ label: 'In 1 hour', at: new Date(now.getTime() + 3600_000).toISOString() }];
  if (new Date(at(today, '18:00')).getTime() > now.getTime() + 15 * 60_000) out.push({ label: 'This evening (6 pm)', at: at(today, '18:00') });
  out.push({ label: 'Tomorrow 9 am', at: at(addDays(today, 1), '09:00') });
  const d = dow(today); const toMon = ((8 - d) % 7) || 7;
  out.push({ label: 'Next Monday 9 am', at: at(addDays(today, toMon), '09:00') });
  return out;
}

export const REM_PRIORITIES: { value: RemPriority; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'bg-slate-100 text-slate-600' },
  { value: 'normal', label: 'Normal', color: 'bg-blue-100 text-blue-700' },
  { value: 'high', label: 'High', color: 'bg-amber-100 text-amber-700' },
  { value: 'urgent', label: 'Urgent', color: 'bg-rose-100 text-rose-700' },
];
export const REM_RECURRENCES = [{ value: 'none', label: 'Does not repeat' }, { value: 'daily', label: 'Every day' }, { value: 'weekly', label: 'Every week' }, { value: 'monthly', label: 'Every month' }];
export const REM_CHANNELS: { value: 'in_app' | 'email' | 'whatsapp'; label: string; enabled: boolean }[] = [
  { value: 'in_app', label: 'In the app', enabled: true },
  { value: 'email', label: 'Email (not enabled yet)', enabled: false },
  { value: 'whatsapp', label: 'WhatsApp (not enabled yet)', enabled: false },
];
export const EVENT_LABEL: Record<string, string> = {
  created: 'Created', due_notified: 'Notified (due)', send_failed: 'Send failed', snoozed: 'Snoozed', completed: 'Completed', cancelled: 'Cancelled',
  escalated: 'Escalated to manager', recurred: 'Next repeat created', reassigned: 'Reassigned', retried: 'Retry',
};
