-- Liaqat Brothers: COMPLETE database setup for a NEW Supabase project.
-- Run this ONE file in Supabase > SQL Editor > New query > Run. Safe to run again.
-- Then open the app, register your own account FIRST: it becomes the Owner automatically.

-- ====================================================================
-- 20261105070818_liaqat_brothers_schema.sql
-- ====================================================================
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


-- ====================================================================
-- 20261105073156_auto_admin_first_user.sql
-- ====================================================================
/*
# Auto-admin for first user + promote existing user

## Changes
1. Update the `handle_new_user` trigger function so that the very first user
   to register (when auth.users has only 1 row) is automatically assigned the
   'admin' role instead of 'staff'. Subsequent users remain 'staff'.
2. Promote the existing single user (John) to admin since they were the first
   to register but received 'staff' under the old trigger.

## Security
- No new tables or policies.
- Only affects the profiles table role column.
*/

-- Promote the existing first user to admin
UPDATE profiles
SET role = 'admin'
WHERE id = (SELECT id FROM auth.users ORDER BY created_at LIMIT 1);

-- Update the trigger function: first user becomes admin automatically
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_count integer;
BEGIN
  SELECT COUNT(*) INTO user_count FROM auth.users;
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    CASE WHEN user_count = 1 THEN 'admin' ELSE 'staff' END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ====================================================================
-- 20261106100000_punjab_rate_sets.sql
-- ====================================================================
/*
  # Punjab rate sets (versioned, admin-managed)

  The Punjab car fee engine reads its rates from the active row here instead of from code.
  When Punjab changes a fee, an admin adds a new version (draft), reviews the diff, and activates it
  with an effective date. Old quotations keep their saved line items, so history never changes.

  - status: draft (editable) -> active (in force from effective_from) -> archived (kept for history)
  - Active and archived rows can never have their `rates` edited (trigger), only their status / last_verified.
  - Only admins can write. Everyone signed in can read.
  - If no active row exists the app falls back to the built-in defaults in src/lib/punjabRates.ts.
*/
CREATE TABLE IF NOT EXISTS punjab_rate_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL,
  effective_from date NOT NULL,
  last_verified date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  rates jsonb NOT NULL,
  created_by uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_punjab_rate_sets_lookup ON punjab_rate_sets (status, effective_from DESC);

ALTER TABLE punjab_rate_sets ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON punjab_rate_sets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON punjab_rate_sets TO service_role;

DROP POLICY IF EXISTS "punjab_rate_sets_select" ON punjab_rate_sets;
CREATE POLICY "punjab_rate_sets_select" ON punjab_rate_sets FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "punjab_rate_sets_insert" ON punjab_rate_sets;
CREATE POLICY "punjab_rate_sets_insert" ON punjab_rate_sets FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "punjab_rate_sets_update" ON punjab_rate_sets;
CREATE POLICY "punjab_rate_sets_update" ON punjab_rate_sets FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- Only drafts can be deleted; history is kept.
DROP POLICY IF EXISTS "punjab_rate_sets_delete" ON punjab_rate_sets;
CREATE POLICY "punjab_rate_sets_delete" ON punjab_rate_sets FOR DELETE TO authenticated
  USING (status = 'draft' AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

CREATE OR REPLACE FUNCTION protect_punjab_rate_sets() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'draft' AND (NEW.rates IS DISTINCT FROM OLD.rates OR NEW.version IS DISTINCT FROM OLD.version OR NEW.effective_from IS DISTINCT FROM OLD.effective_from) THEN
    RAISE EXCEPTION 'An activated rate set cannot be edited. Create a new version instead.';
  END IF;
  IF OLD.status = 'archived' AND NEW.status <> 'archived' THEN
    RAISE EXCEPTION 'An archived rate set cannot be reactivated. Copy it into a new version instead.';
  END IF;
  IF NEW.status = 'active' AND OLD.status = 'draft' THEN NEW.activated_at := now(); END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_punjab_rate_sets ON punjab_rate_sets;
CREATE TRIGGER trg_protect_punjab_rate_sets BEFORE UPDATE ON punjab_rate_sets
  FOR EACH ROW EXECUTE FUNCTION protect_punjab_rate_sets();


-- ====================================================================
-- 20261106120000_settings_and_hpa.sql
-- ====================================================================
/*
  # Business settings and HPA counter

  1. app_settings: one JSON document per key (branding, quotation defaults, service charge presets, custom field presets).
     Everyone signed in can read; only admins can change.
  2. hpa_counts: manual HPA (hire purchase) application counter, kept completely separate from quotations/applications.
     Optional quotation_id links an entry to a quotation (one entry per quotation at most, so it cannot be counted twice).

  Nothing existing is altered.
*/
CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON app_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_settings TO service_role;

DROP POLICY IF EXISTS "app_settings_select" ON app_settings;
CREATE POLICY "app_settings_select" ON app_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "app_settings_insert" ON app_settings;
CREATE POLICY "app_settings_insert" ON app_settings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
DROP POLICY IF EXISTS "app_settings_update" ON app_settings;
CREATE POLICY "app_settings_update" ON app_settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

CREATE TABLE IF NOT EXISTS hpa_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  count integer NOT NULL DEFAULT 1 CHECK (count > 0 AND count <= 1000),
  note text,
  quotation_id uuid REFERENCES quotations(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hpa_counts_date ON hpa_counts (entry_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hpa_counts_quotation ON hpa_counts (quotation_id) WHERE quotation_id IS NOT NULL;

ALTER TABLE hpa_counts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON hpa_counts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hpa_counts TO service_role;

DROP POLICY IF EXISTS "hpa_counts_select" ON hpa_counts;
CREATE POLICY "hpa_counts_select" ON hpa_counts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "hpa_counts_insert" ON hpa_counts;
CREATE POLICY "hpa_counts_insert" ON hpa_counts FOR INSERT TO authenticated WITH CHECK (true);
-- Staff can remove their own mistaken entries; admins can remove any.
DROP POLICY IF EXISTS "hpa_counts_delete" ON hpa_counts;
CREATE POLICY "hpa_counts_delete" ON hpa_counts FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));


-- ====================================================================
-- 20261107090000_crm_cases_tasks_inventory.sql
-- ====================================================================
/*
# CRM modules merged into LBCalculator

Adds the case-tracking side of the Liaqat Brothers CRM on top of the existing
clients / vehicles / quotations / payments tables:

1. cases           - one row per job (registration, transfer, token tax, plates, duplicates)
2. tasks           - to-dos with priority and due date, optionally linked to a case
3. inventory_items - stationery / plates / forms stock with minimum levels

Receipts are not a new table: they are the existing `payments` rows.
Invoices are the existing `quotations` rows.
RLS follows the same rule as the rest of the app (all authenticated users share data).
*/

CREATE TABLE IF NOT EXISTS cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_no text UNIQUE NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  quotation_id uuid REFERENCES quotations(id) ON DELETE SET NULL,
  service_type text NOT NULL DEFAULT 'other'
    CHECK (service_type IN ('new_registration','transfer','token_tax','number_plate','duplicate_docs','other')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','completed','cancelled')),
  govt_fee numeric(14,2) NOT NULL DEFAULT 0,
  service_charge numeric(14,2) NOT NULL DEFAULT 0,
  opened_on date NOT NULL DEFAULT CURRENT_DATE,
  closed_on date,
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases (status);
CREATE INDEX IF NOT EXISTS idx_cases_client ON cases (client_id);
CREATE INDEX IF NOT EXISTS idx_cases_opened ON cases (opened_on DESC);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  notes text,
  due_date date,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
  case_id uuid REFERENCES cases(id) ON DELETE SET NULL,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status, due_date);

CREATE TABLE IF NOT EXISTS inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text,
  quantity integer NOT NULL DEFAULT 0,
  min_level integer NOT NULL DEFAULT 0,
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cases','tasks','inventory_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_select" ON %I', t, t);
    EXECUTE format('CREATE POLICY "%s_select" ON %I FOR SELECT TO authenticated USING (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_insert" ON %I', t, t);
    EXECUTE format('CREATE POLICY "%s_insert" ON %I FOR INSERT TO authenticated WITH CHECK (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_update" ON %I', t, t);
    EXECUTE format('CREATE POLICY "%s_update" ON %I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s_delete" ON %I', t, t);
    EXECUTE format('CREATE POLICY "%s_delete" ON %I FOR DELETE TO authenticated USING (true)', t, t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS cases_updated_at ON cases;
CREATE TRIGGER cases_updated_at BEFORE UPDATE ON cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS inventory_updated_at ON inventory_items;
CREATE TRIGGER inventory_updated_at BEFORE UPDATE ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ====================================================================
-- 20261108100000_ict_rate_sets.sql
-- ====================================================================
/*
  # Islamabad (ICT) rate sets (versioned, admin-managed)

  Same design as punjab_rate_sets. The ICT car fee engine reads its rates from the active row here instead of from code.
  When ICT Excise or the Finance Act changes a fee, an admin adds a new version (draft), reviews the diff, and activates it
  with an effective date. Old quotations keep their saved line items, so history never changes.
  If no active row exists the app falls back to the built-in defaults in src/lib/ictRates.ts.
*/
CREATE TABLE IF NOT EXISTS ict_rate_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL,
  effective_from date NOT NULL,
  last_verified date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  rates jsonb NOT NULL,
  created_by uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ict_rate_sets_lookup ON ict_rate_sets (status, effective_from DESC);

ALTER TABLE ict_rate_sets ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON ict_rate_sets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ict_rate_sets TO service_role;

DROP POLICY IF EXISTS "ict_rate_sets_select" ON ict_rate_sets;
CREATE POLICY "ict_rate_sets_select" ON ict_rate_sets FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "ict_rate_sets_insert" ON ict_rate_sets;
CREATE POLICY "ict_rate_sets_insert" ON ict_rate_sets FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "ict_rate_sets_update" ON ict_rate_sets;
CREATE POLICY "ict_rate_sets_update" ON ict_rate_sets FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- Only drafts can be deleted; history is kept.
DROP POLICY IF EXISTS "ict_rate_sets_delete" ON ict_rate_sets;
CREATE POLICY "ict_rate_sets_delete" ON ict_rate_sets FOR DELETE TO authenticated
  USING (status = 'draft' AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

CREATE OR REPLACE FUNCTION protect_ict_rate_sets() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'draft' AND (NEW.rates IS DISTINCT FROM OLD.rates OR NEW.version IS DISTINCT FROM OLD.version OR NEW.effective_from IS DISTINCT FROM OLD.effective_from) THEN
    RAISE EXCEPTION 'An activated rate set cannot be edited. Create a new version instead.';
  END IF;
  IF OLD.status = 'archived' AND NEW.status <> 'archived' THEN
    RAISE EXCEPTION 'An archived rate set cannot be reactivated. Copy it into a new version instead.';
  END IF;
  IF NEW.status = 'active' AND OLD.status = 'draft' THEN NEW.activated_at := now(); END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_ict_rate_sets ON ict_rate_sets;
CREATE TRIGGER trg_protect_ict_rate_sets BEFORE UPDATE ON ict_rate_sets
  FOR EACH ROW EXECUTE FUNCTION protect_ict_rate_sets();


-- ====================================================================
-- 20261108120000_transfers.sql
-- ====================================================================
/*
# Transfers register

One row per vehicle ownership transfer handled by the office, with the previous and new registration numbers,
seller and buyer (including "care of"), dates, fees and a documents checklist.
The checklist items follow the Punjab Excise list for a transfer (Transfer Order form, seller and purchaser CNIC copies,
witnesses, original registration certificate with token tax paid, biometric verification, Form F).
RLS follows the same rule as the rest of the app (all authenticated users share data).
*/

CREATE TABLE IF NOT EXISTS transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_no text UNIQUE NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'in_process' CHECK (status IN ('in_process','submitted','completed','cancelled')),
  province text NOT NULL DEFAULT 'punjab',

  prev_reg_no text,
  new_reg_no text,
  maker text,
  model text,
  mfg_year integer,
  colour text,
  chassis_no text,
  engine_no text,
  engine_cc integer,

  seller_name text,
  seller_father text,
  seller_cnic text,
  seller_phone text,
  seller_address text,
  seller_care_of text,

  buyer_name text,
  buyer_father text,
  buyer_cnic text,
  buyer_phone text,
  buyer_address text,
  buyer_care_of text,

  sale_date date,
  transfer_date date,
  govt_fee numeric(14,2) NOT NULL DEFAULT 0,
  service_charge numeric(14,2) NOT NULL DEFAULT 0,
  docs jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,

  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_transfers_status ON transfers (status);
CREATE INDEX IF NOT EXISTS idx_transfers_prev_reg ON transfers (lower(prev_reg_no));
CREATE INDEX IF NOT EXISTS idx_transfers_new_reg ON transfers (lower(new_reg_no));
CREATE INDEX IF NOT EXISTS idx_transfers_chassis ON transfers (lower(chassis_no));
CREATE INDEX IF NOT EXISTS idx_transfers_created ON transfers (created_at DESC);

ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON transfers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON transfers TO service_role;
DROP POLICY IF EXISTS "transfers_select" ON transfers;
CREATE POLICY "transfers_select" ON transfers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "transfers_insert" ON transfers;
CREATE POLICY "transfers_insert" ON transfers FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "transfers_update" ON transfers;
CREATE POLICY "transfers_update" ON transfers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "transfers_delete" ON transfers;
CREATE POLICY "transfers_delete" ON transfers FOR DELETE TO authenticated USING (true);

DROP TRIGGER IF EXISTS transfers_updated_at ON transfers;
CREATE TRIGGER transfers_updated_at BEFORE UPDATE ON transfers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ====================================================================
-- 20261108150000_client_management.sql
-- ====================================================================
/*
# Client management and ledger

Clients can now be of three kinds: direct customers, showrooms / dealers, and customers who come through a contact person ("care of").
A customer can be linked to the showroom / contact person they came through (parent_id). When bill_to_parent is true,
that customer's quotations are billed to the parent's account, so a showroom has ONE ledger for all its cars.

- clients: client_type, parent_id, bill_to_parent, care_of, opening_balance (old pending amount from before the app), archived_at (soft delete)
- client_payments: money received on account from a client (for example a showroom paying for several cars at once),
  not tied to a single quotation. Payments recorded on a quotation stay in `payments`.

The ledger (billed, received, pending) is computed in the app from quotations + payments + client_payments.
RLS follows the rest of the app: all authenticated users share data.
*/

ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_type text NOT NULL DEFAULT 'direct';
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_client_type_check;
ALTER TABLE clients ADD CONSTRAINT clients_client_type_check CHECK (client_type IN ('direct','showroom','agent'));
ALTER TABLE clients ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS bill_to_parent boolean NOT NULL DEFAULT false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS care_of text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS opening_balance numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_clients_parent ON clients (parent_id);
CREATE INDEX IF NOT EXISTS idx_clients_type ON clients (client_type);

CREATE TABLE IF NOT EXISTS client_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text,
  reference text,
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_payments_client ON client_payments (client_id, payment_date DESC);

ALTER TABLE client_payments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_payments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON client_payments TO service_role;
DROP POLICY IF EXISTS "client_payments_select" ON client_payments;
CREATE POLICY "client_payments_select" ON client_payments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "client_payments_insert" ON client_payments;
CREATE POLICY "client_payments_insert" ON client_payments FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "client_payments_update" ON client_payments;
CREATE POLICY "client_payments_update" ON client_payments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "client_payments_delete" ON client_payments;
CREATE POLICY "client_payments_delete" ON client_payments FOR DELETE TO authenticated USING (true);


-- ====================================================================
-- 20261108180000_roles_and_rights.sql
-- ====================================================================
/*
# Users, roles and rights

Hierarchy (higher includes everything below it):
  Owner   (role = 'admin')   everything: users, settings, rates, fee rules, audit log, restore backup
  Manager (role = 'manager') all business data including deleting records, reports, backup download. No users, settings or rates
  Staff   (role = 'staff')   daily work: calculator, quotations, clients, transfers, cases, tasks, inventory, record payments.
                             Cannot delete records, edit or delete a payment once recorded, or see reports.

New accounts are NOT active. Anyone who signs up (or is added in Supabase > Authentication) waits for the owner to approve them
in the app under "Users & Rights". The very first account in an empty system becomes the Owner automatically.
Rights are enforced here in the database (row level security), not only on screen.

Safe to run more than once. Works on a fresh database and on one that already holds data.
*/

-- 1) profiles: plain-text role (also converts an old enum), active flag, email ------------------------------------------
DO $$
DECLARE r record;
BEGIN
  -- all policies are rebuilt below; dropping them first lets the role column type change
  FOR r IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY (ARRAY[
    'profiles','fee_rules','fee_rule_revisions','audit_logs','clients','vehicles','quotations','quotation_line_items','payments','client_payments',
    'punjab_rate_sets','ict_rate_sets','app_settings','hpa_counts','cases','tasks','inventory_items','transfers'])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;

  IF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='role') <> 'text' THEN
    ALTER TABLE public.profiles ALTER COLUMN role DROP DEFAULT;
    ALTER TABLE public.profiles ALTER COLUMN role TYPE text USING role::text;
  END IF;

  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass AND contype = 'c' LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'staff';
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin','manager','staff'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;   -- existing users stay active
ALTER TABLE public.profiles ALTER COLUMN active SET DEFAULT false;                          -- new accounts wait for approval
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;
UPDATE public.profiles p SET email = u.email FROM auth.users u WHERE u.id = p.id AND p.email IS NULL;

-- make sure somebody is the owner (the first registered user) if no admin exists yet
UPDATE public.profiles SET role = 'admin', active = true
WHERE NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin' AND active)
  AND id = (SELECT id FROM public.profiles ORDER BY created_at LIMIT 1);

-- 2) helper: rank of the signed-in user (0 = not active / unknown) ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_rank() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT CASE p.role WHEN 'admin' THEN 3 WHEN 'manager' THEN 2 WHEN 'staff' THEN 1 ELSE 0 END
                   FROM public.profiles p WHERE p.id = auth.uid() AND p.active), 0)
$$;
REVOKE ALL ON FUNCTION public.app_rank() FROM public;
GRANT EXECUTE ON FUNCTION public.app_rank() TO authenticated;

-- 3) new accounts: first one is the owner, everyone else waits for approval --------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE first_one boolean;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin') INTO first_one;
  INSERT INTO public.profiles (id, full_name, role, active, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), CASE WHEN first_one THEN 'admin' ELSE 'staff' END, first_one, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4) the owner changes a person's role / access through this function only -------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_user_access(target uuid, new_role text, new_active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE old_row public.profiles;
BEGIN
  IF public.app_rank() < 3 THEN RAISE EXCEPTION 'Only the owner can change user access.'; END IF;
  IF new_role NOT IN ('admin','manager','staff') THEN RAISE EXCEPTION 'Unknown role.'; END IF;
  IF target = auth.uid() AND (new_role <> 'admin' OR NOT new_active) THEN
    RAISE EXCEPTION 'You cannot remove your own owner access. Make someone else an owner first.';
  END IF;
  SELECT * INTO old_row FROM public.profiles WHERE id = target;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found.'; END IF;
  UPDATE public.profiles SET role = new_role, active = new_active WHERE id = target;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'user_access_changed', 'user', target,
          jsonb_build_object('email', old_row.email, 'name', old_row.full_name, 'from_role', old_row.role, 'to_role', new_role, 'was_active', old_row.active, 'now_active', new_active));
