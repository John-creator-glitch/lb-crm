// Punjab Excise rate set as DATA (not code). The calculator in punjab.ts reads everything from here.
// When Punjab changes a rate, an admin creates a new version in the "Punjab Rates" page; no code change or redeploy is needed.
// DEFAULT_PUNJAB_RATES is the built-in fallback (used when the database has no active set or cannot be reached).
// Official page: https://excise.punjab.gov.pk/motorvehicle_tax. Where the page is stale or ambiguous, rates were matched to real e-pay challans (see tests/punjab.test.ts).

export const PUNJAB_SOURCE_URL = 'https://excise.punjab.gov.pk/motorvehicle_tax';

// max_cc / up_to_days = null means "no upper limit" (always the last band).
export interface CcBand { max_cc: number | null }
export interface PunjabRates {
  version: string;           // label shown on every quotation line, e.g. "PB-2026-11-05"
  effective_from: string;    // YYYY-MM-DD
  last_verified: string;     // YYYY-MM-DD, date an admin last checked these against the official page / a real challan
  notes: string;             // what changed and where it came from (notification no., news link, challan no.)

  // Registration fee as a fraction of invoice value. rate null = not known: the operator must type the e-pay figure.
  reg_fee: (CcBand & { rate: number | null; verified: boolean })[];
  // Motor vehicle (token) tax. kind: lifetime = fixed one-time amount, percent = fraction of invoice price, manual = type the e-pay figure.
  mvt: (CcBand & { kind: 'lifetime' | 'percent' | 'manual'; value: number; verified: boolean })[];
  // Income tax collected on the excise challan, by CC band.
  income_tax: (CcBand & { filer: number; non_filer: number; verified: boolean })[];
  reg_mark: (CcBand & { amount: number })[];                       // Additional Reg Mark Fee (appears on challans, not on the official page)
  transfer_fee: (CcBand & { amount: number })[];
  hire_purchase_fee: (CcBand & { amount: number; verified: boolean })[];
  fixed: { arc_fee: number; platform_charges: number; professional_tax: number };
  double_cabin: { reg_fee_rate: number; mvt_rate: number; income_tax_filer: number; max_cc: number };
  // Late registration fee by days since purchase. amount 0 = no fine in that band (not included).
  late_registration: { up_to_days: number | null; amount: number; verified: boolean }[];
  // Late transfer penalty by days since sale. amount null = published figure unknown (the app warns instead of guessing).
  late_transfer: { up_to_days: number | null; amount: number | null }[];
  transfer_wht: (CcBand & { filer: number; non_filer: number })[];   // advance tax on transfer, first-year base amounts
  transfer_wht_rule: { yearly_reduction: number; zero_after_years: number };
  ev: { reg_fee_discount: number; mvt_discount: number };
  cvt: { rate: number; above_cc: number; max_age_years: number; yearly_depreciation: number };
}

