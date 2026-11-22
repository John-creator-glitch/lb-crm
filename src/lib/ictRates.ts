// Islamabad (ICT) rate set as DATA, same idea as punjabRates.ts: admins create a new version on the "Islamabad Rates" page
// when ICT Excise or the Finance Act changes a fee. No code change or redeploy needed.
// DEFAULT_ICT_RATES is the built-in fallback (used when the database has no active set or cannot be reached).
// Rates are matched to real ICT challans (Mar to Nov 2026, see tests/ict.test.ts). verified=false means "not seen on a real challan".

export const ICT_SOURCE_URL = 'https://www.islamabadexcise.gov.pk/';

export interface IctRates {
  version: string;
  effective_from: string;   // YYYY-MM-DD
  last_verified: string;    // YYYY-MM-DD
  notes: string;
  // Registration fee, % of invoice value. rate null = not known: the operator types the ICT figure instead.
  reg_fee: { max_cc: number | null; rate: number | null; verified: boolean }[];
  // Token (motor vehicle) tax. lifetime = fixed rupees, percent = fraction of invoice value, manual = operator types the ICT figure.
  token: { max_cc: number | null; kind: 'lifetime' | 'percent' | 'manual'; value: number; verified: boolean }[];
  // Income tax on the challan, fixed rupees by CC. verified refers to the filer figure.
  income_tax: { max_cc: number | null; filer: number; non_filer: number; verified: boolean }[];
  hire_purchase_fee: { max_cc: number | null; amount: number; verified: boolean }[];
  fixed: { professional_tax: number; smart_card: number; number_plate: number };
  late: { after_days: number };
  // Electric vehicle relief. confirmed 0 = not yet seen on a real ICT challan: the operator must then type the ICT token tax.
  ev: { reg_fee_discount: number; mvt_discount: number; confirmed: number };
}

export const DEFAULT_ICT_RATES: IctRates = {
  version: 'ICT-2026-27',
  effective_from: '2026-07-01',
  last_verified: '2026-11-08',
  notes: 'Built-in defaults matched to real ICT challans (Mar to Nov 2026): Fortuner 2694cc and 2755cc, Hilux Revo 2755cc, Yaris 1329cc.',
  reg_fee: [
    { max_cc: 999, rate: 0.01, verified: false },
    { max_cc: 1999, rate: 0.02, verified: true },   // Yaris 1329cc
    { max_cc: null, rate: 0.04, verified: true },   // Fortuner 2694cc / 2755cc, Hilux 2755cc
  ],
  token: [
    { max_cc: 1000, kind: 'lifetime', value: 20000, verified: false },
    { max_cc: 2000, kind: 'percent', value: 0.0025, verified: true },   // Yaris 1329cc, full year (not pro-rated)
    { max_cc: null, kind: 'percent', value: 0.0035, verified: true },   // Fortuner, Hilux
  ],
  income_tax: [
    { max_cc: 1000, filer: 800, non_filer: 1600, verified: false },
    { max_cc: 1199, filer: 1500, non_filer: 3000, verified: false },
    { max_cc: 1299, filer: 1750, non_filer: 3500, verified: false },
    { max_cc: 1499, filer: 2500, non_filer: 5000, verified: true },    // Yaris 1329cc
    { max_cc: 1599, filer: 3750, non_filer: 7500, verified: false },
    { max_cc: 1999, filer: 4500, non_filer: 9000, verified: false },
    { max_cc: null, filer: 10000, non_filer: 20000, verified: true },  // Fortuner, Hilux
  ],
  // 1329cc = 2,000 and 2755cc Hilux = 3,000 on real challans. The boundary between them (2000cc) is assumed.
  hire_purchase_fee: [{ max_cc: 2000, amount: 2000, verified: true }, { max_cc: null, amount: 3000, verified: true }],
  fixed: { professional_tax: 100, smart_card: 2400, number_plate: 1000 },
  late: { after_days: 60 },
  ev: { reg_fee_discount: 1, mvt_discount: 0, confirmed: 0 },
};

export interface IctRateSetRow { id: string; version: string; effective_from: string; last_verified: string; notes: string | null; status: 'draft' | 'active' | 'archived'; rates: IctRates; created_at: string; }

export function ictBand<T extends { max_cc: number | null }>(bands: T[], cc: number): T {
  return bands.find(b => b.max_cc == null || cc <= b.max_cc) ?? bands[bands.length - 1];
}

const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s).getTime());
const num = (v: unknown) => typeof v === 'number' && isFinite(v);

/** Returns a list of problems. Empty list = safe to save and use. */
export function validateIctRates(r: IctRates): string[] {
  const e: string[] = [];
  if (!r || typeof r !== 'object') return ['Rates are missing'];
  if (!r.version || !String(r.version).trim()) e.push('Version label is required');
  if (!isDate(r.effective_from)) e.push('Effective date must be YYYY-MM-DD');
  if (!isDate(r.last_verified)) e.push('Last verified date must be YYYY-MM-DD');
  const bands = (name: string, rows: any[] | undefined, fields: { f: string; max?: number; nullable?: boolean }[]) => {
    if (!Array.isArray(rows) || rows.length === 0) { e.push(`${name}: at least one row is required`); return; }
    let prev = -Infinity;
    rows.forEach((row, i) => {
      const last = i === rows.length - 1; const v = row.max_cc;
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
  bands('Registration fee', r.reg_fee, [{ f: 'rate', max: 1, nullable: true }]);
  bands('Token tax', r.token, [{ f: 'value', max: 10000000 }]);
  (r.token || []).forEach((m, i) => { if (m.kind === 'percent' && m.value > 1) e.push(`Token tax: row ${i + 1} percent cannot exceed 100%`); });
  bands('Income tax', r.income_tax, [{ f: 'filer' }, { f: 'non_filer' }]);
  bands('Hire purchase fee', r.hire_purchase_fee, [{ f: 'amount' }]);
  const need = (name: string, o: any, keys: string[], max?: number) => keys.forEach(k => { if (!o || !num(o[k]) || o[k] < 0 || (max != null && o[k] > max)) e.push(`${name} "${k}" is invalid`); });
  need('Fixed fees', r.fixed, ['professional_tax', 'smart_card', 'number_plate']);
  need('Late registration', r.late, ['after_days']);
  need('EV relief', r.ev, ['reg_fee_discount', 'mvt_discount'], 1);
  need('EV relief', r.ev, ['confirmed'], 1);
  return e;
}

/** The active set with the latest effective_from that is not in the future. An invalid set is never used silently. */
export function pickIctRateSet(rows: IctRateSetRow[], onDate: string): { rates: IctRates; source: 'database' | 'built-in'; row: IctRateSetRow | null; problems: string[] } {
  const candidates = rows
    .filter(r => r.status === 'active' && r.effective_from <= onDate)
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : a.effective_from > b.effective_from ? -1 : a.created_at < b.created_at ? 1 : -1));
  for (const row of candidates) {
    const rates = { ...row.rates, version: row.version, effective_from: row.effective_from, last_verified: row.last_verified, notes: row.notes ?? '' };
    const problems = validateIctRates(rates);
    if (problems.length === 0) return { rates, source: 'database', row, problems: [] };
    return { rates: DEFAULT_ICT_RATES, source: 'built-in', row, problems };
  }
  return { rates: DEFAULT_ICT_RATES, source: 'built-in', row: null, problems: [] };
}
