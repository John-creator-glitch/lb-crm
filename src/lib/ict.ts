import { pkToday } from './time';
// Islamabad (ICT) Excise engine for private cars and pickups (same rates), NEW REGISTRATION only.
// Every rate comes from `rates` (see ictRates.ts, editable by an admin on the Islamabad Rates page). Nothing here hardcodes a fee.
import type { CalcResult } from './calc';
import { DEFAULT_ICT_RATES, ICT_SOURCE_URL, ictBand, type IctRates } from './ictRates';

export interface IctInput {
  engine_cc: number | null;
  invoice_value: number | null;
  filer_status: 'filer' | 'non_filer';
  fuel_type?: string | null;
  purchase_date?: string | null;
  today?: string | null;
  late_fee?: number | null;         // late registration fee as quoted by ICT Excise
  token_manual?: number | null;     // token tax as quoted by ICT Excise (overrides the formula)
  number_plate_fee?: number | null; // overrides the standard number plate fee
  hire_purchase?: boolean;          // bank financed: adds the hire purchase endorsement fee
}

export function isIctCar(i: { province: string; vehicle_category: string; transaction_type: string }): boolean {
  return i.province === 'islamabad' && ['car', 'jeep'].includes(i.vehicle_category) && i.transaction_type === 'new_registration';
}

const isEv = (i: IctInput) => (i.fuel_type || '').toLowerCase() === 'electric';

export function ictMissing(i: IctInput, rates: IctRates = DEFAULT_ICT_RATES): string[] {
  const m: string[] = [];
  if (!i.engine_cc) m.push('Engine Capacity (CC)');
  if (!i.invoice_value) m.push('Invoice / Purchase Value');
  else if (i.invoice_value < 100000) m.push(`Invoice / Purchase Value looks too small (${i.invoice_value.toLocaleString()}). Enter the full amount in rupees`);
  if (i.engine_cc) {
    if (ictBand(rates.reg_fee, i.engine_cc).rate === null && !isEv(i)) m.push('Registration fee: the rate for this CC band is not known. Update the Islamabad Rates page');
    if (ictBand(rates.token, i.engine_cc).kind === 'manual' && i.token_manual == null) m.push('Motor Vehicle Tax from ICT Excise (rate for this CC band is not set)');
  }
  if (isEv(i) && !rates.ev.confirmed && i.token_manual == null) m.push('Electric vehicle: enter the Motor Vehicle Tax shown by ICT Excise (EV relief is not yet confirmed on a real ICT challan)');
  return m;
}

const round = (n: number) => Math.round(n);

export function calculateIct(i: IctInput, rates: IctRates = DEFAULT_ICT_RATES): { items: CalcResult[]; warnings: string[]; version: string } {
  const miss = ictMissing(i, rates);
  if (miss.length) throw new Error('Missing: ' + miss.join(', '));
  const cc = i.engine_cc as number, v = i.invoice_value as number;
  const filer = i.filer_status === 'filer';
  const ev = isEv(i);
  const items: CalcResult[] = [];
  const warnings: string[] = [];
  let n = 0;
  const add = (fee_type: string, label: string, amount: number, formula: string, verified = true) => {
    items.push({ fee_type, label, category: 'government', amount, formula, source: ICT_SOURCE_URL, rule_version: rates.version, is_override: false, override_reason: null, sort_order: n++ });
    if (!verified) warnings.push(`"${label}" is not confirmed on a real ICT challan. Verify with ICT Excise before quoting.`);
  };
  const pct = (r: number) => `${+(r * 100).toFixed(4)}%`;

  const rf = ictBand(rates.reg_fee, cc);
  const regFee = round(v * (rf.rate ?? 0));
  add('registration_fee', 'Registration Fee', regFee, `${pct(rf.rate ?? 0)} of ${v.toLocaleString()}`, rf.verified);
  if (ev && rates.ev.reg_fee_discount > 0) add('ev_discount_reg_fee', 'Electric Vehicle Discount Reg Fee', -Math.floor(regFee * rates.ev.reg_fee_discount), `${pct(rates.ev.reg_fee_discount)} of registration fee`, !!rates.ev.confirmed);

  const tk = ictBand(rates.token, cc);
  let tokenAmt = 0;
  if (i.token_manual != null) { tokenAmt = i.token_manual; add('motor_vehicle_tax', 'Motor Vehicle Tax', tokenAmt, 'As quoted by ICT Excise'); }
  else {
    tokenAmt = tk.kind === 'lifetime' ? tk.value : round(v * tk.value);
    add('motor_vehicle_tax', 'Motor Vehicle Tax', tokenAmt, tk.kind === 'lifetime' ? `Fixed for up to ${tk.max_cc}cc` : `${pct(tk.value)} of ${v.toLocaleString()} (full year, not pro-rated)`, tk.verified);
    if (ev && rates.ev.mvt_discount > 0) add('ev_discount_mvt', 'Electric Vehicle Discount MVT', -round(tokenAmt * rates.ev.mvt_discount), `${pct(rates.ev.mvt_discount)} of motor vehicle tax`, !!rates.ev.confirmed);
  }

  if (i.hire_purchase) { const hp = ictBand(rates.hire_purchase_fee, cc); add('hire_purchase_fee', 'Hire Purchase Fee', hp.amount, 'Hire purchase endorsement (bank financed)', hp.verified); }

  const it = ictBand(rates.income_tax, cc);
  add('income_tax', `Income Tax (${filer ? 'Filer' : 'Non-Filer'})`, filer ? it.filer : it.non_filer, `Table by CC, up to ${it.max_cc ?? 'any'}cc`, filer ? it.verified : false);
  add('professional_tax', 'Professional Tax', rates.fixed.professional_tax, 'Fixed');
  add('smart_card_fee', 'Smart Card Fee', rates.fixed.smart_card, 'Fixed');
  add('number_plate_fee', 'Number Plate Fee', i.number_plate_fee ?? rates.fixed.number_plate, i.number_plate_fee != null ? 'As quoted by ICT Excise' : 'Fixed');

  const nowIso = i.today || pkToday();
  const lateDays = i.purchase_date ? Math.floor((new Date(nowIso).getTime() - new Date(i.purchase_date).getTime()) / 86400000) : null;
  if (i.late_fee != null) add('late_registration_fee', 'Late Registration Fee', i.late_fee, 'As quoted by ICT Excise');
  else if (lateDays != null && lateDays > rates.late.after_days)
    warnings.push(`Registration is ${lateDays} days after the invoice date (limit ${rates.late.after_days}). A late fee applies but its amount is not published. Enter the ICT figure.`);

  warnings.push('Advance tax (s.231B) is collected by the dealer and does not appear on the ICT challan. A requested (choice) number costs extra, e.g. 10,000 for a normal requested number.');
  return { items, warnings, version: rates.version };
}
