import type { CalcResult } from './calc';

// Extra per-quotation fields the operator can add whenever needed (token tax paid/unpaid, pending documents, special charges, remarks...).
//   charge_govt  : extra government charge, added to the challan total
//   charge_other : any other extra charge, added to additional expenses
//   text         : free text shown on the quotation (pending documents, instructions, remarks)
//   choice       : pick one option (e.g. Token Tax: Paid / Unpaid)
export type CustomFieldKind = 'charge_govt' | 'charge_other' | 'text' | 'choice';
export interface CustomField { id: string; label: string; kind: CustomFieldKind; amount?: number; value?: string; options?: string[]; }
export interface CustomFieldPreset { label: string; kind: CustomFieldKind; options?: string[]; }

export const DEFAULT_FIELD_PRESETS: CustomFieldPreset[] = [
  { label: 'Token Tax', kind: 'choice', options: ['Paid', 'Unpaid'] },
  { label: 'Additional Government Charges', kind: 'charge_govt' },
  { label: 'Pending Documents', kind: 'text' },
  { label: 'Special Instructions', kind: 'text' },
  { label: 'Remarks', kind: 'text' },
  { label: 'Number Choice', kind: 'text' },
  { label: 'Other Charge', kind: 'charge_other' },
];

export const FIELD_KIND_LABEL: Record<CustomFieldKind, string> = {
  charge_govt: 'Government charge (Rs)',
  charge_other: 'Other charge (Rs)',
  text: 'Note / text',
  choice: 'Choice',
};

let seq = 0;
export const newField = (p?: Partial<CustomFieldPreset>): CustomField => ({
  id: `cf${Date.now().toString(36)}${seq++}`,
  label: p?.label ?? '',
  kind: p?.kind ?? 'text',
  options: p?.options,
  amount: undefined,
  value: p?.kind === 'choice' ? p.options?.[0] ?? '' : '',
});

/** Charge fields become real quotation line items so every total in the system (list, detail, PDF, payments) stays consistent. */
export function customChargeItems(fields: CustomField[], startOrder = 150): CalcResult[] {
  return fields
    .filter(f => (f.kind === 'charge_govt' || f.kind === 'charge_other') && f.label.trim() && Number(f.amount) > 0)
    .map((f, i) => ({
      fee_type: f.kind === 'charge_govt' ? 'custom_govt' : 'custom_other',
      label: f.label.trim(),
      category: f.kind === 'charge_govt' ? ('government' as const) : ('additional' as const),
      amount: Number(f.amount),
      formula: 'Custom charge added by operator',
      source: null, rule_version: null, is_override: false, override_reason: null, sort_order: startOrder + i,
    }));
}

/** Fields that are shown as information on the quotation (not amounts). Empty values are dropped. */
export function infoFields(fields: CustomField[] | undefined | null): { label: string; value: string }[] {
  return (fields ?? [])
    .filter(f => (f.kind === 'text' || f.kind === 'choice') && f.label.trim() && (f.value ?? '').trim())
    .map(f => ({ label: f.label.trim(), value: (f.value ?? '').trim() }));
}
