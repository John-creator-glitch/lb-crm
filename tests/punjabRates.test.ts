import { calculatePunjab } from '../src/lib/punjab';
import { DEFAULT_PUNJAB_RATES, validateRates, diffRates, pickRateSet, rateReminders, type RateSetRow, type PunjabRates } from '../src/lib/punjabRates';
let fail = 0;
const eq = (n: string, g: unknown, w: unknown) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, JSON.stringify(g), JSON.stringify(w)); };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const total = (r: ReturnType<typeof calculatePunjab>) => r.items.reduce((s, x) => s + x.amount, 0);
const base = { transaction_type: 'new_registration', engine_cc: 2694, invoice_value: 12556000, filer_status: 'filer' as const };

eq('defaults are valid', validateRates(DEFAULT_PUNJAB_RATES), []);
eq('default total unchanged', total(calculatePunjab(base)), 557423);

// A policy change is just new data: token tax above 2500cc goes 0.3% -> 0.4%, ARC card 1300 -> 1500.
const next = clone(DEFAULT_PUNJAB_RATES);
next.version = 'PB-TEST'; next.mvt[next.mvt.length - 1].value = 0.004; next.fixed.arc_fee = 1500;
const r2 = calculatePunjab(base, next);
eq('new rate: mvt', r2.items.find(x => x.fee_type === 'motor_vehicle_tax')!.amount, 50224);
eq('new rate: total', total(r2), 557423 - 37668 + 50224 + 200);
eq('quotation line carries the version', r2.items[0].rule_version, 'PB-TEST');
eq('diff lists exactly the changes', diffRates(DEFAULT_PUNJAB_RATES, next).length, 2);

// Making the 2001-2500 token band known removes the "enter e-pay figure" requirement
const known = clone(DEFAULT_PUNJAB_RATES);
known.mvt[4] = { max_cc: 2500, kind: 'percent', value: 0.004, verified: true };
known.reg_fee[2] = { max_cc: 2500, rate: 0.04, verified: true };
const c2400 = calculatePunjab({ ...base, engine_cc: 2400 }, known);
eq('known band calculates', c2400.items.find(x => x.fee_type === 'registration_fee')!.amount, 502240);
let needsManual = false; try { calculatePunjab({ ...base, engine_cc: 2400 }); } catch { needsManual = true; }
eq('unknown band still needs e-pay figure', needsManual, true);

// Validation catches broken edits
const bad = clone(DEFAULT_PUNJAB_RATES) as PunjabRates;
bad.reg_fee[1].max_cc = 500;                 // not increasing
bad.income_tax[bad.income_tax.length - 1].max_cc = 5000; // last row must be open-ended
bad.ev.mvt_discount = 2;                     // > 100%
bad.version = ' ';
eq('validation finds 4+ problems', validateRates(bad).length >= 4, true);

// Rate set selection by date: scheduled change on 1 July
const mk = (version: string, effective_from: string, rates: PunjabRates, status: RateSetRow['status'] = 'active'): RateSetRow =>
  ({ id: version, version, effective_from, last_verified: effective_from, notes: null, status, rates, created_at: effective_from + 'T00:00:00Z' });
const rows = [mk('OLD', '2026-07-01', DEFAULT_PUNJAB_RATES), mk('NEW', '2027-07-01', next), mk('DRAFT', '2026-01-01', next, 'draft')];
eq('before change date uses OLD', pickRateSet(rows, '2027-06-30').row?.version, 'OLD');
eq('on change date uses NEW', pickRateSet(rows, '2027-07-01').row?.version, 'NEW');
eq('drafts are never used', pickRateSet([rows[2]], '2027-01-01').source, 'built-in');
eq('no rows falls back to defaults', pickRateSet([], '2026-11-06').rates.version, DEFAULT_PUNJAB_RATES.version);
const broken = clone(DEFAULT_PUNJAB_RATES); broken.reg_fee = [];
eq('invalid active set falls back, with a reason', pickRateSet([mk('BAD', '2026-07-01', broken)], '2026-11-06').problems.length > 0, true);

// Reminders
eq('fresh rates: no reminder', rateReminders(DEFAULT_PUNJAB_RATES, new Date('2026-11-10')), []);
eq('stale rates: reminder', rateReminders(DEFAULT_PUNJAB_RATES, new Date('2027-03-01')).length, 1);
eq('after 1 July budget unverified: reminder', rateReminders({ ...DEFAULT_PUNJAB_RATES, last_verified: '2027-05-01' }, new Date('2027-07-10')).length >= 1, true);
process.exit(fail ? 1 : 0);
