import { DEFAULT_FIELD_PRESETS, type CustomFieldPreset } from './customFields';
import { DEFAULT_LOGO } from './defaultLogo';

// Pure data (no database import) so the PDF generator and tests can use it anywhere.
export interface BusinessSettings {
  business_name: string;
  tagline: string;
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  logo_data_url: string | null;   // uploaded logo, stored as a small PNG data URL
  brand_color: string;            // main brand colour (PDF header, totals bar)
  accent_color: string;           // secondary colour (lines, highlights)
  document_title: string;         // "QUOTATION" / "ESTIMATE"
  validity_days: number;
  payment_terms: string;
  service_details: string;        // what the service includes, one point per line, printed on the quotation
  terms_text: string;             // footer terms, one point per line
  bank_details: string;           // optional: account title / number for payment
  signatory: string;              // "Authorized by" name shown at the bottom
  estimate_note: string;          // notice printed under the totals on every quotation
  show_basis: boolean;            // print the short calculation basis under fee names, e.g. "4% of 12,556,000"
  service_presets: { label: string; amount: number }[]; // quick-add agency charges in the calculator
  field_presets: CustomFieldPreset[];                   // quick-add custom fields in the calculator
}

// Defaults come from https://liaqatbrothers.com/ (name, tagline, address, phone). Colours are the app's existing palette until the owner sets the official ones in Settings.
export const DEFAULT_SETTINGS: BusinessSettings = {
  business_name: 'Liaqat Brothers',
  tagline: 'Vehicle Excise Experts',
  address: '12-K Phase 1 Basement Commercial, Main Ghazi Road, DHA Lahore, Pakistan',
  phone: '0300-4799567',
  whatsapp: '0300-4799567',
  email: '',
  website: 'www.liaqatbrothers.com',
  logo_data_url: DEFAULT_LOGO,
  brand_color: '#0a2645',
  accent_color: '#cfaa5f',
  document_title: 'QUOTATION',
  validity_days: 15,
  payment_terms: '50% advance, 50% on completion',
  service_details: 'Complete file preparation and submission\nChallan generation and payment at Excise\nFollow-up until number plates and registration documents are issued\nDocument delivery',
  terms_text: 'Government fees are as per the Government challan; any difference at the time of payment is adjusted.\nService charges are non-refundable once the file is submitted.',
  bank_details: '',
  signatory: 'Liaqat Brothers',
  estimate_note: 'These prices are estimated and are not final. Government fees will be as per the Government challan at the time of payment.',
  show_basis: true,
  service_presets: [
    { label: 'Service Charges', amount: 5000 },
    { label: 'File Scanning', amount: 0 },
    { label: 'Inspection', amount: 0 },
    { label: 'Number Marking', amount: 0 },
    { label: 'Excise Pass', amount: 0 },
  ],
  field_presets: DEFAULT_FIELD_PRESETS,
};

