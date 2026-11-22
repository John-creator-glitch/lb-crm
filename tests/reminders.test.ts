import { bucketOf, effectiveDue, pkLocalToIso, isoToPkLocal, snoozePresets } from '../src/lib/reminders';
let fails = 0;
const eq = (n: string, g: unknown, w: unknown) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ` got=${JSON.stringify(g)} want=${JSON.stringify(w)}`}`); };
const now = new Date('2026-11-18T08:00:00Z');   // 13:00 Pakistan, Wed 18 Nov
eq('overdue: open and past due', bucketOf({ status: 'open', due_at: '2026-11-18T07:00:00Z' }, now), 'overdue');
eq('today: later the same Pakistan day', bucketOf({ status: 'open', due_at: '2026-11-18T15:00:00Z' }, now), 'today');   // 20:00 PKT
eq('upcoming: after midnight Pakistan time (UTC still same day)', bucketOf({ status: 'open', due_at: '2026-11-18T19:30:00Z' }, now), 'upcoming');   // 00:30 PKT on the 19th
eq('upcoming: next week', bucketOf({ status: 'open', due_at: '2026-11-25T05:00:00Z' }, now), 'upcoming');
eq('snoozed reminder uses the snooze time', bucketOf({ status: 'open', due_at: '2026-11-17T05:00:00Z', snoozed_until: '2026-11-19T05:00:00Z' }, now), 'upcoming');
eq('effectiveDue prefers snooze', effectiveDue({ status: 'open', due_at: 'a', snoozed_until: 'b' }), 'b');
eq('completed stays completed even if past due', bucketOf({ status: 'completed', due_at: '2026-11-01T00:00:00Z' }, now), 'completed');
eq('cancelled', bucketOf({ status: 'cancelled', due_at: '2026-11-30T00:00:00Z' }, now), 'cancelled');
eq('typed Pakistan time -> UTC instant', pkLocalToIso('2026-11-20T09:30'), '2026-11-20T04:30:00.000Z');
eq('UTC instant -> Pakistan input value', isoToPkLocal('2026-11-20T04:30:00.000Z'), '2026-11-20T09:30');
eq('round trip across midnight', isoToPkLocal(pkLocalToIso('2026-11-20T00:15')), '2026-11-20T00:15');
const pr = snoozePresets(now);
eq('presets are all in the future', pr.every(p => new Date(p.at).getTime() > now.getTime()), true);
eq('tomorrow 9am Pakistan', pr.find(p => p.label.startsWith('Tomorrow'))?.at, '2026-11-19T04:00:00.000Z');
eq('next Monday after Wed 18 Nov is 23 Nov', pr.find(p => p.label.startsWith('Next Monday'))?.at, '2026-11-23T04:00:00.000Z');
eq('evening preset offered at 1 pm', pr.some(p => p.label.startsWith('This evening')), true);
eq('evening preset not offered at 5:55 pm', snoozePresets(new Date('2026-11-18T12:55:00Z')).some(p => p.label.startsWith('This evening')), false);
if (fails) process.exit(1);
console.log('all passed');