END $$;
REVOKE ALL ON FUNCTION public.set_user_access(uuid, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.set_user_access(uuid, text, boolean) TO authenticated;

-- 5) rights per table -----------------------------------------------------------------------------------------------------
GRANT SELECT, UPDATE (full_name) ON public.profiles TO authenticated;
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.app_rank() >= 1);
CREATE POLICY "profiles_update_own_name" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DO $$
DECLARE t text;
BEGIN
  -- daily business data: staff read, add and change; managers also delete
  FOREACH t IN ARRAY ARRAY['clients','vehicles','quotations','quotation_line_items','hpa_counts','cases','tasks','inventory_items','transfers'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.app_rank() >= 1)', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.app_rank() >= 1)', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.app_rank() >= 1) WITH CHECK (public.app_rank() >= 1)', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.app_rank() >= 2)', t || '_delete', t);
  END LOOP;
  -- money: staff record payments, only managers and the owner correct or delete them
  FOREACH t IN ARRAY ARRAY['payments','client_payments'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.app_rank() >= 1)', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.app_rank() >= 1)', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.app_rank() >= 2) WITH CHECK (public.app_rank() >= 2)', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.app_rank() >= 2)', t || '_delete', t);
  END LOOP;
  -- fee rules and rate sets: everyone working can read them (the calculator needs them), only the owner changes them
  FOREACH t IN ARRAY ARRAY['fee_rules','punjab_rate_sets','ict_rate_sets'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.app_rank() >= 1)', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.app_rank() >= 3)', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.app_rank() >= 3) WITH CHECK (public.app_rank() >= 3)', t || '_update', t);
    IF t = 'fee_rules' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.app_rank() >= 3)', t || '_delete', t);
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (status = ''draft'' AND public.app_rank() >= 3)', t || '_delete', t);  -- history is kept: only drafts can go
    END IF;
  END LOOP;
END $$;

-- settings and branding: signed-in users read (the login screen shows the logo), the owner changes
GRANT SELECT, INSERT, UPDATE ON public.app_settings TO authenticated;
CREATE POLICY "app_settings_select" ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "app_settings_insert" ON public.app_settings FOR INSERT TO authenticated WITH CHECK (public.app_rank() >= 3);
CREATE POLICY "app_settings_update" ON public.app_settings FOR UPDATE TO authenticated USING (public.app_rank() >= 3) WITH CHECK (public.app_rank() >= 3);

-- audit trail: everyone working adds entries, only the owner reads, nobody edits or deletes
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
CREATE POLICY "audit_logs_select" ON public.audit_logs FOR SELECT TO authenticated USING (public.app_rank() >= 3);
CREATE POLICY "audit_logs_insert" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (public.app_rank() >= 1);
CREATE POLICY "fee_rule_revisions_select" ON public.fee_rule_revisions FOR SELECT TO authenticated USING (public.app_rank() >= 3);

/*
IF YOU EVER LOSE OWNER ACCESS (run in the Supabase SQL Editor, put your own email):
  UPDATE public.profiles SET role = 'admin', active = true WHERE email = 'you@example.com';
*/


-- ====================================================================
-- 20261109090000_m1_integrity_permissions.sql
-- ====================================================================
/*
# M1: data integrity, save safety and permissions

Run on STAGING first, after a fresh backup. Safe to run more than once. Needs 20261108180000_roles_and_rights.sql applied first.

1. public.lb_today(): today's date in Pakistan (Asia/Karachi). Database defaults for payment_date, opened_on, entry_date use it
   (CURRENT_DATE is the UTC day and is wrong between midnight and 5 am in Pakistan).
2. public.create_quotation_atomic(): saves vehicle + quotation + line items + audit entry in ONE transaction, validates everything,
   creates the quotation number on the server (retries on a clash). Any failure rolls back everything.
3. payments.quotation_id no longer cascades: a quotation that has payments cannot be deleted (payments are never lost silently).
4. payments.amount must be more than zero (NOT VALID: checks new and changed rows, does not fail on old rows).
5. audit_logs: user_id is filled automatically and must be the signed-in user, so entries cannot be written in somebody else's name.

NOT in M1 on purpose (see the M1 report): locking approved quotations (M3), case duplicates (M3), staff row-level finance limits (needs owner decision).
*/

-- 1) Pakistan business date --------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lb_today() RETURNS date
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Karachi')::date $$;
GRANT EXECUTE ON FUNCTION public.lb_today() TO authenticated;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('payments','payment_date'),('client_payments','payment_date'),('cases','opened_on'),('hpa_counts','entry_date')) AS v(t, c) LOOP
    IF to_regclass('public.' || r.t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET DEFAULT public.lb_today()', r.t, r.c);
    END IF;
  END LOOP;
END $$;

-- 2) Atomic quotation save -----------------------------------------------------------------------------------------------------
-- SECURITY INVOKER (the default): row level security of the signed-in user applies to every insert inside.
CREATE OR REPLACE FUNCTION public.create_quotation_atomic(p_client_id uuid, p_vehicle jsonb, p_quotation jsonb, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_vehicle_id uuid;
  v_qid uuid;
  v_no text;
  v_try int := 0;
  h_govt numeric := round(coalesce(nullif(p_quotation->>'subtotal_govt', '')::numeric, 0), 2);
  h_service numeric := round(coalesce(nullif(p_quotation->>'subtotal_service', '')::numeric, 0), 2);
  h_add numeric := round(coalesce(nullif(p_quotation->>'subtotal_additional', '')::numeric, 0), 2);
  h_grand numeric := round(coalesce(nullif(p_quotation->>'grand_total', '')::numeric, 0), 2);
  v_days int := coalesce(nullif(p_quotation->>'validity_days', '')::int, 15);
  i_govt numeric; i_service numeric; i_add numeric;
BEGIN
  IF public.app_rank() < 1 THEN RAISE EXCEPTION 'Your account is not active.'; END IF;
  IF p_client_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.clients WHERE id = p_client_id) THEN
    RAISE EXCEPTION 'Client not found. Select a client and try again.';
  END IF;
  IF p_quotation IS NULL OR jsonb_typeof(p_quotation) <> 'object' THEN RAISE EXCEPTION 'Quotation details are missing.'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'A quotation needs at least one line item.';
  END IF;
  IF v_days < 1 OR v_days > 365 THEN RAISE EXCEPTION 'Validity must be between 1 and 365 days.'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items) AS x(label text, category text, amount numeric)
    WHERE coalesce(trim(x.label), '') = '' OR x.category IS NULL OR x.category NOT IN ('government', 'service', 'additional') OR x.amount IS NULL
  ) THEN
    RAISE EXCEPTION 'Every line item needs a label, a category (government, service or additional) and an amount.';
  END IF;

  SELECT coalesce(sum(x.amount) FILTER (WHERE x.category = 'government'), 0),
         coalesce(sum(x.amount) FILTER (WHERE x.category = 'service'), 0),
         coalesce(sum(x.amount) FILTER (WHERE x.category = 'additional'), 0)
    INTO i_govt, i_service, i_add
  FROM jsonb_to_recordset(p_items) AS x(category text, amount numeric);

  IF abs(i_govt - h_govt) > 0.01 OR abs(i_service - h_service) > 0.01 OR abs(i_add - h_add) > 0.01 THEN
    RAISE EXCEPTION 'Quotation totals do not match its line items (items: govt %, service %, additional %; header: govt %, service %, additional %).',
      i_govt, i_service, i_add, h_govt, h_service, h_add;
  END IF;
  IF abs(h_grand - (h_govt + h_service + h_add)) > 0.01 THEN
    RAISE EXCEPTION 'Grand total % is not the sum of its parts (%).', h_grand, h_govt + h_service + h_add;
  END IF;

  -- vehicle (optional)
  IF p_vehicle IS NOT NULL AND jsonb_typeof(p_vehicle) = 'object' AND p_vehicle <> '{}'::jsonb THEN
    INSERT INTO public.vehicles (client_id, province, registration_type, vehicle_category, company, model, engine_cc, manufacturing_year,
                                 invoice_value, registration_number, filer_status, origin, fuel_type)
    VALUES (p_client_id, nullif(p_vehicle->>'province', ''), nullif(p_vehicle->>'registration_type', ''), nullif(p_vehicle->>'vehicle_category', ''),
            nullif(p_vehicle->>'company', ''), nullif(p_vehicle->>'model', ''), nullif(p_vehicle->>'engine_cc', '')::int,
            nullif(p_vehicle->>'manufacturing_year', '')::int, nullif(p_vehicle->>'invoice_value', '')::numeric,
            nullif(p_vehicle->>'registration_number', ''), nullif(p_vehicle->>'filer_status', ''), nullif(p_vehicle->>'origin', ''),
            nullif(p_vehicle->>'fuel_type', ''))
    RETURNING id INTO v_vehicle_id;
  END IF;

  -- quotation, with a server-made number; try again if two people hit the same number
  LOOP
    v_try := v_try + 1;
    v_no := 'LB-' || to_char(public.lb_today(), 'YYYYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 4));
    BEGIN
      INSERT INTO public.quotations (quotation_number, client_id, vehicle_id, transaction_type, status, calculation_snapshot,
                                     subtotal_govt, subtotal_service, subtotal_additional, grand_total, validity_date, payment_terms, notes)
      VALUES (v_no, p_client_id, v_vehicle_id, nullif(p_quotation->>'transaction_type', ''), 'pending', p_quotation->'calculation_snapshot',
              h_govt, h_service, h_add, h_grand, public.lb_today() + v_days, nullif(p_quotation->>'payment_terms', ''), NULL)
      RETURNING id INTO v_qid;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_try >= 8 THEN RAISE EXCEPTION 'Could not create a unique quotation number. Please try again.'; END IF;
    END;
  END LOOP;

  INSERT INTO public.quotation_line_items (quotation_id, fee_type, label, category, amount, formula, source, rule_version, is_override, override_reason, sort_order)
  SELECT v_qid, coalesce(nullif(trim(x.fee_type), ''), 'other'), x.label, x.category, x.amount, x.formula, x.source, x.rule_version,
         coalesce(x.is_override, false), x.override_reason, coalesce(x.sort_order, 0)
  FROM jsonb_to_recordset(p_items) AS x(fee_type text, label text, category text, amount numeric, formula text, source text,
                                        rule_version text, is_override boolean, override_reason text, sort_order int);

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'quotation_created', 'quotation', v_qid, jsonb_build_object('quotation_number', v_no, 'total', h_grand));

  RETURN jsonb_build_object('quotation_id', v_qid, 'quotation_number', v_no, 'vehicle_id', v_vehicle_id);
END $$;
REVOKE ALL ON FUNCTION public.create_quotation_atomic(uuid, jsonb, jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.create_quotation_atomic(uuid, jsonb, jsonb, jsonb) TO authenticated;

-- 3) payments are never deleted by deleting their quotation ---------------------------------------------------------------------
DO $$
DECLARE fk text;
BEGIN
  FOR fk IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.payments'::regclass AND contype = 'f' AND confrelid = 'public.quotations'::regclass LOOP
    EXECUTE format('ALTER TABLE public.payments DROP CONSTRAINT %I', fk);
  END LOOP;
  ALTER TABLE public.payments ADD CONSTRAINT payments_quotation_id_fkey
    FOREIGN KEY (quotation_id) REFERENCES public.quotations(id) ON DELETE RESTRICT;
END $$;

-- 4) payment amount must be positive (new and changed rows) ----------------------------------------------------------------------
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_amount_positive;
ALTER TABLE public.payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0) NOT VALID;
-- After the old data is reviewed (M0 inventory block 10), run once:  ALTER TABLE public.payments VALIDATE CONSTRAINT payments_amount_positive;

-- 5) audit trail cannot be written in somebody else's name -------------------------------------------------------------------------
ALTER TABLE public.audit_logs ALTER COLUMN user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS "audit_logs_insert" ON public.audit_logs;
CREATE POLICY "audit_logs_insert" ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (public.app_rank() >= 1 AND user_id = auth.uid());


-- ====================================================================
-- 20261117090000_m2_client_360_vehicles.sql
-- ====================================================================
/*
# M2: Client 360 and vehicle management

Run on STAGING first, after a fresh backup. Safe to run more than once. Needs the M1 migration (20261109090000) applied first.
Purely additive: no existing column is changed or dropped, no existing row is rewritten (new columns get defaults / stay empty).

1. vehicles: chassis_number, engine_number (so vehicles can be searched and checked for duplicates by chassis too).
2. clients: status (active / inactive), assigned_to (the staff member who looks after the client), business_type (free text, e.g. Garage).
   Only a Manager or the Owner can assign a client to somebody (database trigger, not only a hidden button).
3. Normalising functions (phone, CNIC, number plate, chassis) so "0300-1234567", "+92 300 1234567" and "03001234567" are the same number.
4. Plain (NOT unique) indexes on the normalised values: duplicates are WARNED about, never blocked or merged.
5. find_duplicates(): returns clients / vehicles that share a phone, CNIC, registration number or chassis number with what is being typed.
6. global_search(): one search over client name, phone, CNIC, C/O, vehicle registration, chassis and engine number.
   Both functions run as the signed-in user (SECURITY INVOKER), so row level security decides what each person can see.
7. create_quotation_atomic(): can now link an EXISTING vehicle (p_vehicle.id) instead of always inserting a new vehicle row.
   Everything else in that function is exactly as in M1.

NOT in M2 on purpose: documents and reminders tabs (M3 / M5), quotation-from-vehicle workflow and case rules (M3), payment allocation (M4).
*/

-- 1) vehicles -------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS chassis_number text;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS engine_number text;

-- 2) clients --------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_status_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_status_check CHECK (status IN ('active', 'inactive'));
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS business_type text;
CREATE INDEX IF NOT EXISTS idx_clients_assigned ON public.clients (assigned_to);

-- Only Manager / Owner may assign a client to a person (staff may leave it empty, or take a new client for themselves).
-- auth.uid() is null for the SQL editor / service role: those are not blocked.
CREATE OR REPLACE FUNCTION public.clients_guard_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.app_rank() >= 2 THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_to IS NOT NULL AND NEW.assigned_to <> auth.uid() THEN
      RAISE EXCEPTION 'Only a manager or the owner can assign a client to another person.';
    END IF;
  ELSIF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    RAISE EXCEPTION 'Only a manager or the owner can change who a client is assigned to.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS clients_guard_assignment_trg ON public.clients;
CREATE TRIGGER clients_guard_assignment_trg BEFORE INSERT OR UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.clients_guard_assignment();

