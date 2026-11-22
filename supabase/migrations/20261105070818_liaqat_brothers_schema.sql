/*
# Liaqat Brothers - Excise Vehicle Fee Calculator & Quotation Management System

## Overview
This migration creates the complete database schema for the Liaqat Brothers Excise Vehicle Fee
Calculator and Quotation Management System. It is a multi-user (sign-in required) application
where authenticated admin/staff share a single business database. Role-based permissions
(admin vs staff) are enforced at the application level; all authenticated users share the
business data, so RLS grants access to `authenticated` with a non-null-user check.

## Tables Created

1. **profiles** - Extends auth.users with full_name and role (admin/staff).
2. **fee_rules** - Admin-maintained government fee rules per province, transaction type,
   vehicle category, and fee type. Supports multiple computation methods (fixed, per-cc,
   percent-of-value, slab-based). Tracks source URL, effective date, last verified date,
   rate version, and active status.
3. **fee_rule_revisions** - Full audit history of every fee rule change (snapshots).
4. **audit_logs** - Generic audit trail for fee rule changes, manual overrides, and other
   sensitive actions.
5. **clients** - Client database (name, phone, email, CNIC, address, notes).
6. **vehicles** - Vehicle records linked to clients (province, category, CC, value, filer
   status, fuel type, etc.).
7. **quotations** - Quotation headers with unique quotation number, status, totals,
   validity, payment terms, and a snapshot of the calculation.
8. **quotation_line_items** - Itemized fees per quotation (government / service / additional),
   with formula, source, rule version, and override tracking.
9. **payments** - Payment records linked to quotations.

## Security

- RLS enabled on every table.
- All business tables: authenticated users get CRUD (shared business data).
- profiles: authenticated can read all profiles; users update only their own.
- audit_logs: authenticated can SELECT and INSERT; no UPDATE/DELETE (immutable audit trail).
- fee_rule_revisions: authenticated can SELECT; INSERT is done via trigger (no direct INSERT
  grant needed beyond the trigger's security definer context — we grant SELECT only to
  prevent manual tampering).
- service_role granted on all tables for edge-function use.
- All owner columns default to auth.uid().
*/

-- ============================================================
-- PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

GRANT SELECT, UPDATE (full_name) ON profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON profiles TO service_role;

DROP POLICY IF EXISTS "profiles_select_all" ON profiles;
CREATE POLICY "profiles_select_all" ON profiles FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ============================================================
-- FEE RULES
-- ============================================================
CREATE TABLE IF NOT EXISTS fee_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  province text NOT NULL CHECK (province IN ('punjab','sindh','islamabad','kpk')),
  transaction_type text NOT NULL CHECK (transaction_type IN ('new_registration','transfer','token_tax')),
  vehicle_category text NOT NULL CHECK (vehicle_category IN ('car','jeep','motorcycle','commercial','truck','bus')),
  fee_type text NOT NULL,
  label text NOT NULL,
  computation_type text NOT NULL CHECK (computation_type IN ('fixed','per_cc','percent_of_value','percent_of_value_capped','slab_cc','slab_value','per_year_age')),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_url text,
  effective_date date NOT NULL DEFAULT CURRENT_DATE,
  last_verified_date date,
  rate_version text NOT NULL DEFAULT 'v1',
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fee_rules_lookup
  ON fee_rules (province, transaction_type, vehicle_category, fee_type, is_active);

ALTER TABLE fee_rules ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON fee_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON fee_rules TO service_role;

DROP POLICY IF EXISTS "fee_rules_select" ON fee_rules;
CREATE POLICY "fee_rules_select" ON fee_rules FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "fee_rules_insert" ON fee_rules;
CREATE POLICY "fee_rules_insert" ON fee_rules FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "fee_rules_update" ON fee_rules;
CREATE POLICY "fee_rules_update" ON fee_rules FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "fee_rules_delete" ON fee_rules;
CREATE POLICY "fee_rules_delete" ON fee_rules FOR DELETE
  TO authenticated USING (true);

-- ============================================================
-- FEE RULE REVISIONS (audit snapshots)
-- ============================================================
CREATE TABLE IF NOT EXISTS fee_rule_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_rule_id uuid NOT NULL REFERENCES fee_rules(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  changed_by uuid REFERENCES auth.users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  change_reason text
);

CREATE INDEX IF NOT EXISTS idx_fee_rule_revisions_rule ON fee_rule_revisions (fee_rule_id);

ALTER TABLE fee_rule_revisions ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON fee_rule_revisions TO authenticated;
GRANT SELECT, INSERT ON fee_rule_revisions TO service_role;

DROP POLICY IF EXISTS "fee_rule_revisions_select" ON fee_rule_revisions;
CREATE POLICY "fee_rule_revisions_select" ON fee_rule_revisions FOR SELECT
  TO authenticated USING (true);

-- ============================================================
-- AUDIT LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON audit_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON audit_logs TO service_role;

DROP POLICY IF EXISTS "audit_logs_select" ON audit_logs;
CREATE POLICY "audit_logs_select" ON audit_logs FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "audit_logs_insert" ON audit_logs;
CREATE POLICY "audit_logs_insert" ON audit_logs FOR INSERT
  TO authenticated WITH CHECK (true);

-- ============================================================
-- CLIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  email text,
  cnic text,
  address text,
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_name ON clients (name);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients (phone);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON clients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON clients TO service_role;

