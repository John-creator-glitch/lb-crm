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