export const DEFAULT_PUNJAB_RATES: PunjabRates = {
  version: 'PB-2026-11-05',
  effective_from: '2026-07-01',
  last_verified: '2026-11-06',
  notes: 'Built-in defaults: official page plus real e-pay challans (Sep to Nov 2026).',
  reg_fee: [
    { max_cc: 1000, rate: 0.01, verified: true },
    { max_cc: 2000, rate: 0.02, verified: true },
    { max_cc: 2500, rate: null, verified: false },   // 2001 to 2500cc: page says 4% but no challan seen, so e-pay figure is required
    { max_cc: null, rate: 0.04, verified: true },
  ],
  mvt: [
    { max_cc: 1000, kind: 'lifetime', value: 20000, verified: true },
    { max_cc: 1300, kind: 'manual', value: 0, verified: false },
    { max_cc: 1600, kind: 'percent', value: 0.00225, verified: true },   // 1329cc and 1598cc challans
    { max_cc: 2000, kind: 'percent', value: 0.003, verified: true },     // 1798, 1998, 1999cc challans
    { max_cc: 2500, kind: 'manual', value: 0, verified: false },         // page says 0.4%, no challan seen
    { max_cc: null, kind: 'percent', value: 0.003, verified: true },     // 2694, 2755, 3003cc challans
  ],
  income_tax: [
    { max_cc: 1000, filer: 10000, non_filer: 30000, verified: false },
    { max_cc: 1199, filer: 1500, non_filer: 4500, verified: false },
    { max_cc: 1299, filer: 1750, non_filer: 5250, verified: false },
    { max_cc: 1300, filer: 2500, non_filer: 7500, verified: false },
    { max_cc: 1499, filer: 2500, non_filer: 7500, verified: true },
    { max_cc: 1500, filer: 3750, non_filer: 11250, verified: false },
    { max_cc: 1599, filer: 3750, non_filer: 11250, verified: true },
    { max_cc: 1999, filer: 4500, non_filer: 9000, verified: true },
    { max_cc: 2000, filer: 10000, non_filer: 30000, verified: false },
    { max_cc: 2500, filer: 10000, non_filer: 30000, verified: false },
    { max_cc: null, filer: 10000, non_filer: 30000, verified: true },
  ],
  reg_mark: [
    { max_cc: 1000, amount: 2000 },
    { max_cc: 1800, amount: 4000 },
    { max_cc: null, amount: 6000 },
  ],
  transfer_fee: [
    { max_cc: 1000, amount: 3025 },   // real challan BAQ 014 (655cc) shows 3,025; official page says 4,540
    { max_cc: 1800, amount: 9075 },
    { max_cc: null, amount: 18150 },
  ],
  hire_purchase_fee: [
    { max_cc: 1000, amount: 3025, verified: true },
    { max_cc: 1800, amount: 9075, verified: true },
    { max_cc: null, amount: 18150, verified: false },  // official page says 1,850 above 1800cc (probably a typo); no challan seen
  ],
  fixed: { arc_fee: 1300, platform_charges: 15, professional_tax: 200 },
  double_cabin: { reg_fee_rate: 0.02, mvt_rate: 0.003, income_tax_filer: 4500, max_cc: 2500 },
  late_registration: [
    { up_to_days: 30, amount: 0, verified: false },
    { up_to_days: 60, amount: 3000, verified: true },
    { up_to_days: 90, amount: 5000, verified: false },
    { up_to_days: 120, amount: 7000, verified: false },
    { up_to_days: 150, amount: 10000, verified: false },
    { up_to_days: 180, amount: 15000, verified: false },
    { up_to_days: null, amount: 15000, verified: true },
  ],
  late_transfer: [
    { up_to_days: 30, amount: 0 },
    { up_to_days: 60, amount: 10000 },
    { up_to_days: 90, amount: 20000 },
    { up_to_days: 120, amount: 30000 },
    { up_to_days: null, amount: null },
  ],
  transfer_wht: [
    { max_cc: 850, filer: 0, non_filer: 0 },
    { max_cc: 1000, filer: 5000, non_filer: 15000 },
    { max_cc: 1300, filer: 7500, non_filer: 22500 },
    { max_cc: 1600, filer: 12500, non_filer: 37500 },
    { max_cc: 1800, filer: 18750, non_filer: 56250 },
    { max_cc: 2000, filer: 25000, non_filer: 75000 },
    { max_cc: 2500, filer: 37500, non_filer: 112500 },
    { max_cc: 3000, filer: 50000, non_filer: 150000 },
    { max_cc: null, filer: 62500, non_filer: 187500 },
  ],
  transfer_wht_rule: { yearly_reduction: 0.1, zero_after_years: 5 },
  ev: { reg_fee_discount: 0.95, mvt_discount: 0.99 },
  cvt: { rate: 0.01, above_cc: 1300, max_age_years: 5, yearly_depreciation: 0.1 },
};

/** The band that applies to this CC (first band whose max_cc is not below it; the last band has no limit). */
export function ccBand<T extends CcBand>(bands: T[], cc: number): T {
  return bands.find(b => b.max_cc == null || cc <= b.max_cc) ?? bands[bands.length - 1];
}
export function dayBand<T extends { up_to_days: number | null }>(bands: T[], days: number): T {
  return bands.find(b => b.up_to_days == null || days <= b.up_to_days) ?? bands[bands.length - 1];
}

const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
const num = (v: unknown) => typeof v === 'number' && isFinite(v);

