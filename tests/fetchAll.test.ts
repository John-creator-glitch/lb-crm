import { fetchAll, PAGE, MAX_ROWS } from '../src/lib/fetchAll';
let fail = 0; const t = (n: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${n}`); if (!ok) fail++; };
const source = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));
const fake = (rows: { id: number }[], calls: number[][] = []) => (a: number, b: number) => { calls.push([a, b]); return Promise.resolve({ data: rows.slice(a, b + 1), error: null }); };
(async () => {
  let calls: number[][] = []; let r = await fetchAll(fake(source(0), calls));
  t('empty list: one request, no rows', r.data!.length === 0 && calls.length === 1 && !r.truncated);
  calls = []; r = await fetchAll(fake(source(999), calls)); t('999 rows: one request', r.data!.length === 999 && calls.length === 1);
  calls = []; r = await fetchAll(fake(source(1000), calls)); t('exactly 1000 rows: second request confirms the end', r.data!.length === 1000 && calls.length === 2);
  calls = []; r = await fetchAll(fake(source(2500), calls)); t('2500 rows: 3 pages, ranges 0-999, 1000-1999, 2000-2999', r.data!.length === 2500 && calls.length === 3 && calls[1][0] === 1000 && calls[2][1] === 2999);
  t('no duplicates or gaps', new Set(r.data!.map(x => x.id)).size === 2500 && r.data![2499].id === 2499);
  r = await fetchAll(() => Promise.resolve({ data: null, error: { message: 'boom' } })); t('error is returned, not swallowed', r.error?.message === 'boom' && r.data === null);
  let n = 0; r = await fetchAll(() => { n++; return Promise.resolve({ data: source(PAGE), error: null }); });
  t('runaway query stops at the safety cap and says so', r.truncated && n === MAX_ROWS / PAGE);
  if (fail) process.exit(1);
})();
