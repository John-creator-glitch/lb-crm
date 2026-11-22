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
