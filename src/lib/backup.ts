import { supabase } from '@/lib/supabase';
import { isMissingTable, verifyManifest, type BackupTableDef, type BackupReport } from './backupCore';

// Full data backup (one JSON file) and restore. Tables are listed parents first so a restore never breaks a link.
// profiles is not included: accounts live in Supabase Authentication and are recreated there (the owner re-approves them).
export const BACKUP_TABLES: BackupTableDef[] = [
  { name: 'clients', pk: 'id' },
  { name: 'vehicles', pk: 'id' },
  { name: 'quotations', pk: 'id' },
  { name: 'quotation_line_items', pk: 'id' },
  { name: 'payments', pk: 'id' },
  { name: 'client_payments', pk: 'id' },
  // function-only history (M3-M5): saved in every backup, never written back by Restore (the database rules create these, restoring would bypass them)
  { name: 'payment_allocations', pk: 'id', restore: false },
  { name: 'status_history', pk: 'id', restore: false },
  { name: 'reminders', pk: 'id', restore: false },
  { name: 'reminder_events', pk: 'id', restore: false },
  { name: 'cases', pk: 'id' },
  { name: 'case_documents', pk: 'id' },
  { name: 'tasks', pk: 'id' },
  { name: 'transfers', pk: 'id' },
  { name: 'inventory_items', pk: 'id' },
  { name: 'hpa_counts', pk: 'id' },
  { name: 'fee_rules', pk: 'id' },
  { name: 'punjab_rate_sets', pk: 'id' },
  { name: 'ict_rate_sets', pk: 'id' },
  { name: 'app_settings', pk: 'key' },
  { name: 'leads', pk: 'id' },
  { name: 'message_templates', pk: 'id' },
  { name: 'crm_activities', pk: 'id', restore: false },
  { name: 'client_documents', pk: 'id', restore: false },
  { name: 'expenses', pk: 'id', ownerOnly: true, restore: false },
  { name: 'fee_rule_revisions', pk: 'id', ownerOnly: true, restore: false },
  { name: 'audit_logs', pk: 'id', ownerOnly: true, restore: false },
];

export interface BackupFile { app: 'liaqat-brothers'; version: 1; created_at: string; tables: Record<string, Record<string, unknown>[]>; manifest?: Record<string, number> }

/** Reads a whole table. Only a genuine "table does not exist" is reported as missing; every other error stops the backup. */
async function fetchAll(table: string, pk: string): Promise<{ rows: Record<string, unknown>[]; missing: boolean }> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    // a stable order is required, otherwise pages can repeat or skip rows
    const { data, error } = await supabase.from(table).select('*').order(pk, { ascending: true }).range(from, from + 999);
    if (error) {
      if (from === 0 && isMissingTable(error)) return { rows: [], missing: true };
      throw new Error(`Backup stopped, ${table} could not be read (${error.code ?? 'error'}): ${error.message}`);
    }
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }
  // cross-check against the database's own row count
  const { count, error: cErr } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (cErr) throw new Error(`Backup stopped, could not confirm the row count of ${table}: ${cErr.message}`);
  if (count !== null && count !== rows.length) throw new Error(`Backup stopped, ${table} is incomplete: read ${rows.length} of ${count} rows. Try again.`);
  return { rows, missing: false };
}

export async function createBackup(opts: { isOwner: boolean }): Promise<{ file: BackupFile; counts: Record<string, number>; report: BackupReport }> {
  const tables: BackupFile['tables'] = {}; const counts: Record<string, number> = {}; const missing: string[] = []; const notIncluded: string[] = [];
  for (const t of BACKUP_TABLES) {
    if (t.ownerOnly && !opts.isOwner) { notIncluded.push(t.name); continue; }
    const r = await fetchAll(t.name, t.pk);
    if (r.missing) { missing.push(t.name); continue; }
    tables[t.name] = r.rows; counts[t.name] = r.rows.length;
  }
  const report: BackupReport = { counts, missing, notIncluded, complete: missing.length === 0 };
  return { file: { app: 'liaqat-brothers', version: 1, created_at: new Date().toISOString(), tables, manifest: counts }, counts, report };
}

export function parseBackup(text: string): BackupFile {
  let j: any;
  try { j = JSON.parse(text); } catch { throw new Error('This is not a valid backup file.'); }
  if (!j || j.app !== 'liaqat-brothers' || typeof j.tables !== 'object') throw new Error('This file is not a backup made by this app.');
  const problems = verifyManifest(j.manifest, j.tables);
  if (problems.length) throw new Error('This backup file is damaged or incomplete: ' + problems.join('; '));
  return j as BackupFile;
}

/** Parents before children inside one table (a customer's showroom must exist before the customer). */
export function orderRows(table: string, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  if (table !== 'clients') return rows;
  const ids = new Set(rows.map(r => r.id));
  const done = new Set<unknown>(); const out: Record<string, unknown>[] = []; let left = rows.slice();
  while (left.length) {
    const next = left.filter(r => !r.parent_id || !ids.has(r.parent_id) || done.has(r.parent_id));
    if (!next.length) { out.push(...left); break; }
    next.forEach(r => { done.add(r.id); out.push(r); });
    left = left.filter(r => !next.includes(r));
  }
  return out;
}

/** Restore = add back or overwrite rows by id. Nothing is deleted. */
export async function restoreBackup(file: BackupFile, onProgress?: (m: string) => void): Promise<{ restored: Record<string, number>; errors: string[] }> {
  const restored: Record<string, number> = {}; const errors: string[] = [];
  for (const t of BACKUP_TABLES) {
    if (t.restore === false) continue; // history tables are kept in the backup but never written back
    const rows = file.tables[t.name];
    if (!rows?.length) continue;
    onProgress?.(`Restoring ${t.name}...`);
    const ordered = orderRows(t.name, rows);
    let ok = 0;
    for (let i = 0; i < ordered.length; i += 200) {
      const chunk = ordered.slice(i, i + 200);
      const { error } = await supabase.from(t.name).upsert(chunk, { onConflict: t.pk });
      if (error) { errors.push(`${t.name}: ${error.message}`); break; }
      ok += chunk.length;
    }
    restored[t.name] = ok;
  }
  return { restored, errors };
}
