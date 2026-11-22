import { pkToday } from './time';
// Punjab Excise engine for private cars. Source: https://excise.punjab.gov.pk/motorvehicle_tax
// plus two real e-pay challans used as test fixtures (see tests/punjab.test.ts).
// Every rate carries verified:true only if it matched a real challan or is stated unambiguously on the official page.
import type { CalcResult } from './calc';
import { DEFAULT_PUNJAB_RATES, PUNJAB_SOURCE_URL, ccBand, dayBand, type PunjabRates } from './punjabRates';

export interface PunjabInput {
  transaction_type: string;
  engine_cc: number | null;
  invoice_value: number | null;       // new registration: invoice price
  filer_status: 'filer' | 'non_filer';
  fuel_type?: string | null;
  cvt_assessed_value?: number | null; // transfer: value Excise charges CVT on (from e-pay challan / Excise calculator)
  transfer_wht?: number | null;       // transfer: optional override with the amount shown by e-pay
  first_registration_date?: string | null; // transfer: YYYY-MM-DD from registration card
  vehicle_value?: number | null;      // transfer: approximate value, used only to ESTIMATE CVT
  purchase_date?: string | null;      // new registration: invoice date, for late registration fine
  sale_date?: string | null;          // transfer: date buyer took the car, for late transfer penalty
  today?: string | null;              // testing hook
  hire_purchase?: boolean;            // bank financed (HPA): adds Hire Purchase Fee
  mvt_manual?: number | null;         // motor vehicle tax from e-pay, for bands whose rate is not known
  reg_fee_manual?: number | null;     // registration fee from e-pay, for bands whose rate is not known
  vehicle_class?: 'car' | 'double_cabin'; // passenger car, or double cabin goods vehicle
  late_fee?: number | null;           // new registration: late registration fee shown by e-pay
}

// Every rate below comes from `rates` (see punjabRates.ts). Nothing in this file hardcodes a fee amount.
const SRC = PUNJAB_SOURCE_URL;
const round = (n: number) => Math.round(n);

export function vehicleAge(firstReg: string | null | undefined, today = new Date()): number | null {
  if (!firstReg) return null;
  const d = new Date(firstReg); if (isNaN(d.getTime())) return null;
  let y = today.getFullYear() - d.getFullYear();
  if (today.getMonth() < d.getMonth() || (today.getMonth() === d.getMonth() && today.getDate() < d.getDate())) y--;
  return Math.max(0, y);
}
export function transferWht(cc: number, filer: boolean, age: number, rates: PunjabRates = DEFAULT_PUNJAB_RATES): number {
  const row = ccBand(rates.transfer_wht, cc);
  const base = filer ? row.filer : row.non_filer;
  const rule = rates.transfer_wht_rule;
  return age >= rule.zero_after_years ? 0 : round(base * (1 - rule.yearly_reduction * age));
}
export function daysBetween(a: string, b: string): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}
// Late registration fine by days since purchase. Band amount 0 means "no fine / not included" (grace period unknown, so not guessed).
export function lateFineVerified(days: number, rates: PunjabRates = DEFAULT_PUNJAB_RATES): boolean { return dayBand(rates.late_registration, days).verified; }
export function lateRegistrationFine(days: number, rates: PunjabRates = DEFAULT_PUNJAB_RATES): number | null {
  const amt = dayBand(rates.late_registration, days).amount;
  return amt > 0 ? amt : null;
}
// Late transfer penalty for cars (Rule 47(3) Punjab Motor Vehicles Rules). Band amount null = published figure unknown.
export function lateTransferPenalty(days: number, rates: PunjabRates = DEFAULT_PUNJAB_RATES): number | null | 'unknown' {
  const amt = dayBand(rates.late_transfer, days).amount;
  if (amt === null) return 'unknown';
  return amt > 0 ? amt : null;
}
const cvtApplies = (cc: number, age: number, rates: PunjabRates) => cc > rates.cvt.above_cc && age <= rates.cvt.max_age_years;

export function punjabMissing(i: PunjabInput, rates: PunjabRates = DEFAULT_PUNJAB_RATES): string[] {
  const m: string[] = [];
  if (!i.engine_cc) m.push('Engine Capacity (CC)');
  if (i.transaction_type === 'new_registration') {
    if (!i.invoice_value) m.push('Invoice / Purchase Value');
    else if (i.invoice_value < 100000) m.push(`Invoice / Purchase Value looks too small (${i.invoice_value.toLocaleString()}). Enter the full amount in rupees, e.g. 12,556,000`);
    const cc = i.engine_cc || 0;
    if ((i.vehicle_class || 'car') === 'double_cabin') {
      if (cc > rates.double_cabin.max_cc) m.push(`Double cabin goods vehicle rates are only known up to ${rates.double_cabin.max_cc}cc. If this is a car or SUV, change Vehicle class to "Passenger car". If it really is a double cabin, enter the e-pay challan lines manually`);
    } else if (cc) {
      if (ccBand(rates.mvt, cc).kind === 'manual' && i.mvt_manual == null) m.push('Motor Vehicle Tax from e-pay (rate for this CC band is not verified)');
      if (ccBand(rates.reg_fee, cc).rate === null && i.reg_fee_manual == null) m.push('Registration Fee from e-pay (rate for this CC band is not verified)');
    }
  } else if (i.transaction_type === 'transfer') {
    const age = vehicleAge(i.first_registration_date);
    if (age == null) m.push('First registration date (from registration card)');
    else if (i.engine_cc && cvtApplies(i.engine_cc, age, rates) && i.cvt_assessed_value == null && !i.vehicle_value)
      m.push('CVT value: enter the e-pay CVT assessed value, or an approximate vehicle value for an estimate');
  } else {
    m.push('Token tax is not supported yet. Use the e-pay figure');
  }
  return m;
}

