import { parseCard, toIsoDate } from '../src/lib/cardParser';
let fail = 0;
const eq = (n: string, g: unknown, w: unknown) => { const ok = g === w; if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, g, w); };
// Text modelled on the labels seen on the real Punjab e-pay challan (label: value on one line). Real e-card layout is NOT yet tested.
const t = `Registration No: DPA 412
Chassis No: ZVG10R0911444
Engine Size: 1796
Make: TOYOTA
Model: CROSS
Manufacturing Year: 2026
Registration Date: 08-09-2026`;
const d = parseCard(t);
eq('reg', d.registration_number, 'DPA 412');
eq('chassis', d.chassis_number, 'ZVG10R0911444');
eq('cc', d.engine_cc, 1796);
eq('make', d.make, 'TOYOTA');
eq('year', d.manufacturing_year, 2026);
eq('date', d.registration_date, '2026-09-08');
eq('iso', toIsoDate('2026-11-05'), '2026-11-05');
eq('bad date', toIsoDate('45-13-2026'), null);
eq('empty', parseCard('nothing here').engine_cc, null);
process.exit(fail ? 1 : 0);
