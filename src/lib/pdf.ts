import type { Quotation, QuotationLineItem, Client, Vehicle } from './supabase';
import { formatPKR, formatDate } from './format';

const BRAND = {
  name: 'Liaqat Brothers',
  tagline: 'Excise & Vehicle Registration Services',
  website: 'www.liaqatbrothers.com',
  phone: '+92 300 0000000',
  address: 'Lahore, Punjab, Pakistan',
};

export function generateQuotationPDF(
  quotation: Quotation,
  lineItems: QuotationLineItem[],
  client: Client | null,
  vehicle: Vehicle | null,
): string {
  const govtItems = lineItems.filter(li => li.category === 'government');
  const serviceItems = lineItems.filter(li => li.category === 'service');
  const additionalItems = lineItems.filter(li => li.category === 'additional');

  const itemsTable = (items: QuotationLineItem[]) =>
    items
      .map(
        li => `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">
            <div style="font-weight:500;color:#1e293b;">${escapeHtml(li.label)}</div>
            ${li.formula ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;">${escapeHtml(li.formula)}</div>` : ''}
            ${li.is_override ? `<div style="font-size:11px;color:#dc2626;margin-top:2px;">Manually overridden: ${escapeHtml(li.override_reason ?? '')}</div>` : ''}
            ${li.source ? `<div style="font-size:11px;color:#94a3b8;margin-top:1px;">Source: ${escapeHtml(li.source)}</div>` : ''}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;color:#1e293b;white-space:nowrap;">${formatPKR(li.amount)}</td>
        </tr>`,
      )
      .join('');

  const sectionTable = (title: string, items: QuotationLineItem[], subtotal: number) =>
    items.length === 0
      ? ''
      : `<div style="margin-top:24px;">
          <h3 style="font-size:13px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">${title}</h3>
          <table style="width:100%;border-collapse:collapse;">
            <tbody>${itemsTable(items)}</tbody>
          </table>
          <div style="text-align:right;padding:8px 12px;font-weight:600;color:#1e293b;border-top:2px solid #f59e0b;">Subtotal: ${formatPKR(subtotal)}</div>
        </div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Quotation ${quotation.quotation_number}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #475569; font-size: 13px; line-height: 1.6; }
  .page { max-width: 800px; margin: 0 auto; padding: 40px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #f59e0b; padding-bottom: 20px; margin-bottom: 30px; }
  .brand-name { font-size: 24px; font-weight: 800; color: #1e293b; }
  .brand-tagline { font-size: 12px; color: #94a3b8; margin-top: 2px; }
  .brand-contact { font-size: 11px; color: #94a3b8; margin-top: 6px; line-height: 1.5; }
  .quote-meta { text-align: right; }
  .quote-number { font-size: 18px; font-weight: 700; color: #f59e0b; }
  .quote-date { font-size: 12px; color: #94a3b8; margin-top: 4px; }
  .quote-valid { font-size: 11px; color: #94a3b8; margin-top: 2px; }
  .section-title { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 20px; }
  .info-card { background: #f8fafc; border-radius: 8px; padding: 16px; }
  .info-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 12px; }
  .info-label { color: #94a3b8; }
  .info-value { color: #1e293b; font-weight: 500; }
  .totals { background: #1e293b; color: white; border-radius: 12px; padding: 24px; margin-top: 24px; }
  .total-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }
  .total-row.grand { border-top: 1px solid rgba(255,255,255,0.2); margin-top: 8px; padding-top: 14px; font-size: 18px; font-weight: 700; }
  .total-row.grand .amount { color: #f59e0b; }
  .disclaimer { margin-top: 30px; padding: 16px; background: #fef3c7; border-radius: 8px; border-left: 4px solid #f59e0b; }
  .disclaimer-title { font-size: 12px; font-weight: 700; color: #92400e; margin-bottom: 4px; }
  .disclaimer-text { font-size: 11px; color: #78350f; line-height: 1.6; }
  .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #cbd5e1; border-top: 1px solid #e2e8f0; padding-top: 16px; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="brand-name">${BRAND.name}</div>
      <div class="brand-tagline">${BRAND.tagline}</div>
      <div class="brand-contact">${BRAND.address}<br/>${BRAND.phone} · ${BRAND.website}</div>
    </div>
    <div class="quote-meta">
      <div class="quote-number">${quotation.quotation_number}</div>
      <div class="quote-date">Date: ${formatDate(quotation.created_at.slice(0, 10))}</div>
      <div class="quote-valid">Valid until: ${formatDate(quotation.validity_date)}</div>
    </div>
  </div>

  <div class="info-grid">
    <div class="info-card">
      <div class="section-title">Client</div>
      ${client ? `
        <div class="info-row"><span class="info-label">Name</span><span class="info-value">${escapeHtml(client.name)}</span></div>
        ${client.phone ? `<div class="info-row"><span class="info-label">Phone</span><span class="info-value">${escapeHtml(client.phone)}</span></div>` : ''}
        ${client.email ? `<div class="info-row"><span class="info-label">Email</span><span class="info-value">${escapeHtml(client.email)}</span></div>` : ''}
        ${client.cnic ? `<div class="info-row"><span class="info-label">CNIC</span><span class="info-value">${escapeHtml(client.cnic)}</span></div>` : ''}
      ` : '<div class="info-row"><span class="info-value">Walk-in client</span></div>'}
    </div>
    <div class="info-card">
      <div class="section-title">Vehicle</div>
      ${vehicle ? `
        ${vehicle.company ? `<div class="info-row"><span class="info-label">Company</span><span class="info-value">${escapeHtml(vehicle.company)}</span></div>` : ''}
        ${vehicle.model ? `<div class="info-row"><span class="info-label">Model</span><span class="info-value">${escapeHtml(vehicle.model)}</span></div>` : ''}
        ${vehicle.engine_cc ? `<div class="info-row"><span class="info-label">Engine</span><span class="info-value">${vehicle.engine_cc} cc</span></div>` : ''}
        ${vehicle.manufacturing_year ? `<div class="info-row"><span class="info-label">Year</span><span class="info-value">${vehicle.manufacturing_year}</span></div>` : ''}
        ${vehicle.fuel_type ? `<div class="info-row"><span class="info-label">Fuel</span><span class="info-value" style="text-transform:capitalize;">${vehicle.fuel_type}</span></div>` : ''}
        ${vehicle.registration_number ? `<div class="info-row"><span class="info-label">Reg #</span><span class="info-value">${escapeHtml(vehicle.registration_number)}</span></div>` : ''}
      ` : '<div class="info-row"><span class="info-value">N/A</span></div>'}
    </div>
  </div>

  ${sectionTable('Government Fees', govtItems, quotation.subtotal_govt)}
  ${sectionTable('Liaqat Brothers Service Charges', serviceItems, quotation.subtotal_service)}
  ${sectionTable('Additional Expenses', additionalItems, quotation.subtotal_additional)}

  <div class="totals">
    <div class="total-row"><span>Government Fees</span><span class="amount">${formatPKR(quotation.subtotal_govt)}</span></div>
    ${quotation.subtotal_service > 0 ? `<div class="total-row"><span>Service Charges</span><span class="amount">${formatPKR(quotation.subtotal_service)}</span></div>` : ''}
    ${quotation.subtotal_additional > 0 ? `<div class="total-row"><span>Additional Expenses</span><span class="amount">${formatPKR(quotation.subtotal_additional)}</span></div>` : ''}
    <div class="total-row grand"><span>Grand Total</span><span class="amount">${formatPKR(quotation.grand_total)}</span></div>
  </div>

  ${quotation.payment_terms ? `<div style="margin-top:20px;font-size:12px;color:#64748b;"><strong>Payment Terms:</strong> ${escapeHtml(quotation.payment_terms)}</div>` : ''}

  <div class="disclaimer">
    <div class="disclaimer-title">Official Fee Verification Notice</div>
    <div class="disclaimer-text">
      The government fees shown in this quotation are based on rate schedules maintained by Liaqat Brothers and
      verified against official provincial excise sources. Rates may change without notice. Final charges will be
      confirmed at the time of processing with the relevant excise authority. Liaqat Brothers service charges are
      separate from government fees. This quotation is valid for 15 days from the date of issue.
    </div>
  </div>

  <div class="footer">
    ${BRAND.name} · ${BRAND.tagline} · ${BRAND.website}<br/>
    This is a computer-generated quotation and does not require a signature.
  </div>
</div>
</body>
</html>`;

  return html;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Pakistani numbers: 0300-1234567, +92 300 1234567, 923001234567 and 3001234567 all become 923001234567 (wa.me needs country code, no zero, no symbols).
export function normalizePkPhone(raw: string | null | undefined): string | null {
  const d = (raw ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0092')) return d.slice(2);
  if (d.startsWith('92') && d.length >= 12) return d;
  if (d.startsWith('0') && d.length === 11) return '92' + d.slice(1);
  if (d.length === 10 && d.startsWith('3')) return '92' + d;
  return d.length >= 11 ? d : null; // other international numbers pass through; short junk is rejected
}

// Full quotation as plain text (WhatsApp, email and copy all use this).
export function buildQuotationMessage(
  quotation: Quotation,
  lineItems: QuotationLineItem[],
  client: Client | null,
  vehicle: Vehicle | null,
): string {
  const L: string[] = [];
  const section = (title: string, cat: string, subtotal: number) => {
    const rows = lineItems.filter(li => li.category === cat);
    if (!rows.length) return;
    L.push(`*${title}*`);
    rows.forEach(li => L.push(`- ${li.label}: ${formatPKR(li.amount)}`));
    L.push(`Subtotal: ${formatPKR(subtotal)}`, '');
  };
  L.push(`*Liaqat Brothers - Quotation ${quotation.quotation_number}*`, '');
  L.push(`Dear ${client?.name ?? 'Customer'},`, '');
  if (vehicle) {
    const v = [vehicle.company, vehicle.model].filter(Boolean).join(' ');
    L.push('*Vehicle*');
    if (v) L.push(v + (vehicle.engine_cc ? ` (${vehicle.engine_cc}cc)` : ''));
    if (vehicle.registration_number) L.push(`Registration No: ${vehicle.registration_number.toUpperCase()}`);
    L.push('');
  }
  section('Government Fees', 'government', quotation.subtotal_govt);
  section('Service Charges', 'service', quotation.subtotal_service);
  section('Additional Expenses', 'additional', quotation.subtotal_additional);
  L.push(`*Grand Total: ${formatPKR(quotation.grand_total)}*`, '');
  if (quotation.payment_terms) L.push(`Payment terms: ${quotation.payment_terms}`, '');
  L.push(`Valid until: ${formatDate(quotation.validity_date)}`);
  L.push('Final government amount is confirmed by the e-pay challan.', '');
  L.push(`Liaqat Brothers - ${BRAND.tagline}`, BRAND.phone);
  return L.join('\n');
}

export function buildWhatsAppMessage(quotation: Quotation, client: Client | null, lineItems: QuotationLineItem[] = [], vehicle: Vehicle | null = null): string {
  return buildQuotationMessage(quotation, lineItems, client, vehicle);
}
