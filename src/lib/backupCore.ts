// Pure helpers for backup (no database calls, so they can be tested).

/** True ONLY when the error really means "this table does not exist". Network, permission and server errors must never pass. */
export function isMissingTable(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === 'PGRST205' || err.code === '42P01') return true;
  return /could not find the table .* in the schema cache/i.test(err.message ?? '') || /relation .* does not exist/i.test(err.message ?? '');
}

export interface BackupTableDef { name: string; pk: string; /** only the owner can read it */ ownerOnly?: boolean; /** false = saved in the backup but never written back by Restore */ restore?: boolean }

export interface BackupReport {
  counts: Record<string, number>;
  /** table does not exist in this database (migration not run) */
  missing: string[];
  /** left out on purpose because this user's role cannot read it */
  notIncluded: string[];
  /** true only if every table was read in full and its row count matches the database count */
  complete: boolean;
}

/** Compare the counts written into a backup file with the rows it really holds. Returns problems (empty list = file is intact). */
export function verifyManifest(manifest: Record<string, number> | undefined, tables: Record<string, unknown[]>): string[] {
  if (!manifest) return [];
  const problems: string[] = [];
  for (const [name, n] of Object.entries(manifest)) {
    const have = tables[name]?.length ?? 0;
    if (have !== n) problems.push(`${name}: file says ${n} rows but holds ${have}`);
  }
  return problems;
}
