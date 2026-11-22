import { calculatePunjab } from '../src/lib/punjab';
const total = (r: ReturnType<typeof calculatePunjab>) => r.items.reduce((s, x) => s + x.amount, 0);
let fail = 0;
function eq(name: string, got: number, want: number) { const ok = got === want; if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', name, got, want); }

// Challan 1: Toyota Cross 1796cc, filer, price 9,309,140, new registration (e-pay assessed total 227,125)
const nr = calculatePunjab({ transaction_type: 'new_registration', engine_cc: 1796, invoice_value: 9309140, filer_status: 'filer', late_fee: 3000 });
eq('NR total', total(nr), 227125);
eq('NR reg fee', nr.items.find(x => x.fee_type === 'registration_fee')!.amount, 186183);
eq('NR MVT', nr.items.find(x => x.fee_type === 'motor_vehicle_tax')!.amount, 27927);

// ---- Real Punjab e-pay challans (private cars, new registration), all filer unless noted ----
type Fx = [string, number, number, string, number, Record<string, unknown>?];
const nrCases: Fx[] = [
  // name, cc, price, purchaseDate, expectedTotal, extra input (application date is "today")
  ['DNF 326 Cross HPA', 1798, 9309140, '2026-09-28', 233200, { today: '2026-10-14', hire_purchase: true }],
  ['DJN 998 Cross (income tax 9,000, assumed non-filer)', 1798, 7998420, '2026-08-28', 198478, { today: '2026-09-01', filer_status: 'non_filer' }],
  ['DPR 915 Cross late 3,000', 1798, 7502520, '2026-09-15', 185573, { today: '2026-10-30' }],
  ['DLF 814 Altis Grande', 1798, 8046360, '2026-09-15', 195081, { today: '2026-09-21' }],
  ['ALY 262 Tank 500 PHEV late 3,000', 1998, 23891000, '2026-09-17', 564508, { today: '2026-10-29' }],
  ['DNX 119 Sportage', 1598, 12442980, '2026-10-19', 286122, { today: '2026-10-22' }],
  ['DPP 230 Yaris', 1329, 4905180, '2026-10-29', 117156, { today: '2026-11-04' }],
  ['DPB 504 Yaris HPA', 1329, 4905180, '2026-10-16', 126231, { today: '2026-10-23', hire_purchase: true }],
  ['AVQ 123 Fortuner 2755', 2755, 22475800, '2026-10-28', 983974, { today: '2026-10-30' }],
  ['DPB 402 Fortuner 2694', 2694, 13686040, '2026-10-19', 606015, { today: '2026-10-23' }],
  ['DMY 132 Deepal EV', 3003, 10298970, '2026-10-05', 38423, { today: '2026-10-12', fuel_type: 'electric' }],
  ['DBK 967 Inverex EV 657cc', 657, 4349000, '2026-06-10', 35690, { today: '2026-06-16', fuel_type: 'electric' }],
];
// Double cabin goods vehicles up to 2500cc
nrCases.push(
  ['DJX 105 JAC double cabin 1999', 1999, 9213750, '2026-08-28', 223931, { today: '2026-09-05', vehicle_class: 'double_cabin' }],
  ['DMW 367 BYD Shark 6 double cabin 1498', 1498, 19950000, '2026-09-22', 468865, { today: '2026-10-12', vehicle_class: 'double_cabin' }],
);
for (const [name, cc, price, pd, want, extra] of nrCases) {
  const r = calculatePunjab({ transaction_type: 'new_registration', engine_cc: cc, invoice_value: price, filer_status: 'filer', purchase_date: pd, ...(extra || {}) } as any);
  eq('NR ' + name, total(r), want);
}

// Challan 2: DHX 547 transfer (e-pay total 150,856): 1601-1800cc, non-filer WHT 56,250, first-year vehicle. CVT base from e-pay.
const today = new Date().toISOString().slice(0, 10);
const tr = calculatePunjab({ transaction_type: 'transfer', engine_cc: 1700, invoice_value: null, filer_status: 'non_filer', first_registration_date: today, cvt_assessed_value: 8021600 });
eq('Transfer total', total(tr), 150856);
eq('Transfer WHT (computed)', tr.items.find(x => x.fee_type === 'withholding_tax')!.amount, 56250);
eq('Transfer fee', tr.items[0].amount, 9075);
import { transferWht, lateRegistrationFine, lateTransferPenalty } from '../src/lib/punjab';
// Challan 1 purchase 07-09-2026, application 24-10-2026 = 47 days late = 3,000
const nr2 = calculatePunjab({ transaction_type: 'new_registration', engine_cc: 1796, invoice_value: 9309140, filer_status: 'filer', purchase_date: '2026-09-07', today: '2026-10-24' });
eq('NR auto late fee total', total(nr2), 227125);
eq('late reg 47d', lateRegistrationFine(47), 3000);
eq('late transfer 45d', lateTransferPenalty(45), 10000);
eq('WHT 1300cc filer age 3', transferWht(1300, true, 3), 5250);
eq('WHT age 5 is zero', transferWht(1800, false, 5), 0);
// Fortuner 2694cc on the 29.10.2026 Indus invoice, gross 12,556,000: same engine path as real challan DPB 402 (13,686,040 -> 606,015)
const fz = calculatePunjab({ transaction_type: 'new_registration', engine_cc: 2694, invoice_value: 12556000, filer_status: 'filer' });
eq('Fortuner reg fee', fz.items.find(x => x.fee_type === 'registration_fee')!.amount, 502240);
eq('Fortuner MVT', fz.items.find(x => x.fee_type === 'motor_vehicle_tax')!.amount, 37668);
eq('Fortuner total', total(fz), 557423);
let guard = false; try { calculatePunjab({ transaction_type: 'new_registration', engine_cc: 2694, invoice_value: 12556, filer_status: 'filer' }); } catch { guard = true; }
eq('tiny invoice value rejected', guard ? 1 : 0, 1);
process.exit(fail ? 1 : 0);