/** Returns a list of problems. Empty list = safe to save and use. Used by the admin page AND when loading from the database. */
export function validateRates(r: PunjabRates): string[] {
  const e: string[] = [];
  if (!r || typeof r !== 'object') return ['Rates are missing'];
  if (!r.version || !String(r.version).trim()) e.push('Version label is required');
  if (!isDate(r.effective_from)) e.push('Effective date must be YYYY-MM-DD');
  if (!isDate(r.last_verified)) e.push('Last verified date must be YYYY-MM-DD');

  const bands = (name: string, rows: any[] | undefined, key: 'max_cc' | 'up_to_days', fields: { f: string; max?: number; nullable?: boolean }[]) => {
    if (!Array.isArray(rows) || rows.length === 0) { e.push(`${name}: at least one row is required`); return; }
    let prev = -Infinity;
    rows.forEach((row, i) => {
      const last = i === rows.length - 1;
      const v = row[key];
      if (last) { if (v !== null) e.push(`${name}: the last row must have no limit (leave "up to" empty)`); }
      else if (!num(v) || v <= 0) e.push(`${name}: row ${i + 1} needs a positive "up to" value`);
      else { if (v <= prev) e.push(`${name}: "up to" values must increase (row ${i + 1})`); prev = v; }
      fields.forEach(({ f, max, nullable }) => {
        const x = row[f];
        if (x === null && nullable) return;
        if (!num(x) || x < 0) e.push(`${name}: row ${i + 1} "${f}" must be a number, 0 or more`);
        else if (max != null && x > max) e.push(`${name}: row ${i + 1} "${f}" cannot be more than ${max}`);
      });
    });
  };
  bands('Registration fee', r.reg_fee, 'max_cc', [{ f: 'rate', max: 1, nullable: true }]);
  bands('Motor vehicle tax', r.mvt, 'max_cc', [{ f: 'value', max: 10000000 }]);
  (r.mvt || []).forEach((m, i) => { if (m.kind === 'percent' && m.value > 1) e.push(`Motor vehicle tax: row ${i + 1} percent cannot exceed 100%`); });
  bands('Income tax', r.income_tax, 'max_cc', [{ f: 'filer' }, { f: 'non_filer' }]);
  bands('Reg mark fee', r.reg_mark, 'max_cc', [{ f: 'amount' }]);
  bands('Transfer fee', r.transfer_fee, 'max_cc', [{ f: 'amount' }]);
  bands('Hire purchase fee', r.hire_purchase_fee, 'max_cc', [{ f: 'amount' }]);
  bands('Transfer withholding tax', r.transfer_wht, 'max_cc', [{ f: 'filer' }, { f: 'non_filer' }]);
  bands('Late registration', r.late_registration, 'up_to_days', [{ f: 'amount' }]);
  bands('Late transfer', r.late_transfer, 'up_to_days', [{ f: 'amount', nullable: true }]);
  const need = (name: string, o: any, keys: string[], max?: number) => keys.forEach(k => { if (!o || !num(o[k]) || o[k] < 0 || (max != null && o[k] > max)) e.push(`${name} "${k}" is invalid`); });
  need('Fixed fees', r.fixed, ['arc_fee', 'platform_charges', 'professional_tax']);
  need('Double cabin', r.double_cabin, ['reg_fee_rate', 'mvt_rate', 'income_tax_filer', 'max_cc']);
  need('EV discount', r.ev, ['reg_fee_discount', 'mvt_discount'], 1);
  need('CVT', r.cvt, ['rate', 'above_cc', 'max_age_years', 'yearly_depreciation'], 1000000);
  need('Transfer WHT rule', r.transfer_wht_rule, ['yearly_reduction', 'zero_after_years'], 100);
  return e;
}

/** Human-readable list of what differs between two rate sets (used to review a change before saving). */
export function diffRates(a: PunjabRates, b: PunjabRates): string[] {
  const out: string[] = [];
  const walk = (x: any, y: any, path: string) => {
    if (x !== null && y !== null && typeof x === 'object' && typeof y === 'object') {
      const keys = Array.from(new Set([...Object.keys(x), ...Object.keys(y)]));
      keys.forEach(k => walk(x[k], y[k], path ? `${path}.${k}` : k));
    } else if (x !== y) out.push(`${path}: ${x === undefined ? '(none)' : String(x)} -> ${y === undefined ? '(none)' : String(y)}`);
  };
  const strip = (r: PunjabRates) => { const { version, effective_from, last_verified, notes, ...rest } = r; return rest; };
  walk(strip(a), strip(b), '');
  return out;
}

export interface RateSetRow { id: string; version: string; effective_from: string; last_verified: string; notes: string | null; status: 'draft' | 'active' | 'archived'; rates: PunjabRates; created_at: string; }

/** Picks the rate set in force on a date: the active set with the latest effective_from that is not in the future. Falls back to built-in defaults. */
export function pickRateSet(rows: RateSetRow[], onDate: string): { rates: PunjabRates; source: 'database' | 'built-in'; row: RateSetRow | null; problems: string[] } {
  const candidates = rows
    .filter(r => r.status === 'active' && r.effective_from <= onDate)
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : a.effective_from > b.effective_from ? -1 : a.created_at < b.created_at ? 1 : -1));
  for (const row of candidates) {
    const rates = { ...row.rates, version: row.version, effective_from: row.effective_from, last_verified: row.last_verified, notes: row.notes ?? '' };
    const problems = validateRates(rates);
    if (problems.length === 0) return { rates, source: 'database', row, problems: [] };
    // An invalid set is never used silently: fall through to the next one, and report why.
    return { rates: DEFAULT_PUNJAB_RATES, source: 'built-in', row, problems };
  }
  return { rates: DEFAULT_PUNJAB_RATES, source: 'built-in', row: null, problems: [] };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Reminders for the admin: rates not re-checked recently, or not re-checked since the 1 July budget. */
export function rateReminders(rates: PunjabRates, today = new Date()): string[] {
  const out: string[] = [];
  const t = iso(today);
  const days = Math.floor((today.getTime() - new Date(rates.last_verified).getTime()) / 86400000);
  if (days > 90) out.push(`Rates were last verified ${days} days ago. Check the Punjab Excise page and mark them re-verified.`);
  const y = today.getUTCMonth() >= 6 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  const budgetDay = `${y}-07-01`;
  if (t >= budgetDay && rates.last_verified < budgetDay) out.push(`Rates have not been checked since the 1 July ${y} budget. Fees usually change on 1 July.`);
  return out;
}