-- 3) normalisers (the TypeScript twins live in src/lib/duplicates.ts and are tested with the same examples) -----------------------
-- Phone: digits only; +92 / 0092 / 92 prefix becomes 0; a bare 3xxxxxxxxx mobile gets its 0. Fewer than 7 digits: not comparable (NULL).
CREATE OR REPLACE FUNCTION public.lb_norm_phone(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN length(d) < 7 THEN NULL
    WHEN d ~ '^0092[0-9]{10}$' THEN '0' || substr(d, 5)
    WHEN d ~ '^92[0-9]{10}$'   THEN '0' || substr(d, 3)
    WHEN d ~ '^3[0-9]{9}$'     THEN '0' || d
    ELSE d END
  FROM (SELECT regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g') AS d) s
$$;
-- CNIC: exactly 13 digits, otherwise NULL.
CREATE OR REPLACE FUNCTION public.lb_norm_cnic(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN length(d) = 13 THEN d ELSE NULL END
  FROM (SELECT regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g') AS d) s
$$;
-- Number plate: letters and digits only, upper case, at least 3 characters.
CREATE OR REPLACE FUNCTION public.lb_norm_plate(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN length(d) >= 3 THEN d ELSE NULL END
  FROM (SELECT upper(regexp_replace(coalesce(t, ''), '[^A-Za-z0-9]', '', 'g')) AS d) s
$$;
-- Chassis / engine number: letters and digits only, upper case, at least 5 characters.
CREATE OR REPLACE FUNCTION public.lb_norm_chassis(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN length(d) >= 5 THEN d ELSE NULL END
  FROM (SELECT upper(regexp_replace(coalesce(t, ''), '[^A-Za-z0-9]', '', 'g')) AS d) s
$$;
GRANT EXECUTE ON FUNCTION public.lb_norm_phone(text), public.lb_norm_cnic(text), public.lb_norm_plate(text), public.lb_norm_chassis(text) TO authenticated;

-- 4) plain indexes (NOT unique: a duplicate is a warning, never an error) --------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_clients_norm_phone ON public.clients (public.lb_norm_phone(phone));
CREATE INDEX IF NOT EXISTS idx_clients_norm_cnic ON public.clients (public.lb_norm_cnic(cnic));
CREATE INDEX IF NOT EXISTS idx_vehicles_norm_plate ON public.vehicles (public.lb_norm_plate(registration_number));
CREATE INDEX IF NOT EXISTS idx_vehicles_norm_chassis ON public.vehicles (public.lb_norm_chassis(chassis_number));

-- 5) duplicate finder -----------------------------------------------------------------------------------------------------------
-- Pass whatever is being typed (any argument may be null). Pass the id of the record being edited to leave it out of the answer.
-- Returns { clients: [{id,name,phone,cnic,archived,reasons:[...]}], vehicles: [{id,client_id,client_name,registration_number,chassis_number,reasons:[...]}] }
CREATE OR REPLACE FUNCTION public.find_duplicates(p_phone text DEFAULT NULL, p_cnic text DEFAULT NULL, p_registration text DEFAULT NULL,
                                                 p_chassis text DEFAULT NULL, p_exclude_client uuid DEFAULT NULL, p_exclude_vehicle uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  n_phone text := public.lb_norm_phone(p_phone);
  n_cnic text := public.lb_norm_cnic(p_cnic);
  n_plate text := public.lb_norm_plate(p_registration);
  n_chassis text := public.lb_norm_chassis(p_chassis);
  res_c jsonb := '[]'::jsonb;
  res_v jsonb := '[]'::jsonb;
BEGIN
  IF public.app_rank() < 1 THEN RAISE EXCEPTION 'Your account is not active.'; END IF;

  IF n_phone IS NOT NULL OR n_cnic IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) INTO res_c FROM (
      SELECT c.id, c.name, c.phone, c.cnic, (c.archived_at IS NOT NULL) AS archived,
             array_remove(ARRAY[CASE WHEN n_phone IS NOT NULL AND public.lb_norm_phone(c.phone) = n_phone THEN 'phone' END,
                                CASE WHEN n_cnic  IS NOT NULL AND public.lb_norm_cnic(c.cnic)   = n_cnic  THEN 'cnic'  END], NULL) AS reasons
      FROM public.clients c
      WHERE (p_exclude_client IS NULL OR c.id <> p_exclude_client)
        AND ((n_phone IS NOT NULL AND public.lb_norm_phone(c.phone) = n_phone) OR (n_cnic IS NOT NULL AND public.lb_norm_cnic(c.cnic) = n_cnic))
      ORDER BY c.created_at LIMIT 10) m;
  END IF;

  IF n_plate IS NOT NULL OR n_chassis IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) INTO res_v FROM (
      SELECT v.id, v.client_id, cl.name AS client_name, v.registration_number, v.chassis_number,
             array_remove(ARRAY[CASE WHEN n_plate   IS NOT NULL AND public.lb_norm_plate(v.registration_number) = n_plate     THEN 'registration' END,
                                CASE WHEN n_chassis IS NOT NULL AND public.lb_norm_chassis(v.chassis_number)    = n_chassis   THEN 'chassis' END], NULL) AS reasons
      FROM public.vehicles v LEFT JOIN public.clients cl ON cl.id = v.client_id
      WHERE (p_exclude_vehicle IS NULL OR v.id <> p_exclude_vehicle)
        AND ((n_plate IS NOT NULL AND public.lb_norm_plate(v.registration_number) = n_plate) OR (n_chassis IS NOT NULL AND public.lb_norm_chassis(v.chassis_number) = n_chassis))
      ORDER BY v.created_at LIMIT 10) m;
  END IF;

  RETURN jsonb_build_object('clients', res_c, 'vehicles', res_v);
END $$;
REVOKE ALL ON FUNCTION public.find_duplicates(text, text, text, text, uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.find_duplicates(text, text, text, text, uuid, uuid) TO authenticated;

-- 6) global search --------------------------------------------------------------------------------------------------------------
-- Money is never returned here. Archived clients are returned (flagged) after the active ones.
CREATE OR REPLACE FUNCTION public.global_search(p_q text, p_limit int DEFAULT 15) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  q text := btrim(coalesce(p_q, ''));
  lim int := least(greatest(coalesce(p_limit, 15), 1), 50);
  like_q text;
  q_digits text := regexp_replace(q, '[^0-9]', '', 'g');
  q_phone text := public.lb_norm_phone(q);
  q_alnum text := upper(regexp_replace(q, '[^A-Za-z0-9]', '', 'g'));
  res_c jsonb := '[]'::jsonb;
  res_v jsonb := '[]'::jsonb;
BEGIN
  IF public.app_rank() < 1 THEN RAISE EXCEPTION 'Your account is not active.'; END IF;
  IF length(q) < 2 THEN RETURN jsonb_build_object('clients', res_c, 'vehicles', res_v); END IF;
  like_q := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) INTO res_c FROM (
    SELECT c.id, c.name, c.phone, c.cnic, c.client_type, c.care_of, c.parent_id, (c.archived_at IS NOT NULL) AS archived
    FROM public.clients c
    WHERE c.name ILIKE like_q OR coalesce(c.care_of, '') ILIKE like_q OR coalesce(c.email, '') ILIKE like_q
       OR (length(q_digits) >= 3 AND (regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') LIKE '%' || q_digits || '%'
                                      OR regexp_replace(coalesce(c.cnic, ''), '[^0-9]', '', 'g') LIKE '%' || q_digits || '%'))
       OR (q_phone IS NOT NULL AND public.lb_norm_phone(c.phone) = q_phone)
    ORDER BY (c.archived_at IS NOT NULL), (c.name ILIKE replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%') DESC, c.name
    LIMIT lim) m;

  SELECT coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) INTO res_v FROM (
    SELECT v.id, v.client_id, cl.name AS client_name, v.registration_number, v.chassis_number, v.engine_number, v.company, v.model, v.manufacturing_year
    FROM public.vehicles v LEFT JOIN public.clients cl ON cl.id = v.client_id
    WHERE (length(q_alnum) >= 3 AND (upper(regexp_replace(coalesce(v.registration_number, ''), '[^A-Za-z0-9]', '', 'g')) LIKE '%' || q_alnum || '%'
                                     OR upper(regexp_replace(coalesce(v.chassis_number, ''), '[^A-Za-z0-9]', '', 'g')) LIKE '%' || q_alnum || '%'
                                     OR upper(regexp_replace(coalesce(v.engine_number, ''), '[^A-Za-z0-9]', '', 'g')) LIKE '%' || q_alnum || '%'))
       OR coalesce(v.company, '') || ' ' || coalesce(v.model, '') ILIKE like_q
    ORDER BY v.created_at DESC
    LIMIT lim) m;

  RETURN jsonb_build_object('clients', res_c, 'vehicles', res_v);
END $$;
REVOKE ALL ON FUNCTION public.global_search(text, int) FROM public;
GRANT EXECUTE ON FUNCTION public.global_search(text, int) TO authenticated;

-- 7) quotation save can reuse an existing vehicle ----------------------------------------------------------------------------------
-- Same function as in M1 with ONE change: if p_vehicle contains "id", that vehicle is linked (it must exist and belong to the same client,
-- or to the client's showroom / customer) and no new vehicle row is inserted. Without "id" it behaves exactly as before.
CREATE OR REPLACE FUNCTION public.create_quotation_atomic(p_client_id uuid, p_vehicle jsonb, p_quotation jsonb, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_vehicle_id uuid;
  v_existing_id uuid;
  v_vehicle_owner uuid;
  v_qid uuid;
  v_no text;
  v_try int := 0;
  h_govt numeric := round(coalesce(nullif(p_quotation->>'subtotal_govt', '')::numeric, 0), 2);
  h_service numeric := round(coalesce(nullif(p_quotation->>'subtotal_service', '')::numeric, 0), 2);
  h_add numeric := round(coalesce(nullif(p_quotation->>'subtotal_additional', '')::numeric, 0), 2);
  h_grand numeric := round(coalesce(nullif(p_quotation->>'grand_total', '')::numeric, 0), 2);
  v_days int := coalesce(nullif(p_quotation->>'validity_days', '')::int, 15);
  i_govt numeric; i_service numeric; i_add numeric;
BEGIN
  IF public.app_rank() < 1 THEN RAISE EXCEPTION 'Your account is not active.'; END IF;
  IF p_client_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.clients WHERE id = p_client_id) THEN
    RAISE EXCEPTION 'Client not found. Select a client and try again.';
  END IF;
  IF p_quotation IS NULL OR jsonb_typeof(p_quotation) <> 'object' THEN RAISE EXCEPTION 'Quotation details are missing.'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'A quotation needs at least one line item.';
  END IF;
  IF v_days < 1 OR v_days > 365 THEN RAISE EXCEPTION 'Validity must be between 1 and 365 days.'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items) AS x(label text, category text, amount numeric)
    WHERE coalesce(trim(x.label), '') = '' OR x.category IS NULL OR x.category NOT IN ('government', 'service', 'additional') OR x.amount IS NULL
  ) THEN
    RAISE EXCEPTION 'Every line item needs a label, a category (government, service or additional) and an amount.';
  END IF;

  SELECT coalesce(sum(x.amount) FILTER (WHERE x.category = 'government'), 0),
         coalesce(sum(x.amount) FILTER (WHERE x.category = 'service'), 0),
         coalesce(sum(x.amount) FILTER (WHERE x.category = 'additional'), 0)
    INTO i_govt, i_service, i_add
  FROM jsonb_to_recordset(p_items) AS x(category text, amount numeric);

  IF abs(i_govt - h_govt) > 0.01 OR abs(i_service - h_service) > 0.01 OR abs(i_add - h_add) > 0.01 THEN
    RAISE EXCEPTION 'Quotation totals do not match its line items (items: govt %, service %, additional %; header: govt %, service %, additional %).',
      i_govt, i_service, i_add, h_govt, h_service, h_add;
  END IF;
  IF abs(h_grand - (h_govt + h_service + h_add)) > 0.01 THEN
    RAISE EXCEPTION 'Grand total % is not the sum of its parts (%).', h_grand, h_govt + h_service + h_add;
  END IF;

  -- vehicle (optional): link an existing one, or insert a new one
  IF p_vehicle IS NOT NULL AND jsonb_typeof(p_vehicle) = 'object' AND p_vehicle <> '{}'::jsonb THEN
    v_existing_id := nullif(p_vehicle->>'id', '')::uuid;
    IF v_existing_id IS NOT NULL THEN
      SELECT v.client_id INTO v_vehicle_owner FROM public.vehicles v WHERE v.id = v_existing_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'The selected vehicle no longer exists. Pick the vehicle again.'; END IF;
      IF v_vehicle_owner IS NOT NULL AND v_vehicle_owner <> p_client_id
         AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v_vehicle_owner AND c.parent_id = p_client_id)
         AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = p_client_id AND c.parent_id = v_vehicle_owner) THEN
        RAISE EXCEPTION 'This vehicle belongs to a different client.';
      END IF;
      v_vehicle_id := v_existing_id;
    ELSE
      INSERT INTO public.vehicles (client_id, province, registration_type, vehicle_category, company, model, engine_cc, manufacturing_year,
                                   invoice_value, registration_number, filer_status, origin, fuel_type, chassis_number, engine_number)
      VALUES (p_client_id, nullif(p_vehicle->>'province', ''), nullif(p_vehicle->>'registration_type', ''), nullif(p_vehicle->>'vehicle_category', ''),
              nullif(p_vehicle->>'company', ''), nullif(p_vehicle->>'model', ''), nullif(p_vehicle->>'engine_cc', '')::int,
              nullif(p_vehicle->>'manufacturing_year', '')::int, nullif(p_vehicle->>'invoice_value', '')::numeric,
              nullif(p_vehicle->>'registration_number', ''), nullif(p_vehicle->>'filer_status', ''), nullif(p_vehicle->>'origin', ''),
              nullif(p_vehicle->>'fuel_type', ''), nullif(p_vehicle->>'chassis_number', ''), nullif(p_vehicle->>'engine_number', ''))
      RETURNING id INTO v_vehicle_id;
    END IF;
  END IF;

  -- quotation, with a server-made number; try again if two people hit the same number
  LOOP
    v_try := v_try + 1;
    v_no := 'LB-' || to_char(public.lb_today(), 'YYYYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 4));
    BEGIN
      INSERT INTO public.quotations (quotation_number, client_id, vehicle_id, transaction_type, status, calculation_snapshot,
                                     subtotal_govt, subtotal_service, subtotal_additional, grand_total, validity_date, payment_terms, notes)
      VALUES (v_no, p_client_id, v_vehicle_id, nullif(p_quotation->>'transaction_type', ''), 'pending', p_quotation->'calculation_snapshot',
              h_govt, h_service, h_add, h_grand, public.lb_today() + v_days, nullif(p_quotation->>'payment_terms', ''), NULL)
      RETURNING id INTO v_qid;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_try >= 8 THEN RAISE EXCEPTION 'Could not create a unique quotation number. Please try again.'; END IF;
    END;
  END LOOP;

  INSERT INTO public.quotation_line_items (quotation_id, fee_type, label, category, amount, formula, source, rule_version, is_override, override_reason, sort_order)
  SELECT v_qid, coalesce(nullif(trim(x.fee_type), ''), 'other'), x.label, x.category, x.amount, x.formula, x.source, x.rule_version,
         coalesce(x.is_override, false), x.override_reason, coalesce(x.sort_order, 0)
  FROM jsonb_to_recordset(p_items) AS x(fee_type text, label text, category text, amount numeric, formula text, source text,
                                        rule_version text, is_override boolean, override_reason text, sort_order int);

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'quotation_created', 'quotation', v_qid, jsonb_build_object('quotation_number', v_no, 'total', h_grand));

  RETURN jsonb_build_object('quotation_id', v_qid, 'quotation_number', v_no, 'vehicle_id', v_vehicle_id);
END $$;
REVOKE ALL ON FUNCTION public.create_quotation_atomic(uuid, jsonb, jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.create_quotation_atomic(uuid, jsonb, jsonb, jsonb) TO authenticated;


-- ====================================================================
-- 20261118090000_m3_quotation_case_workflow.sql
-- ====================================================================
/*
# M3: Quotation and case workflow

Run on STAGING first, after a fresh backup. Safe to run more than once. Needs M1 (20261109090000) and M2 (20261117090000) applied first.
Additive: no existing column is changed or dropped. Existing quotations and cases keep every value; existing cases get a "stage" worked out from their status.

1. status_history: one row for EVERY quotation status change and EVERY case status / stage / assignee change, written by a database trigger,
   so it is logged whichever screen (or API call) made the change. Nobody can edit or delete history from the app.
2. Quotation states: draft, pending, approved, rejected, completed. Allowed moves are enforced in the database (Manager / Owner may correct any move, still logged).
   "Expired" is not a stored status: a pending quotation whose validity date has passed is shown as expired. Follow-up date and note added.
3. cases: stage (new, documents, submitted, processing, ready, delivered), assigned_to, priority, due_date, next_action, next_action_on,
   excise_reference, excise_submitted_on. Stage and status stay consistent; a closed case can be reopened by a Manager / Owner only.
4. case_documents: required-document checklist per case (default list per service, editable per case).
5. create_case_from_quotation(): one action. Only an APPROVED quotation. Safe to call twice: the second call returns the same case (the quotation row is locked while it runs).
   A database rule also stops a second open case being linked to the same quotation by any other route.
6. set_quotation_status / set_case_stage / set_case_status: change with a note (a cancellation must give a reason).

NOT in M3 on purpose: client notifications and reminders (M5), payment allocation (M4). Fee calculation engine and PDF are untouched.
*/

-- 1) history ----------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('quotation', 'case')),
  entity_id uuid NOT NULL,
  field text NOT NULL DEFAULT 'status',
  from_value text,
  to_value text NOT NULL,
  note text,
  changed_by uuid DEFAULT auth.uid(),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_status_history_entity ON public.status_history (entity_type, entity_id, changed_at);
ALTER TABLE public.status_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.status_history FROM anon, authenticated;
GRANT SELECT ON public.status_history TO authenticated;
GRANT ALL ON public.status_history TO service_role;
DROP POLICY IF EXISTS status_history_select ON public.status_history;
CREATE POLICY status_history_select ON public.status_history FOR SELECT TO authenticated USING (public.app_rank() >= 1);

-- written only by the triggers below (SECURITY DEFINER); the note of the current action travels in a transaction-local setting
CREATE OR REPLACE FUNCTION public.lb_log_change(p_type text, p_id uuid, p_field text, p_from text, p_to text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.status_history (entity_type, entity_id, field, from_value, to_value, note, changed_by)
  VALUES (p_type, p_id, p_field, p_from, p_to, nullif(current_setting('lb.change_note', true), ''), auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.lb_log_change(text, uuid, text, text, text) FROM public;

-- 2) quotations -------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS follow_up_on date;
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS follow_up_note text;

CREATE OR REPLACE FUNCTION public.quotation_move_allowed(p_from text, p_to text, p_rank int) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_from = p_to THEN true
    WHEN p_rank >= 2 THEN true                                  -- manager / owner may correct any move; it is logged
    WHEN p_from = 'draft'     THEN p_to IN ('pending', 'rejected')
    WHEN p_from = 'pending'   THEN p_to IN ('approved', 'rejected', 'draft')
    WHEN p_from = 'approved'  THEN p_to IN ('completed', 'pending', 'rejected')
    WHEN p_from = 'rejected'  THEN p_to IN ('pending')
    ELSE false                                                  -- completed: only a manager / owner can reopen
  END
$$;
GRANT EXECUTE ON FUNCTION public.quotation_move_allowed(text, text, int) TO authenticated;

-- SECURITY DEFINER so the trigger may write history; nobody can call lb_log_change themselves, and auth.uid() / app_rank() still see the signed-in user
CREATE OR REPLACE FUNCTION public.quotations_status_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF auth.uid() IS NOT NULL AND NOT public.quotation_move_allowed(OLD.status, NEW.status, public.app_rank()) THEN
      RAISE EXCEPTION 'A quotation cannot go from "%" to "%". Ask a manager if this is a correction.', OLD.status, NEW.status;
    END IF;
    PERFORM public.lb_log_change('quotation', NEW.id, 'status', OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.quotations_status_guard() FROM public;
DROP TRIGGER IF EXISTS quotations_status_guard_trg ON public.quotations;
CREATE TRIGGER quotations_status_guard_trg BEFORE UPDATE OF status ON public.quotations FOR EACH ROW EXECUTE FUNCTION public.quotations_status_guard();

-- 3) cases ------------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'new';
-- existing cases: derive the stage from their status ONCE (the triggers are created after this, so no history rows are made for it)
UPDATE public.cases SET stage = CASE status WHEN 'completed' THEN 'delivered' WHEN 'active' THEN 'processing' ELSE 'new' END
 WHERE stage = 'new' AND status IN ('completed', 'active');
ALTER TABLE public.cases DROP CONSTRAINT IF EXISTS cases_stage_check;
ALTER TABLE public.cases ADD CONSTRAINT cases_stage_check CHECK (stage IN ('new', 'documents', 'submitted', 'processing', 'ready', 'delivered'));
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';
ALTER TABLE public.cases DROP CONSTRAINT IF EXISTS cases_priority_check;
ALTER TABLE public.cases ADD CONSTRAINT cases_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS next_action text;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS next_action_on date;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS excise_reference text;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS excise_submitted_on date;
CREATE INDEX IF NOT EXISTS idx_cases_assigned ON public.cases (assigned_to);
CREATE INDEX IF NOT EXISTS idx_cases_quotation ON public.cases (quotation_id);

CREATE OR REPLACE FUNCTION public.cases_workflow_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE other_no text; rk int := public.app_rank(); n_from text; n_to text;
BEGIN
  -- one open case per quotation (cancelled cases do not count, so a cancelled case can be replaced)
  IF NEW.quotation_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.quotation_id IS DISTINCT FROM OLD.quotation_id) AND NEW.status <> 'cancelled' THEN
    SELECT c.case_no INTO other_no FROM public.cases c WHERE c.quotation_id = NEW.quotation_id AND c.id <> NEW.id AND c.status <> 'cancelled' LIMIT 1;
    IF FOUND THEN RAISE EXCEPTION 'This quotation already has case %. Open that case instead of creating another.', other_no; END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'completed' THEN NEW.stage := 'delivered'; END IF;
    IF NEW.status IN ('completed', 'cancelled') AND NEW.closed_on IS NULL THEN NEW.closed_on := public.lb_today(); END IF;
    RETURN NEW;
  END IF;

  -- a closed case is reopened (status or stage moved) by a manager / owner only
  IF OLD.status IN ('completed', 'cancelled') AND auth.uid() IS NOT NULL AND rk < 2
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.stage IS DISTINCT FROM OLD.stage) THEN
    RAISE EXCEPTION 'This case is closed. Only a manager or the owner can reopen it.';
  END IF;

  -- stage and status stay consistent
  IF NEW.stage IS DISTINCT FROM OLD.stage AND NEW.status = OLD.status THEN
    IF NEW.stage = 'delivered' THEN NEW.status := 'completed';
    ELSIF NEW.status = 'pending' AND NEW.stage <> 'new' THEN NEW.status := 'active';
    ELSIF OLD.status = 'completed' AND NEW.stage <> 'delivered' THEN NEW.status := 'active';   -- reopened by moving the stage back
    END IF;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'completed' AND NEW.stage <> 'delivered' THEN NEW.stage := 'delivered'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('completed', 'cancelled') THEN NEW.closed_on := coalesce(NEW.closed_on, public.lb_today());
    ELSE NEW.closed_on := NULL; END IF;
  END IF;
  NEW.updated_at := now();

  IF NEW.status IS DISTINCT FROM OLD.status THEN PERFORM public.lb_log_change('case', NEW.id, 'status', OLD.status, NEW.status); END IF;
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN PERFORM public.lb_log_change('case', NEW.id, 'stage', OLD.stage, NEW.stage); END IF;
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    SELECT full_name INTO n_from FROM public.profiles WHERE id = OLD.assigned_to;
    SELECT full_name INTO n_to FROM public.profiles WHERE id = NEW.assigned_to;
    PERFORM public.lb_log_change('case', NEW.id, 'assigned_to', coalesce(n_from, 'nobody'), coalesce(n_to, 'nobody'));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cases_workflow_guard() FROM public;
DROP TRIGGER IF EXISTS cases_workflow_guard_trg ON public.cases;
CREATE TRIGGER cases_workflow_guard_trg BEFORE INSERT OR UPDATE ON public.cases FOR EACH ROW EXECUTE FUNCTION public.cases_workflow_guard();

-- 4) document checklist ------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.case_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  required boolean NOT NULL DEFAULT true,
  received boolean NOT NULL DEFAULT false,
  received_on date,
  notes text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_case_documents_case ON public.case_documents (case_id);
ALTER TABLE public.case_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.case_documents FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_documents TO authenticated;
GRANT ALL ON public.case_documents TO service_role;
DROP POLICY IF EXISTS case_documents_select ON public.case_documents;
DROP POLICY IF EXISTS case_documents_insert ON public.case_documents;
DROP POLICY IF EXISTS case_documents_update ON public.case_documents;
DROP POLICY IF EXISTS case_documents_delete ON public.case_documents;
CREATE POLICY case_documents_select ON public.case_documents FOR SELECT TO authenticated USING (public.app_rank() >= 1);
CREATE POLICY case_documents_insert ON public.case_documents FOR INSERT TO authenticated WITH CHECK (public.app_rank() >= 1);
CREATE POLICY case_documents_update ON public.case_documents FOR UPDATE TO authenticated USING (public.app_rank() >= 1) WITH CHECK (public.app_rank() >= 1);
CREATE POLICY case_documents_delete ON public.case_documents FOR DELETE TO authenticated USING (public.app_rank() >= 1);

CREATE OR REPLACE FUNCTION public.case_documents_stamp() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.received AND (TG_OP = 'INSERT' OR NOT OLD.received) AND NEW.received_on IS NULL THEN NEW.received_on := public.lb_today(); END IF;
  IF NOT NEW.received THEN NEW.received_on := NULL; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS case_documents_stamp_trg ON public.case_documents;
CREATE TRIGGER case_documents_stamp_trg BEFORE INSERT OR UPDATE ON public.case_documents FOR EACH ROW EXECUTE FUNCTION public.case_documents_stamp();