export function calculatePunjab(i: PunjabInput, rates: PunjabRates = DEFAULT_PUNJAB_RATES): { items: CalcResult[]; warnings: string[]; version: string } {
  const miss = punjabMissing(i, rates);
  if (miss.length) throw new Error('Missing: ' + miss.join(', '));
  const cc = i.engine_cc as number;
  const warnings: string[] = [];
  const items: CalcResult[] = [];
  const VERSION = rates.version;
  let n = 0;
  const add = (fee_type: string, label: string, amount: number, formula: string, verified = true) => {
    items.push({ fee_type, label, category: 'government', amount, formula, source: SRC, rule_version: VERSION, is_override: false, override_reason: null, sort_order: n++ });
    if (!verified) warnings.push(`"${label}" uses a rate not yet matched to a real challan. Verify on e-pay before quoting.`);
  };
  const upTo = (m: number | null) => (m == null ? 'any CC' : `up to ${m}cc`);

  if (i.transaction_type === 'new_registration') {
    const v = i.invoice_value as number;
    const dc = (i.vehicle_class || 'car') === 'double_cabin';
    const regBand = ccBand(rates.reg_fee, cc);
    const manualReg = !dc && regBand.rate === null;
    const rate = dc ? rates.double_cabin.reg_fee_rate : (regBand.rate ?? 0);
    const regUnrounded = manualReg ? (i.reg_fee_manual as number) : v * rate;
    const ev = (i.fuel_type || '').toLowerCase() === 'electric';
    add('registration_fee', 'Registration Fee', round(regUnrounded), manualReg ? 'As shown by e-pay' : `${+(rate * 100).toFixed(4)}% of ${v.toLocaleString()}`);

    const mb = ccBand(rates.mvt, cc);
    if (dc) add('motor_vehicle_tax', 'Motor Vehicle Tax', round(v * rates.double_cabin.mvt_rate), `${+(rates.double_cabin.mvt_rate * 100).toFixed(4)}% of ${v.toLocaleString()} (double cabin)`);
    else if (mb.kind === 'lifetime') add('lifetime_token', 'Life Time Token', mb.value, `Fixed for ${upTo(mb.max_cc)}`, mb.verified);
    else if (mb.kind === 'percent') add('motor_vehicle_tax', 'Motor Vehicle Tax', round(v * mb.value), `${+(mb.value * 100).toFixed(4)}% of ${v.toLocaleString()}`, mb.verified);
    else add('motor_vehicle_tax', 'Motor Vehicle Tax', i.mvt_manual as number, 'As shown by e-pay', false);

    if (dc) add('income_tax', 'Income Tax', rates.double_cabin.income_tax_filer, 'Double cabin, seen on 2 real challans (filer)', i.filer_status === 'filer');
    else {
      const row = ccBand(rates.income_tax, cc);
      const it = i.filer_status === 'filer' ? row.filer : row.non_filer;
      add('income_tax', `Income Tax (${i.filer_status === 'filer' ? 'Filer' : 'Non-Filer'})`, it, `Table, ${upTo(row.max_cc)}`, i.filer_status === 'filer' ? row.verified : false);
    }
    add('additional_reg_mark_fee', 'Additional Reg Mark Fee', ccBand(rates.reg_mark, cc).amount, 'By CC band (seen on real challans)');
    if (i.hire_purchase) { const hp = ccBand(rates.hire_purchase_fee, cc); add('hire_purchase_fee', 'Hire Purchase Fee', hp.amount, `Hire purchase endorsement, ${upTo(hp.max_cc)} (bank financed)`, hp.verified); }
    const nowIso = i.today || pkToday();
    const lateDays = i.purchase_date ? daysBetween(i.purchase_date, nowIso) : null;
    const autoLate = i.late_fee == null && lateDays != null ? lateRegistrationFine(lateDays, rates) : null;
    const late = i.late_fee ?? autoLate ?? 0;
    add('late_registration_fee', 'Late Registration Fee', late, i.late_fee != null ? 'As shown by e-pay' : autoLate != null ? `Delay from purchase date, per Gazette notification Sep 2025` : 'Not included', i.late_fee != null || autoLate == null || (lateDays != null && lateFineVerified(lateDays, rates)));
    if (i.late_fee == null && autoLate == null) warnings.push('Late registration fee is NOT included. If the vehicle is registered late, add it from e-pay.');
    add('smart_card_fee', 'Automated Registration Card Fee', rates.fixed.arc_fee, 'Fixed');
    add('professional_tax', 'Professional Tax', rates.fixed.professional_tax, 'Fixed');
    add('miscellaneous', 'Miscellaneous', 0, 'Fixed');
    if (ev) {
      // Matches 2 real EV challans (Deepal S05 and Inverex Xio): 95% off registration fee (floored), 99% off motor vehicle tax.
      add('ev_discount_reg_fee', 'Electric Vehicle Discount Reg Fee', -Math.floor(regUnrounded * rates.ev.reg_fee_discount), `${+(rates.ev.reg_fee_discount * 100).toFixed(2)}% of registration fee`, true);
      const mv = items.find(x => x.fee_type === 'motor_vehicle_tax');
      if (mv) add('ev_discount_mvt', 'Electric Vehicle Discount MVT', -round(mv.amount * rates.ev.mvt_discount), `${+(rates.ev.mvt_discount * 100).toFixed(2)}% of motor vehicle tax`, true);
    }
    add('platform_charges', 'Govt. Platform Charges', rates.fixed.platform_charges, 'Fixed');
    warnings.push('Withholding tax at registration is collected by the dealer and does not appear on this challan.');
  } else {
    const tf = ccBand(rates.transfer_fee, cc);
    add('transfer_fee', 'Transfer Fee', tf.amount, `Band ${upTo(tf.max_cc)}`);
    add('miscellaneous', 'Miscellaneous', 0, 'Fixed');
    const age = vehicleAge(i.first_registration_date) as number;
    const filer = i.filer_status === 'filer';
    const auto = transferWht(cc, filer, age, rates);
    const wht = i.transfer_wht != null ? i.transfer_wht : auto;
    const row = ccBand(rates.transfer_wht, cc);
    const rule = rates.transfer_wht_rule;
    add('withholding_tax', `With Holding Tax (${filer ? 'Filer' : 'Non-Filer'})`, wht,
      i.transfer_wht != null ? 'Entered from e-pay' : `Base ${(filer ? row.filer : row.non_filer).toLocaleString()} reduced ${+(rule.yearly_reduction * 100).toFixed(2)}% per full year (age ${age}); 0 after ${rule.zero_after_years} years`,
      i.transfer_wht != null || (cc > 1600 && cc <= 1800 && !filer && age === 0));
    add('smart_card_fee', 'Automated Registration Card Fee', rates.fixed.arc_fee, 'Fixed');
    const cvt = rates.cvt;
    if (!cvtApplies(cc, age, rates)) add('cvt', 'Capital Value Tax (CVT)', 0, `Not applicable (${cvt.above_cc}cc or below, or older than ${cvt.max_age_years} years)`);
    else if (i.cvt_assessed_value != null) add('cvt', 'Capital Value Tax (CVT)', round(i.cvt_assessed_value * cvt.rate), `${+(cvt.rate * 100).toFixed(4)}% of ${i.cvt_assessed_value.toLocaleString()} (e-pay assessed value)`, false);
    else {
      const est = round((i.vehicle_value as number) * Math.pow(1 - cvt.yearly_depreciation, age) * cvt.rate);
      add('cvt', 'Capital Value Tax (CVT) ESTIMATE', est, `${+(cvt.rate * 100).toFixed(4)}% of ${(i.vehicle_value as number).toLocaleString()} x ${+(1 - cvt.yearly_depreciation).toFixed(4)}^${age}. Estimate only`, false);
      warnings.push('CVT is an ESTIMATE. Excise uses its own vehicle value table. Final amount comes from the e-pay challan.');
    }
    if (i.sale_date) {
      const pen = lateTransferPenalty(daysBetween(i.sale_date, i.today || pkToday()), rates);
      if (pen === 'unknown') warnings.push('Transfer is later than the last published penalty band. The penalty is not published in the sources I found. Confirm on e-pay.');
      else if (pen) add('late_transfer_penalty', 'Late Transfer Penalty (Rule 47(3))', pen, 'Delay since date of sale', false);
    } else warnings.push('Date of sale not entered. A late transfer penalty is NOT included.');
    add('additional_reg_mark_fee', 'Additional Reg Mark Fee', ccBand(rates.reg_mark, cc).amount, 'By CC band (seen on real challans)');
    add('platform_charges', 'Govt. Platform Charges', rates.fixed.platform_charges, 'Fixed');
    warnings.push('Withholding tax table comes from a secondary source and matched one real challan. Confirm on e-pay.');
  }
  return { items, warnings, version: VERSION };
}
