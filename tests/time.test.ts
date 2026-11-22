import { pkDateOf, addDays, pkMonthStart, pkYearStart, compactDate, pkDayStartUtc, pkRangeUtc } from '../src/lib/time';
let fails = 0;
const eq = (n: string, g: unknown, w: unknown) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ` got=${JSON.stringify(g)} want=${JSON.stringify(w)}`}`); };

// 23:30 UTC on 7 Nov is 04:30 on 8 Nov in Pakistan: the old UTC slice gave the wrong day
eq('night window is next day in PK', pkDateOf('2026-11-07T23:30:00Z'), '2026-11-08');
eq('UTC slice would be wrong', '2026-11-07T23:30:00Z'.slice(0, 10), '2026-11-07');
eq('18:59 UTC still same PK day', pkDateOf('2026-11-07T18:59:00Z'), '2026-11-07');
eq('19:00 UTC is midnight PK next day', pkDateOf('2026-11-07T19:00:00Z'), '2026-11-08');
eq('year boundary', pkDateOf('2026-12-31T20:00:00Z'), '2027-01-01');
eq('Date input', pkDateOf(new Date('2026-03-01T00:00:00Z')), '2026-03-01');
eq('addDays +1 month end', addDays('2026-11-30', 1), '2026-12-01');
eq('addDays -6', addDays('2026-11-03', -6), '2026-10-28');
eq('addDays leap', addDays('2028-02-28', 1), '2028-02-29');
eq('month start', pkMonthStart('2026-11-08'), '2026-11-01');
eq('year start', pkYearStart('2026-11-08'), '2026-01-01');
eq('compact', compactDate('2026-11-08'), '20261108');
eq('day start utc', pkDayStartUtc('2026-11-08'), '2026-11-07T19:00:00.000Z');
eq('range inclusive end', pkRangeUtc('2026-11-01', '2026-11-08'), { from: '2026-10-31T19:00:00.000Z', toExclusive: '2026-11-08T19:00:00.000Z' });
// a quotation made at 02:00 PK on 8 Nov (21:00 UTC on 7 Nov) must fall inside the 8 Nov report
const q = '2026-11-07T21:00:00Z'; const r = pkRangeUtc('2026-11-08', '2026-11-08');
eq('02:00 PK record inside its PK day range', q >= r.from.replace('.000', '') && q < r.toExclusive.replace('.000', ''), true);
if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
