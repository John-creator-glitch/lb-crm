import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/** false when the .env file (local) or the Environment Variables (Vercel) are missing: the app then shows a clear message instead of a blank page */
export const envOk = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(supabaseUrl || 'http://missing.invalid', supabaseAnonKey || 'missing', {
  auth: {
    persistSession: true,
    storage: window.sessionStorage,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type Province = 'punjab' | 'sindh' | 'islamabad' | 'kpk';
export type TransactionType = 'new_registration' | 'transfer' | 'token_tax';
export type VehicleCategory = 'car' | 'jeep' | 'motorcycle' | 'commercial' | 'truck' | 'bus';
export type FilerStatus = 'filer' | 'non_filer';
export type Origin = 'local' | 'imported';
export type FuelType = 'petrol' | 'diesel' | 'hybrid' | 'electric';
export type QuotationStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'completed';
export type ComputationType =
  | 'fixed'
  | 'per_cc'
  | 'percent_of_value'
  | 'percent_of_value_capped'
  | 'slab_cc'
  | 'slab_value'
  | 'per_year_age';
export type LineItemCategory = 'government' | 'service' | 'additional';
export type UserRole = 'admin' | 'manager' | 'staff';

export const PROVINCES: { value: Province; label: string }[] = [
  { value: 'punjab', label: 'Punjab' },
  { value: 'sindh', label: 'Sindh' },
  { value: 'islamabad', label: 'Islamabad (ICT)' },
  { value: 'kpk', label: 'Khyber Pakhtunkhwa' },
];

export const TRANSACTION_TYPES: { value: TransactionType; label: string }[] = [
  { value: 'new_registration', label: 'New Registration' },
  { value: 'transfer', label: 'Ownership Transfer' },
  { value: 'token_tax', label: 'Token Tax' },
];

export const VEHICLE_CATEGORIES: { value: VehicleCategory; label: string }[] = [
  { value: 'car', label: 'Car' },
  { value: 'jeep', label: 'Jeep / SUV' },
  { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'commercial', label: 'Commercial Vehicle' },
  { value: 'truck', label: 'Truck' },
  { value: 'bus', label: 'Bus' },
];

export const FILER_STATUSES: { value: FilerStatus; label: string }[] = [
  { value: 'filer', label: 'Filer' },
  { value: 'non_filer', label: 'Non-Filer' },
];

export const ORIGINS: { value: Origin; label: string }[] = [
  { value: 'local', label: 'Local' },
  { value: 'imported', label: 'Imported' },
];

export const FUEL_TYPES: { value: FuelType; label: string }[] = [
  { value: 'petrol', label: 'Petrol' },
  { value: 'diesel', label: 'Diesel' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'electric', label: 'Electric' },
];

export const QUOTATION_STATUSES: { value: QuotationStatus; label: string; color: string }[] = [
  { value: 'draft', label: 'Draft', color: 'bg-gray-100 text-gray-700' },
  { value: 'pending', label: 'Pending', color: 'bg-amber-100 text-amber-700' },
  { value: 'approved', label: 'Approved', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'rejected', label: 'Rejected', color: 'bg-rose-100 text-rose-700' },
  { value: 'completed', label: 'Completed', color: 'bg-blue-100 text-blue-700' },
];

export const COMPUTATION_TYPES: { value: ComputationType; label: string }[] = [
  { value: 'fixed', label: 'Fixed Amount' },
  { value: 'per_cc', label: 'Per CC' },
  { value: 'percent_of_value', label: 'Percent of Invoice Value' },
  { value: 'percent_of_value_capped', label: 'Percent of Value (Capped)' },
  { value: 'slab_cc', label: 'Slab by Engine CC' },
  { value: 'slab_value', label: 'Slab by Invoice Value' },
  { value: 'per_year_age', label: 'Per Year of Vehicle Age' },
];

export interface FeeRule {
  id: string;
  province: Province;
  transaction_type: TransactionType;
  vehicle_category: VehicleCategory;
  fee_type: string;
  label: string;
  computation_type: ComputationType;
  params: Record<string, any>;
  source_url: string | null;
  effective_date: string;
  last_verified_date: string | null;
  rate_version: string;
  is_active: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  cnic: string | null;
  address: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  // Client management (migration 20261108150000). Optional so older rows / a database without the migration still load.
  client_type?: 'direct' | 'showroom' | 'agent';
  parent_id?: string | null;
  bill_to_parent?: boolean;
  care_of?: string | null;
  opening_balance?: number;
  archived_at?: string | null;
  // Client 360 (migration 20261117090000). Optional so a database without the M2 migration still loads.
  status?: 'active' | 'inactive';
  assigned_to?: string | null;
  business_type?: string | null;
}

export interface ClientPayment {
  id: string;
  client_id: string;
  amount: number;
  payment_date: string;
  payment_method: string | null;
  reference: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  reversed_at?: string | null;
  reversed_by?: string | null;
  reversal_reason?: string | null;
}
export interface PaymentAllocation {
  id: string; client_payment_id: string; quotation_id: string; amount: number;
  created_by: string | null; created_at: string; voided_at: string | null; void_reason: string | null;
}

export const CLIENT_TYPES: { value: 'direct' | 'showroom' | 'agent'; label: string; color: string }[] = [
  { value: 'direct', label: 'Individual', color: 'bg-slate-100 text-slate-700' },
  { value: 'showroom', label: 'Showroom / Dealer', color: 'bg-indigo-100 text-indigo-700' },
  { value: 'agent', label: 'Contact person (C/O)', color: 'bg-teal-100 text-teal-700' },
];

export interface Vehicle {
  id: string;
  client_id: string | null;
  province: Province | null;
  registration_type: TransactionType | null;
  vehicle_category: VehicleCategory | null;
  company: string | null;
  model: string | null;
  engine_cc: number | null;
  manufacturing_year: number | null;
  invoice_date: string | null;
  invoice_value: number | null;
  registration_number: string | null;
  filer_status: FilerStatus | null;
  origin: Origin | null;
  fuel_type: FuelType | null;
  prev_token_tax_details: string | null;
  registration_status: string | null;
  buyer_name: string | null;
  seller_name: string | null;
  // M2 (migration 20261117090000)
  chassis_number?: string | null;
  engine_number?: string | null;
  // M12
  token_tax_due?: string | null;
  registration_due?: string | null;
  created_by: string;
  created_at: string;
}

export interface QuotationLineItem {
  id?: string;
  quotation_id?: string;
  fee_type: string;
  label: string;
  category: LineItemCategory;
  amount: number;
  formula: string | null;
  source: string | null;
  rule_version: string | null;
  is_override: boolean;
  override_reason: string | null;
  sort_order: number;
}

export interface Quotation {
  id: string;
  quotation_number: string;
  client_id: string | null;
  vehicle_id: string | null;
  transaction_type: TransactionType | null;
  status: QuotationStatus;
  financial_year: string | null;
  calculation_snapshot: Record<string, any> | null;
  subtotal_govt: number;
  subtotal_service: number;
  subtotal_additional: number;
  grand_total: number;
  validity_date: string | null;
  follow_up_on?: string | null;      // M3 (migration 20261118090000)
  follow_up_note?: string | null;
  payment_terms: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  quotation_id: string;
  amount: number;
  payment_method: string | null;
  payment_date: string;
  reference: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  reversed_at?: string | null;
  reversed_by?: string | null;
  reversal_reason?: string | null;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, any> | null;
  created_at: string;
}

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  created_at: string;
  active?: boolean;
  email?: string | null;
  must_change_password?: boolean;
}

// ---------- CRM modules (cases, tasks, inventory) ----------
export type CaseStatus = 'pending' | 'active' | 'completed' | 'cancelled';
export type CaseService = 'new_registration' | 'transfer' | 'token_tax' | 'number_plate' | 'duplicate_docs' | 'other';

export const CASE_STATUSES: { value: CaseStatus; label: string; color: string }[] = [
  { value: 'pending', label: 'Pending', color: 'bg-amber-100 text-amber-700' },
  { value: 'active', label: 'Active', color: 'bg-blue-100 text-blue-700' },
  { value: 'completed', label: 'Completed', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'cancelled', label: 'Cancelled', color: 'bg-gray-100 text-gray-600' },
];

export const CASE_SERVICES: { value: CaseService; label: string }[] = [
  { value: 'new_registration', label: 'New Registration' },
  { value: 'transfer', label: 'Ownership Transfer' },
  { value: 'token_tax', label: 'Token Tax' },
  { value: 'number_plate', label: 'Number Plate' },
  { value: 'duplicate_docs', label: 'Duplicate Documents' },
  { value: 'other', label: 'Other' },
];

export interface CaseRow {
  id: string;
  case_no: string;
  client_id: string | null;
  vehicle_id: string | null;
  quotation_id: string | null;
  service_type: CaseService;
  status: CaseStatus;
  govt_fee: number;
  service_charge: number;
  opened_on: string;
  closed_on: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // M3 (migration 20261118090000). Optional so the app still loads before that migration is run.
  stage?: CaseStage;
  priority?: CasePriority;
  assigned_to?: string | null;
  due_date?: string | null;
  next_action?: string | null;
  next_action_on?: string | null;
  excise_reference?: string | null;
  excise_submitted_on?: string | null;
}

export type CaseStage = 'new' | 'documents' | 'submitted' | 'processing' | 'ready' | 'delivered';
export type CasePriority = 'low' | 'normal' | 'high' | 'urgent';
export interface CaseDocument { id: string; case_id: string; label: string; required: boolean; received: boolean; received_on: string | null; notes: string | null; sort_order: number; created_at: string }
export interface StatusHistoryRow { id: string; entity_type: 'quotation' | 'case'; entity_id: string; field: string; from_value: string | null; to_value: string; note: string | null; changed_by: string | null; changed_at: string }

export interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'completed';
  case_id: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string | null;
  quantity: number;
  min_level: number;
  notes: string | null;
  updated_at: string;
}

// ---------- Transfers register ----------
export type TransferStatus = 'in_process' | 'submitted' | 'completed' | 'cancelled';
export const TRANSFER_STATUSES: { value: TransferStatus; label: string; color: string }[] = [
  { value: 'in_process', label: 'In process', color: 'bg-amber-100 text-amber-700' },
  { value: 'submitted', label: 'Submitted at Excise', color: 'bg-blue-100 text-blue-700' },
  { value: 'completed', label: 'Completed', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'cancelled', label: 'Cancelled', color: 'bg-slate-100 text-slate-600' },
];

// Documents for a Punjab ownership transfer (Punjab Excise: Transfer Order form, CNIC copies of seller and purchaser,
// witnesses, original registration certificate with token tax paid; plus biometric verification and Form F).
export const TRANSFER_DOCS: { key: string; label: string }[] = [
  { key: 'transfer_order', label: 'Transfer Order (T.O) form signed' },
  { key: 'seller_cnic', label: 'Seller CNIC copy' },
  { key: 'buyer_cnic', label: 'Buyer (purchaser) CNIC copy' },
  { key: 'witnesses', label: 'Witnesses CNIC copies' },
  { key: 'original_rc', label: 'Original registration book / smart card' },
  { key: 'token_clear', label: 'Token tax paid up to date' },
  { key: 'biometric', label: 'Biometric verification done' },
  { key: 'form_f', label: 'Form F filled and signed' },
  { key: 'challan_paid', label: 'Government challan paid' },
];

export interface TransferRow {
  id: string;
  transfer_no: string;
  client_id: string | null;
  status: TransferStatus;
  province: string;
  prev_reg_no: string | null;
  new_reg_no: string | null;
  maker: string | null;
  model: string | null;
  mfg_year: number | null;
  colour: string | null;
  chassis_no: string | null;
  engine_no: string | null;
  engine_cc: number | null;
  seller_name: string | null;
  seller_father: string | null;
  seller_cnic: string | null;
  seller_phone: string | null;
  seller_address: string | null;
  seller_care_of: string | null;
  buyer_name: string | null;
  buyer_father: string | null;
  buyer_cnic: string | null;
  buyer_phone: string | null;
  buyer_address: string | null;
  buyer_care_of: string | null;
  sale_date: string | null;
  transfer_date: string | null;
  govt_fee: number;
  service_charge: number;
  docs: Record<string, boolean>;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Reminder {
  id: string; title: string; notes: string | null;
  client_id: string | null; case_id: string | null; quotation_id: string | null; task_id: string | null;
  owner_id: string; created_by: string; due_at: string;
  priority: 'low' | 'normal' | 'high' | 'urgent'; channel: 'in_app' | 'email' | 'whatsapp';
  status: 'open' | 'completed' | 'cancelled'; snoozed_until: string | null;
  recurrence: 'none' | 'daily' | 'weekly' | 'monthly'; escalate_after_hours: number | null; escalated_at: string | null;
  completed_at: string | null; completed_by: string | null; cancel_reason: string | null; parent_id: string | null;
  created_at: string; updated_at: string;
}
export interface ReminderEvent { id: string; reminder_id: string; event: string; detail: string | null; actor: string | null; created_at: string }
export interface AppNotification {
  id: string; user_id: string; reminder_id: string | null; kind: 'due' | 'escalated' | 'assigned'; title: string; body: string | null;
  channel: string; delivery_status: 'delivered' | 'failed'; failure_reason: string | null; attempts: number; read_at: string | null; created_at: string;
}