-- Suggested checklist per service. These are only a starting point: edit the list on each case to match what the office actually asks for.
CREATE OR REPLACE FUNCTION public.default_case_documents(p_service text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_service
    WHEN 'new_registration' THEN ARRAY['Owner CNIC copy', 'Invoice / sale letter', 'Import or customs papers (if imported)', 'Application form signed by owner']
    WHEN 'transfer'         THEN ARRAY['Seller CNIC copy', 'Buyer CNIC copy', 'Registration book (original)', 'Transfer form signed by seller and buyer', 'Token tax clearance']
    WHEN 'token_tax'        THEN ARRAY['Registration book copy', 'Previous token receipt']
    WHEN 'number_plate'     THEN ARRAY['Registration book copy', 'Owner CNIC copy', 'Old plate (if replacing)']
    WHEN 'duplicate_docs'   THEN ARRAY['Owner CNIC copy', 'Application / affidavit', 'Police report (if lost)']
    ELSE ARRAY[]::text[]
  END
$$;
GRANT EXECUTE ON FUNCTION public.default_case_documents(text) TO authenticated;

-- 5) quotation -> case, one action ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_case_from_quotation(p_quotation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  q public.quotations%ROWTYPE;
  ex public.cases%ROWTYPE;
  v_service text; v_assignee uuid; v_id uuid; v_no text; v_try int := 0; d text; i int := 0;
BEGIN
  IF public.app_rank() < 1 THEN RAISE EXCEPTION 'Your account is not active.'; END IF;
  SELECT * INTO q FROM public.quotations WHERE id = p_quotation_id FOR UPDATE;    -- the lock makes a double click / two people safe
  IF NOT FOUND THEN RAISE EXCEPTION 'Quotation not found.'; END IF;

  SELECT * INTO ex FROM public.cases WHERE quotation_id = q.id AND status <> 'cancelled' ORDER BY created_at LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('case_id', ex.id, 'case_no', ex.case_no, 'already_existed', true); END IF;

  IF q.status <> 'approved' THEN RAISE EXCEPTION 'Only an approved quotation can create a case (this one is "%").', q.status; END IF;
  IF q.client_id IS NULL THEN RAISE EXCEPTION 'This quotation has no client. Link a client first.'; END IF;

  v_service := CASE WHEN q.transaction_type IN ('new_registration', 'transfer', 'token_tax') THEN q.transaction_type ELSE 'other' END;
  SELECT c.assigned_to INTO v_assignee FROM public.clients c WHERE c.id = q.client_id;
  v_assignee := coalesce(v_assignee, auth.uid());

  LOOP
    v_try := v_try + 1;
    v_no := 'CS-' || to_char(public.lb_today(), 'YYYYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 4));
    BEGIN
      INSERT INTO public.cases (case_no, client_id, vehicle_id, quotation_id, service_type, status, stage, govt_fee, service_charge, assigned_to, opened_on)
      VALUES (v_no, q.client_id, q.vehicle_id, q.id, v_service, 'pending', 'new', q.subtotal_govt, coalesce(q.subtotal_service, 0) + coalesce(q.subtotal_additional, 0), v_assignee, public.lb_today())
      RETURNING id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_try >= 8 THEN RAISE EXCEPTION 'Could not create a unique case number. Please try again.'; END IF;
    END;
  END LOOP;

  FOREACH d IN ARRAY public.default_case_documents(v_service) LOOP
    i := i + 1;
    INSERT INTO public.case_documents (case_id, label, sort_order) VALUES (v_id, d, i);
  END LOOP;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'case_created_from_quotation', 'case', v_id, jsonb_build_object('case_no', v_no, 'quotation_number', q.quotation_number, 'client_id', q.client_id));
  RETURN jsonb_build_object('case_id', v_id, 'case_no', v_no, 'already_existed', false);
END $$;
REVOKE ALL ON FUNCTION public.create_case_from_quotation(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.create_case_from_quotation(uuid) TO authenticated;

-- 6) changes with a note ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_quotation_status(p_id uuid, p_status text, p_note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF p_status NOT IN ('draft', 'pending', 'approved', 'rejected', 'completed') THEN RAISE EXCEPTION 'Unknown status.'; END IF;
  IF p_status = 'rejected' AND coalesce(btrim(p_note), '') = '' THEN RAISE EXCEPTION 'Please write why the quotation is rejected.'; END IF;
  PERFORM set_config('lb.change_note', coalesce(p_note, ''), true);
  UPDATE public.quotations SET status = p_status WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quotation not found.'; END IF;
  PERFORM set_config('lb.change_note', '', true);
END $$;

CREATE OR REPLACE FUNCTION public.set_case_stage(p_id uuid, p_stage text, p_note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM set_config('lb.change_note', coalesce(p_note, ''), true);
  UPDATE public.cases SET stage = p_stage WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Case not found.'; END IF;
  PERFORM set_config('lb.change_note', '', true);
END $$;

CREATE OR REPLACE FUNCTION public.set_case_status(p_id uuid, p_status text, p_note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF p_status NOT IN ('pending', 'active', 'completed', 'cancelled') THEN RAISE EXCEPTION 'Unknown status.'; END IF;
  IF p_status = 'cancelled' AND coalesce(btrim(p_note), '') = '' THEN RAISE EXCEPTION 'Please write why the case is cancelled.'; END IF;
  PERFORM set_config('lb.change_note', coalesce(p_note, ''), true);
  UPDATE public.cases SET status = p_status WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Case not found.'; END IF;
  PERFORM set_config('lb.change_note', '', true);
END $$;

REVOKE ALL ON FUNCTION public.set_quotation_status(uuid, text, text), public.set_case_stage(uuid, text, text), public.set_case_status(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_quotation_status(uuid, text, text), public.set_case_stage(uuid, text, text), public.set_case_status(uuid, text, text) TO authenticated;


-- ====================================================================
-- 20261119090000_m4_payments_ledger.sql
-- ====================================================================
-- M4: Payments, receipts and client ledger. Additive and safe to run more than once.
-- 1) Payments are never edited in amount/date/target and never silently deleted: a wrong payment is REVERSED (manager/owner, with a reason) and re-entered.
-- 2) An on-account payment can be ALLOCATED to a quotation. Allocation does not change the client balance (the money was already counted once
--    when it was received); it only shows which quotation it paid. The database refuses over-allocation (double counting).
-- 3) ledger_balance() and quotation_payment_summary give the same numbers the screens show, for reconciliation tests and reports.

-- helper: the account that pays for a client's bills (the parent when bill_to_parent is set)
CREATE OR REPLACE FUNCTION public.lb_payer(p_client uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN c.bill_to_parent AND c.parent_id IS NOT NULL THEN c.parent_id ELSE c.id END FROM public.clients c WHERE c.id = p_client
$$;

-- 1) reversal columns -------------------------------------------------------------------------------------------------------------
ALTER TABLE public.payments        ADD COLUMN IF NOT EXISTS reversed_at timestamptz, ADD COLUMN IF NOT EXISTS reversed_by uuid, ADD COLUMN IF NOT EXISTS reversal_reason text;
ALTER TABLE public.client_payments ADD COLUMN IF NOT EXISTS reversed_at timestamptz, ADD COLUMN IF NOT EXISTS reversed_by uuid, ADD COLUMN IF NOT EXISTS reversal_reason text;

CREATE OR REPLACE FUNCTION public.payments_money_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'payments' THEN
    IF NEW.quotation_id IS DISTINCT FROM OLD.quotation_id THEN RAISE EXCEPTION 'The amount, date and account of a payment cannot be edited. Reverse the payment and record it again.'; END IF;
  ELSE
    IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN RAISE EXCEPTION 'The amount, date and account of a payment cannot be edited. Reverse the payment and record it again.'; END IF;
  END IF;
  IF NEW.amount IS DISTINCT FROM OLD.amount OR NEW.payment_date IS DISTINCT FROM OLD.payment_date THEN
    RAISE EXCEPTION 'The amount, date and account of a payment cannot be edited. Reverse the payment and record it again.';
  END IF;
  IF (NEW.reversed_at IS DISTINCT FROM OLD.reversed_at OR NEW.reversed_by IS DISTINCT FROM OLD.reversed_by OR NEW.reversal_reason IS DISTINCT FROM OLD.reversal_reason)
     AND coalesce(current_setting('lb.reversing', true), '') <> '1' THEN
    RAISE EXCEPTION 'Use Reverse payment to cancel a payment.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS payments_money_guard_trg ON public.payments;
CREATE TRIGGER payments_money_guard_trg BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.payments_money_guard();
DROP TRIGGER IF EXISTS client_payments_money_guard_trg ON public.client_payments;
CREATE TRIGGER client_payments_money_guard_trg BEFORE UPDATE ON public.client_payments FOR EACH ROW EXECUTE FUNCTION public.payments_money_guard();

-- hard delete is owner-only; managers use reversal, which keeps the record
DROP POLICY IF EXISTS payments_delete ON public.payments;
CREATE POLICY payments_delete ON public.payments FOR DELETE TO authenticated USING (public.app_rank() >= 3);
DROP POLICY IF EXISTS client_payments_delete ON public.client_payments;
CREATE POLICY client_payments_delete ON public.client_payments FOR DELETE TO authenticated USING (public.app_rank() >= 3);

-- 2) allocations ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_payment_id uuid NOT NULL REFERENCES public.client_payments(id) ON DELETE RESTRICT,
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz, voided_by uuid, void_reason text
);
CREATE INDEX IF NOT EXISTS idx_alloc_payment ON public.payment_allocations (client_payment_id);
CREATE INDEX IF NOT EXISTS idx_alloc_quotation ON public.payment_allocations (quotation_id);
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.payment_allocations TO authenticated;
GRANT ALL ON public.payment_allocations TO service_role;
DROP POLICY IF EXISTS alloc_select ON public.payment_allocations;
CREATE POLICY alloc_select ON public.payment_allocations FOR SELECT TO authenticated USING (public.app_rank() >= 1);
-- no insert/update/delete policy: allocations change only through the functions below

CREATE OR REPLACE FUNCTION public.allocate_client_payment(p_payment uuid, p_quotation uuid, p_amount numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cp public.client_payments; q public.quotations; v_free numeric; v_out numeric; v_id uuid; v_amt numeric := round(coalesce(p_amount, 0), 2);
BEGIN
  IF auth.uid() IS NULL OR public.app_rank() < 1 THEN RAISE EXCEPTION 'Not allowed.'; END IF;
  IF v_amt <= 0 THEN RAISE EXCEPTION 'Enter an amount more than zero.'; END IF;
  SELECT * INTO cp FROM public.client_payments WHERE id = p_payment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
  IF cp.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'This payment was reversed and cannot be allocated.'; END IF;
  SELECT * INTO q FROM public.quotations WHERE id = p_quotation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quotation not found.'; END IF;
  IF q.status IN ('draft', 'rejected') THEN RAISE EXCEPTION 'A % quotation is not billed, so no payment can be allocated to it.', q.status; END IF;
  IF q.client_id IS NULL OR public.lb_payer(q.client_id) IS DISTINCT FROM cp.client_id THEN RAISE EXCEPTION 'This quotation is not billed to the account that made the payment.'; END IF;
  v_free := cp.amount - coalesce((SELECT sum(amount) FROM public.payment_allocations WHERE client_payment_id = cp.id AND voided_at IS NULL), 0);
  IF v_amt > v_free THEN RAISE EXCEPTION 'Only % of this payment is still unallocated.', v_free; END IF;
  v_out := q.grand_total
    - coalesce((SELECT sum(amount) FROM public.payments WHERE quotation_id = q.id AND reversed_at IS NULL), 0)
    - coalesce((SELECT sum(amount) FROM public.payment_allocations WHERE quotation_id = q.id AND voided_at IS NULL), 0);
  IF v_amt > v_out THEN RAISE EXCEPTION 'The quotation has only % outstanding. Allocating more would count the money twice.', greatest(v_out, 0); END IF;
  INSERT INTO public.payment_allocations (client_payment_id, quotation_id, amount) VALUES (cp.id, q.id, v_amt) RETURNING id INTO v_id;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'payment_allocated', 'quotation', q.id, jsonb_build_object('client_payment_id', cp.id, 'amount', v_amt, 'quotation_number', q.quotation_number));
  RETURN jsonb_build_object('allocation_id', v_id, 'unallocated_left', v_free - v_amt, 'outstanding_left', v_out - v_amt);
END $$;
REVOKE ALL ON FUNCTION public.allocate_client_payment(uuid, uuid, numeric) FROM public;
GRANT EXECUTE ON FUNCTION public.allocate_client_payment(uuid, uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.void_allocation(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.payment_allocations;
BEGIN
  IF auth.uid() IS NULL OR public.app_rank() < 2 THEN RAISE EXCEPTION 'Only a manager or the owner can undo an allocation.'; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'A reason is required.'; END IF;
  SELECT * INTO a FROM public.payment_allocations WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Allocation not found.'; END IF;
  IF a.voided_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.payment_allocations SET voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason) WHERE id = p_id;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'payment_allocation_voided', 'quotation', a.quotation_id, jsonb_build_object('allocation_id', a.id, 'amount', a.amount, 'reason', btrim(p_reason)));
