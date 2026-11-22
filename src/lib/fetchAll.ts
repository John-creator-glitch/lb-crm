// Reads EVERY row of a list, page by page. Supabase returns at most 1,000 rows per request; without this a shop with more than 1,000
// quotations would silently see (and total up) only the first 1,000. PURE (no imports) so it is unit tested.
export type Page<T> = { data: T[] | null; error: { message: string } | null };
export const PAGE = 1000;
export const MAX_ROWS = 50_000;   // safety stop: a runaway query must not freeze the browser

/** make(from, to) must return ONE page, ordered by a UNIQUE key as its last order-by (add .order('id')), e.g.
 *  fetchAll<Client>((a, b) => supabase.from('clients').select('*').order('name').order('id').range(a, b)) */
export async function fetchAll<T>(make: (from: number, to: number) => PromiseLike<Page<T>>): Promise<Page<T> & { truncated: boolean }> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const r = await make(from, from + PAGE - 1);
    if (r.error) return { data: null, error: r.error, truncated: false };
    const rows = r.data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return { data: out, error: null, truncated: false };
  }
  return { data: out, error: null, truncated: true };
}
