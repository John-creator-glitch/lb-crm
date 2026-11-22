import { jsPDF } from 'jspdf';
import type { Quotation, QuotationLineItem, Client, Vehicle } from './supabase';
import type { BusinessSettings } from './brand';
import type { CustomField } from './customFields';

// One-page A4 quotation, drawn as a real PDF (selectable text, small file, sharp on any phone).
// If a quotation has many lines, spacing and text are scaled down automatically until everything fits on ONE page.

export interface QuotationPdfInput {
  quotation: Quotation;
  items: QuotationLineItem[];
  client: Client | null;
  vehicle: Vehicle | null;
  settings: BusinessSettings;
  customFields?: CustomField[] | null;
  hirePurchase?: boolean;
}
export interface QuotationPdfResult { blob: Blob; filename: string; pages: number; scale: number }

const PAGE_W = 210, PAGE_H = 297, M = 12;               // mm
const BODY_BOTTOM = PAGE_H - 22;                          // footer band lives below this

const rgb = (hex: string): [number, number, number] => {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? '0f172a';
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
// Standard PDF fonts only cover Latin text. Common typographic characters are mapped; anything else (e.g. Urdu script) becomes "?".
export const latin = (s: unknown): string =>
  String(s ?? '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/ /g, ' ')
    .replace(/[^\x09\x0A\x20-\x7E¡-ÿ]/g, '?');
export const hasNonLatin = (s: string) => /[^\x09\x0A\x20-\x7E¡-ÿ‘’“”–—…]/.test(s);
const money = (n: number) => (n < 0 ? '-' : '') + 'Rs ' + Math.abs(Math.round(n)).toLocaleString('en-US');
const fmtDate = (d: string | null | undefined) => {
  if (!d) return '-';
  const t = new Date(d);
  return isNaN(t.getTime()) ? '-' : t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const lines = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean);

function draw(doc: jsPDF, d: QuotationPdfInput, s: number): number {
  const { quotation: q, items, client, vehicle, settings: st } = d;
  const brand = rgb(st.brand_color), accent = rgb(st.accent_color);
  const W = PAGE_W - 2 * M;
  const fs = (n: number) => doc.setFontSize(n * s);
  const txt = (t: string, x: number, y: number, o?: { align?: 'left' | 'right' | 'center'; maxWidth?: number }) => doc.text(latin(t), x, y, o as any);
  const wrap = (t: string, w: number) => doc.splitTextToSize(latin(t), w) as string[];
  const set = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const fill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);
  const slate: [number, number, number] = [71, 85, 105], light: [number, number, number] = [148, 163, 184], dark: [number, number, number] = [15, 23, 42];
  const panel: [number, number, number] = [241, 245, 249];

  // ---- header
  let y = M;
  const logoH = 18;
  let textX = M;
  if (st.logo_data_url) {
    try {
      const p = doc.getImageProperties(st.logo_data_url);
      const w = Math.min(36, logoH * (p.width / p.height));
      doc.addImage(st.logo_data_url, 'PNG', M, y, w, logoH);
      textX = M + w + 4;
    } catch { /* fall back to monogram */ }
  }
  if (textX === M) {
    fill(brand); doc.roundedRect(M, y, logoH, logoH, 2.5, 2.5, 'F');
    doc.setFont('helvetica', 'bold'); fs(15); doc.setTextColor(255, 255, 255);
    const ini = latin(st.business_name).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'LB';
    txt(ini, M + logoH / 2, y + logoH / 2 + 2 * s, { align: 'center' });
    textX = M + logoH + 4;
  }
  doc.setFont('helvetica', 'bold'); fs(17); set(brand); txt(st.business_name, textX, y + 6.5);
  doc.setFont('helvetica', 'bold'); fs(8.5); set(accent); txt(st.tagline, textX, y + 11.5);
  doc.setFont('helvetica', 'normal'); fs(7.5); set(slate);
  const contact = [st.phone && `Tel/WhatsApp: ${st.phone}`, st.website, st.email].filter(Boolean).join('   |   ');
  txt(contact, textX, y + 15.5, { maxWidth: PAGE_W - M - textX - 52 });
  // right: document title and numbers
  doc.setFont('helvetica', 'bold'); fs(20); set(accent); txt(st.document_title.toUpperCase(), PAGE_W - M, y + 7, { align: 'right' });
  doc.setFont('helvetica', 'normal'); fs(8); set(slate);
  txt(`No: ${q.quotation_number}`, PAGE_W - M, y + 12.5, { align: 'right' });
  txt(`Date: ${fmtDate(q.created_at)}`, PAGE_W - M, y + 16.5, { align: 'right' });
  y += 23.5;
  fill(accent); doc.rect(M, y, W, 0.9, 'F');
  y += 4 * s + 1;

  // ---- prepared for / vehicle panels
  const colW = (W - 4) / 2;
  const clientLines: string[] = [];
  if (client?.name) clientLines.push(client.name);
  if (client?.phone) clientLines.push(`Mobile: ${client.phone}`);
  if (client?.cnic) clientLines.push(`CNIC: ${client.cnic}`);
  if (client?.address) clientLines.push(client.address);
  if (!clientLines.length) clientLines.push('Walk-in customer');
  const service = ({ new_registration: 'New Registration', transfer: 'Ownership Transfer', token_tax: 'Token Tax' } as Record<string, string>)[q.transaction_type ?? ''] ?? 'Vehicle service';
  const prov = vehicle?.province ? ({ punjab: 'Punjab', sindh: 'Sindh', islamabad: 'Islamabad (ICT)', kpk: 'Khyber Pakhtunkhwa' } as Record<string, string>)[vehicle.province] : '';
  const veh: string[] = [`${service}${prov ? ' - ' + prov : ''}`];
  const mk = [vehicle?.company, vehicle?.model].filter(Boolean).join(' ');
  if (mk) veh.push(mk + (vehicle?.manufacturing_year ? ` (${vehicle.manufacturing_year})` : ''));
  const spec = [vehicle?.engine_cc ? `${vehicle.engine_cc} cc` : '', vehicle?.fuel_type ?? '', vehicle?.filer_status === 'filer' ? 'Filer' : vehicle?.filer_status === 'non_filer' ? 'Non-filer' : ''].filter(Boolean).join('  |  ');
  if (spec) veh.push(spec);
  if (vehicle?.registration_number) veh.push(`Reg. No: ${vehicle.registration_number.toUpperCase()}`);
  if (d.hirePurchase) veh.push('Bank financed (HPA)');
  const lh = 4.1 * s;
  const panelH = (n: number) => 8 * s + n * lh;
  doc.setFont('helvetica', 'normal'); fs(8.5);
  const wc = clientLines.flatMap(l => wrap(l, colW - 6));
  const wv = veh.flatMap(l => wrap(l, colW - 6));
  const ph = Math.max(panelH(wc.length), panelH(wv.length));
  [[M, 'PREPARED FOR', wc], [M + colW + 4, 'VEHICLE / SERVICE', wv]].forEach(([x, title, ls]) => {
    fill(panel); doc.roundedRect(x as number, y, colW, ph, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold'); fs(7); set(light); txt(title as string, (x as number) + 3, y + 4.2 * s);
    (ls as string[]).forEach((l, i) => {
      doc.setFont('helvetica', i === 0 ? 'bold' : 'normal'); fs(i === 0 ? 9.5 : 8.5); set(i === 0 ? dark : slate);
      doc.text(l, (x as number) + 3, y + 8.6 * s + i * lh);
    });
  });
  y += ph + 4.5 * s;

  // ---- fee table
  fill(brand); doc.rect(M, y, W, 6.5 * s, 'F');
  doc.setFont('helvetica', 'bold'); fs(8.5); doc.setTextColor(255, 255, 255);
  txt('DESCRIPTION', M + 3, y + 4.4 * s); txt('AMOUNT', PAGE_W - M - 3, y + 4.4 * s, { align: 'right' });
  y += 6.5 * s;

  const section = (title: string, cat: string, totalLabel: string, total: number) => {
    const rows = items.filter(i => i.category === cat && Math.round(i.amount) !== 0).sort((a, b) => a.sort_order - b.sort_order);
    if (!rows.length) return;
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z]/g, '');
    const single = rows.length === 1 && cat !== 'government' && norm(rows[0].label) === norm(title); // header, row and total would all say the same thing
    if (!single) {
      fill(panel); doc.rect(M, y, W, 5 * s, 'F');
      doc.setFont('helvetica', 'bold'); fs(7.5); set(accent); txt(title, M + 3, y + 3.5 * s);
      y += 5 * s;
    }
    rows.forEach((r, idx) => {
      const basis = ''; // the owner PDF never prints calculation notes like "4% of ..."
      const rh = (basis ? 8.2 : 5.6) * s;
      doc.setFont('helvetica', 'normal'); fs(9); set(dark); txt(r.label, M + 3, y + (basis ? 3.9 : 3.9) * s, { maxWidth: W - 45 });
      if (basis) { fs(6.8); set(light); txt(basis, M + 3, y + 7 * s, { maxWidth: W - 45 }); }
      doc.setFont('helvetica', 'bold'); fs(9); set(dark); txt(money(r.amount), PAGE_W - M - 3, y + 3.9 * s, { align: 'right' });
      y += rh;
      doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.2); if (idx < rows.length - 1) doc.line(M + 3, y, PAGE_W - M - 3, y);
    });
    // subtotal row
    doc.setDrawColor(accent[0], accent[1], accent[2]); doc.setLineWidth(0.4); doc.line(M, y, PAGE_W - M, y);
    if (single) { y += 1.5 * s; return; }
    doc.setFont('helvetica', 'bold'); fs(9); set(brand);
    txt(totalLabel, M + 3, y + 4.3 * s); txt(money(total), PAGE_W - M - 3, y + 4.3 * s, { align: 'right' });
    y += 6.2 * s;
  };
  section('GOVERNMENT CHALLAN (PAID TO EXCISE)', 'government', 'Challan Total', q.subtotal_govt);
  section('SERVICE CHARGES', 'service', 'Service Total', q.subtotal_service);
  section('ADDITIONAL EXPENSES', 'additional', 'Additional Total', q.subtotal_additional);

  // grand total bar
  y += 1.5 * s;
  fill(brand); doc.roundedRect(M, y, W, 10 * s, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold'); fs(11); doc.setTextColor(255, 255, 255); txt('GRAND TOTAL', M + 4, y + 6.6 * s);
  fs(14); txt(money(q.grand_total), PAGE_W - M - 4, y + 6.9 * s, { align: 'right' });
  y += 10 * s + 4 * s;

  // ---- estimate notice (the only text under the totals)
  const warn: [number, number, number] = [180, 83, 9];
  doc.setFont('helvetica', 'bold'); fs(9);
  // Prices and government fees change, so no validity date is printed. The government challan sentence is always present, even if an older saved note lacks it.
  // Older saved notes may still say "Excise e-pay challan": print "Government challan" instead.
  const GOVT_NOTE = 'Government fees will be as per the Government challan at the time of payment.';
  const baseNote = (st.estimate_note || 'These prices are estimated and are not final.').replace(/(the\s+)?(Excise\s+)?e-?pay\s+challan/gi, 'the Government challan').replace(/\be-?pay\b/gi, 'Government challan');
  const noteText = /government\s+challan/i.test(baseNote) ? baseNote : `${baseNote} ${GOVT_NOTE}`;
  const nl = wrap(noteText, W - 10);
  const nh = nl.length * 4.4 * s + 5 * s;
  doc.setFillColor(254, 243, 199); doc.roundedRect(M, y, W, nh, 1.5, 1.5, 'F');
  set(warn); nl.forEach((l, i) => doc.text(l, M + 5, y + 5.2 * s + i * 4.4 * s));
  y += nh + 2 * s;
  return y;
}