END $$;
REVOKE ALL ON FUNCTION public.void_allocation(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.void_allocation(uuid, text) TO authenticated;

-- reversal: p_kind = 'quotation' (payments) or 'on_account' (client_payments)
CREATE OR REPLACE FUNCTION public.reverse_payment(p_kind text, p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_amount numeric; v_ref uuid; v_done timestamptz; v_why text := btrim(coalesce(p_reason, ''));
BEGIN
  IF auth.uid() IS NULL OR public.app_rank() < 2 THEN RAISE EXCEPTION 'Only a manager or the owner can reverse a payment.'; END IF;
  IF v_why = '' THEN RAISE EXCEPTION 'A reason is required to reverse a payment.'; END IF;
  PERFORM set_config('lb.reversing', '1', true);
  IF p_kind = 'quotation' THEN
    SELECT amount, quotation_id, reversed_at INTO v_amount, v_ref, v_done FROM public.payments WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
    IF v_done IS NOT NULL THEN RAISE EXCEPTION 'This payment is already reversed.'; END IF;
    UPDATE public.payments SET reversed_at = now(), reversed_by = auth.uid(), reversal_reason = v_why WHERE id = p_id;
  ELSIF p_kind = 'on_account' THEN
    SELECT amount, client_id, reversed_at INTO v_amount, v_ref, v_done FROM public.client_payments WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
    IF v_done IS NOT NULL THEN RAISE EXCEPTION 'This payment is already reversed.'; END IF;
    UPDATE public.payment_allocations SET voided_at = now(), voided_by = auth.uid(), void_reason = 'Payment reversed: ' || v_why WHERE client_payment_id = p_id AND voided_at IS NULL;
    UPDATE public.client_payments SET reversed_at = now(), reversed_by = auth.uid(), reversal_reason = v_why WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Unknown payment kind.';
  END IF;
  PERFORM set_config('lb.reversing', '', true);
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'payment_reversed', CASE WHEN p_kind = 'quotation' THEN 'quotation' ELSE 'client' END, v_ref, jsonb_build_object('payment_id', p_id, 'kind', p_kind, 'amount', v_amount, 'reason', v_why));
END $$;
REVOKE ALL ON FUNCTION public.reverse_payment(text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.reverse_payment(text, uuid, text) TO authenticated;

-- 3) numbers --------------------------------------------------------------------------------------------------------------------------
-- Billed = every quotation billed to this account except draft and rejected. Received = payments on those quotations (any status) + on-account
-- payments, never reversed ones. Pending = opening + billed - received (negative = advance). Same rules as src/lib/ledger.ts.
CREATE OR REPLACE FUNCTION public.ledger_balance(p_account uuid) RETURNS TABLE (opening numeric, billed numeric, received numeric, pending numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH o AS (SELECT coalesce(opening_balance, 0) AS v FROM public.clients WHERE id = p_account),
  qs AS (SELECT id, status, grand_total FROM public.quotations WHERE client_id IS NOT NULL AND public.lb_payer(client_id) = p_account),
  b AS (SELECT coalesce(sum(grand_total) FILTER (WHERE status NOT IN ('draft', 'rejected')), 0) AS v FROM qs),
  r AS (SELECT coalesce((SELECT sum(p.amount) FROM public.payments p JOIN qs ON qs.id = p.quotation_id WHERE p.reversed_at IS NULL), 0)
             + coalesce((SELECT sum(amount) FROM public.client_payments WHERE client_id = p_account AND reversed_at IS NULL), 0) AS v)
  SELECT o.v, b.v, r.v, o.v + b.v - r.v FROM o, b, r
$$;
GRANT EXECUTE ON FUNCTION public.ledger_balance(uuid) TO authenticated;

CREATE OR REPLACE VIEW public.quotation_payment_summary WITH (security_invoker = true) AS
SELECT q.id AS quotation_id, q.grand_total,
  coalesce((SELECT sum(p.amount) FROM public.payments p WHERE p.quotation_id = q.id AND p.reversed_at IS NULL), 0) AS paid_direct,
  coalesce((SELECT sum(a.amount) FROM public.payment_allocations a WHERE a.quotation_id = q.id AND a.voided_at IS NULL), 0) AS paid_allocated,
  coalesce((SELECT sum(p.amount) FROM public.payments p WHERE p.quotation_id = q.id AND p.reversed_at IS NULL), 0)
  + coalesce((SELECT sum(a.amount) FROM public.payment_allocations a WHERE a.quotation_id = q.id AND a.voided_at IS NULL), 0) AS paid,
  q.grand_total
  - coalesce((SELECT sum(p.amount) FROM public.payments p WHERE p.quotation_id = q.id AND p.reversed_at IS NULL), 0)
  - coalesce((SELECT sum(a.amount) FROM public.payment_allocations a WHERE a.quotation_id = q.id AND a.voided_at IS NULL), 0) AS outstanding
FROM public.quotations q;
GRANT SELECT ON public.quotation_payment_summary TO authenticated;


-- ====================================================================
-- 20261120090000_m5_reminders_notifications.sql
-- ====================================================================
-- M5: Reminders, in-app notifications and delivery log. Additive and safe to run more than once.
-- Reminders are separate from tasks (tasks = work to do; reminders = something that must alert a person at a time). A reminder may link to a task.
-- Only the IN-APP channel is live. email / whatsapp reminders can be created but are recorded as "failed: not enabled" and NOTHING external is ever sent
-- until provider, templates, consent and opt-out rules are approved (see docs/M5_provider_plan.md).
-- Notifications are created by process_due_reminders(), which is idempotent: one notification per (reminder, due time, person), enforced by a unique key.

CREATE TABLE IF NOT EXISTS public.reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  notes text,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  quotation_id uuid REFERENCES public.quotations(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  due_at timestamptz NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  channel text NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'email', 'whatsapp')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
  snoozed_until timestamptz,
  recurrence text NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly')),
  escalate_after_hours integer CHECK (escalate_after_hours IS NULL OR escalate_after_hours > 0),
  escalated_at timestamptz,
  completed_at timestamptz, completed_by uuid, cancel_reason text,
  parent_id uuid REFERENCES public.reminders(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reminders_owner_status ON public.reminders (owner_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON public.reminders (status, due_at);
CREATE INDEX IF NOT EXISTS idx_reminders_links ON public.reminders (client_id, case_id, quotation_id);

CREATE TABLE IF NOT EXISTS public.reminder_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id uuid NOT NULL REFERENCES public.reminders(id) ON DELETE CASCADE,
  event text NOT NULL,           -- created, due_notified, send_failed, snoozed, completed, cancelled, escalated, recurred, reassigned, retried
  detail text,
  actor uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reminder_events ON public.reminder_events (reminder_id, created_at);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reminder_id uuid REFERENCES public.reminders(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('due', 'escalated', 'assigned')),
  title text NOT NULL, body text,
  channel text NOT NULL DEFAULT 'in_app',
  delivery_status text NOT NULL DEFAULT 'delivered' CHECK (delivery_status IN ('delivered', 'failed')),
  failure_reason text,
  attempts integer NOT NULL DEFAULT 1,
  idempotency_key text NOT NULL UNIQUE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications (user_id, read_at, created_at DESC);

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminders TO authenticated;
GRANT SELECT ON public.reminder_events, public.notifications TO authenticated;
GRANT ALL ON public.reminders, public.reminder_events, public.notifications TO service_role;

DROP POLICY IF EXISTS reminders_select ON public.reminders;
CREATE POLICY reminders_select ON public.reminders FOR SELECT TO authenticated USING (public.app_rank() >= 1);
DROP POLICY IF EXISTS reminders_insert ON public.reminders;
CREATE POLICY reminders_insert ON public.reminders FOR INSERT TO authenticated WITH CHECK (public.app_rank() >= 1 AND created_by = auth.uid());
DROP POLICY IF EXISTS reminders_update ON public.reminders;
CREATE POLICY reminders_update ON public.reminders FOR UPDATE TO authenticated
  USING (public.app_rank() >= 2 OR owner_id = auth.uid() OR created_by = auth.uid()) WITH CHECK (public.app_rank() >= 1);
DROP POLICY IF EXISTS reminders_delete ON public.reminders;
CREATE POLICY reminders_delete ON public.reminders FOR DELETE TO authenticated USING (public.app_rank() >= 3);   -- others cancel; history is kept
DROP POLICY IF EXISTS reminder_events_select ON public.reminder_events;
CREATE POLICY reminder_events_select ON public.reminder_events FOR SELECT TO authenticated USING (public.app_rank() >= 1);
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.app_rank() >= 2);

-- guard: state fields change only through the functions below; log creation and reassignment ---------------------------------------
CREATE OR REPLACE FUNCTION public.reminders_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'open'; NEW.snoozed_until := NULL; NEW.escalated_at := NULL; NEW.completed_at := NULL; NEW.completed_by := NULL; NEW.cancel_reason := NULL;
    RETURN NEW;
  END IF;
  IF coalesce(current_setting('lb.rem', true), '') <> '1' AND (
       NEW.status IS DISTINCT FROM OLD.status OR NEW.snoozed_until IS DISTINCT FROM OLD.snoozed_until OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
       OR NEW.completed_by IS DISTINCT FROM OLD.completed_by OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason OR NEW.escalated_at IS DISTINCT FROM OLD.escalated_at
       OR NEW.created_by IS DISTINCT FROM OLD.created_by) THEN
    RAISE EXCEPTION 'Use Complete, Snooze or Cancel to change a reminder.';
  END IF;
  IF OLD.status <> 'open' AND coalesce(current_setting('lb.rem', true), '') <> '1' THEN RAISE EXCEPTION 'A completed or cancelled reminder is kept as history and cannot be edited.'; END IF;
  -- a new due time starts a fresh cycle
  IF NEW.due_at IS DISTINCT FROM OLD.due_at AND coalesce(current_setting('lb.rem', true), '') <> '1' THEN NEW.snoozed_until := NULL; NEW.escalated_at := NULL; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reminders_guard_trg ON public.reminders;
CREATE TRIGGER reminders_guard_trg BEFORE INSERT OR UPDATE ON public.reminders FOR EACH ROW EXECUTE FUNCTION public.reminders_guard();

CREATE OR REPLACE FUNCTION public.reminders_after() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.reminder_events (reminder_id, event, detail, actor) VALUES (NEW.id, 'created', CASE WHEN NEW.parent_id IS NOT NULL THEN 'Repeat of an earlier reminder' END, NEW.created_by);
    IF NEW.owner_id <> NEW.created_by THEN
      INSERT INTO public.notifications (user_id, reminder_id, kind, title, body, idempotency_key)
      VALUES (NEW.owner_id, NEW.id, 'assigned', 'Reminder assigned to you: ' || NEW.title, NEW.notes, 'asg:' || NEW.id || ':' || NEW.owner_id) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  ELSIF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    INSERT INTO public.reminder_events (reminder_id, event, detail, actor) VALUES (NEW.id, 'reassigned', (SELECT full_name FROM public.profiles WHERE id = NEW.owner_id), auth.uid());
    INSERT INTO public.notifications (user_id, reminder_id, kind, title, body, idempotency_key)
    VALUES (NEW.owner_id, NEW.id, 'assigned', 'Reminder assigned to you: ' || NEW.title, NEW.notes, 'asg:' || NEW.id || ':' || NEW.owner_id) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reminders_after_trg ON public.reminders;
CREATE TRIGGER reminders_after_trg AFTER INSERT OR UPDATE OF owner_id ON public.reminders FOR EACH ROW EXECUTE FUNCTION public.reminders_after();

-- actions -----------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lb_can_act_on_reminder(r public.reminders) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.app_rank() >= 2 OR (public.app_rank() >= 1 AND (r.owner_id = auth.uid() OR r.created_by = auth.uid()))
$$;

CREATE OR REPLACE FUNCTION public.snooze_reminder(p_id uuid, p_until timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.reminders;
BEGIN
  SELECT * INTO r FROM public.reminders WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reminder not found.'; END IF;
  IF NOT public.lb_can_act_on_reminder(r) THEN RAISE EXCEPTION 'You cannot change this reminder.'; END IF;
  IF r.status <> 'open' THEN RAISE EXCEPTION 'Only an open reminder can be snoozed.'; END IF;
  IF p_until IS NULL OR p_until <= now() THEN RAISE EXCEPTION 'Choose a time in the future.'; END IF;
  PERFORM set_config('lb.rem', '1', true);
  UPDATE public.reminders SET snoozed_until = p_until, escalated_at = NULL WHERE id = p_id;
  PERFORM set_config('lb.rem', '', true);
  INSERT INTO public.reminder_events (reminder_id, event, detail, actor) VALUES (p_id, 'snoozed', to_char(p_until AT TIME ZONE 'Asia/Karachi', 'DD Mon YYYY HH24:MI'), auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.complete_reminder(p_id uuid, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.reminders; v_next timestamptz; v_new uuid; v_step interval;
BEGIN
  SELECT * INTO r FROM public.reminders WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reminder not found.'; END IF;
  IF NOT public.lb_can_act_on_reminder(r) THEN RAISE EXCEPTION 'You cannot change this reminder.'; END IF;
  IF r.status <> 'open' THEN RAISE EXCEPTION 'This reminder is already %.', r.status; END IF;
  PERFORM set_config('lb.rem', '1', true);
  UPDATE public.reminders SET status = 'completed', completed_at = now(), completed_by = auth.uid() WHERE id = p_id;
  INSERT INTO public.reminder_events (reminder_id, event, detail, actor) VALUES (p_id, 'completed', nullif(btrim(coalesce(p_note, '')), ''), auth.uid());
  IF r.recurrence <> 'none' THEN
    v_step := CASE r.recurrence WHEN 'daily' THEN interval '1 day' WHEN 'weekly' THEN interval '7 days' ELSE interval '1 month' END;
    v_next := r.due_at + v_step;
    WHILE v_next <= now() LOOP v_next := v_next + v_step; END LOOP;
    INSERT INTO public.reminders (title, notes, client_id, case_id, quotation_id, task_id, owner_id, created_by, due_at, priority, channel, recurrence, escalate_after_hours, parent_id)
    VALUES (r.title, r.notes, r.client_id, r.case_id, r.quotation_id, r.task_id, r.owner_id, r.created_by, v_next, r.priority, r.channel, r.recurrence, r.escalate_after_hours, r.id) RETURNING id INTO v_new;
    INSERT INTO public.reminder_events (reminder_id, event, detail, actor) VALUES (p_id, 'recurred', 'Next: ' || to_char(v_next AT TIME ZONE 'Asia/Karachi', 'DD Mon YYYY HH24:MI'), auth.uid());
  END IF;
  PERFORM set_config('lb.rem', '', true);
  RETURN jsonb_build_object('next_id', v_new);
END $$;

CREATE OR REPLACE FUNCTION public.cancel_reminder(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.reminders;
BEGIN
  SELECT * INTO r FROM public.reminders WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reminder not found.'; END IF;
  IF NOT public.lb_can_act_on_reminder(r) THEN RAISE EXCEPTION 'You cannot change this reminder.'; END IF;
  IF r.status <> 'open' THEN RAISE EXCEPTION 'This reminder is already %.', r.status; END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'A reason is required to cancel a reminder.'; END IF;
  PERFORM set_config('lb.rem', '1', true);
  UPDATE public.reminders SET status = 'cancelled', cancel_reason = btrim(p_reason) WHERE id = p_id;
  PERFORM set_config('lb.rem', '', true);
  INSERT INTO public.reminder_events (reminder_id, event, detail, actor) VALUES (p_id, 'cancelled', btrim(p_reason), auth.uid());
END $$;

-- the worker: safe to call as often as you like (every minute from the app; optionally pg_cron too) ------------------------------------
CREATE OR REPLACE FUNCTION public.process_due_reminders() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.reminders; v_eff timestamptz; v_n integer := 0; v_rows integer; m record; v_ok boolean; v_reason text;
BEGIN
  IF auth.uid() IS NOT NULL AND public.app_rank() < 1 THEN RAISE EXCEPTION 'Not allowed.'; END IF;
  FOR r IN SELECT * FROM public.reminders WHERE status = 'open' AND coalesce(snoozed_until, due_at) <= now() ORDER BY due_at LIMIT 500 FOR UPDATE SKIP LOCKED LOOP
    v_eff := coalesce(r.snoozed_until, r.due_at);
    v_ok := r.channel = 'in_app';
    v_reason := CASE WHEN v_ok THEN NULL ELSE 'The ' || r.channel || ' channel is not enabled yet: provider, message template and client consent are not approved. Nothing was sent.' END;
    INSERT INTO public.notifications (user_id, reminder_id, kind, title, body, channel, delivery_status, failure_reason, idempotency_key)
    VALUES (r.owner_id, r.id, 'due', 'Due: ' || r.title, r.notes, r.channel, CASE WHEN v_ok THEN 'delivered' ELSE 'failed' END, v_reason, 'due:' || r.id || ':' || extract(epoch FROM v_eff)::bigint || ':' || r.owner_id)
    ON CONFLICT (idempotency_key) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 1 THEN
      v_n := v_n + 1;
      INSERT INTO public.reminder_events (reminder_id, event, detail) VALUES (r.id, CASE WHEN v_ok THEN 'due_notified' ELSE 'send_failed' END, v_reason);
    END IF;
    -- escalation: still open this many hours after it was due -> tell every manager / the owner of the business, once
    IF r.escalate_after_hours IS NOT NULL AND r.escalated_at IS NULL AND v_eff + make_interval(hours => r.escalate_after_hours) <= now() THEN
      FOR m IN SELECT id FROM public.profiles WHERE active AND role IN ('manager', 'admin') AND id <> r.owner_id LOOP
        INSERT INTO public.notifications (user_id, reminder_id, kind, title, body, idempotency_key)
        VALUES (m.id, r.id, 'escalated', 'Overdue: ' || r.title, 'Not done ' || r.escalate_after_hours || ' hours after it was due. Assigned to ' || coalesce((SELECT full_name FROM public.profiles WHERE id = r.owner_id), 'someone'), 'esc:' || r.id || ':' || extract(epoch FROM v_eff)::bigint || ':' || m.id)
        ON CONFLICT (idempotency_key) DO NOTHING;
      END LOOP;
      PERFORM set_config('lb.rem', '1', true);
      UPDATE public.reminders SET escalated_at = now() WHERE id = r.id;
      PERFORM set_config('lb.rem', '', true);
      INSERT INTO public.reminder_events (reminder_id, event, detail) VALUES (r.id, 'escalated', 'After ' || r.escalate_after_hours || ' hours');
    END IF;
  END LOOP;
  RETURN v_n;
END $$;

-- safe retry of a failed delivery: never creates a second notification, only records another attempt
CREATE OR REPLACE FUNCTION public.retry_notification(p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n public.notifications;
BEGIN
  SELECT * INTO n FROM public.notifications WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR (n.user_id <> auth.uid() AND public.app_rank() < 2) THEN RAISE EXCEPTION 'Notification not found.'; END IF;
  IF n.delivery_status <> 'failed' THEN RETURN 'Already delivered.'; END IF;
  IF n.channel = 'in_app' THEN
    UPDATE public.notifications SET delivery_status = 'delivered', failure_reason = NULL, attempts = attempts + 1 WHERE id = p_id;
    RETURN 'Delivered.';
  END IF;
  UPDATE public.notifications SET attempts = attempts + 1, failure_reason = 'No sending provider is connected yet. Nothing was sent; it will be possible after the owner approves the provider, templates and consent rules.' WHERE id = p_id;
  IF n.reminder_id IS NOT NULL THEN INSERT INTO public.reminder_events (reminder_id, event, detail, actor) VALUES (n.reminder_id, 'retried', 'Still not sent: channel not enabled', auth.uid()); END IF;
  RETURN 'Still not sent: the ' || n.channel || ' channel is not enabled.';
END $$;

CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_ids uuid[] DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not allowed.'; END IF;
  UPDATE public.notifications SET read_at = now() WHERE user_id = auth.uid() AND read_at IS NULL AND (p_ids IS NULL OR id = ANY (p_ids));
  GET DIAGNOSTICS c = ROW_COUNT; RETURN c;
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['public.snooze_reminder(uuid,timestamptz)', 'public.complete_reminder(uuid,text)', 'public.cancel_reminder(uuid,text)', 'public.process_due_reminders()', 'public.retry_notification(uuid)', 'public.mark_notifications_read(uuid[])'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  REVOKE ALL ON FUNCTION public.lb_can_act_on_reminder(public.reminders) FROM public;
  GRANT EXECUTE ON FUNCTION public.lb_can_act_on_reminder(public.reminders) TO authenticated;
END $$;
-- Optional scheduler on the server (Supabase: enable the pg_cron extension, then run once):
--   select cron.schedule('lb-reminders', '* * * * *', $$select public.process_due_reminders()$$);
-- Without it the app runs the worker every minute while anyone has it open.


-- ====================================================================
-- 20261121090000_m6_dashboard_reports.sql
-- ====================================================================
-- M6: Dashboard & reports computed in the database (full aggregates, no 100/1000-row subsets).
-- * Every date range is in Pakistan time (Asia/Karachi): a record belongs to the day it happened in Pakistan.
-- * kpi_ids(kind, from, to) is the ONE definition of each KPI: the dashboard count is the number of ids it returns, and clicking a KPI opens exactly those records.
-- * Finance figures come from the same rules as the client ledger (billed = every quotation with a client except draft/rejected; received = payments and
--   on-account payments that are not reversed). Staff get work KPIs for their own assigned work only and no finance.
-- All functions are SECURITY INVOKER: row-level security still applies on top.

CREATE OR REPLACE FUNCTION public.lb_pk_date(p timestamptz) RETURNS date LANGUAGE sql STABLE AS $$ SELECT (p AT TIME ZONE 'Asia/Karachi')::date $$;

-- one row per paying account: opening, billed, received, pending, the unpaid part split by age (0-30, 31-60, 61-90, 90+ days; oldest bills are paid first),
-- overdue (= everything older than 30 days) and any advance held
DROP FUNCTION IF EXISTS public.account_balances();
CREATE OR REPLACE FUNCTION public.account_balances() RETURNS TABLE (account_id uuid, name text, opening numeric, billed numeric, received numeric, pending numeric, overdue numeric, b0 numeric, b31 numeric, b61 numeric, b90 numeric, advance numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH acc AS (SELECT c.id, c.name, coalesce(c.opening_balance, 0) AS opening FROM public.clients c WHERE public.lb_payer(c.id) = c.id),
  bills AS (SELECT public.lb_payer(q.client_id) AS acc, q.id AS bid, q.grand_total AS amt, public.lb_pk_date(q.created_at) AS d
            FROM public.quotations q WHERE q.client_id IS NOT NULL AND q.status NOT IN ('draft', 'rejected')),
  rec AS (SELECT z.acc, sum(z.x) AS r FROM (
            SELECT public.lb_payer(q.client_id) AS acc, p.amount AS x FROM public.payments p JOIN public.quotations q ON q.id = p.quotation_id WHERE p.reversed_at IS NULL AND q.client_id IS NOT NULL
            UNION ALL SELECT cp.client_id, cp.amount FROM public.client_payments cp WHERE cp.reversed_at IS NULL) z GROUP BY z.acc),
  base AS (SELECT a.id, a.name, a.opening, coalesce((SELECT sum(amt) FROM bills b WHERE b.acc = a.id), 0) AS billed, coalesce((SELECT r FROM rec WHERE rec.acc = a.id), 0) AS received FROM acc a),
  items AS (  -- every bill, plus the opening balance as the oldest bill
    SELECT a.id AS acc, NULL::uuid AS bid, date '0001-01-01' AS d, a.opening AS amt FROM acc a WHERE a.opening > 0
    UNION ALL SELECT b.acc, b.bid, b.d, b.amt FROM bills b),
  fifo AS (SELECT i.acc, i.d, i.amt, coalesce(sum(i.amt) OVER (PARTITION BY i.acc ORDER BY i.d, i.bid ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before FROM items i),
  unpaid AS (SELECT f.acc, public.lb_today() - f.d AS age, greatest(0, least(f.amt, f.before + f.amt - (bs.received + greatest(-bs.opening, 0)))) AS u FROM fifo f JOIN base bs ON bs.id = f.acc),
  od AS (SELECT acc, sum(u) FILTER (WHERE age <= 30) AS b0, sum(u) FILTER (WHERE age BETWEEN 31 AND 60) AS b31, sum(u) FILTER (WHERE age BETWEEN 61 AND 90) AS b61, sum(u) FILTER (WHERE age > 90) AS b90 FROM unpaid GROUP BY acc)
  SELECT bs.id, bs.name, bs.opening, bs.billed, bs.received, bs.opening + bs.billed - bs.received,
         coalesce(od.b31, 0) + coalesce(od.b61, 0) + coalesce(od.b90, 0), coalesce(od.b0, 0), coalesce(od.b31, 0), coalesce(od.b61, 0), coalesce(od.b90, 0),
         greatest(0, bs.received + greatest(-bs.opening, 0) - (greatest(bs.opening, 0) + bs.billed))
  FROM base bs LEFT JOIN od ON od.acc = bs.id WHERE public.app_rank() >= 2
$$;
GRANT EXECUTE ON FUNCTION public.account_balances() TO authenticated;

-- the single definition of each KPI: the records it counts -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kpi_ids(p_kind text, p_from date, p_to date) RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_rank int := public.app_rank(); v_me uuid := auth.uid(); v_open text[] := ARRAY['pending', 'active']; v_status text;
BEGIN
  IF v_rank < 1 THEN RETURN; END IF;
  IF p_kind = 'clients_total' THEN RETURN QUERY SELECT id FROM public.clients WHERE archived_at IS NULL AND (v_rank >= 2 OR assigned_to = v_me);
  ELSIF p_kind = 'clients_new' THEN RETURN QUERY SELECT id FROM public.clients WHERE archived_at IS NULL AND public.lb_pk_date(created_at) BETWEEN p_from AND p_to AND (v_rank >= 2 OR assigned_to = v_me);
  ELSIF p_kind = 'vehicles_total' THEN RETURN QUERY SELECT v.id FROM public.vehicles v WHERE v_rank >= 2 OR v.client_id IN (SELECT id FROM public.clients WHERE assigned_to = v_me);
  ELSIF p_kind = 'cases_active' THEN RETURN QUERY SELECT id FROM public.cases WHERE status = ANY (v_open) AND (v_rank >= 2 OR assigned_to = v_me);
  ELSIF p_kind = 'cases_completed' THEN RETURN QUERY SELECT id FROM public.cases WHERE status = 'completed' AND closed_on BETWEEN p_from AND p_to AND (v_rank >= 2 OR assigned_to = v_me);
  ELSIF p_kind = 'cases_stale' THEN RETURN QUERY SELECT id FROM public.cases WHERE status = ANY (v_open) AND updated_at < now() - interval '7 days' AND (v_rank >= 2 OR assigned_to = v_me);
  ELSIF p_kind = 'cases_unassigned' THEN RETURN QUERY SELECT id FROM public.cases WHERE status = ANY (v_open) AND assigned_to IS NULL AND v_rank >= 2;
  ELSIF p_kind = 'cases_missing_docs' THEN RETURN QUERY SELECT c.id FROM public.cases c WHERE c.status = ANY (v_open) AND (v_rank >= 2 OR c.assigned_to = v_me)
      AND EXISTS (SELECT 1 FROM public.case_documents d WHERE d.case_id = c.id AND d.required AND NOT d.received);
  ELSIF p_kind LIKE 'q\_%' THEN
    v_status := substr(p_kind, 3);
    IF v_status NOT IN ('draft', 'pending', 'approved', 'rejected', 'completed') THEN RAISE EXCEPTION 'Unknown KPI %', p_kind; END IF;
    RETURN QUERY SELECT id FROM public.quotations WHERE status = v_status AND public.lb_pk_date(created_at) BETWEEN p_from AND p_to AND (v_rank >= 2 OR created_by = v_me);
  ELSIF p_kind = 'reminders_overdue' THEN RETURN QUERY SELECT id FROM public.reminders WHERE status = 'open' AND coalesce(snoozed_until, due_at) < now() AND (v_rank >= 2 OR owner_id = v_me);
  ELSIF p_kind = 'accounts_due' THEN RETURN QUERY SELECT account_id FROM public.account_balances() WHERE overdue > 0.004;   -- manager/owner only (empty for staff)
  ELSE RAISE EXCEPTION 'Unknown KPI %', p_kind;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.kpi_ids(text, date, date) TO authenticated;

-- finance summary for a date range (manager/owner) --------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finance_summary(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE r jsonb; v_open numeric; v_billed record; v_coll numeric; v_net_open numeric; v_net_close numeric; v_out numeric; v_adv numeric; v_net_now numeric; v_unlinked record; v_methods jsonb;
BEGIN
  IF public.app_rank() < 2 THEN RAISE EXCEPTION 'Finance figures are for managers and the owner.'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'Choose a valid date range.'; END IF;
  SELECT coalesce(sum(coalesce(opening_balance, 0)), 0) INTO v_open FROM public.clients WHERE public.lb_payer(id) = id;
  SELECT coalesce(sum(grand_total), 0) AS total, coalesce(sum(subtotal_govt), 0) AS govt, coalesce(sum(subtotal_service), 0) AS service, coalesce(sum(subtotal_additional), 0) AS additional, count(*) AS n INTO v_billed
    FROM public.quotations WHERE client_id IS NOT NULL AND status NOT IN ('draft', 'rejected') AND public.lb_pk_date(created_at) BETWEEN p_from AND p_to;
  SELECT coalesce(sum(grand_total), 0) AS total, count(*) AS n INTO v_unlinked FROM public.quotations WHERE client_id IS NULL AND status NOT IN ('draft', 'rejected') AND public.lb_pk_date(created_at) BETWEEN p_from AND p_to;
  WITH rec AS (
    SELECT coalesce(p.payment_method, 'other') AS m, p.amount, p.payment_date AS d FROM public.payments p JOIN public.quotations q ON q.id = p.quotation_id WHERE p.reversed_at IS NULL AND q.client_id IS NOT NULL
    UNION ALL SELECT coalesce(cp.payment_method, 'other'), cp.amount, cp.payment_date FROM public.client_payments cp WHERE cp.reversed_at IS NULL)
  SELECT coalesce(sum(amount), 0), coalesce(jsonb_object_agg(m, s), '{}'::jsonb) INTO v_coll, v_methods FROM (SELECT m, sum(amount) AS amount, sum(amount) AS s FROM rec WHERE d BETWEEN p_from AND p_to GROUP BY m) z;
  -- net money owed to us across all paying accounts, as of the end of a day
  SELECT v_open + coalesce((SELECT sum(grand_total) FROM public.quotations WHERE client_id IS NOT NULL AND status NOT IN ('draft', 'rejected') AND public.lb_pk_date(created_at) <= p_from - 1), 0)
    - coalesce((SELECT sum(p.amount) FROM public.payments p JOIN public.quotations q ON q.id = p.quotation_id WHERE p.reversed_at IS NULL AND q.client_id IS NOT NULL AND p.payment_date <= p_from - 1), 0)
    - coalesce((SELECT sum(amount) FROM public.client_payments WHERE reversed_at IS NULL AND payment_date <= p_from - 1), 0) INTO v_net_open;
  SELECT v_open + coalesce((SELECT sum(grand_total) FROM public.quotations WHERE client_id IS NOT NULL AND status NOT IN ('draft', 'rejected') AND public.lb_pk_date(created_at) <= p_to), 0)
    - coalesce((SELECT sum(p.amount) FROM public.payments p JOIN public.quotations q ON q.id = p.quotation_id WHERE p.reversed_at IS NULL AND q.client_id IS NOT NULL AND p.payment_date <= p_to), 0)
    - coalesce((SELECT sum(amount) FROM public.client_payments WHERE reversed_at IS NULL AND payment_date <= p_to), 0) INTO v_net_close;
  SELECT coalesce(sum(pending) FILTER (WHERE pending > 0), 0), coalesce(-sum(pending) FILTER (WHERE pending < 0), 0), coalesce(sum(pending), 0) INTO v_out, v_adv, v_net_now FROM public.account_balances();
  RETURN jsonb_build_object(
    'from', p_from, 'to', p_to,
    'billed', v_billed.total, 'billed_govt', v_billed.govt, 'billed_service', v_billed.service, 'billed_additional', v_billed.additional, 'billed_count', v_billed.n,
    'billed_without_client', v_unlinked.total, 'billed_without_client_count', v_unlinked.n,
    'collected', v_coll, 'collected_by_method', v_methods,
    'net_opening', v_net_open, 'net_closing', v_net_close,
    'reconciles', round(v_net_open + v_billed.total - v_coll - v_net_close, 2) = 0,
    'outstanding_now', v_out, 'advances_now', v_adv, 'net_now', v_net_now,
    'matches_ledger_now', CASE WHEN p_to >= public.lb_today() THEN round(v_net_close - v_net_now, 2) = 0 ELSE NULL END);
END $$;
GRANT EXECUTE ON FUNCTION public.finance_summary(date, date) TO authenticated;

-- the dashboard in one call -------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_kpis(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE k text; n bigint; r jsonb := '{}'::jsonb;
BEGIN
  IF public.app_rank() < 1 THEN RAISE EXCEPTION 'Not allowed.'; END IF;
  FOREACH k IN ARRAY ARRAY['clients_total', 'clients_new', 'vehicles_total', 'cases_active', 'cases_completed', 'cases_stale', 'cases_unassigned', 'cases_missing_docs',
                           'q_draft', 'q_pending', 'q_approved', 'q_rejected', 'q_completed', 'reminders_overdue', 'accounts_due'] LOOP
    SELECT count(*) INTO n FROM public.kpi_ids(k, p_from, p_to);
    r := r || jsonb_build_object(k, n);
  END LOOP;
  RETURN jsonb_build_object('counts', r, 'scope', CASE WHEN public.app_rank() >= 2 THEN 'all' ELSE 'mine' END,
    'finance', CASE WHEN public.app_rank() >= 2 THEN public.finance_summary(p_from, p_to) ELSE NULL END);
END $$;
GRANT EXECUTE ON FUNCTION public.dashboard_kpis(date, date) TO authenticated;

-- reports -------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_summary(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF public.app_rank() < 2 THEN RAISE EXCEPTION 'Reports are for managers and the owner.'; END IF;
  RETURN jsonb_build_object(
    'quotations_by_status', coalesce((SELECT jsonb_agg(jsonb_build_object('status', status, 'count', n, 'total', t, 'govt', g, 'service', s) ORDER BY status) FROM
       (SELECT status, count(*) n, sum(grand_total) t, sum(subtotal_govt) g, sum(subtotal_service + subtotal_additional) s FROM public.quotations WHERE public.lb_pk_date(created_at) BETWEEN p_from AND p_to GROUP BY status) x), '[]'::jsonb),
    'cases_opened', (SELECT count(*) FROM public.cases WHERE opened_on BETWEEN p_from AND p_to),
    'cases_by_status', coalesce((SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM public.cases WHERE opened_on BETWEEN p_from AND p_to GROUP BY status) x), '{}'::jsonb),
    'cases_by_stage', coalesce((SELECT jsonb_object_agg(stage, n) FROM (SELECT coalesce(stage, 'new') AS stage, count(*) n FROM public.cases WHERE opened_on BETWEEN p_from AND p_to GROUP BY 1) x), '{}'::jsonb),
    'cases_govt_fee', (SELECT coalesce(sum(govt_fee), 0) FROM public.cases WHERE opened_on BETWEEN p_from AND p_to),
    'cases_service_charge', (SELECT coalesce(sum(service_charge), 0) FROM public.cases WHERE opened_on BETWEEN p_from AND p_to),
    'finance', public.finance_summary(p_from, p_to));
END $$;
GRANT EXECUTE ON FUNCTION public.report_summary(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_workload(p_from date, p_to date) RETURNS TABLE (user_id uuid, full_name text, role text, open_cases bigint, overdue_cases bigint, completed_cases bigint, open_reminders bigint, overdue_reminders bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.id, p.full_name, p.role,
    (SELECT count(*) FROM public.cases c WHERE c.assigned_to = p.id AND c.status IN ('pending', 'active')),
    (SELECT count(*) FROM public.cases c WHERE c.assigned_to = p.id AND c.status IN ('pending', 'active') AND c.due_date < public.lb_today()),
    (SELECT count(*) FROM public.cases c WHERE c.assigned_to = p.id AND c.status = 'completed' AND c.closed_on BETWEEN p_from AND p_to),
    (SELECT count(*) FROM public.reminders r WHERE r.owner_id = p.id AND r.status = 'open'),
    (SELECT count(*) FROM public.reminders r WHERE r.owner_id = p.id AND r.status = 'open' AND coalesce(r.snoozed_until, r.due_at) < now())
  FROM public.profiles p WHERE p.active AND public.app_rank() >= 2 ORDER BY p.full_name
$$;
GRANT EXECUTE ON FUNCTION public.staff_workload(date, date) TO authenticated;


-- ====================================================================
-- 20261122090000_m8_performance.sql
-- ====================================================================
-- M8: speed. account_balances() summed bills/payments with a correlated sub-select per account (accounts x rows). With ~6,000 accounts and ~30,000 quotations it ran for minutes;
-- the same figures are now produced with one GROUP BY + join each. Result columns and rules are IDENTICAL (tests M4/M6 unchanged and passing).
-- Idempotent: CREATE OR REPLACE. No data is changed.
CREATE OR REPLACE FUNCTION public.account_balances()
 RETURNS TABLE(account_id uuid, name text, opening numeric, billed numeric, received numeric, pending numeric, overdue numeric, b0 numeric, b31 numeric, b61 numeric, b90 numeric, advance numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH acc AS (SELECT c.id, c.name, coalesce(c.opening_balance, 0) AS opening FROM public.clients c WHERE NOT (c.bill_to_parent AND c.parent_id IS NOT NULL)),   -- = lb_payer(c.id) = c.id, inlined
  bills AS (SELECT CASE WHEN cl.bill_to_parent AND cl.parent_id IS NOT NULL THEN cl.parent_id ELSE cl.id END AS acc, q.id AS bid, q.grand_total AS amt, public.lb_pk_date(q.created_at) AS d
            FROM public.quotations q JOIN public.clients cl ON cl.id = q.client_id WHERE q.status NOT IN ('draft', 'rejected')),
  rec AS (SELECT z.acc, sum(z.x) AS r FROM (
            SELECT CASE WHEN cl.bill_to_parent AND cl.parent_id IS NOT NULL THEN cl.parent_id ELSE cl.id END AS acc, p.amount AS x FROM public.payments p JOIN public.quotations q ON q.id = p.quotation_id JOIN public.clients cl ON cl.id = q.client_id WHERE p.reversed_at IS NULL
            UNION ALL SELECT cp.client_id, cp.amount FROM public.client_payments cp WHERE cp.reversed_at IS NULL) z GROUP BY z.acc),
  billed_by AS (SELECT b.acc, sum(b.amt) AS billed FROM bills b GROUP BY b.acc),
  base AS (SELECT a.id, a.name, a.opening, coalesce(bb.billed, 0) AS billed, coalesce(rc.r, 0) AS received FROM acc a LEFT JOIN billed_by bb ON bb.acc = a.id LEFT JOIN rec rc ON rc.acc = a.id),
  items AS (  -- every bill, plus the opening balance as the oldest bill
    SELECT a.id AS acc, NULL::uuid AS bid, date '0001-01-01' AS d, a.opening AS amt FROM acc a WHERE a.opening > 0
    UNION ALL SELECT b.acc, b.bid, b.d, b.amt FROM bills b),
  fifo AS (SELECT i.acc, i.d, i.amt, coalesce(sum(i.amt) OVER (PARTITION BY i.acc ORDER BY i.d, i.bid ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before FROM items i),
  unpaid AS (SELECT f.acc, public.lb_today() - f.d AS age, greatest(0, least(f.amt, f.before + f.amt - (bs.received + greatest(-bs.opening, 0)))) AS u FROM fifo f JOIN base bs ON bs.id = f.acc),
  od AS (SELECT acc, sum(u) FILTER (WHERE age <= 30) AS b0, sum(u) FILTER (WHERE age BETWEEN 31 AND 60) AS b31, sum(u) FILTER (WHERE age BETWEEN 61 AND 90) AS b61, sum(u) FILTER (WHERE age > 90) AS b90 FROM unpaid GROUP BY acc)
  SELECT bs.id, bs.name, bs.opening, bs.billed, bs.received, bs.opening + bs.billed - bs.received,
         coalesce(od.b31, 0) + coalesce(od.b61, 0) + coalesce(od.b90, 0), coalesce(od.b0, 0), coalesce(od.b31, 0), coalesce(od.b61, 0), coalesce(od.b90, 0),
         greatest(0, bs.received + greatest(-bs.opening, 0) - (greatest(bs.opening, 0) + bs.billed))
  FROM base bs LEFT JOIN od ON od.acc = bs.id WHERE public.app_rank() >= 2
$function$;

-- M8: speed. Row-level-security rules called app_rank() / auth.uid() ONCE PER ROW (app_rank reads the profiles table each time), so every list, count
-- and report over tens of thousands of rows paid that cost per row. Writing it as (SELECT app_rank()) makes Postgres evaluate it once per query.
-- The rules mean exactly the same; only the form changes. Idempotent: policies already in the new form are skipped.
DO $$
DECLARE p record; q text; w text; sql text; n int := 0;
BEGIN
  SET LOCAL search_path = public;
  FOR p IN SELECT pol.polname, c.relname, pol.polcmd, pg_get_expr(pol.polqual, pol.polrelid) AS q, pg_get_expr(pol.polwithcheck, pol.polrelid) AS w
           FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public'
  LOOP
    q := p.q; w := p.w;
    IF q IS NOT NULL THEN q := regexp_replace(regexp_replace(q, '(?<!select )(?<!SELECT )app_rank\(\)', '(SELECT app_rank())', 'g'), '(?<!select )(?<!SELECT )auth\.uid\(\)', '(SELECT auth.uid())', 'g'); END IF;
    IF w IS NOT NULL THEN w := regexp_replace(regexp_replace(w, '(?<!select )(?<!SELECT )app_rank\(\)', '(SELECT app_rank())', 'g'), '(?<!select )(?<!SELECT )auth\.uid\(\)', '(SELECT auth.uid())', 'g'); END IF;
    IF q IS NOT DISTINCT FROM p.q AND w IS NOT DISTINCT FROM p.w THEN CONTINUE; END IF;
    sql := format('ALTER POLICY %I ON public.%I', p.polname, p.relname)
        || CASE WHEN q IS NOT NULL THEN ' USING (' || q || ')' ELSE '' END
        || CASE WHEN w IS NOT NULL THEN ' WITH CHECK (' || w || ')' ELSE '' END;
    EXECUTE sql; n := n + 1;
  END LOOP;
  RAISE NOTICE 'M8: % policies rewritten', n;
END $$;


-- ====================================================================
-- 20261123090000_m9_security_hardening.sql
-- ====================================================================
-- M9 security hardening (from the 19 Nov 2026 security review). Idempotent; changes no data.
-- 1. A quotation's MONEY is locked once approved: only Manager / Owner may change amounts or line items (Staff may still work on draft / pending quotations).
-- 2. Two elevated trigger functions get a fixed search_path.
-- 3. Defence in depth: nobody who is not signed in (anon / PUBLIC) can execute ANY function in the public schema; signed-in users keep exactly the access they had.

-- 1 -------------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.quotations_amount_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.app_rank() < 2 AND OLD.status IN ('approved', 'completed') AND (
       NEW.grand_total IS DISTINCT FROM OLD.grand_total OR NEW.subtotal_govt IS DISTINCT FROM OLD.subtotal_govt
    OR NEW.subtotal_service IS DISTINCT FROM OLD.subtotal_service OR NEW.subtotal_additional IS DISTINCT FROM OLD.subtotal_additional
    OR NEW.client_id IS DISTINCT FROM OLD.client_id) THEN
    RAISE EXCEPTION 'The amounts of an approved quotation can only be changed by a manager or the owner.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS quotations_amount_guard_trg ON public.quotations;
CREATE TRIGGER quotations_amount_guard_trg BEFORE UPDATE ON public.quotations FOR EACH ROW EXECUTE FUNCTION public.quotations_amount_guard();

CREATE OR REPLACE FUNCTION public.quotation_lines_amount_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE qid uuid; st text;
BEGIN
  IF auth.uid() IS NULL OR public.app_rank() >= 2 THEN RETURN COALESCE(NEW, OLD); END IF;
  qid := COALESCE(NEW.quotation_id, OLD.quotation_id);
  SELECT status INTO st FROM public.quotations WHERE id = qid;
  IF st IN ('approved', 'completed') THEN
    RAISE EXCEPTION 'The fee lines of an approved quotation can only be changed by a manager or the owner.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.quotation_id IS DISTINCT FROM OLD.quotation_id THEN
    SELECT status INTO st FROM public.quotations WHERE id = NEW.quotation_id;
    IF st IN ('approved', 'completed') THEN RAISE EXCEPTION 'The fee lines of an approved quotation can only be changed by a manager or the owner.' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS quotation_lines_amount_guard_trg ON public.quotation_line_items;
CREATE TRIGGER quotation_lines_amount_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON public.quotation_line_items FOR EACH ROW EXECUTE FUNCTION public.quotation_lines_amount_guard();

-- 2 -------------------------------------------------------------------------------------------------------------------------------------
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.snapshot_fee_rule_revision() SET search_path = public;

-- 3 -------------------------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE f record; keep oid[] := '{}';
BEGIN
  -- remember what signed-in users may run today (so internal helpers that are already locked stay locked)
  FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
           AND has_function_privilege('authenticated', p.oid, 'EXECUTE') LOOP keep := keep || f.oid; END LOOP;
  FOR f IN SELECT p.oid::regprocedure AS sig, p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p') LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
    IF f.oid = ANY (keep) THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig); END IF;
  END LOOP;
END $$;
-- Functions created by LATER migrations: run this statement again after adding any new function (or add REVOKE ... FROM PUBLIC, anon next to it).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;


-- ====================================================================
-- 20261125090000_m11_insider_integrity.sql
-- ====================================================================
-- M11: insider-abuse protection (found by attacking the app as a logged-in Staff user through the public API). Idempotent.
-- Before: a Staff login could, with no trace in the audit log,
--   * put someone else's name (e.g. the Owner) in "created_by" of clients / payments / quotations, or reassign it later,
--   * change a client's opening balance (forgive or invent a debt),
--   * add payments / credits directly with any amount and date.
-- Now: (1) created_by is always the real signed-in user and can never be changed,
--      (2) only Manager / Owner can set or change an opening balance,
--      (3) every insert / change / delete on the money tables is written to the audit log by the database itself,
--          with the real user id and the old -> new values, so it cannot be skipped by calling the API directly.

-- 1) authorship cannot be forged or rewritten -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lb_lock_created_by() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- applies to the public API (role 'authenticated'), also inside the app's own functions; internal maintenance runs as the database owner and is not touched
  IF auth.uid() IS NOT NULL AND coalesce(current_setting('role', true), '') = 'authenticated' THEN
    IF TG_OP = 'INSERT' THEN NEW.created_by := auth.uid(); ELSE NEW.created_by := OLD.created_by; END IF;
  END IF;
  RETURN NEW;
END $$;

-- 2) opening balance is a manager decision -----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lb_opening_balance_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.app_rank() < 2 AND (
       (TG_OP = 'INSERT' AND coalesce(NEW.opening_balance, 0) <> 0)
    OR (TG_OP = 'UPDATE' AND NEW.opening_balance IS DISTINCT FROM OLD.opening_balance)) THEN
    RAISE EXCEPTION 'Only a manager or the owner can set or change an opening balance.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lb_opening_balance_guard_trg ON public.clients;
CREATE TRIGGER lb_opening_balance_guard_trg BEFORE INSERT OR UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.lb_opening_balance_guard();

-- 3) tamper-proof audit trail written by the database ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lb_audit_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; o jsonb; d jsonb; eid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN r := to_jsonb(OLD); ELSE r := to_jsonb(NEW); END IF;
  eid := nullif(r ->> 'id', '')::uuid;
  IF TG_OP = 'UPDATE' THEN
    o := to_jsonb(OLD);
    SELECT jsonb_object_agg(n.key, jsonb_build_object('old', o -> n.key, 'new', n.value)) INTO d
      FROM jsonb_each(r) n WHERE n.value IS DISTINCT FROM (o -> n.key) AND n.key NOT IN ('updated_at');
    IF d IS NULL THEN RETURN NEW; END IF;
  ELSE
    d := r;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), 'db.' || lower(TG_OP) || '.' || TG_TABLE_NAME, TG_TABLE_NAME, eid, d);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.lb_audit_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lb_lock_created_by() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lb_opening_balance_guard() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients','quotations','payments','client_payments','payment_allocations','cases','vehicles','transfers'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS lb_lock_created_by_trg ON public.%I', t);
    EXECUTE format('CREATE TRIGGER lb_lock_created_by_trg BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.lb_lock_created_by()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['clients','payments','client_payments','payment_allocations'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS lb_audit_row_trg ON public.%I', t);
    EXECUTE format('CREATE TRIGGER lb_audit_row_trg AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.lb_audit_row()', t);
  END LOOP;
  -- quotations: creation is already logged by create_quotation_atomic; log only changes to money, client or status (not every autosave)
  DROP TRIGGER IF EXISTS lb_audit_row_trg ON public.quotations;
  CREATE TRIGGER lb_audit_row_trg AFTER DELETE OR UPDATE OF grand_total, subtotal_govt, subtotal_service, subtotal_additional, client_id, status ON public.quotations
    FOR EACH ROW EXECUTE FUNCTION public.lb_audit_row();
END $$;


-- ====================================================================
-- 20261126090000_m12_crm_growth.sql
-- ====================================================================
-- M12: CRM growth pack. Additive and safe to run more than once. Changes no existing data.
--   1. Leads (inquiries) with follow-up dates and a call / WhatsApp / visit log (also usable on clients)
--   2. Expenses (manager and owner only), voided instead of deleted, with a profit summary
--   3. Client documents: metadata table + PRIVATE storage bucket (CNIC, registration book, challan ...)
--   4. Vehicle renewal dates (token tax, registration) for reminders
--   5. Message templates (WhatsApp) the owner can edit
--   6. crm_kpis() / expense_summary() for the dashboard and reports; convert_lead_to_client()
-- Security by design: row-level security on every table, rights by role (Staff = 1, Manager = 2, Owner = 3), nothing for signed-out visitors,
-- created_by can never be forged, money / document changes are written to the audit log by the database itself.

-- 1) Vehicle renewal dates ---------------------------------------------------------------------------------------------------------
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS token_tax_due date;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS registration_due date;
CREATE INDEX IF NOT EXISTS idx_vehicles_token_tax_due ON public.vehicles (token_tax_due) WHERE token_tax_due IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehicles_registration_due ON public.vehicles (registration_due) WHERE registration_due IS NOT NULL;

-- 2) Leads -------------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0 AND length(name) <= 120),
  phone text CHECK (phone IS NULL OR length(phone) <= 40),
  source text NOT NULL DEFAULT 'other' CHECK (source IN ('walk_in', 'phone', 'whatsapp', 'showroom', 'reference', 'website', 'social', 'other')),
  interest text CHECK (interest IS NULL OR length(interest) <= 200),
  vehicle_info text CHECK (vehicle_info IS NULL OR length(vehicle_info) <= 200),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'quoted', 'won', 'lost')),
  next_follow_up date,
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  lost_reason text CHECK (lost_reason IS NULL OR length(lost_reason) <= 300),
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leads_lost_needs_reason CHECK (status <> 'lost' OR length(btrim(coalesce(lost_reason, ''))) > 0)
);
CREATE INDEX IF NOT EXISTS idx_leads_status_followup ON public.leads (status, next_follow_up);
CREATE INDEX IF NOT EXISTS idx_leads_client ON public.leads (client_id);

CREATE TABLE IF NOT EXISTS public.crm_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'note' CHECK (kind IN ('call', 'whatsapp', 'visit', 'email', 'note')),
  note text NOT NULL CHECK (length(btrim(note)) > 0 AND length(note) <= 2000),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_activities_one_parent CHECK ((lead_id IS NOT NULL)::int + (client_id IS NOT NULL)::int = 1)
);
CREATE INDEX IF NOT EXISTS idx_crm_activities_lead ON public.crm_activities (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_activities_client ON public.crm_activities (client_id, created_at DESC);

-- 3) Expenses ----------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date date NOT NULL DEFAULT public.lb_today(),
  category text NOT NULL CHECK (category IN ('rent', 'utilities', 'internet_phone', 'salary', 'agent_payment', 'government_fee_paid', 'transport_fuel', 'stationery_printing', 'marketing', 'repair_maintenance', 'tax_fee', 'other')),
  amount numeric(14, 2) NOT NULL CHECK (amount > 0 AND amount < 100000000),
  paid_from text NOT NULL DEFAULT 'cash' CHECK (paid_from IN ('cash', 'bank', 'mobile_wallet', 'other')),
  description text CHECK (description IS NULL OR length(description) <= 500),
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text CHECK (void_reason IS NULL OR length(void_reason) <= 300),
  CONSTRAINT expenses_void_pair CHECK ((voided_at IS NULL AND void_reason IS NULL) OR (voided_at IS NOT NULL AND length(btrim(coalesce(void_reason, ''))) > 0))
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses (expense_date DESC);

CREATE OR REPLACE FUNCTION public.lb_expense_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.expense_date > public.lb_today() + 1 THEN RAISE EXCEPTION 'An expense cannot be dated in the future.' USING ERRCODE = '22023'; END IF;
  IF NEW.expense_date < public.lb_today() - 800 THEN RAISE EXCEPTION 'An expense cannot be dated more than about two years back.' USING ERRCODE = '22023'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lb_expense_guard_trg ON public.expenses;
CREATE TRIGGER lb_expense_guard_trg BEFORE INSERT ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.lb_expense_guard();

-- an expense is never edited or deleted: it is voided with a reason (the row stays for the audit trail)
CREATE OR REPLACE FUNCTION public.void_expense(p_id uuid, p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.app_rank() < 2 THEN RAISE EXCEPTION 'Only a manager or the owner can void an expense.' USING ERRCODE = '42501'; END IF;
  IF length(btrim(coalesce(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'A reason is required to void an expense.' USING ERRCODE = '22023'; END IF;
  UPDATE public.expenses SET voided_at = now(), voided_by = auth.uid(), void_reason = left(btrim(p_reason), 300) WHERE id = p_id AND voided_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found or already voided.' USING ERRCODE = '22023'; END IF;
END $$;

-- 4) Client documents --------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  case_id uuid REFERENCES public.cases(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  doc_type text NOT NULL DEFAULT 'other' CHECK (doc_type IN ('cnic', 'registration_book', 'invoice', 'challan', 'transfer_letter', 'affidavit', 'photo', 'other')),
  file_name text NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 150),
  storage_path text NOT NULL UNIQUE CHECK (length(storage_path) <= 300),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_documents_path_in_client_folder CHECK (storage_path LIKE client_id::text || '/%' AND storage_path !~ '\.\.' AND storage_path !~ '//')
);
CREATE INDEX IF NOT EXISTS idx_client_documents_client ON public.client_documents (client_id, created_at DESC);

-- 5) Message templates -------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9_]{2,40}$'),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 80),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 1200),
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.message_templates (key, title, body, sort_order) VALUES
  ('follow_up', 'Follow-up on an inquiry', 'Assalam o Alaikum {name}, aap ne {vehicle} ke baare mein poocha tha. Kya aap ko hamari madad chahiye? Hum har tarah ki rehnumai ke liye hazir hain. - {business}', 10),
  ('quotation_ready', 'Quotation ready', 'Assalam o Alaikum {name}, aap ki quotation tayyar hai: {amount}. Koi sawal ho to zaroor bataiye. - {business}', 20),
  ('documents_needed', 'Documents needed', 'Assalam o Alaikum {name}, {vehicle} ke kaam ke liye CNIC ki copy aur registration book ki copy bhej dein. Shukriya. - {business}', 30),
  ('case_done', 'Work completed', 'Assalam o Alaikum {name}, aap ka {vehicle} ka kaam mukammal ho gaya hai. Hum par bharosa karne ka shukriya. - {business}', 40),
  ('payment_due', 'Payment reminder', 'Assalam o Alaikum {name}, aap ki taraf {amount} baqi hain. Meharbani karke ada kar dein. Shukriya. - {business}', 50),
  ('renewal_due', 'Token tax / registration renewal', 'Assalam o Alaikum {name}, aap ki gaari {vehicle} ka token tax / registration {date} ko due hai. Hum aap ke liye ye kaam kar saktay hain. - {business}', 60)
ON CONFLICT (key) DO NOTHING;

-- 6) Row-level security, rights, audit and anti-forgery ------------------------------------------------------------------------------
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leads_select ON public.leads;  CREATE POLICY leads_select ON public.leads FOR SELECT TO authenticated USING ((SELECT public.app_rank()) >= 1);
DROP POLICY IF EXISTS leads_insert ON public.leads;  CREATE POLICY leads_insert ON public.leads FOR INSERT TO authenticated WITH CHECK ((SELECT public.app_rank()) >= 1);
DROP POLICY IF EXISTS leads_update ON public.leads;  CREATE POLICY leads_update ON public.leads FOR UPDATE TO authenticated USING ((SELECT public.app_rank()) >= 1) WITH CHECK ((SELECT public.app_rank()) >= 1);
DROP POLICY IF EXISTS leads_delete ON public.leads;  CREATE POLICY leads_delete ON public.leads FOR DELETE TO authenticated USING ((SELECT public.app_rank()) >= 2);

DROP POLICY IF EXISTS crm_activities_select ON public.crm_activities; CREATE POLICY crm_activities_select ON public.crm_activities FOR SELECT TO authenticated USING ((SELECT public.app_rank()) >= 1);
DROP POLICY IF EXISTS crm_activities_insert ON public.crm_activities; CREATE POLICY crm_activities_insert ON public.crm_activities FOR INSERT TO authenticated WITH CHECK ((SELECT public.app_rank()) >= 1);
DROP POLICY IF EXISTS crm_activities_delete ON public.crm_activities; CREATE POLICY crm_activities_delete ON public.crm_activities FOR DELETE TO authenticated USING ((SELECT public.app_rank()) >= 3);

DROP POLICY IF EXISTS expenses_select ON public.expenses; CREATE POLICY expenses_select ON public.expenses FOR SELECT TO authenticated USING ((SELECT public.app_rank()) >= 2);
DROP POLICY IF EXISTS expenses_insert ON public.expenses; CREATE POLICY expenses_insert ON public.expenses FOR INSERT TO authenticated WITH CHECK ((SELECT public.app_rank()) >= 2);

DROP POLICY IF EXISTS client_documents_select ON public.client_documents; CREATE POLICY client_documents_select ON public.client_documents FOR SELECT TO authenticated USING ((SELECT public.app_rank()) >= 1);
DROP POLICY IF EXISTS client_documents_insert ON public.client_documents; CREATE POLICY client_documents_insert ON public.client_documents FOR INSERT TO authenticated WITH CHECK ((SELECT public.app_rank()) >= 1);
DROP POLICY IF EXISTS client_documents_delete ON public.client_documents; CREATE POLICY client_documents_delete ON public.client_documents FOR DELETE TO authenticated USING ((SELECT public.app_rank()) >= 2);

DROP POLICY IF EXISTS message_templates_select ON public.message_templates; CREATE POLICY message_templates_select ON public.message_templates FOR SELECT TO authenticated USING ((SELECT public.app_rank()) >= 1);
DROP POLICY IF EXISTS message_templates_insert ON public.message_templates; CREATE POLICY message_templates_insert ON public.message_templates FOR INSERT TO authenticated WITH CHECK ((SELECT public.app_rank()) >= 3);
DROP POLICY IF EXISTS message_templates_update ON public.message_templates; CREATE POLICY message_templates_update ON public.message_templates FOR UPDATE TO authenticated USING ((SELECT public.app_rank()) >= 3) WITH CHECK ((SELECT public.app_rank()) >= 3);
DROP POLICY IF EXISTS message_templates_delete ON public.message_templates; CREATE POLICY message_templates_delete ON public.message_templates FOR DELETE TO authenticated USING ((SELECT public.app_rank()) >= 3);

-- table rights: nothing for signed-out visitors; append-only tables get no UPDATE / DELETE at all
REVOKE ALL ON public.leads, public.crm_activities, public.expenses, public.client_documents, public.message_templates FROM anon, PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON public.expenses FROM authenticated;
REVOKE UPDATE, TRUNCATE ON public.crm_activities, public.client_documents FROM authenticated;
REVOKE TRUNCATE ON public.leads, public.message_templates FROM authenticated;

-- updated_at, created_by cannot be forged, the database writes the audit trail
DROP TRIGGER IF EXISTS leads_updated_at ON public.leads;
CREATE TRIGGER leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS message_templates_updated_at ON public.message_templates;
CREATE TRIGGER message_templates_updated_at BEFORE UPDATE ON public.message_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leads', 'crm_activities', 'expenses', 'client_documents'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS lb_lock_created_by_trg ON public.%I', t);
    EXECUTE format('CREATE TRIGGER lb_lock_created_by_trg BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.lb_lock_created_by()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['leads', 'expenses', 'client_documents', 'message_templates'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS lb_audit_row_trg ON public.%I', t);
    EXECUTE format('CREATE TRIGGER lb_audit_row_trg AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.lb_audit_row()', t);
  END LOOP;
END $$;

-- 7) Dashboard / report numbers ----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_kpis(p_from date, p_to date) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE r int := public.app_rank(); today date := public.lb_today(); out jsonb;
BEGIN
  IF r < 1 THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  out := jsonb_build_object(
    'leads_followup_due', (SELECT count(*) FROM public.leads WHERE status IN ('new', 'contacted', 'quoted') AND next_follow_up IS NOT NULL AND next_follow_up <= today),
    'leads_new',  (SELECT count(*) FROM public.leads WHERE status = 'new'),
    'leads_open', (SELECT count(*) FROM public.leads WHERE status IN ('new', 'contacted', 'quoted')),
    'leads_won',  (SELECT count(*) FROM public.leads WHERE status = 'won'  AND public.lb_pk_date(updated_at) BETWEEN p_from AND p_to),
    'leads_lost', (SELECT count(*) FROM public.leads WHERE status = 'lost' AND public.lb_pk_date(updated_at) BETWEEN p_from AND p_to),
    'renewals_overdue', (SELECT count(*) FROM public.vehicles WHERE LEAST(token_tax_due, registration_due) < today),
    'renewals_30',      (SELECT count(*) FROM public.vehicles WHERE LEAST(token_tax_due, registration_due) BETWEEN today AND today + 30));
  IF r >= 2 THEN
    out := out || jsonb_build_object('expenses_total', coalesce((SELECT sum(amount) FROM public.expenses WHERE voided_at IS NULL AND expense_date BETWEEN p_from AND p_to), 0),
                                     'expenses_count', (SELECT count(*) FROM public.expenses WHERE voided_at IS NULL AND expense_date BETWEEN p_from AND p_to));
  ELSE
    out := out || jsonb_build_object('expenses_total', NULL, 'expenses_count', NULL);
  END IF;
  RETURN out;
END $$;

CREATE OR REPLACE FUNCTION public.expense_summary(p_from date, p_to date) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE out jsonb;
BEGIN
  IF public.app_rank() < 2 THEN RAISE EXCEPTION 'Expense figures are for managers and the owner.' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object(
    'total', coalesce(sum(amount), 0), 'count', count(*),
    'by_category', coalesce((SELECT jsonb_agg(jsonb_build_object('category', category, 'total', t, 'count', c) ORDER BY t DESC)
                             FROM (SELECT category, sum(amount) AS t, count(*) AS c FROM public.expenses WHERE voided_at IS NULL AND expense_date BETWEEN p_from AND p_to GROUP BY category) x), '[]'::jsonb),
    'by_method', coalesce((SELECT jsonb_object_agg(paid_from, t) FROM (SELECT paid_from, sum(amount) AS t FROM public.expenses WHERE voided_at IS NULL AND expense_date BETWEEN p_from AND p_to GROUP BY paid_from) y), '{}'::jsonb))
  INTO out FROM public.expenses WHERE voided_at IS NULL AND expense_date BETWEEN p_from AND p_to;
  RETURN out;
END $$;

-- turns a lead into a client in one step (runs with the caller's own rights)
CREATE OR REPLACE FUNCTION public.convert_lead_to_client(p_lead uuid) RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE l public.leads%ROWTYPE; cid uuid;
BEGIN
  IF public.app_rank() < 1 THEN RAISE EXCEPTION 'Not allowed.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO l FROM public.leads WHERE id = p_lead FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead not found.' USING ERRCODE = '22023'; END IF;
  IF l.client_id IS NOT NULL THEN RETURN l.client_id; END IF;
  INSERT INTO public.clients (name, phone, notes) VALUES (l.name, l.phone, nullif(btrim(coalesce(l.notes, '')), '')) RETURNING id INTO cid;
  UPDATE public.leads SET client_id = cid, status = 'won', next_follow_up = NULL WHERE id = p_lead;
  INSERT INTO public.crm_activities (client_id, kind, note) VALUES (cid, 'note', 'Created from an inquiry (' || l.source || ')' || CASE WHEN l.interest IS NOT NULL THEN ': ' || l.interest ELSE '' END);
  RETURN cid;
END $$;

-- functions: only signed-in users may run them
REVOKE ALL ON FUNCTION public.crm_kpis(date, date), public.expense_summary(date, date), public.convert_lead_to_client(uuid), public.void_expense(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_kpis(date, date), public.expense_summary(date, date), public.convert_lead_to_client(uuid), public.void_expense(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.lb_expense_guard() FROM PUBLIC, anon, authenticated;

-- 8) Private file storage for client documents (only where Supabase Storage exists) ----------------------------------------------------
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'Supabase Storage not found: the document bucket was not created.';
    RETURN;
  END IF;
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('lb-documents', 'lb-documents', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

  EXECUTE 'DROP POLICY IF EXISTS lb_documents_insert ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS lb_documents_select ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS lb_documents_delete ON storage.objects';
  -- upload: signed-in, only into the folder of an existing client (folder name = client id).
  -- Note: objects.name is written in full on purpose: inside the sub-query a bare "name" would mean clients.name.
  EXECUTE $p$CREATE POLICY lb_documents_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'lb-documents' AND (SELECT public.app_rank()) >= 1
    AND (storage.foldername(objects.name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND EXISTS (SELECT 1 FROM public.clients c WHERE c.id::text = (storage.foldername(objects.name))[1]))$p$;
  -- download: only files that are registered in client_documents (so stray uploads can never be read)
  EXECUTE $p$CREATE POLICY lb_documents_select ON storage.objects FOR SELECT TO authenticated USING (
    bucket_id = 'lb-documents' AND (SELECT public.app_rank()) >= 1
    AND EXISTS (SELECT 1 FROM public.client_documents d WHERE d.storage_path = objects.name))$p$;
  -- delete: manager / owner only. There is no UPDATE policy: a stored file can never be overwritten.
  EXECUTE $p$CREATE POLICY lb_documents_delete ON storage.objects FOR DELETE TO authenticated USING (
    bucket_id = 'lb-documents' AND (SELECT public.app_rank()) >= 2)$p$;
END $$;


-- ====================================================================
-- 20261127090000_m13_pentest_hardening.sql
-- ====================================================================
-- M13: pentest hardening (insider/staff abuse paths found when attacking the M12 build). Idempotent.
-- M10: fixes from the penetration test (supabase/tests/M10_pentest_tests.sql). Idempotent. Changes no existing data.
-- Every rule below applies to people using the app / API (auth.uid() is set). The owner working in the Supabase SQL editor is not affected.
-- Rules that only restrict Staff say "rank < 2"; Manager and Owner keep their rights.

-- 1. NaN poisons every total (NaN > 0 is true in Postgres, and sum() of any NaN is NaN). Refuse it for new / changed rows. (NOT VALID = existing rows are not re-checked.)
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('payments','amount'),('client_payments','amount'),('payment_allocations','amount'),('quotation_line_items','amount'),
    ('quotations','subtotal_govt'),('quotations','subtotal_service'),('quotations','subtotal_additional'),('quotations','grand_total'),
    ('cases','govt_fee'),('cases','service_charge'),('clients','opening_balance')) v(t, col) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c.t || '_' || c.col || '_not_nan' AND conrelid = ('public.' || c.t)::regclass) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I IS NULL OR %I <> ''NaN''::numeric) NOT VALID', c.t, c.t || '_' || c.col || '_not_nan', c.col, c.col);
    END IF;
  END LOOP;
END $$;

-- 2. "Recorded by" can never be someone else (audit trail), whoever types it.
CREATE OR REPLACE FUNCTION public.lb_force_created_by() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN IF auth.uid() IS NOT NULL AND coalesce(current_setting('role', true), '') = 'authenticated' THEN NEW.created_by := auth.uid(); END IF; RETURN NEW; END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payments','client_payments','quotations','clients','vehicles','cases','tasks','transfers','inventory_items'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_force_created_by_trg', t);
      EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.lb_force_created_by()', t || '_force_created_by_trg', t);
    END IF;
  END LOOP;
END $$;

-- 3. Payments: no future dates, Staff cannot back-date the entry time, and nobody can hard-DELETE a payment through the app (reverse it, so the trail stays).
CREATE OR REPLACE FUNCTION public.payments_insert_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NEW.payment_date IS NOT NULL AND NEW.payment_date > public.lb_today() + 1 THEN
      RAISE EXCEPTION 'A payment cannot be dated in the future (%). Check the date.', NEW.payment_date USING ERRCODE = '22007';
    END IF;
    IF public.app_rank() < 2 THEN NEW.created_at := now(); END IF;
    IF NEW.amount IS NULL OR NEW.amount <= 0 THEN RAISE EXCEPTION 'A payment must be more than zero.' USING ERRCODE = '23514'; END IF;
    IF TG_TABLE_NAME = 'payments' THEN
      PERFORM 1 FROM public.quotations q WHERE q.id = NEW.quotation_id AND q.status IN ('rejected');
      IF FOUND THEN RAISE EXCEPTION 'Payments cannot be recorded against a rejected quotation.' USING ERRCODE = '42501'; END IF;
      IF public.app_rank() < 2 AND NEW.amount + COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.quotation_id = NEW.quotation_id AND p.reversed_at IS NULL), 0)
           > COALESCE((SELECT q.grand_total FROM public.quotations q WHERE q.id = NEW.quotation_id), 0) + 0.01 THEN
        RAISE EXCEPTION 'This payment is more than the amount still due. A manager must record an overpayment.' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.payments_no_delete() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'A payment cannot be deleted. Reverse it with a reason instead, so the record stays.' USING ERRCODE = '42501'; END IF;
  RETURN OLD;
