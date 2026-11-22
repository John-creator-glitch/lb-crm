// Extracts vehicle fields from the text of a Punjab e-registration card (or challan).
// Label based and tolerant. Anything not found stays null so the operator must fill it. Never guesses.
export interface CardData {
  registration_number: string | null;
  chassis_number: string | null;
  engine_cc: number | null;
  make: string | null;
  model: string | null;
  manufacturing_year: number | null;
  registration_date: string | null; // YYYY-MM-DD
}

const clean = (t: string) => t.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ');

function after(text: string, labels: string[], valueRe: string): string | null {
  for (const l of labels) {
    const re = new RegExp(`${l}\\s*[:.\\-]?\\s*(${valueRe})`, 'i');
    const m = text.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

export function toIsoDate(s: string | null): string | null {
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  let y: number, mo: number, d: number;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (!m) return null;
    d = +m[1]; mo = +m[2]; y = +m[3];
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1960 || y > 2100) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseCard(raw: string): CardData {
  const text = clean(raw);
  const out: CardData = { registration_number: null, chassis_number: null, engine_cc: null, make: null, model: null, manufacturing_year: null, registration_date: null };

  out.registration_number = after(text, ['Registration\\s*(?:No|Number|#)', 'Reg\\.?\\s*(?:No|Number)'], '[A-Z]{2,4}[\\s-]?\\d{0,2}[\\s-]?\\d{1,4}');
  out.chassis_number = after(text, ['Chassis\\s*(?:No|Number|#)?'], '[A-Z0-9]{8,20}');

  const cc = after(text, ['Engine\\s*(?:Size|Capacity|CC)', 'Capacity', 'Cubic\\s*Capacity'], '\\d{3,4}');
  if (cc && +cc >= 50 && +cc <= 8000) out.engine_cc = +cc;

  out.make = after(text, ['Make', 'Maker', 'Company'], '[A-Za-z][A-Za-z\\- ]{1,24}?(?=\\s{2,}|\\n|$|\\s+(?:Model|Colou?r|Engine|Chassis|Class))');
  out.model = after(text, ['Model\\s*Name', 'Model(?!\\s*Year)'], '[A-Za-z0-9][A-Za-z0-9\\- ]{1,24}?(?=\\s{2,}|\\n|$|\\s+(?:Colou?r|Engine|Chassis|Class|Year))');

  const yr = after(text, ['Manufacturing\\s*Year', 'Model\\s*Year', 'Year\\s*of\\s*Manufacture'], '(?:19|20)\\d{2}');
  if (yr) out.manufacturing_year = +yr;

  out.registration_date = toIsoDate(after(text, ['Registration\\s*Date', 'Date\\s*of\\s*Registration', 'Reg\\.?\\s*Date'], '\\d{1,4}[-/.]\\d{1,2}[-/.]\\d{1,4}'));
  if (out.registration_number) out.registration_number = out.registration_number.replace(/\s+/g, ' ').toUpperCase();
  if (out.chassis_number) out.chassis_number = out.chassis_number.toUpperCase();
  return out;
}

export function missingFromCard(d: CardData): string[] {
  const m: string[] = [];
  if (!d.registration_number) m.push('Registration number');
  if (!d.engine_cc) m.push('Engine CC');
  if (!d.registration_date) m.push('Registration date');
  return m;
}
