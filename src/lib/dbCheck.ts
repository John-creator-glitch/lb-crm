import { supabase } from './supabase';

export interface DbCheckRow { table: string; ok: boolean; detail: string }

const TABLES = ['profiles', 'fee_rules', 'fee_rule_revisions', 'audit_logs', 'clients', 'vehicles', 'quotations', 'quotation_line_items', 'payments', 'client_payments', 'app_settings', 'punjab_rate_sets', 'ict_rate_sets', 'hpa_counts', 'cases', 'tasks', 'inventory_items', 'transfers', 'leads', 'crm_activities', 'expenses', 'client_documents', 'message_templates'];

/** Reads one row from every table the app needs and reports what works. Never throws. */
export async function checkDatabase(): Promise<DbCheckRow[]> {
  const out: DbCheckRow[] = [];
  for (const table of TABLES) {
    try {
      const { error } = await supabase.from(table).select('*', { head: true, count: 'exact' }).limit(1);
      out.push({ table, ok: !error, detail: error ? error.message : 'OK' });
    } catch (e: any) {
      out.push({ table, ok: false, detail: e?.message || 'Network error: cannot reach Supabase' });
    }
  }
  return out;
}
