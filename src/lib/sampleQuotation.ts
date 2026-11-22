import type { BusinessSettings } from './brand';
import type { QuotationPdfInput } from './quotationPdf';
import { calculatePunjab } from './punjab';

/** A realistic sample (Fortuner, 12,556,000) used by the Settings page to preview the quotation design. */
export function sampleQuotation(settings: BusinessSettings): QuotationPdfInput {
  const calc = calculatePunjab({ transaction_type: 'new_registration', engine_cc: 2694, invoice_value: 12556000, filer_status: 'filer', hire_purchase: true });
  const extras = settings.service_presets.filter(p => p.amount > 0).slice(0, 3).map((p, i) => ({ fee_type: 'service_charge', label: p.label, category: 'service' as const, amount: p.amount, formula: 'Agency service charge', source: null, rule_version: null, is_override: false, override_reason: null, sort_order: 100 + i }));
  if (!extras.length) extras.push({ fee_type: 'service_charge', label: 'Service Charges', category: 'service', amount: 5000, formula: 'Agency service charge', source: null, rule_version: null, is_override: false, override_reason: null, sort_order: 100 });
  const items: any[] = [...calc.items, ...extras].map((x, i) => ({ ...x, id: 's' + i, quotation_id: 'sample', created_at: '' }));
  const sum = (c: string) => items.filter(i => i.category === c).reduce((t, i) => t + i.amount, 0);
  return {
    quotation: { id: 'sample', quotation_number: 'LB-SAMPLE-0001', transaction_type: 'new_registration', subtotal_govt: sum('government'), subtotal_service: sum('service'), subtotal_additional: 0, grand_total: items.reduce((t, i) => t + i.amount, 0), validity_date: new Date(Date.now() + settings.validity_days * 86400000).toISOString().slice(0, 10), payment_terms: settings.payment_terms, notes: null, created_at: new Date().toISOString() } as any,
    items, hirePurchase: true, settings,
    client: { name: 'Sample Customer', phone: '0300-0000000', cnic: null, address: null } as any,
    vehicle: { province: 'punjab', company: 'Toyota', model: 'Fortuner', manufacturing_year: 2027, engine_cc: 2694, fuel_type: 'petrol', filer_status: 'filer', registration_number: null } as any,
    customFields: [{ id: 'a', label: 'Token Tax', kind: 'choice', value: 'Unpaid' }, { id: 'b', label: 'Pending Documents', kind: 'text', value: 'Sample: original sales certificate' }],
  };
}
