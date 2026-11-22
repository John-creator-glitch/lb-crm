// Form F: "Form of application for registration of motor vehicles" [see section 25(1)].
// The printed wording, numbering (17 is followed by 19, there is no 18) and spelling are copied exactly from the
// government form. Do NOT "correct" them. Only the typed values are ours.
// Layout is stored in the pixel space of the scanned original and mapped onto A4 portrait.

export interface FormFValues {
  full_name: string; father_name: string;
  postal_address: string; permanent_address: string;
  phone: string; ntn: string; cnic: string;
  maker: string; make: string; year: string; colour: string;
  chassis: string; engine_no: string; cc: string; kws: string;
  fuel: string; seats: string; ownership: string;
  poss_name: string; poss_cnic: string; poss_contact: string;
  prev_reg: string;
  tyre: string; laden_total: string; laden_front: string; laden_rear_b: string; laden_rear_c: string;
  axle_total: string; axle_front: string; axle_rear_b: string; axle_rear_c: string;
  trailer_body: string; trailer_unladen: string; trailer_tyres: string; trailer_axle: string;
  hire_purchase_with: string;
}

// Other pages (e.g. Transfers) leave data here before opening the Form F page
export const FORM_F_PREFILL_KEY = 'lb_formf_prefill';

export const EMPTY_FORM_F: FormFValues = {
  full_name: '', father_name: '', postal_address: '', permanent_address: '', phone: '', ntn: '', cnic: '',
  maker: '', make: '', year: '', colour: '', chassis: '', engine_no: '', cc: '', kws: '', fuel: '', seats: '', ownership: '',
  poss_name: '', poss_cnic: '', poss_contact: '', prev_reg: '',
  tyre: '', laden_total: '', laden_front: '', laden_rear_b: '', laden_rear_c: '', axle_total: '', axle_front: '', axle_rear_b: '', axle_rear_c: '',
  trailer_body: '', trailer_unladen: '', trailer_tyres: '', trailer_axle: '', hire_purchase_with: '',
};

// The subset of the jsPDF API used here (lets tests run without jsPDF).
export interface PdfLike {
  setFont(name: string, style?: string): unknown;
  setFontSize(n: number): unknown;
  setTextColor(r: number, g?: number, b?: number): unknown;
  setDrawColor(r: number, g?: number, b?: number): unknown;
  setLineWidth(w: number): unknown;
  line(x1: number, y1: number, x2: number, y2: number): unknown;
  rect(x: number, y: number, w: number, h: number, style?: string): unknown;
  text(t: string, x: number, y: number, opts?: { align?: 'left' | 'center' | 'right' }): unknown;
  getTextWidth(t: string): number;
}

// px (scan) -> mm (A4)
const X = (px: number) => 16 + (px - 126) * 0.2595;
const Y = (py: number) => 14 + (py - 52) * 0.2329;
const SIZE = 9.5;

type Fld = { key?: keyof FormFValues; label?: string; lx?: number; y: number; x1?: number; x2?: number };

