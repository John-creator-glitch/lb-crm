import { calculatePunjab } from './punjab';
import { calculateIct, isIctCar } from './ict';
import type { IctRates } from './ictRates';
import type { PunjabRates } from './punjabRates';
import type {
  FeeRule,
  FilerStatus,
  LineItemCategory,
  ComputationType,
} from './supabase';

export interface CalcInput {
  province: string;
  transaction_type: string;
  vehicle_category: string;
  engine_cc: number | null;
  invoice_value: number | null;
  manufacturing_year: number | null;
  filer_status: FilerStatus;
  fuel_type: string | null;
  origin: string | null;
  cvt_assessed_value?: number | null;
  transfer_wht?: number | null;
  late_fee?: number | null;
  first_registration_date?: string | null;
  purchase_date?: string | null;
  sale_date?: string | null;
  hire_purchase?: boolean;
  mvt_manual?: number | null;
  reg_fee_manual?: number | null;
  vehicle_class?: 'car' | 'double_cabin';
  vehicle_value?: number | null;
  number_plate_fee?: number | null;
}

export interface CalcResult {
  fee_type: string;
  label: string;
  category: LineItemCategory;
  amount: number;
  formula: string;
  source: string | null;
  rule_version: string | null;
  is_override: boolean;
  override_reason: string | null;
  sort_order: number;
}

