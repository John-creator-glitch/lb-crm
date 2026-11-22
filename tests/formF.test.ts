// Form F is a government form: its printed wording must never change. These tests lock the text and check typed values.
import { drawFormF, EMPTY_FORM_F, type PdfLike, type FormFValues } from '../src/lib/formF';

let fails = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  if (!ok) fails++;
}
function run(v: FormFValues) {
  const texts: string[] = []; let lines = 0, rects = 0;
  const doc: PdfLike = {
    setFont() {}, setFontSize() {}, setTextColor() {}, setDrawColor() {}, setLineWidth() {},
    line() { lines++; }, rect() { rects++; }, text(t) { texts.push(t); }, getTextWidth(t) { return t.length * 1.6; },
  };
  drawFormF(doc, v);
  return { texts, lines, rects };
}

const blank = run(EMPTY_FORM_F);
// exact printed wording (including the government's own spelling: "Pervious", "axel", and no item 18)
const printed = [
  'FORM F', '[see section 25(1)]', 'FORM OF APPLICATION FOR REGISTRATION OF MOTOR VEHICLES', '(for all types of vehicles)',
  '1.  Full Name {in block letters}', '2.  Father’s / Husband’s Name {in block letters}', '3.  Postal Address', 'Permanent Address',
  '4.  Phone No.', '5.  NTN.', '6.  CNIC', '7.  Maker’s Name', '8.  Make', '9.  Year of manufacture', '10.  Colour',
  '11.  Chassis Number', '12.  Engine Number', '13.  Engine Capacity', 'CC or', 'Kws', '14.  Type of Fuel',
  '15.  Seating Capacity (Including Driver)', '16.  Type of ownership Private/Government/Semi Government',
  '17.  Possessor of Vehicle (in case of financing)', 'I.  Name', 'II.  CNIC', 'III.  Contact',
  '19.  Pervious registration number and date of registration (if any)', '(to be filled in case of commercial vehicles)',
  '1.  Number, description and size of tyre', '2.  Maximum laden weight', '3.  Maximum axel weight',
  '(a)  Front axle', '(b)  Rear axle', '(c)  Rear axle', 'ADDITIONAL TRAILER', '(a)  Type of Body', '(b)  Unladen weight',
  '(c)  Number, description and size of tyres on the axle', '(d)  Maximum axel weight',
  'DECLARATION:', '“I hereby declare that the above Particulars are true. I further declare that the vehicle',
  'particulars of which are given above is not involved in any criminal case and neither attached or confiscated by',
  'any competent authority under any law in Pakistan.”', 'Signature of the Declarant', 'VERIFICATION:',
  'Certified that the above Particulars are correct.', 'HIRE PURCHASE:',
  'The motor vehicle above described is held by the person as the registered owner', 'Under a hire purchase agreement with',
  'Signature / Stamp of', 'Hire Purchase Party', 'Name & Signature of', 'Licensing Officer',
];
for (const p of printed) eq(`printed text present: ${p.slice(0, 40)}`, blank.texts.includes(p), true);
eq('no item 18 printed', blank.texts.some(t => /^18\./.test(t)), false);
eq('"Lbs." is printed 8 times, as on the original', blank.texts.filter(t => t === 'Lbs.').length, 8);
eq('blank form prints nothing but the form text', blank.texts.filter(t => !printed.includes(t) && t !== '–' && t !== 'Lbs.').length, 0);
eq('CNIC box is drawn', blank.rects, 1);

const v: FormFValues = { ...EMPTY_FORM_F, full_name: 'ALI KHAN', cnic: '35202-1234567-1', chassis: 'ABC123', postal_address: 'House 1 Lahore' };
const f = run(v);
eq('typed name printed', f.texts.includes('ALI KHAN'), true);
eq('typed chassis printed', f.texts.includes('ABC123'), true);
eq('CNIC digits go one per box', f.texts.filter(t => /^\d$/.test(t)).join(''), '3520212345671');
eq('filled form has the same lines as blank', f.lines, blank.lines);
eq('CNIC longer than 13 digits is cut', run({ ...EMPTY_FORM_F, cnic: '123456789012345678' }).texts.filter(t => /^\d$/.test(t)).length, 13);
eq('empty values print nothing extra', run({ ...EMPTY_FORM_F, full_name: '   ' }).texts.length, blank.texts.length);

if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
