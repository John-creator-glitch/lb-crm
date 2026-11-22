import { isMissingTable, verifyManifest } from '../src/lib/backupCore';
let fails = 0;
const eq = (n: string, g: unknown, w: unknown) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ` got=${JSON.stringify(g)} want=${JSON.stringify(w)}`}`); };

eq('PostgREST missing table', isMissingTable({ code: 'PGRST205', message: "Could not find the table 'public.cases' in the schema cache" }), true);
eq('Postgres undefined table', isMissingTable({ code: '42P01', message: 'relation "public.cases" does not exist' }), true);
eq('message-only missing table', isMissingTable({ message: "Could not find the table 'public.tasks' in the schema cache" }), true);
eq('permission denied is NOT missing', isMissingTable({ code: '42501', message: 'permission denied for table payments' }), false);
eq('RLS/JWT error is NOT missing', isMissingTable({ code: 'PGRST301', message: 'JWT expired' }), false);
eq('network error is NOT missing', isMissingTable({ message: 'TypeError: Failed to fetch' }), false);
eq('timeout is NOT missing', isMissingTable({ code: '57014', message: 'canceling statement due to statement timeout' }), false);
eq('no error', isMissingTable(null), false);
eq('manifest ok', verifyManifest({ clients: 2 }, { clients: [1, 2] }), []);
eq('manifest missing rows', verifyManifest({ clients: 3 }, { clients: [1, 2] }).length, 1);
eq('manifest missing table', verifyManifest({ payments: 1 }, {}).length, 1);
eq('old file without manifest accepted', verifyManifest(undefined, { clients: [1] }), []);
if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