export interface CalculationBreakdown {
  lineItems: CalcResult[];
  subtotal_govt: number;
  subtotal_service: number;
  subtotal_additional: number;
  grand_total: number;
  warnings: string[];
  rule_version: string;
  calculated_at: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function matchRule(
  rules: FeeRule[],
  input: CalcInput,
  feeType: string,
): FeeRule | null {
  return (
    rules.find(
      r =>
        r.is_active &&
        r.province === input.province &&
        r.transaction_type === input.transaction_type &&
        r.vehicle_category === input.vehicle_category &&
        r.fee_type === feeType,
    ) ?? null
  );
}

function computeByType(
  rule: FeeRule,
  input: CalcInput,
): { amount: number; formula: string } {
  const p = rule.params || {};
  const cc = input.engine_cc ?? 0;
  const value = input.invoice_value ?? 0;
  const year = input.manufacturing_year;
  const ageYears = year ? Math.max(0, new Date().getFullYear() - year) : 0;

  switch (rule.computation_type as ComputationType) {
    case 'fixed': {
      const amount = Number(p.amount ?? 0);
      return { amount, formula: `Fixed PKR ${amount.toLocaleString()}` };
    }
    case 'per_cc': {
      const rate = Number(p.rate ?? 0);
      const amount = round2(rate * cc);
      return { amount, formula: `${rate} × ${cc}cc = PKR ${amount.toLocaleString()}` };
    }
    case 'percent_of_value': {
      const rate = Number(p.rate ?? 0);
      const pct = round2(rate * 100);
      const raw = value * rate;
      const min = p.min ? Number(p.min) : 0;
      const amount = round2(Math.max(min, raw));
      const formula = min > 0 && raw < min
        ? `${pct}% of ${value.toLocaleString()} = ${round2(raw).toLocaleString()} (min ${min.toLocaleString()} applied)`
        : `${pct}% of ${value.toLocaleString()} = PKR ${amount.toLocaleString()}`;
      return { amount, formula };
    }
    case 'percent_of_value_capped': {
      const rate = Number(p.rate ?? 0);
      const pct = round2(rate * 100);
      const min = p.min ? Number(p.min) : 0;
      const max = p.max ? Number(p.max) : Infinity;
      const raw = value * rate;
      const clamped = Math.min(max, Math.max(min, raw));
      const amount = round2(clamped);
      let formula = `${pct}% of ${value.toLocaleString()} = ${round2(raw).toLocaleString()}`;
      if (clamped < raw) formula += ` (capped at ${max.toLocaleString()})`;
      if (clamped > raw && min > 0) formula += ` (min ${min.toLocaleString()} applied)`;
      return { amount, formula };
    }
    case 'slab_cc': {
      const slabs: { max_cc: number; amount: number }[] = p.slabs ?? [];
      const slab = slabs.find(s => cc <= s.max_cc) ?? slabs[slabs.length - 1];
      if (!slab) return { amount: 0, formula: 'No matching CC slab' };
      return {
        amount: Number(slab.amount),
        formula: `CC ${cc} → slab (≤${slab.max_cc}cc) = PKR ${Number(slab.amount).toLocaleString()}`,
      };
    }
    case 'slab_value': {
      const slabs: { max_value: number; amount: number; rate?: number }[] = p.slabs ?? [];
      const slab = slabs.find(s => value <= s.max_value) ?? slabs[slabs.length - 1];
      if (!slab) return { amount: 0, formula: 'No matching value slab' };
      const amt = slab.rate ? round2(value * Number(slab.rate)) : Number(slab.amount);
      return {
        amount: amt,
        formula: `Value ${value.toLocaleString()} → slab (≤${slab.max_value.toLocaleString()}) = PKR ${amt.toLocaleString()}`,
      };
    }
    case 'per_year_age': {
      const perYear = Number(p.per_year ?? 0);
      const amount = round2(perYear * ageYears);
      return {
        amount,
        formula: `${perYear} × ${ageYears} yrs (age) = PKR ${amount.toLocaleString()}`,
      };
    }
    default:
      return { amount: 0, formula: `Unknown computation type: ${rule.computation_type}` };
  }
}

const ALL_FEE_TYPES = [
  'registration_fee',
  'transfer_fee',
  'transfer_letter_fee',
  'token_tax_life',
  'token_tax_annual',
  'pending_token_tax',
  'withholding_tax_filer',
  'withholding_tax_nonfiler',
  'smart_card_fee',
  'number_plate_fee',
  'cvt',
  'luxury_tax',
  'late_registration_penalty',
];

const FILER_DEPENDENT = new Set(['withholding_tax_filer', 'withholding_tax_nonfiler']);

export function isPunjabCar(i: { province: string; vehicle_category: string; transaction_type: string }): boolean {
  return i.province === 'punjab' && ['car', 'jeep'].includes(i.vehicle_category) && ['new_registration', 'transfer'].includes(i.transaction_type);
}

export function calculate(
  rules: FeeRule[],
  input: CalcInput,
  punjabRates?: PunjabRates,
  ictRates?: IctRates,
): CalculationBreakdown {
  if (isPunjabCar(input)) {
    const r = calculatePunjab(input, punjabRates);
    const subtotal_govt = round2(r.items.reduce((t, l) => t + l.amount, 0));
    return {
      lineItems: r.items, subtotal_govt, subtotal_service: 0, subtotal_additional: 0, grand_total: subtotal_govt,
      warnings: [...r.warnings, 'Final amount is confirmed only by the Government challan (PSID).'],
      rule_version: r.version, calculated_at: new Date().toISOString(),
    };
  }
  if (isIctCar(input)) {
    const r = calculateIct({
      engine_cc: input.engine_cc, invoice_value: input.invoice_value, filer_status: input.filer_status, fuel_type: input.fuel_type,
      purchase_date: input.purchase_date, late_fee: input.late_fee, token_manual: input.mvt_manual, number_plate_fee: input.number_plate_fee, hire_purchase: input.hire_purchase,
    }, ictRates);
    const subtotal_govt = round2(r.items.reduce((t, l) => t + l.amount, 0));
    return {
      lineItems: r.items, subtotal_govt, subtotal_service: 0, subtotal_additional: 0, grand_total: subtotal_govt,
      warnings: [...r.warnings, 'Final amount is confirmed only by the ICT Excise challan.'],
      rule_version: r.version, calculated_at: new Date().toISOString(),
    };
  }
  const lineItems: CalcResult[] = [];
  const warnings: string[] = [];
  let sortOrder = 0;
  let ruleVersion = '';

  for (const feeType of ALL_FEE_TYPES) {
    if (FILER_DEPENDENT.has(feeType)) {
      const wanted =
        input.filer_status === 'filer'
          ? 'withholding_tax_filer'
          : 'withholding_tax_nonfiler';
      if (feeType !== wanted) continue;
    }

    const rule = matchRule(rules, input, feeType);
    if (!rule) continue;

    const { amount, formula } = computeByType(rule, input);
    if (!ruleVersion) ruleVersion = rule.rate_version;

    if (rule.last_verified_date) {
      const daysSince = Math.floor(
        (Date.now() - new Date(rule.last_verified_date).getTime()) / 86400000,
      );
      if (daysSince > 180) {
        warnings.push(
          `Fee "${rule.label}" was last verified ${daysSince} days ago — please re-verify against the official source.`,
        );
      }
    } else {
      warnings.push(`Fee "${rule.label}" has no last-verified date on record.`);
    }

    lineItems.push({
      fee_type: rule.fee_type,
      label: rule.label,
      category: 'government',
      amount,
      formula,
      source: rule.source_url,
      rule_version: rule.rate_version,
      is_override: false,
      override_reason: null,
      sort_order: sortOrder++,
    });
  }

  const subtotal_govt = round2(lineItems.reduce((s, l) => s + l.amount, 0));

  warnings.push(
    'These figures are based on admin-maintained fee rules. Always verify against the official government source before final collection.',
  );

  return {
    lineItems,
    subtotal_govt,
    subtotal_service: 0,
    subtotal_additional: 0,
    grand_total: subtotal_govt,
    warnings,
    rule_version: ruleVersion,
    calculated_at: new Date().toISOString(),
  };
}

export function recalcTotals(items: CalcResult[]): {
  subtotal_govt: number;
  subtotal_service: number;
  subtotal_additional: number;
  grand_total: number;
} {
  const sum = (cat: LineItemCategory) =>
    round2(items.filter(i => i.category === cat).reduce((s, i) => s + i.amount, 0));
  const subtotal_govt = sum('government');
  const subtotal_service = sum('service');
  const subtotal_additional = sum('additional');
  return {
    subtotal_govt,
    subtotal_service,
    subtotal_additional,
    grand_total: round2(subtotal_govt + subtotal_service + subtotal_additional),
  };
}
