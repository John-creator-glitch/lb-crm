// Extracts fields from the text of a dealer sales invoice. Label based. Anything not found stays null/empty.
// Prices are returned as CANDIDATES because invoices show several totals (ex-factory, sales tax, total). The operator picks one.
import { toIsoDate } from './cardParser';

export interface InvoiceData {
  invoice_date: string | null;       // YYYY-MM-DD
  price_candidates: { label: string; value: number }[];
  engine_cc: number | null;
  make: string | null;
  model: string | null;
  manufacturing_year: number | null;
  fuel_type: 'petrol' | 'diesel' | 'hybrid' | 'electric' | null;
  chassis_number: string | null;
  engine_number: string | null;
  colour: string | null;
}

const clean = (t: string) => t.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ');
function after(text: string, labels: string[], valueRe: string): string | null {
  for (const l of labels) {
    const m = text.match(new RegExp(`${l}\\s*[:.\\-]?\\s*(${valueRe})`, 'i'));
    if (m) return m[1].trim();
  }
  return null;
}

const PRICE_LABELS = ['Gross\\s*Amount(?!\\s*\\(words)', 'Total\\s*Invoice\\s*Value', 'Invoice\\s*(?:Value|Amount|Price)(?!\\s*with)', 'Net\\s*(?:Price|Amount|Payable)', 'Total\\s*(?:Price|Amount)', 'Grand\\s*Total', 'Vehicle\\s*Price', 'Ex[-\\s]?Factory\\s*Price'];

// One money amount as printed on invoices or on OCR'd scans: "12,556,000.00", "12,556, 000.00" (stray space), "12.435.000.00" (dots as thousand separators).
const AMOUNT_RE = /\d{1,3}(?:[,.]\s?\d{3})+(?:[,.]\s?\d{2})?(?!\d)|\d{6,9}(?:\.\d{1,2})?(?!\d)/g;
export function parseAmount(tok: string): number {
  const t = tok.replace(/\s+/g, '');
  const parts = t.split(/[,.]/);
  if (parts.length > 1 && parts[parts.length - 1].length === 2) {
    const dec = Number(parts.pop()) / 100;
    return Number(parts.join('')) + dec;
  }
  return Number(parts.join(''));
}
const addCandidate = (out: InvoiceData, label: string, value: number) => {
  if (value >= 100000 && !out.price_candidates.some(c => c.value === value)) out.price_candidates.push({ label, value });
};

export function parseInvoice(raw: string): InvoiceData {
  const text = clean(raw);
  const out: InvoiceData = { invoice_date: null, price_candidates: [], engine_cc: null, make: null, model: null, manufacturing_year: null, fuel_type: null, chassis_number: null, engine_number: null, colour: null };

  // 1) Label followed by an amount on the same line (first match wins per label).
  for (const l of PRICE_LABELS) {
    const m = text.match(new RegExp(`(${l})[^\\n\\d]{0,40}(\\d[\\d,. ]{5,20})`, 'i'));
    if (!m) continue;
    const a = (m[2].match(AMOUNT_RE) || [])[0];
    if (a) addCandidate(out, m[1].replace(/\s+/g, ' '), parseAmount(a));
  }
  // 2) Fallback for scans where labels and numbers drift apart: the largest amount on the page is the gross invoice total.
  if (out.price_candidates.length === 0) {
    const all = (text.match(AMOUNT_RE) || []).map(parseAmount).filter(v => v >= 100000);
    if (all.length) addCandidate(out, 'Largest amount on document', Math.max(...all));
  }
  out.invoice_date = toIsoDate(after(text, ['Invoic\\w*\\s*Dat\\w*', 'Date\\s*of\\s*Invoice', 'Bill\\s*Date', 'Date'], '\\d{1,4}[-/.]\\d{1,2}[-/.]\\d{1,4}'));
  const cc = after(text, ['Engine\\s*(?:Capacity|Size|CC)', 'Capacity', 'Displacement', 'CC'], '\\d{3,4}');
  const ccTail = text.match(/\b(\d{3,4})\s*CC\b/i)?.[1]; // e.g. "FORTUNER ... 2694CC"
  const ccv = cc ?? ccTail ?? null;
  if (ccv && +ccv >= 50 && +ccv <= 8000) out.engine_cc = +ccv;
  out.chassis_number = after(text, ['Chassis\\s*(?:No|Number|#)?', 'VIN'], '[A-Z0-9]{8,20}')?.toUpperCase() ?? null;
  out.engine_number = after(text, ['Engine\\s*(?:No|Number|#)'], '[A-Z0-9][A-Z0-9\\-]{4,20}')?.toUpperCase() ?? null;
  out.make = after(text, ['Make', 'Brand', 'Maker'], '[A-Za-z][A-Za-z\\- ]{1,20}?(?=\\s{2,}|\\n|$|\\s+(?:Model|Variant|Colou?r|Chassis|Engine))');
  out.model = after(text, ['Model\\s*Name', 'Model\\s*/\\s*Variant', 'Variant', 'Model(?!\\s*Year)'], '[A-Za-z0-9][A-Za-z0-9\\-\\. ]{1,30}?(?=\\s{2,}|\\n|$|\\s+(?:Colou?r|Chassis|Engine|Year))');
  out.colour = after(text, ['Colou?r'], '[A-Za-z][A-Za-z ]{2,20}?(?=\\s{2,}|\\n|$)');
  const yr = after(text, ['Model\\s*Year', 'Manufacturing\\s*Year', 'Year\\s*of\\s*Manufacture'], '(?:19|20)\\d{2}');
  if (yr) out.manufacturing_year = +yr;
  const low = text.toLowerCase();
  out.fuel_type = /\b(electric|ev|bev)\b/.test(low) && !/\bphev\b/.test(low) ? 'electric' : /\b(hybrid|phev|hev)\b/.test(low) ? 'hybrid' : /\bdiesel\b/.test(low) ? 'diesel' : /\bpetrol\b/.test(low) ? 'petrol' : null;
  return out;
}
