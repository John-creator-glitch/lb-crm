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
