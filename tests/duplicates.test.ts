import { normPhone, normCnic, normPlate, normChassis, hasDuplicates, reasonText, worthChecking, NO_DUPLICATES } from '../src/lib/duplicates';
import { setPrefill, takePrefill, peekPrefill } from '../src/lib/prefill';
import { buildActivity } from '../src/lib/activity';
let fails = 0;
const eq = (n: string, g: unknown, w: unknown) => { const ok = JSON.stringify(g) === JSON.stringify(w); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : ` got=${JSON.stringify(g)} want=${JSON.stringify(w)}`}`); };

// same examples as supabase/tests/M2_client_vehicle_tests.sql T1
eq('phone dashes', normPhone('0300-1234567'), '03001234567');
eq('phone +92 with spaces', normPhone('+92 300 1234567'), '03001234567');
eq('phone 0092', normPhone('0092-300-1234567'), '03001234567');
eq('phone 92 prefix', normPhone('923001234567'), '03001234567');
eq('phone bare mobile', normPhone('3001234567'), '03001234567');
eq('phone landline kept', normPhone('042-35761234'), '04235761234');
eq('phone too short', normPhone('123'), null);
eq('phone null', normPhone(null), null);
eq('cnic dashes', normCnic('35202-1234567-1'), '3520212345671');
eq('cnic too short', normCnic('3520212345'), null);
eq('plate spaced lower', normPlate('lea-21 1234'), 'LEA211234');
eq('plate too short', normPlate('AB'), null);
eq('chassis', normChassis('jtdkb20u0-12345'), 'JTDKB20U012345');
eq('chassis too short', normChassis('1234'), null);

eq('worthChecking nothing', worthChecking({ phone: '03', cnic: '12' }), false);
eq('worthChecking phone', worthChecking({ phone: '0300-1234567' }), true);
eq('hasDuplicates empty', hasDuplicates(NO_DUPLICATES), false);
eq('hasDuplicates client', hasDuplicates({ clients: [{ id: 'x', name: 'A', phone: null, cnic: null, archived: false, reasons: ['phone'] }], vehicles: [] }), true);
eq('reason text', reasonText(['phone', 'cnic']), 'same phone number and same CNIC');

// prefill is taken once
setPrefill({ clientId: 'c1', vehicleId: 'v1' });
eq('peek keeps it', peekPrefill(), { clientId: 'c1', vehicleId: 'v1' });
eq('take returns it', takePrefill(), { clientId: 'c1', vehicleId: 'v1' });
eq('take clears it', takePrefill(), null);
setPrefill({});
eq('empty prefill ignored', takePrefill(), null);

// activity timeline: newest first, audit duplicates skipped, limit respected
const act = buildActivity({
  client: { id: 'c', name: 'Ali', created_at: '2026-11-01T05:00:00Z' },
  vehicles: [{ id: 'v1', registration_number: 'LEA-1', company: 'Toyota', model: 'Corolla', created_at: '2026-11-02T05:00:00Z' }],
  quotations: [{ id: 'q1', quotation_number: 'LB-1', status: 'approved', grand_total: 100, created_at: '2026-11-03T05:00:00Z' }],
  cases: [{ id: 'k1', case_no: 'C-1', status: 'active', created_at: '2026-11-04T05:00:00Z' }],
  payments: [{ id: 'p1', amount: 50, payment_date: '2026-11-05', created_at: '2026-11-05T09:00:00Z', text: 'Payment received (on account)' }],
  audit: [
    { id: 'a1', action: 'client_archived', details: { name: 'Ali' }, created_at: '2026-11-06T05:00:00Z' },
    { id: 'a2', action: 'vehicle_added', details: {}, created_at: '2026-11-02T05:00:01Z' },
    { id: 'a3', action: 'something_unknown', details: {}, created_at: '2026-11-07T05:00:00Z' },
  ],
});
eq('activity order', act.map(a => a.key), ['aa1', 'pp1', 'kk1', 'qq1', 'vv1', 'cc']);
eq('activity vehicle text', act.find(a => a.key === 'vv1')?.detail, 'LEA-1 · Toyota Corolla');
eq('activity limit', buildActivity({ client: { id: 'c', name: 'A', created_at: 'x' }, vehicles: [], quotations: [], cases: [], payments: [] }, 0).length, 0);

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); } else console.log('\nall passed');