function footer(doc: jsPDF, st: BusinessSettings) {
  const brand = rgb(st.brand_color), accent = rgb(st.accent_color);
  doc.setFillColor(accent[0], accent[1], accent[2]); doc.rect(0, PAGE_H - 15, PAGE_W, 1.2, 'F');
  doc.setFillColor(brand[0], brand[1], brand[2]); doc.rect(0, PAGE_H - 13.8, PAGE_W, 13.8, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
  doc.text(latin(st.business_name) + ' - ' + latin(st.tagline), PAGE_W / 2, PAGE_H - 8, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
  doc.text(latin([st.address, st.phone].filter(Boolean).join('   |   ')), PAGE_W / 2, PAGE_H - 4, { align: 'center', maxWidth: PAGE_W - 2 * M });
}

export function buildQuotationPdf(d: QuotationPdfInput): QuotationPdfResult {
  // Find the largest scale at which the content fits above the footer.
  let scale = 1;
  for (; scale > 0.5; scale = +(scale - 0.03).toFixed(2)) {
    const probe = new jsPDF({ unit: 'mm', format: 'a4' });
    if (draw(probe, d, scale) <= BODY_BOTTOM) break;
  }
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: `${d.settings.document_title} ${d.quotation.quotation_number}`, author: d.settings.business_name, subject: 'Vehicle excise quotation' });
  draw(doc, d, scale);
  footer(doc, d.settings);
  const buf = doc.output('arraybuffer');
  const reg = d.vehicle?.registration_number ? '-' + d.vehicle.registration_number.toUpperCase().replace(/[^A-Z0-9]+/g, '') : '';
  return {
    blob: new Blob([buf], { type: 'application/pdf' }),
    filename: `${d.settings.business_name.replace(/\s+/g, '')}-${d.quotation.quotation_number}${reg}.pdf`,
    pages: doc.getNumberOfPages(),
    scale,
  };
}