END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payments','client_payments'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_insert_guard_trg', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.payments_insert_guard()', t || '_insert_guard_trg', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_no_delete_trg', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.payments_no_delete()', t || '_no_delete_trg', t);
  END LOOP;
END $$;

-- 4. Clients: money-moving fields are for Manager / Owner (opening balance, who pays, archive). Staff may still add and edit contact details.
CREATE OR REPLACE FUNCTION public.clients_money_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.app_rank() >= 2 THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.opening_balance, 0) < 0 THEN RAISE EXCEPTION 'An advance (minus opening balance) can only be entered by a manager or the owner.' USING ERRCODE = '42501'; END IF;
    NEW.archived_at := NULL;
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.opening_balance, 0) IS DISTINCT FROM COALESCE(OLD.opening_balance, 0)
     OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
     OR COALESCE(NEW.bill_to_parent, false) IS DISTINCT FROM COALESCE(OLD.bill_to_parent, false)
     OR NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'The opening balance, who pays for this client, and archiving can only be changed by a manager or the owner.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS clients_money_guard_trg ON public.clients;
CREATE TRIGGER clients_money_guard_trg BEFORE INSERT OR UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.clients_money_guard();

-- 5. Quotations: Staff cannot create one that is already approved, cannot back-date it, and the total must equal its parts (nobody can store a total of Rs 5 for Rs 10,000 of fees).
CREATE OR REPLACE FUNCTION public.quotations_integrity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE money_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    money_changed := true;
    IF auth.uid() IS NOT NULL AND public.app_rank() < 2 THEN
      IF NEW.status NOT IN ('draft', 'pending') THEN RAISE EXCEPTION 'A new quotation starts as draft or pending; approval is a separate step.' USING ERRCODE = '42501'; END IF;
      IF NEW.created_at IS NOT NULL AND NEW.created_at < now() - interval '1 day' THEN RAISE EXCEPTION 'A new quotation cannot be back-dated.' USING ERRCODE = '22007'; END IF;
      NEW.created_at := now();
    END IF;
  ELSE
    money_changed := NEW.grand_total IS DISTINCT FROM OLD.grand_total OR NEW.subtotal_govt IS DISTINCT FROM OLD.subtotal_govt
                  OR NEW.subtotal_service IS DISTINCT FROM OLD.subtotal_service OR NEW.subtotal_additional IS DISTINCT FROM OLD.subtotal_additional;
  END IF;
  IF money_changed AND auth.uid() IS NOT NULL THEN
    IF COALESCE(NEW.subtotal_govt, 0) < 0 OR COALESCE(NEW.subtotal_service, 0) < 0 OR COALESCE(NEW.subtotal_additional, 0) < 0 OR COALESCE(NEW.grand_total, 0) < 0 THEN
      RAISE EXCEPTION 'Amounts in a quotation cannot be negative.' USING ERRCODE = '23514';
    END IF;
    IF abs(COALESCE(NEW.grand_total, 0) - (COALESCE(NEW.subtotal_govt, 0) + COALESCE(NEW.subtotal_service, 0) + COALESCE(NEW.subtotal_additional, 0))) > 0.01 THEN
      RAISE EXCEPTION 'The quotation total (%) does not equal government + service + additional fees (%).', NEW.grand_total, COALESCE(NEW.subtotal_govt, 0) + COALESCE(NEW.subtotal_service, 0) + COALESCE(NEW.subtotal_additional, 0) USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS quotations_integrity_guard_trg ON public.quotations;
