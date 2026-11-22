// Turns raw database / network errors into a message that says what happened and what to do. PURE (no imports), unit tested.
export function friendlyError(raw: unknown, action = 'Save'): string {
  const m = (typeof raw === 'string' ? raw : (raw as { message?: string } | null)?.message ?? '').trim();
  if (!m) return `${action} failed. Please try again.`;
  const l = m.toLowerCase();
  if (/failed to fetch|networkerror|network request failed|load failed/.test(l)) return `No internet connection, so nothing was saved. Check the connection and try again.`;
  if (/jwt expired|invalid jwt|not authenticated|refresh token/.test(l)) return 'Your session has expired. Sign in again, then repeat this step.';
  if (/row-level security|permission denied|not allowed|42501/.test(l)) return 'You do not have permission for this. Ask a manager or the owner to do it.';
  if (/duplicate key|already exists|unique constraint|23505/.test(l)) return 'This record already exists. Search for it and open the existing one instead of creating a new one.';
  if (/violates foreign key|23503/.test(l)) return 'This record is linked to other records (payments, cases or quotations), so it cannot be removed or changed this way.';
  if (/violates not-null|null value in column|23502/.test(l)) return 'A required field is empty. Fill in every field marked * and try again.';
  if (/violates check constraint|23514|invalid input syntax|22p02/.test(l)) return 'One of the values is not valid (for example a negative amount or a wrong date). Check the entries and try again.';
  if (/could not find the function|does not exist|schema cache|pgrst/.test(l)) return 'The database has not been updated for this feature yet. Ask the administrator to run the latest migration, then reload.';
  if (/timeout|timed out|57014/.test(l)) return 'The server took too long to answer. Wait a moment and try again.';
  return m;
}
/** Inline validation helpers: return an error string or '' */
export const required = (v: string | null | undefined, name: string) => (v ?? '').trim() ? '' : `${name} is required.`;
export const positiveAmount = (v: string | number | null | undefined, name = 'Amount') => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? '' : `${name} must be a number greater than 0.`;
};
export const pkPhone = (v: string | null | undefined) => {
  const d = (v ?? '').replace(/[^\d]/g, '');
  return !d ? '' : /^(92|0)?3\d{9}$/.test(d) || /^0\d{9,10}$/.test(d) || /^92\d{10}$/.test(d) ? '' : 'Phone number looks wrong. Example: 0300 1234567.';
};
/** wa.me link for a Pakistani number, or null. */
export function whatsappUrl(phone: string | null | undefined, text?: string): string | null {
  let d = (phone ?? '').replace(/[^\d]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '92' + d.slice(1);
  if (!/^92\d{9,10}$/.test(d)) return null;
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
export const telUrl = (phone: string | null | undefined) => { const d = (phone ?? '').replace(/[^\d+]/g, ''); return d.length >= 7 ? `tel:${d}` : null; };