// label + underline. `key` is the value written on the underline.
const FIELDS: Fld[] = [
  { key: 'full_name', label: '1.  Full Name {in block letters}', lx: 126, y: 138, x1: 326, x2: 812 },
  { key: 'father_name', label: '2.  Father’s / Husband’s Name {in block letters}', lx: 126, y: 174, x1: 438, x2: 812 },
  { key: 'postal_address', label: '3.  Postal Address', lx: 126, y: 209, x1: 247, x2: 812 },
  { y: 247, x1: 126, x2: 812 }, // 2nd line of postal address (value continues here)
  { key: 'permanent_address', label: 'Permanent Address', lx: 127, y: 278, x1: 258, x2: 812 },
  { y: 316, x1: 127, x2: 812 }, // 2nd line of permanent address
  { key: 'phone', label: '4.  Phone No.', lx: 126, y: 340, x1: 219, x2: 437 },
  { key: 'ntn', label: '5.  NTN.', lx: 443, y: 340, x1: 502, x2: 812 },
  { key: 'maker', label: '7.  Maker’s Name', lx: 126, y: 412, x1: 249, x2: 437 },
  { key: 'make', label: '8.  Make', lx: 443, y: 412, x1: 503, x2: 812 },
  { key: 'year', label: '9.  Year of manufacture', lx: 126, y: 446, x1: 284, x2: 437 },
  { key: 'colour', label: '10.  Colour', lx: 443, y: 446, x1: 513, x2: 812 },
  { key: 'chassis', label: '11.  Chassis Number', lx: 126, y: 481, x1: 261, x2: 812 },
  { key: 'engine_no', label: '12.  Engine Number', lx: 126, y: 515, x1: 254, x2: 812 },
  { key: 'cc', label: '13.  Engine Capacity', lx: 126, y: 550, x1: 261, x2: 437 },
  { key: 'kws', label: 'CC or', lx: 443, y: 550, x1: 487, x2: 575 },
  { label: 'Kws', lx: 580, y: 550 },
  { key: 'fuel', label: '14.  Type of Fuel', lx: 126, y: 585, x1: 237, x2: 437 },
  { key: 'seats', label: '15.  Seating Capacity (Including Driver)', lx: 443, y: 585, x1: 700, x2: 812 },
  { key: 'ownership', label: '16.  Type of ownership Private/Government/Semi Government', lx: 130, y: 620, x1: 527, x2: 808 },
  { label: '17.  Possessor of Vehicle (in case of financing)', lx: 126, y: 652 },
  { key: 'poss_name', label: 'I.  Name', lx: 153, y: 688, x1: 217, x2: 463 },
  { key: 'poss_cnic', label: 'II.  CNIC', lx: 153, y: 723, x1: 217, x2: 463 },
  { key: 'poss_contact', label: 'III.  Contact', lx: 153, y: 758, x1: 235, x2: 463 },
  { key: 'tyre', label: '1.  Number, description and size of tyre', lx: 179, y: 826, x1: 415, x2: 773 },
  { key: 'laden_total', label: '2.  Maximum laden weight', lx: 179, y: 846, x1: 334, x2: 397 },
  { label: 'Lbs.', lx: 400, y: 846 },
  { key: 'axle_total', label: '3.  Maximum axel weight', lx: 443, y: 846, x1: 611, x2: 708 },
  { label: 'Lbs.', lx: 712, y: 846 },
  { key: 'laden_front', label: '(a)  Front axle', lx: 179, y: 866, x1: 277, x2: 397 },
  { label: 'Lbs.', lx: 400, y: 866 },
  { key: 'axle_front', label: '(a)  Front axle', lx: 466, y: 866, x1: 561, x2: 708 },
  { label: 'Lbs.', lx: 712, y: 866 },
  { key: 'laden_rear_b', label: '(b)  Rear axle', lx: 179, y: 885, x1: 277, x2: 397 },
  { label: 'Lbs.', lx: 400, y: 885 },
  { key: 'axle_rear_b', label: '(b)  Rear axle', lx: 466, y: 885, x1: 565, x2: 708 },
  { label: 'Lbs.', lx: 712, y: 885 },
  { key: 'laden_rear_c', label: '(c)  Rear axle', lx: 179, y: 905, x1: 277, x2: 397 },
  { label: 'Lbs.', lx: 400, y: 905 },
  { key: 'axle_rear_c', label: '(c)  Rear axle', lx: 466, y: 905, x1: 565, x2: 708 },
  { label: 'Lbs.', lx: 712, y: 905 },
  { key: 'trailer_body', label: '(a)  Type of Body', lx: 179, y: 950, x1: 300, x2: 520 },
  { key: 'trailer_unladen', label: '(b)  Unladen weight', lx: 179, y: 969, x1: 313, x2: 520 },
  { key: 'trailer_tyres', label: '(c)  Number, description and size of tyres on the axle', lx: 179, y: 989, x1: 526, x2: 773 },
  { key: 'trailer_axle', label: '(d)  Maximum axel weight', lx: 179, y: 1008, x1: 358, x2: 580 },
  { key: 'hire_purchase_with', label: 'Under a hire purchase agreement with', lx: 126, y: 1144, x1: 381, x2: 790 },
];