CREATE TRIGGER quotations_integrity_guard_trg BEFORE INSERT OR UPDATE ON public.quotations FOR EACH ROW EXECUTE FUNCTION public.quotations_integrity_guard();

CREATE OR REPLACE FUNCTION public.quotation_lines_sign_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.app_rank() < 2 AND TG_OP <> 'DELETE' AND COALESCE(NEW.amount, 0) < 0 THEN
    RAISE EXCEPTION 'A fee line cannot be negative. A discount must be entered by a manager.' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS quotation_lines_sign_guard_trg ON public.quotation_line_items;
CREATE TRIGGER quotation_lines_sign_guard_trg BEFORE INSERT OR UPDATE ON public.quotation_line_items FOR EACH ROW EXECUTE FUNCTION public.quotation_lines_sign_guard();

-- 6. Cases: a closed case, its links and its document checklist are not for Staff to rewrite.
CREATE OR REPLACE FUNCTION public.cases_staff_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.app_rank() >= 2 THEN RETURN NEW; END IF;
  IF OLD.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'A closed case can only be changed by a manager or the owner.' USING ERRCODE = '42501';
  END IF;
  IF (OLD.client_id IS NOT NULL AND NEW.client_id IS DISTINCT FROM OLD.client_id) OR (OLD.quotation_id IS NOT NULL AND NEW.quotation_id IS DISTINCT FROM OLD.quotation_id)
     OR (OLD.vehicle_id IS NOT NULL AND NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id) THEN
    RAISE EXCEPTION 'A case cannot be moved to another client, vehicle or quotation. Ask a manager.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cases_staff_guard_trg ON public.cases;
