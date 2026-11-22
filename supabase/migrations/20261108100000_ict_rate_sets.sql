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
