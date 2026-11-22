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
