// Shared types and helpers for Leads, Expenses, Documents and message templates (migration M12).
export const LEAD_SOURCES: Record<string, string> = { walk_in: 'Walk-in', phone: 'Phone call', whatsapp: 'WhatsApp', showroom: 'Showroom / dealer', reference: 'Reference', website: 'Website', social: 'Social media', other: 'Other' };
export const LEAD_STATUSES: Record<string, string> = { new: 'New', contacted: 'Contacted', quoted: 'Quoted', won: 'Won', lost: 'Lost' };
export const ACTIVITY_KINDS: Record<string, string> = { call: 'Call', whatsapp: 'WhatsApp', visit: 'Visit', email: 'Email', note: 'Note' };
export const EXPENSE_CATEGORIES: Record<string, string> = { rent: 'Rent', utilities: 'Utilities', internet_phone: 'Internet / phone', salary: 'Salary', agent_payment: 'Agent payment', government_fee_paid: 'Government fee paid', transport_fuel: 'Transport / fuel', stationery_printing: 'Stationery / printing', marketing: 'Marketing', repair_maintenance: 'Repair / maintenance', tax_fee: 'Tax / fee', other: 'Other' };
export const PAID_FROM: Record<string, string> = { cash: 'Cash', bank: 'Bank', mobile_wallet: 'Mobile wallet', other: 'Other' };
export const DOC_TYPES: Record<string, string> = { cnic: 'CNIC', registration_book: 'Registration book', invoice: 'Invoice', challan: 'Challan', transfer_letter: 'Transfer letter', affidavit: 'Affidavit', photo: 'Photo', other: 'Other' };
export const DOC_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const DOC_MAX_BYTES = 5 * 1024 * 1024;

export interface Lead { id: string; name: string; phone: string | null; source: string; interest: string | null; vehicle_info: string | null; status: string; next_follow_up: string | null; notes: string | null; lost_reason: string | null; client_id: string | null; created_at: string }
export interface Expense { id: string; expense_date: string; category: string; amount: number; paid_from: string; description: string | null; voided_at: string | null; void_reason: string | null }
export interface ClientDocument { id: string; client_id: string; doc_type: string; file_name: string; storage_path: string; mime_type: string; size_bytes: number; created_at: string }
export interface MessageTemplate { id: string; key: string; title: string; body: string; active: boolean; sort_order: number }

/** Fill {name} {vehicle} {amount} {date} {business} in a template. Unknown placeholders are left out, never shown raw. */
export function fillTemplate(body: string, v: { name?: string; vehicle?: string; amount?: string; date?: string; business?: string }): string {
  return body.replace(/\{(name|vehicle|amount|date|business)\}/g, (_, k: keyof typeof v) => v[k] ?? '').replace(/[ \t]{2,}/g, ' ').trim();
}

/** Make a safe storage file name: letters, digits, dot, dash, underscore only. */
export function safeFileName(n: string): string {
  const s = n.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(-80);
  return s || 'file';
}

export function docProblem(f: { type: string; size: number }): string | null {
  if (!DOC_MIME.includes(f.type)) return 'Only JPG, PNG, WEBP or PDF files are allowed.';
  if (f.size <= 0) return 'This file is empty.';
  if (f.size > DOC_MAX_BYTES) return 'File is bigger than 5 MB. Please reduce it.';
  return null;
}
