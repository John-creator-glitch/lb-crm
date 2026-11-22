import { generateTempPassword, passwordProblem } from '../src/lib/password';
let fails = 0;
function ok(name: string, cond: boolean) { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) fails++; }
ok('short password refused', passwordProblem('abc123') !== null);
ok('letters only refused', passwordProblem('abcdefghij') !== null);
ok('digits only refused', passwordProblem('1234567890') !== null);
ok('good password accepted', passwordProblem('Lahore2026') === null);
ok('mismatch refused', passwordProblem('Lahore2026', 'Lahore2027') !== null);
ok('match accepted', passwordProblem('Lahore2026', 'Lahore2026') === null);
ok('73 characters refused', passwordProblem('a1' + 'x'.repeat(71)) !== null);
const t = generateTempPassword(12, n => new Uint32Array(Array.from({ length: n }, (_, i) => i * 7919)));
ok('temp password has the asked length', t.length === 12);
ok('temp password has no look-alike characters', !/[0O1lI]/.test(generateTempPassword(200, n => new Uint32Array(Array.from({ length: n }, (_, i) => i * 31 + 5)))));
let allValid = true; for (let i = 0; i < 2000; i++) { if (passwordProblem(generateTempPassword(12)) !== null) allValid = false; }
ok('2000 generated passwords are all acceptable', allValid);
ok('two temp passwords differ', generateTempPassword() !== generateTempPassword());
if (fails) process.exit(1);
