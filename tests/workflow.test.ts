import { allowedQuotationMoves, isQuotationExpired, followUpState, nextStage, docProgress, caseOverdue, CASE_STAGES } from '../src/lib/workflow';
let fails = 0;
const eq = (n: string, g: unknown, w: unknown) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ` got=${JSON.stringify(g)} want=${JSON.stringify(w)}`}`); };

// same matrix as quotation_move_allowed() in the migration
eq('staff: pending', allowedQuotationMoves('pending', 1), ['approved', 'rejected', 'draft']);
eq('staff: approved', allowedQuotationMoves('approved', 1), ['completed', 'pending', 'rejected']);
eq('staff: rejected', allowedQuotationMoves('rejected', 1), ['pending']);
eq('staff: completed is final', allowedQuotationMoves('completed', 1), []);
eq('manager: completed can be corrected', allowedQuotationMoves('completed', 2), ['draft', 'pending', 'approved', 'rejected']);
eq('staff: approved cannot go to draft', allowedQuotationMoves('approved', 1).includes('draft'), false);

eq('expired: pending past date', isQuotationExpired({ status: 'pending', validity_date: '2026-11-01' }, '2026-11-17'), true);
eq('expired: on the last day is NOT expired', isQuotationExpired({ status: 'pending', validity_date: '2026-11-17' }, '2026-11-17'), false);
eq('expired: approved never', isQuotationExpired({ status: 'approved', validity_date: '2026-01-01' }, '2026-11-17'), false);
eq('expired: no date never', isQuotationExpired({ status: 'pending', validity_date: null }, '2026-11-17'), false);

eq('follow-up overdue', followUpState('2026-11-10', 'pending', '2026-11-17'), 'overdue');
eq('follow-up today', followUpState('2026-11-17', 'pending', '2026-11-17'), 'today');
eq('follow-up later', followUpState('2026-11-20', 'approved', '2026-11-17'), 'upcoming');
eq('follow-up ignored when rejected', followUpState('2026-11-10', 'rejected', '2026-11-17'), 'none');
eq('follow-up none', followUpState(null, 'pending', '2026-11-17'), 'none');

eq('stage order', CASE_STAGES.map(s => s.value), ['new', 'documents', 'submitted', 'processing', 'ready', 'delivered']);
eq('next stage', nextStage('submitted'), 'processing');
eq('last stage has no next', nextStage('delivered'), null);
eq('missing stage = new', nextStage(undefined), 'documents');

eq('docs progress', docProgress([{ required: true, received: true }, { required: true, received: false }, { required: false, received: false }]), { required: 2, received: 1, missing: 1, complete: false });
eq('docs complete', docProgress([{ required: true, received: true }]).complete, true);
eq('no docs is not "complete"', docProgress([]).complete, false);
eq('case overdue', caseOverdue({ status: 'active', due_date: '2026-11-10' }, '2026-11-17'), true);
eq('closed case never overdue', caseOverdue({ status: 'completed', due_date: '2026-11-10' }, '2026-11-17'), false);

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); } else console.log('\nall passed');
