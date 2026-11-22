import { calculateIct, ictMissing } from '../src/lib/ict';
let fail = 0;
function eq(name: string, got: number, want: number) { const ok = got === want; if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', name, got, want); }
type R = ReturnType<typeof calculateIct>;
const amt = (r: R, t: string) => r.items.find(x => x.fee_type === t)!.amount;
// Smart card and number plate are on the challan only in some cases (others carry them as a counter stamp), so compare without them.
const core = (r: R) => r.items.filter(x => x.fee_type !== 'smart_card_fee' && x.fee_type !== 'number_plate_fee').reduce((s, x) => s + x.amount, 0);
const all = (r: R) => r.items.reduce((s, x) => s + x.amount, 0);

// Real ICT challans, 2026-27 rates (payment up to 30-06-2027), all filer.
// CBG-138 Fortuner 2694cc, 13,686,040: total 605,443
const f1 = calculateIct({ engine_cc: 2694, invoice_value: 13686040, filer_status: 'filer' });
eq('CBG-138 reg fee', amt(f1, 'registration_fee'), 547442);
eq('CBG-138 MVT', amt(f1, 'motor_vehicle_tax'), 47901);
eq('CBG-138 total', core(f1), 605443);
// CCZ-160 Hilux Revo double cabin 2755cc, 17,396,400, HPA, plus 10,000 requested number fee: total 779,843
const f2 = calculateIct({ engine_cc: 2755, invoice_value: 17396400, filer_status: 'filer', hire_purchase: true });
eq('CCZ-160 reg fee', amt(f2, 'registration_fee'), 695856);
eq('CCZ-160 MVT', amt(f2, 'motor_vehicle_tax'), 60887);
eq('CCZ-160 HP fee', amt(f2, 'hire_purchase_fee'), 3000);
eq('CCZ-160 total', core(f2) + 10000, 779843);
// CDU-691 Yaris 1329cc, 4,925,580, HPA, smart card 2,400 + number plate 1,000 on the challan: total 118,826
const f3 = calculateIct({ engine_cc: 1329, invoice_value: 4925580, filer_status: 'filer', hire_purchase: true });
eq('CDU-691 reg fee', amt(f3, 'registration_fee'), 98512);
eq('CDU-691 MVT', amt(f3, 'motor_vehicle_tax'), 12314);
eq('CDU-691 income tax', amt(f3, 'income_tax'), 2500);
eq('CDU-691 total', all(f3), 118826);
// No unverified warning for the verified bands
eq('verified bands give no unverified warning', f3.warnings.filter(w => w.includes('not confirmed')).length, 0);

eq('token manual override', amt(calculateIct({ engine_cc: 1300, invoice_value: 5000000, filer_status: 'filer', token_manual: 9000 }), 'motor_vehicle_tax'), 9000);
eq('<=1000cc flagged unverified', calculateIct({ engine_cc: 660, invoice_value: 3000000, filer_status: 'filer' }).warnings.filter(w => w.includes('not confirmed')).length > 0 ? 1 : 0, 1);
eq('tiny value rejected', ictMissing({ engine_cc: 1300, invoice_value: 5000, filer_status: 'filer' }).length, 1);
// EV: registration fee shown as exempt, token tax must be typed from the ICT challan
const ev = calculateIct({ engine_cc: 3003, invoice_value: 10298970, filer_status: 'filer', fuel_type: 'electric', token_manual: 5000 });
eq('EV reg fee nets to zero', amt(ev, 'registration_fee') + amt(ev, 'ev_discount_reg_fee'), 0);
eq('EV without token tax is incomplete', ictMissing({ engine_cc: 3003, invoice_value: 10298970, filer_status: 'filer', fuel_type: 'electric' }).length, 1);
eq('hybrid gets no discount', calculateIct({ engine_cc: 1998, invoice_value: 23891000, filer_status: 'filer', fuel_type: 'hybrid' }).items.filter(x => x.amount < 0).length, 0);
// Admin can change policy: a new rate set changes the result with no code change
import { DEFAULT_ICT_RATES, validateIctRates, pickIctRateSet } from '../src/lib/ictRates';
eq('default ICT rates are valid', validateIctRates(DEFAULT_ICT_RATES).length, 0);
const r2 = JSON.parse(JSON.stringify(DEFAULT_ICT_RATES)); r2.version = 'ICT-TEST'; r2.token[2].value = 0.005; r2.ev = { reg_fee_discount: 1, mvt_discount: 0.5, confirmed: 1 };
eq('new token rate applies', amt(calculateIct({ engine_cc: 2694, invoice_value: 10000000, filer_status: 'filer' }, r2), 'motor_vehicle_tax'), 50000);
const ev2 = calculateIct({ engine_cc: 2694, invoice_value: 10000000, filer_status: 'filer', fuel_type: 'electric' }, r2);
eq('confirmed EV relief needs no manual token', amt(ev2, 'motor_vehicle_tax') + amt(ev2, 'ev_discount_mvt'), 25000);
const bad = JSON.parse(JSON.stringify(DEFAULT_ICT_RATES)); bad.token[0].max_cc = 5000;
eq('overlapping bands rejected', validateIctRates(bad).length > 0 ? 1 : 0, 1);
const row = (status: string, eff: string, rates: any) => ({ id: eff, version: rates.version, effective_from: eff, last_verified: eff, notes: null, status, rates, created_at: eff }) as any;
eq('future set not used yet', pickIctRateSet([row('active', '2099-01-01', r2)], '2026-11-08').source === 'built-in' ? 1 : 0, 1);
eq('active set used from its date', pickIctRateSet([row('active', '2026-11-01', r2)], '2026-11-08').rates.version === 'ICT-TEST' ? 1 : 0, 1);
process.exit(fail ? 1 : 0);
