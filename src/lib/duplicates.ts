// Duplicate detection helpers. PURE (no database): the database function find_duplicates() is the source of truth and uses the same
// normalisation (lb_norm_* in migration 20261117090000). Both are tested with the same examples.
// A duplicate is only ever WARNED about. Nothing here merges, blocks or deletes a record.

/** Phone: digits only; +92 / 0092 / 92 prefix becomes 0; a bare 3xxxxxxxxx mobile gets its 0. Fewer than 7 digits cannot be compared. */
export function normPhone(t: string | null | undefined): string | null {
  const d = (t ?? '').replace(/[^0-9]/g, '');
  if (d.length < 7) return null;
  if (/^0092[0-9]{10}$/.test(d)) return '0' + d.slice(4);
  if (/^92[0-9]{10}$/.test(d)) return '0' + d.slice(2);
  if (/^3[0-9]{9}$/.test(d)) return '0' + d;
  return d;
}
/** CNIC: exactly 13 digits, otherwise it cannot be compared. */
export function normCnic(t: string | null | undefined): string | null {
  const d = (t ?? '').replace(/[^0-9]/g, '');
  return d.length === 13 ? d : null;
}
/** Number plate: letters and digits only, upper case, at least 3 characters. */
export function normPlate(t: string | null | undefined): string | null {
  const d = (t ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return d.length >= 3 ? d : null;
}
/** Chassis / engine number: letters and digits only, upper case, at least 5 characters. */
export function normChassis(t: string | null | undefined): string | null {
  const d = (t ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return d.length >= 5 ? d : null;
}

export interface DupClient { id: string; name: string; phone: string | null; cnic: string | null; archived: boolean; reasons: ('phone' | 'cnic')[] }
export interface DupVehicle { id: string; client_id: string | null; client_name: string | null; registration_number: string | null; chassis_number: string | null; reasons: ('registration' | 'chassis')[] }
export interface DuplicateResult { clients: DupClient[]; vehicles: DupVehicle[] }
export const NO_DUPLICATES: DuplicateResult = { clients: [], vehicles: [] };
export const hasDuplicates = (d: DuplicateResult | null | undefined): boolean => !!d && (d.clients.length > 0 || d.vehicles.length > 0);

const REASON_TEXT: Record<string, string> = { phone: 'same phone number', cnic: 'same CNIC', registration: 'same registration number', chassis: 'same chassis number' };
export const reasonText = (reasons: string[]): string => reasons.map(r => REASON_TEXT[r] ?? r).join(' and ');

/** Should the database be asked at all? Saves a call while the user is still typing the first digits. */
export function worthChecking(i: { phone?: string | null; cnic?: string | null; registration?: string | null; chassis?: string | null }): boolean {
  return !!(normPhone(i.phone) || normCnic(i.cnic) || normPlate(i.registration) || normChassis(i.chassis));
}