function digits(s: string) { return (s || '').replace(/\D/g, ''); }

export function drawFormF(doc: PdfLike, v: FormFValues): void {
  doc.setTextColor(0, 0, 0); doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.25);
  const bold = (size = SIZE) => { doc.setFont('times', 'bold'); doc.setFontSize(size); };
  // Print `text` so that it is exactly `width` mm wide (shrinks/stretches the size slightly, capped at maxSize)
  const fit = (text: string, px: number, py: number, widthPx: number, maxSize = SIZE) => {
    bold(10); const w10 = doc.getTextWidth(text);
    const size = Math.min(maxSize, (10 * (widthPx * 0.2595)) / w10);
    bold(size); doc.text(text, X(px), Y(py));
  };

  // ---- title block
  doc.setTextColor(0, 0, 0);
  bold(21); doc.text('FORM F', X(462), Y(60), { align: 'center' });
  bold(9); doc.text('[see section 25(1)]', X(462), Y(79), { align: 'center' });
  bold(11); doc.text('FORM OF APPLICATION FOR REGISTRATION OF MOTOR VEHICLES', X(462), Y(97), { align: 'center' });
  bold(10); doc.text('(for all types of vehicles)', X(462), Y(115), { align: 'center' });

  // ---- label + line fields
  for (const f of FIELDS) {
    if (f.label) {
      // size the label so it ends where the original's underline starts (clamped, so it never looks odd)
      let size = 10;
      if (f.x1 !== undefined && f.lx !== undefined) {
        bold(10); const w10 = doc.getTextWidth(f.label);
        size = Math.max(8.5, Math.min(10.5, (10 * ((f.x1 - f.lx) * 0.2595 - 1.2)) / w10));
      }
      bold(size); doc.text(f.label, X(f.lx as number), Y(f.y));
    }
    if (f.x1 !== undefined && f.x2 !== undefined) doc.line(X(f.x1), Y(f.y + 3), X(f.x2), Y(f.y + 3));
  }
  const vals = v as unknown as Record<string, string>;
  const put = (key: string, x1: number, x2: number, y: number) => {
    const t = (vals[key] || '').trim(); if (!t) return;
    doc.setFont('helvetica', 'normal');
    let size = 9.5; doc.setFontSize(size);
    const max = (x2 - x1) * 0.2595 - 2;
    while (doc.getTextWidth(t) > max && size > 5.5) { size -= 0.25; doc.setFontSize(size); }
    doc.text(t, X(x1) + 1.2, Y(y + 3) - 0.9);
  };
  for (const f of FIELDS) {
    if (!f.key || f.x1 === undefined || f.x2 === undefined) continue;
    if (f.key === 'postal_address' || f.key === 'permanent_address') continue; // 2-line, handled below
    put(f.key, f.x1, f.x2, f.y);
  }
  // ---- two-line address values
  const twoLines = (key: 'postal_address' | 'permanent_address', xA: number, yA: number, xB: number, yB: number) => {
    const t = (vals[key] || '').trim(); if (!t) return;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    const maxA = (812 - xA) * 0.2595 - 2, maxB = (812 - xB) * 0.2595 - 2;
    const words = t.split(/\s+/); let l1 = '', i = 0;
    while (i < words.length && doc.getTextWidth((l1 ? l1 + ' ' : '') + words[i]) <= maxA) { l1 = (l1 ? l1 + ' ' : '') + words[i]; i++; }
    if (!l1 && words.length) { l1 = words[0]; i = 1; }
    let l2 = words.slice(i).join(' ');
    let size = 9.5; doc.setFontSize(size);
    while (doc.getTextWidth(l2) > maxB && size > 5.5) { size -= 0.25; doc.setFontSize(size); }
    doc.setFontSize(9.5); doc.text(l1, X(xA) + 1.2, Y(yA + 3) - 0.9);
    doc.setFontSize(size); if (l2) doc.text(l2, X(xB) + 1.2, Y(yB + 3) - 0.9);
  };
  twoLines('postal_address', 247, 209, 126, 247);
  twoLines('permanent_address', 258, 278, 127, 316);

  // ---- 6. CNIC boxes
  bold(); doc.text('6.  CNIC', X(126), Y(374));
  const bx = [194, 236, 277, 318, 359, 400, 441, 482, 523, 564, 605, 646, 687, 728, 769, 811];
  doc.rect(X(194), Y(352), (811 - 194) * 0.2595, 29 * 0.2329, 'S');
  for (let i = 1; i < bx.length - 1; i++) doc.line(X(bx[i]), Y(352), X(bx[i]), Y(381));
  bold(11);
  doc.text('–', X((400 + 441) / 2), Y(373), { align: 'center' });
  doc.text('–', X((728 + 769) / 2), Y(373), { align: 'center' });
  const cells = [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 14]; // indices of the 13 digit cells (5 + 7 + 1)
  const d = digits(v.cnic).slice(0, 13);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  for (let i = 0; i < d.length; i++) {
    const c = cells[i]; doc.text(d[i], X((bx[c] + bx[c + 1]) / 2), Y(373), { align: 'center' });
  }

  // ---- 19. previous registration (no underline in the original: the typed value follows the printed text)
  bold(); const t19 = '19.  Pervious registration number and date of registration (if any)';
  doc.text(t19, X(126), Y(777));
  if ((v.prev_reg || '').trim()) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    doc.text(v.prev_reg.trim(), X(126) + doc.getTextWidth(t19) + 8, Y(777)); // after the printed text
  }
  bold(10.5); doc.text('(to be filled in case of commercial vehicles)', X(462), Y(800), { align: 'center' });

  // ---- section: ADDITIONAL TRAILER
  bold(10.5); doc.text('ADDITIONAL TRAILER', X(127), Y(932));

  // ---- declaration / verification / hire purchase
  bold(11.5); doc.text('DECLARATION:', X(127), Y(1036));
  bold(11.5); const dw = doc.getTextWidth('DECLARATION:');
  const first = '“I hereby declare that the above Particulars are true. I further declare that the vehicle';
  bold(9.5); doc.text(first, X(127) + dw + 0.5, Y(1036));
  fit('particulars of which are given above is not involved in any criminal case and neither attached or confiscated by', 127, 1055, 688);
  fit('any competent authority under any law in Pakistan.”', 127, 1074, 330);
  bold(9); doc.text('Signature of the Declarant', X(815), Y(1094), { align: 'right' });
  bold(11.5); doc.text('VERIFICATION:', X(127), Y(1104)); const vw = doc.getTextWidth('VERIFICATION:');
  bold(9); doc.text('Certified that the above Particulars are correct.', X(127) + vw + 1.5, Y(1104));
  bold(11.5); doc.text('HIRE PURCHASE:', X(127), Y(1122)); const hw = doc.getTextWidth('HIRE PURCHASE:');
  bold(9); doc.text('The motor vehicle above described is held by the person as the registered owner', X(127) + hw + 1.5, Y(1122));
  // "Under a hire purchase agreement with" + line are in FIELDS
  bold(9.5);
  doc.text('Signature / Stamp of', X(202), Y(1193)); doc.text('Hire Purchase Party', X(202), Y(1210));
  doc.text('Name & Signature of', X(585), Y(1192)); doc.text('Licensing Officer', X(585), Y(1209));
}

// Browser entry point. jsPDF is loaded on demand so the main bundle stays small.
export async function buildFormFPdf(v: FormFValues): Promise<{ blob: Blob; filename: string }> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: 'Form F - Application for Registration of Motor Vehicles', subject: 'Form F [see section 25(1)]' });
  drawFormF(doc as unknown as PdfLike, v);
  const buf = doc.output('arraybuffer');
  const tag = (v.chassis || v.full_name || 'blank').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 20) || 'blank';
  return { blob: new Blob([buf], { type: 'application/pdf' }), filename: `FormF-${tag}.pdf` };
}
