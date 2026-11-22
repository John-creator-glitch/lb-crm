import { compactDate } from './time';
/** One CSV cell. Text that starts with = + - @ (or a tab / carriage return) would be run as a FORMULA by Excel (e.g. a client named =HYPERLINK(...)),
 *  so it is stored with a leading apostrophe. Real numbers (typeof number) and plain numeric text such as "-500" or "+92 300" are left alone. */
export function csvCell(v: string | number | null | undefined): string {
  let s = v == null ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^[-+]?[\d.,]+$/.test(s) && !/^\+?\d[\d\s-]{6,}$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function downloadCSV(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = csvCell;
  const blob = new Blob(['\ufeff' + rows.map(r => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function newCaseNumber(): string {
  const ymd = compactDate();
  return `CS-${ymd}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}
