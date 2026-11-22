import { writeFileSync } from 'node:fs';
import { buildQuotationPdf } from '../src/lib/quotationPdf';
import { DEFAULT_SETTINGS } from '../src/lib/brand';
import { calculatePunjab } from '../src/lib/punjab';
import { customChargeItems, newField } from '../src/lib/customFields';

let fail = 0;
const eq = (n: string, g: unknown, w: unknown) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, JSON.stringify(g), JSON.stringify(w)); };
const out = process.argv[2] || '';

const calc = calculatePunjab({ transaction_type: 'new_registration', engine_cc: 2694, invoice_value: 12556000, filer_status: 'filer', hire_purchase: true, purchase_date: '2026-10-29', today: '2026-11-06' });
const mk = (extraItems: any[] = [], fields: any[] = []) => {
  const items = [
    ...calc.items,
    { fee_type: 'service_charge', label: 'Service Charges', category: 'service', amount: 25000, formula: 'Agency service charge', source: null, rule_version: null, is_override: false, override_reason: null, sort_order: 100 },
    { fee_type: 'service_charge', label: 'Inspection', category: 'service', amount: 10000, formula: 'Agency service charge', source: null, rule_version: null, is_override: false, override_reason: null, sort_order: 101 },
    ...customChargeItems([{ ...newField({ label: 'Additional Government Charges', kind: 'charge_govt' }), amount: 1500 }]),
    ...extraItems,
  ].map((x: any, i) => ({ ...x, id: 'i' + i, quotation_id: 'q', created_at: '' }));
  const sum = (c: string) => items.filter(i => i.category === c).reduce((s, i) => s + i.amount, 0);
  const quotation: any = { id: 'q', quotation_number: 'LB-20261106-AB12', transaction_type: 'new_registration', subtotal_govt: sum('government'), subtotal_service: sum('service'), subtotal_additional: sum('additional'), grand_total: items.reduce((s, i) => s + i.amount, 0), validity_date: '2026-11-21', payment_terms: '50% advance, 50% on completion', notes: null, created_at: '2026-11-06T10:00:00Z' };
  const client: any = { name: 'Muhammad Ali Khan', phone: '0300-1234567', cnic: '35202-1234567-1', address: 'House 5, Street 3, DHA Phase 5, Lahore' };
  const vehicle: any = { province: 'punjab', company: 'Toyota', model: 'Fortuner 2.7 G', manufacturing_year: 2027, engine_cc: 2694, fuel_type: 'petrol', filer_status: 'filer', registration_number: null };
  const customFields = [
    { ...newField({ label: 'Token Tax', kind: 'choice', options: ['Paid', 'Unpaid'] }), value: 'Unpaid' },
    { ...newField({ label: 'Pending Documents', kind: 'text' }), value: 'Original sales certificate, MCB Bank NOC and lessee CNIC copy' },
    { ...newField({ label: 'Special Instructions', kind: 'text' }), value: 'Number choice: LEA-26-xxx. Deliver file to MCB Gulberg branch after registration.' },
    ...fields,
  ];
  return { quotation, items, client, vehicle, settings: DEFAULT_SETTINGS, customFields, hirePurchase: true };
};

const a = buildQuotationPdf(mk());
eq('sample is one page', a.pages, 1);
eq('sample not shrunk', a.scale, 1);
if (out) writeFileSync(out + '/sample.pdf', Buffer.from(await a.blob.arrayBuffer()));

// Stress: 45 extra charge lines + long remarks must still be ONE page
const many = Array.from({ length: 45 }, (_, i) => ({ fee_type: 'custom_other', label: `Extra charge number ${i + 1} with a fairly long description`, category: 'additional', amount: 100 + i, formula: 'Custom charge added by operator', source: null, rule_version: null, is_override: false, override_reason: null, sort_order: 300 + i }));
const b = buildQuotationPdf(mk(many, [{ ...newField({ label: 'Remarks', kind: 'text' }), value: 'Long remark. '.repeat(40) }]));
eq('stress is one page', b.pages, 1);
console.log('stress scale', b.scale);
if (out) writeFileSync(out + '/stress.pdf', Buffer.from(await b.blob.arrayBuffer()));

// Urdu script does not crash the generator
const c = buildQuotationPdf(mk([], [{ ...newField({ label: 'Remarks', kind: 'text' }), value: 'گاڑی کا نمبر' }]));
eq('non-latin text does not break', c.pages, 1);
process.exit(fail ? 1 : 0);