CREATE TRIGGER cases_staff_guard_trg BEFORE UPDATE ON public.cases FOR EACH ROW EXECUTE FUNCTION public.cases_staff_guard();

CREATE OR REPLACE FUNCTION public.case_documents_staff_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE st text; cid uuid := COALESCE(OLD.case_id, NEW.case_id);
BEGIN
  IF auth.uid() IS NULL OR public.app_rank() >= 2 THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT status INTO st FROM public.cases WHERE id = cid;
  IF st IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'The document checklist of a closed case can only be changed by a manager or the owner.' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'DELETE' AND OLD.received THEN RAISE EXCEPTION 'A document that was already received cannot be removed from the checklist. Ask a manager.' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS case_documents_staff_guard_trg ON public.case_documents;
CREATE TRIGGER case_documents_staff_guard_trg BEFORE UPDATE OR DELETE ON public.case_documents FOR EACH ROW EXECUTE FUNCTION public.case_documents_staff_guard();

-- 7. Business settings (bank details, branding) are for active staff only, not for someone who just signed up and waits for approval.
DROP POLICY IF EXISTS app_settings_select ON public.app_settings;
CREATE POLICY app_settings_select ON public.app_settings FOR SELECT TO authenticated USING ((SELECT public.app_rank()) >= 1);

-- 8. Sign-up take-over: the FIRST account ever created becomes the Owner. It used to be "when no admin exists", so deleting the owner's account while other users existed
--    let the next stranger who signed up become Owner. Now it only happens on a completely empty system. (Recovery: promote someone in the SQL editor:
--    update public.profiles set role = 'admin', active = true where email = 'you@example.com';)
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE first_one boolean;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles) INTO first_one;
  INSERT INTO public.profiles (id, full_name, role, active, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), CASE WHEN first_one THEN 'admin' ELSE 'staff' END, first_one, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

-- 9. Keep the "nobody signed-out can run a function" rule for everything created above.
REVOKE EXECUTE ON FUNCTION public.lb_force_created_by(), public.payments_insert_guard(), public.payments_no_delete(), public.clients_money_guard(), public.quotations_integrity_guard(),
  public.quotation_lines_sign_guard(), public.cases_staff_guard(), public.case_documents_staff_guard(), public.handle_new_user() FROM PUBLIC, anon;

-- =====================================================================================================================================
-- M13 part 2: attacks on the M12 tables (found by pentest). Typed rows can no longer fake history.
-- =====================================================================================================================================
-- (a) expenses: a new expense is always "live" and stamped now; "voided" can only come from void_expense()
CREATE OR REPLACE FUNCTION public.lb_expense_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.expense_date > public.lb_today() + 1 THEN RAISE EXCEPTION 'An expense cannot be dated in the future.' USING ERRCODE = '22023'; END IF;
  IF NEW.expense_date < public.lb_today() - 800 THEN RAISE EXCEPTION 'An expense cannot be dated more than about two years back.' USING ERRCODE = '22023'; END IF;
  IF auth.uid() IS NOT NULL THEN
    NEW.voided_at := NULL; NEW.voided_by := NULL; NEW.void_reason := NULL; NEW.created_at := now();
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.lb_expense_guard() FROM PUBLIC, anon, authenticated;

-- (b) CRM history is stamped by the database: activity time cannot be back-dated, a lead's creation time cannot be rewritten
CREATE OR REPLACE FUNCTION public.lb_stamp_history() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN NEW.created_at := now(); ELSE NEW.created_at := OLD.created_at; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.lb_stamp_history() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS lb_stamp_history_trg ON public.crm_activities;
CREATE TRIGGER lb_stamp_history_trg BEFORE INSERT ON public.crm_activities FOR EACH ROW EXECUTE FUNCTION public.lb_stamp_history();
DROP TRIGGER IF EXISTS lb_stamp_history_trg ON public.leads;
CREATE TRIGGER lb_stamp_history_trg BEFORE INSERT OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.lb_stamp_history();
DROP TRIGGER IF EXISTS lb_stamp_history_trg ON public.client_documents;
CREATE TRIGGER lb_stamp_history_trg BEFORE INSERT OR UPDATE ON public.client_documents FOR EACH ROW EXECUTE FUNCTION public.lb_stamp_history();

-- (c) dates must be real dates: 'infinity' / year 9999 would break every screen that prints or sorts them
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_follow_up_sane;
ALTER TABLE public.leads ADD CONSTRAINT leads_follow_up_sane CHECK (next_follow_up IS NULL OR next_follow_up BETWEEN DATE '2000-01-01' AND DATE '2100-12-31') NOT VALID;
ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_renewal_dates_sane;
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_renewal_dates_sane CHECK (
  (token_tax_due IS NULL OR token_tax_due BETWEEN DATE '2000-01-01' AND DATE '2100-12-31')
  AND (registration_due IS NULL OR registration_due BETWEEN DATE '2000-01-01' AND DATE '2100-12-31')) NOT VALID;

-- =====================================================================================================================================
-- M13 part 3 (CRITICAL): table-level rights.
-- Supabase gives anon + authenticated "ALL" on every new table in public by default. Row-level security then does all the work, and a
-- column-level "GRANT UPDATE (full_name)" on profiles is meaningless next to a table-level UPDATE: any signed-in user (even one still
-- waiting for approval) could run  UPDATE profiles SET role='admin', active=true  on their own row. Fixed here at three layers.
-- =====================================================================================================================================
-- 1) visitors (not signed in) get no table rights at all; nobody signed-in needs TRUNCATE / REFERENCES / TRIGGER
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;

-- 2) profiles: a signed-in user may change only their own display name. Role / active / e-mail change ONLY through set_user_access()
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (full_name) ON public.profiles TO authenticated;

-- 3) ... and even if someone re-grants it later, a trigger refuses (functions that run as the table owner, such as set_user_access() and the
--    sign-up trigger, are not affected: they run as postgres, not as authenticated)
CREATE OR REPLACE FUNCTION public.profiles_protect_trg() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'Profiles are created by the system only.' USING ERRCODE = '42501'; END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.role IS DISTINCT FROM OLD.role OR NEW.active IS DISTINCT FROM OLD.active OR NEW.email IS DISTINCT FROM OLD.email THEN
      RAISE EXCEPTION 'Role, access and e-mail can only be changed by the owner through the Users page.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
REVOKE EXECUTE ON FUNCTION public.profiles_protect_trg() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS profiles_protect ON public.profiles;
CREATE TRIGGER profiles_protect BEFORE INSERT OR UPDATE OR DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.profiles_protect_trg();

-- 4) internal helper that writes the status history must not be callable by users (they could forge "who changed what" entries).
--    Triggers that run as the table owner still call it.
REVOKE EXECUTE ON FUNCTION public.lb_log_change(text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;


-- ====================================================================
-- 20261128090000_m14_admin_password_reset.sql
-- ====================================================================
-- M14: owner can reset a user's password (through the admin-set-password Edge Function). The user must choose their own new password at the next sign-in.
-- Idempotent. Nothing here lets a normal user touch the flag: only the Edge Function (service role) can set it, and it is cleared only after the password really changed.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- Private table: the fingerprint of the temporary password. No signed-in user can read or write it.
CREATE TABLE IF NOT EXISTS public.password_resets (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  temp_hash text,
  reset_by uuid,
  reset_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_resets FROM PUBLIC, anon, authenticated;

-- Called by the Edge Function ONLY (service role) right after it set the temporary password.
CREATE OR REPLACE FUNCTION public.lb_mark_password_reset(p_target uuid, p_by uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  UPDATE public.profiles SET must_change_password = true WHERE id = p_target;
  INSERT INTO public.password_resets (user_id, temp_hash, reset_by, reset_at)
  VALUES (p_target, (SELECT u.encrypted_password FROM auth.users u WHERE u.id = p_target), p_by, now())
  ON CONFLICT (user_id) DO UPDATE SET temp_hash = EXCLUDED.temp_hash, reset_by = EXCLUDED.reset_by, reset_at = now();
END $$;
REVOKE EXECUTE ON FUNCTION public.lb_mark_password_reset(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lb_mark_password_reset(uuid, uuid) TO service_role;

-- Called by the signed-in user after choosing a new password. Works only if the stored password really is different from the temporary one.
CREATE OR REPLACE FUNCTION public.clear_must_change_password() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE cur text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT u.encrypted_password INTO cur FROM auth.users u WHERE u.id = auth.uid();
  IF NOT EXISTS (SELECT 1 FROM public.password_resets r WHERE r.user_id = auth.uid() AND r.temp_hash IS NOT DISTINCT FROM cur) THEN
    UPDATE public.profiles SET must_change_password = false WHERE id = auth.uid();
    DELETE FROM public.password_resets WHERE user_id = auth.uid();
  END IF;
  RETURN NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.must_change_password);
END $$;
REVOKE EXECUTE ON FUNCTION public.clear_must_change_password() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_must_change_password() TO authenticated;

-- belt and braces: the profiles guard also keeps the flag away from users
CREATE OR REPLACE FUNCTION public.profiles_protect_trg() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'Profiles are created by the system only.' USING ERRCODE = '42501'; END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.role IS DISTINCT FROM OLD.role OR NEW.active IS DISTINCT FROM OLD.active OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.must_change_password IS DISTINCT FROM OLD.must_change_password THEN
      RAISE EXCEPTION 'Role, access, e-mail and password rules can only be changed by the owner.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
REVOKE EXECUTE ON FUNCTION public.profiles_protect_trg() FROM PUBLIC, anon, authenticated;

-- =====================================================================================================================================
-- M14 part 2: staff must not be able to see how much money the business received.
-- Until now every signed-in person could read ALL payments (Receipts page total, or a direct API call). Now:
--   Owner / Manager : everything (unchanged)
--   Staff           : only the payments of THEIR OWN customers (assigned to them or created by them) and payments they entered themselves
-- Expenses, profit, reports and the money part of the dashboard were already closed to staff.
-- =====================================================================================================================================
DROP POLICY IF EXISTS payments_select ON public.payments;
CREATE POLICY payments_select ON public.payments FOR SELECT TO authenticated USING (
  (SELECT public.app_rank()) >= 2
  OR (
    (SELECT public.app_rank()) = 1
    AND (
      created_by = (SELECT auth.uid())
      OR quotation_id IN (SELECT q.id FROM public.quotations q
                           WHERE q.created_by = (SELECT auth.uid())
                              OR q.client_id IN (SELECT c.id FROM public.clients c WHERE c.assigned_to = (SELECT auth.uid()) OR c.created_by = (SELECT auth.uid())))
    )
  )
);

DROP POLICY IF EXISTS client_payments_select ON public.client_payments;
CREATE POLICY client_payments_select ON public.client_payments FOR SELECT TO authenticated USING (
  (SELECT public.app_rank()) >= 2
  OR (
    (SELECT public.app_rank()) = 1
    AND (
      created_by = (SELECT auth.uid())
      OR client_id IN (SELECT c.id FROM public.clients c WHERE c.assigned_to = (SELECT auth.uid()) OR c.created_by = (SELECT auth.uid()))
    )
  )
);

DROP POLICY IF EXISTS alloc_select ON public.payment_allocations;
CREATE POLICY alloc_select ON public.payment_allocations FOR SELECT TO authenticated USING (
  (SELECT public.app_rank()) >= 2
  OR (
    (SELECT public.app_rank()) = 1
    AND (
      created_by = (SELECT auth.uid())
      OR client_payment_id IN (SELECT cp.id FROM public.client_payments cp)   -- already limited by client_payments_select
    )
  )
);