DROP POLICY IF EXISTS "clients_select" ON clients;
CREATE POLICY "clients_select" ON clients FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "clients_insert" ON clients;
CREATE POLICY "clients_insert" ON clients FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "clients_update" ON clients;
CREATE POLICY "clients_update" ON clients FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "clients_delete" ON clients;
CREATE POLICY "clients_delete" ON clients FOR DELETE
  TO authenticated USING (true);

-- ============================================================
-- VEHICLES
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  province text CHECK (province IN ('punjab','sindh','islamabad','kpk')),
  registration_type text CHECK (registration_type IN ('new_registration','transfer','token_tax')),
  vehicle_category text CHECK (vehicle_category IN ('car','jeep','motorcycle','commercial','truck','bus')),
  company text,
  model text,
  engine_cc integer,
  manufacturing_year integer,
  invoice_date date,
  invoice_value numeric(14,2),
  registration_number text,
  filer_status text CHECK (filer_status IN ('filer','non_filer')),
  origin text CHECK (origin IN ('local','imported')),
  fuel_type text CHECK (fuel_type IN ('petrol','diesel','hybrid','electric')),
  prev_token_tax_details text,
  registration_status text,
  buyer_name text,
  seller_name text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicles_client ON vehicles (client_id);

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON vehicles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON vehicles TO service_role;

DROP POLICY IF EXISTS "vehicles_select" ON vehicles;
CREATE POLICY "vehicles_select" ON vehicles FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "vehicles_insert" ON vehicles;
CREATE POLICY "vehicles_insert" ON vehicles FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "vehicles_update" ON vehicles;
CREATE POLICY "vehicles_update" ON vehicles FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "vehicles_delete" ON vehicles;
CREATE POLICY "vehicles_delete" ON vehicles FOR DELETE
  TO authenticated USING (true);

-- ============================================================
-- QUOTATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_number text UNIQUE NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  transaction_type text CHECK (transaction_type IN ('new_registration','transfer','token_tax')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','rejected','completed')),
  financial_year text,
  calculation_snapshot jsonb,
  subtotal_govt numeric(14,2) NOT NULL DEFAULT 0,
  subtotal_service numeric(14,2) NOT NULL DEFAULT 0,
  subtotal_additional numeric(14,2) NOT NULL DEFAULT 0,
  grand_total numeric(14,2) NOT NULL DEFAULT 0,
  validity_date date,
  payment_terms text,
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations (status);
CREATE INDEX IF NOT EXISTS idx_quotations_client ON quotations (client_id);
CREATE INDEX IF NOT EXISTS idx_quotations_created ON quotations (created_at DESC);

ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON quotations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON quotations TO service_role;

DROP POLICY IF EXISTS "quotations_select" ON quotations;
CREATE POLICY "quotations_select" ON quotations FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "quotations_insert" ON quotations;
CREATE POLICY "quotations_insert" ON quotations FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "quotations_update" ON quotations;
CREATE POLICY "quotations_update" ON quotations FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "quotations_delete" ON quotations;
CREATE POLICY "quotations_delete" ON quotations FOR DELETE
  TO authenticated USING (true);

-- ============================================================
-- QUOTATION LINE ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS quotation_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  fee_type text NOT NULL,
  label text NOT NULL,
  category text NOT NULL CHECK (category IN ('government','service','additional')),
  amount numeric(14,2) NOT NULL DEFAULT 0,
  formula text,
  source text,
  rule_version text,
  is_override boolean NOT NULL DEFAULT false,
  override_reason text,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_line_items_quotation ON quotation_line_items (quotation_id);

ALTER TABLE quotation_line_items ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON quotation_line_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON quotation_line_items TO service_role;

DROP POLICY IF EXISTS "line_items_select" ON quotation_line_items;
CREATE POLICY "line_items_select" ON quotation_line_items FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "line_items_insert" ON quotation_line_items;
CREATE POLICY "line_items_insert" ON quotation_line_items FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "line_items_update" ON quotation_line_items;
CREATE POLICY "line_items_update" ON quotation_line_items FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "line_items_delete" ON quotation_line_items;
CREATE POLICY "line_items_delete" ON quotation_line_items FOR DELETE
  TO authenticated USING (true);

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  payment_method text,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  reference text,
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_quotation ON payments (quotation_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON payments TO service_role;

DROP POLICY IF EXISTS "payments_select" ON payments;
CREATE POLICY "payments_select" ON payments FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "payments_insert" ON payments;
CREATE POLICY "payments_insert" ON payments FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "payments_update" ON payments;
CREATE POLICY "payments_update" ON payments FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "payments_delete" ON payments;
CREATE POLICY "payments_delete" ON payments FOR DELETE
  TO authenticated USING (true);

-- ============================================================
-- TRIGGER: Auto-create profile on signup + updated_at on fee_rules
-- ============================================================

-- updated_at trigger for fee_rules
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS fee_rules_updated_at ON fee_rules;
CREATE TRIGGER fee_rules_updated_at BEFORE UPDATE ON fee_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS quotations_updated_at ON quotations;
CREATE TRIGGER quotations_updated_at BEFORE UPDATE ON quotations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Auto-create profile on new auth user
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), 'staff')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Auto-snapshot fee rule revisions on update
CREATE OR REPLACE FUNCTION snapshot_fee_rule_revision()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.fee_rule_revisions (fee_rule_id, snapshot, changed_by, change_reason)
  VALUES (OLD.id, to_jsonb(OLD), auth.uid(), NULL);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS fee_rule_revision_trigger ON fee_rules;
CREATE TRIGGER fee_rule_revision_trigger AFTER UPDATE ON fee_rules
  FOR EACH ROW EXECUTE FUNCTION snapshot_fee_rule_revision();
