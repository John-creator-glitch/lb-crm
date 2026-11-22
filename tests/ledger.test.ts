import { buildLedger, pendingByAccount, payerOf, payState, paidOnQuotation, unallocated, ageingFor, ageingAll } from '../src/lib/ledger';
let fails = 0;
const eq = (n: string, g: unknown, w: unknown) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ` got=${JSON.stringify(g)} want=${JSON.stringify(w)}`}`); };

const clients = [
  { id: 'S', name: 'Star Motors', opening_balance: 5000 },
  { id: 'A', name: 'Ali', parent_id: 'S', bill_to_parent: true },
  { id: 'B', name: 'Bilal', parent_id: 'S', bill_to_parent: false },
  { id: 'D', name: 'Direct Dan' },
];
const quotations = [
  { id: 'q1', client_id: 'A', grand_total: 20000, status: 'approved', created_at: '2026-11-01T10:00:00Z', quotation_number: 'LB-1' },
  { id: 'q2', client_id: 'S', grand_total: 10000, status: 'pending', created_at: '2026-11-02T10:00:00Z', quotation_number: 'LB-2' },
  { id: 'q3', client_id: 'A', grand_total: 99999, status: 'rejected', created_at: '2026-11-03T10:00:00Z', quotation_number: 'LB-3' },
  { id: 'q4', client_id: 'B', grand_total: 7000, status: 'completed', created_at: '2026-11-03T10:00:00Z', quotation_number: 'LB-4' },
  { id: 'q5', client_id: 'D', grand_total: 3000, status: 'draft', created_at: '2026-11-03T10:00:00Z', quotation_number: 'LB-5' },
];
const payments = [{ id: 'p1', quotation_id: 'q1', amount: 5000, payment_date: '2026-11-04' }, { id: 'p2', quotation_id: 'q4', amount: 7000, payment_date: '2026-11-05' }];
const clientPayments = [{ id: 'c1', client_id: 'S', amount: 8000, payment_date: '2026-11-06' }];
const data = { clients, quotations, payments, clientPayments };

eq('payer: bill_to_parent', payerOf(clients[1]), 'S');
eq('payer: not billed to parent', payerOf(clients[2]), 'B');
const s = buildLedger('S', data);
eq('showroom billed (own + customer A, rejected/other excluded)', s.billed, 30000);
eq('showroom received (A payment + on account)', s.received, 13000);
eq('showroom pending = 5000 opening + 30000 - 13000', s.pending, 22000);
eq('last running balance equals pending', s.lines[s.lines.length - 1].balance, 22000);
eq('opening line first', s.lines[0].kind, 'opening');
const b = buildLedger('B', data);
eq('Bilal own account: billed 7000 paid 7000', [b.billed, b.received, b.pending], [7000, 7000, 0]);
eq('draft not billed', buildLedger('D', data).pending, 0);
const m = pendingByAccount(data);
eq('pendingByAccount showroom matches ledger', m.get('S')?.pending, 22000);
eq('pendingByAccount child billed to parent is zero', m.get('A')?.pending, 0);
eq('pendingByAccount Bilal', m.get('B')?.pending, 0);
eq('payState unpaid', payState(1000, 0), 'unpaid');
eq('payState partial', payState(1000, 400), 'partial');
eq('payState paid', payState(1000, 1000), 'paid');
eq('payState advance', payState(1000, 1500), 'advance');

// ---- M4: reversal, allocation, ageing (same figures as supabase/tests/M4_finance_tests.sql) ----
const mc = [{ id: 'S', name: 'Showroom', opening_balance: 500 }, { id: 'C', name: 'Cust', parent_id: 'S', bill_to_parent: true }, { id: 'X', name: 'Solo' }];
const mq = [
  { id: 'q1', client_id: 'C', grand_total: 1000, status: 'approved', created_at: '2026-10-01T10:00:00Z', quotation_number: 'Q1' },
  { id: 'q2', client_id: 'C', grand_total: 600, status: 'pending', created_at: '2026-10-20T10:00:00Z', quotation_number: 'Q2' },
  { id: 'q3', client_id: 'C', grand_total: 300, status: 'draft', created_at: '2026-10-25T10:00:00Z', quotation_number: 'Q3' },
  { id: 'q4', client_id: 'X', grand_total: 2000, status: 'approved', created_at: '2026-08-01T10:00:00Z', quotation_number: 'Q4' },
];
const mp = [{ id: 'p1', quotation_id: 'q1', amount: 400, payment_date: '2026-10-02' }, { id: 'p2', quotation_id: 'q3', amount: 50, payment_date: '2026-10-26' }];
const mcp = [{ id: 'c1', client_id: 'S', amount: 700, payment_date: '2026-10-27' }];
const md = { clients: mc, quotations: mq, payments: mp, clientPayments: mcp };
const L = buildLedger('S', md);
eq('M4 ledger: opening 500, billed 1600, received 1150, pending 950', [L.opening, L.billed, L.received, L.pending], [500, 1600, 1150, 950]);
const alloc = [{ id: 'a1', client_payment_id: 'c1', quotation_id: 'q2', amount: 600 }, { id: 'a2', client_payment_id: 'c1', quotation_id: 'q1', amount: 100 }];
eq('M4 allocation does not change the balance (counted once)', buildLedger('S', md).pending, 950);
eq('M4 Q2 paid by allocation', paidOnQuotation('q2', { payments: mp, allocations: alloc }), { direct: 0, allocated: 600, paid: 600 });
eq('M4 Q1 direct 400 + allocated 100', paidOnQuotation('q1', { payments: mp, allocations: alloc }).paid, 500);
eq('M4 voided allocation counts for nothing', paidOnQuotation('q2', { payments: mp, allocations: [{ ...alloc[0], voided_at: 'x' }] }).paid, 0);
eq('M4 unallocated of the 700 payment after 700 allocated', unallocated(mcp[0], alloc), 0);
eq('M4 unallocated with only 600 allocated', unallocated(mcp[0], [alloc[0]]), 100);
const revd = { ...md, clientPayments: [{ ...mcp[0], reversed_at: '2026-11-01', reversal_reason: 'Cheque bounced' }] };
const R = buildLedger('S', revd);
eq('M4 reversed on-account payment: received 450, pending 1650', [R.received, R.pending], [450, 1650]);
eq('M4 reversed payment stays in the statement, marked, credit 0', R.lines.filter(l => l.reversed).map(l => [l.credit, l.onAccount]), [[0, true]]);
eq('M4 last running balance equals pending after reversal', R.lines[R.lines.length - 1].balance, R.pending);
eq('M4 pendingByAccount ignores reversed', pendingByAccount(revd).get('S')?.pending, 1650);
eq('M4 reversed unallocated is 0', unallocated(revd.clientPayments[0], []), 0);
const R2 = buildLedger('S', { ...md, payments: [{ ...mp[0], reversed_at: 'x', reversal_reason: 'wrong quotation' }, mp[1]] });
eq('M4 reversed direct payment raises pending by 400', R2.pending, 1350);
// ageing: today 2026-11-18. Credits 1150 go to the oldest bills: opening 500 (90+), Q1 1000 (48 days), Q2 600 (29 days)
const A = ageingFor('S', md, '2026-11-18');
eq('M4 ageing: oldest bills are paid first', A, { current: 600, d31: 350, d61: 0, d90: 0, total: 950, advance: 0 });
eq('M4 ageing total equals ledger pending', A.total, L.pending);
const A2 = ageingFor('S', { ...md, payments: [], clientPayments: [{ id: 'c1', client_id: 'S', amount: 100, payment_date: '2026-10-27' }] }, '2026-11-18');
eq('M4 ageing: opening 500 less 100 received leaves 400 in 90+', A2.d90, 400);
eq('M4 ageing X: 2000 billed 109 days ago is 90+', ageingFor('X', md, '2026-11-18'), { current: 0, d31: 0, d61: 0, d90: 2000, total: 2000, advance: 0 });
eq('M4 advance when overpaid', ageingFor('X', { ...md, payments: [{ id: 'px', quotation_id: 'q4', amount: 2500, payment_date: '2026-09-01' }] }, '2026-11-18').advance, 500);
eq('M4 ageingAll lists payer accounts only, biggest first', ageingAll(md, '2026-11-18').map(r => r.account.id), ['X', 'S']);
if (fails) process.exit(1);
