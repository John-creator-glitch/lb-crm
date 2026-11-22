import { parseInvoice, parseAmount } from '../src/lib/invoiceParser';
let fail = 0;
const eq = (n: string, g: unknown, w: unknown) => { const ok = g === w; if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', n, g, w); };
// Synthetic invoice text. The real dealer invoice layout is NOT tested yet.
const t = `Invoice Date: 28-09-2026
Make: TOYOTA
Model: CROSS
Model Year: 2026
Engine Capacity: 1798
Fuel: Hybrid
Chassis No: ZVG10R0911520
Engine No: 9Z13521
Colour: ATTITUDE BLACK
Total Invoice Value: Rs. 9,309,140`;
const d = parseInvoice(t);
eq('date', d.invoice_date, '2026-09-28');
eq('price', d.price_candidates[0]?.value, 9309140);
eq('cc', d.engine_cc, 1798);
eq('year', d.manufacturing_year, 2026);
eq('fuel', d.fuel_type, 'hybrid');
eq('chassis', d.chassis_number, 'ZVG10R0911520');
eq('no price', parseInvoice('hello').price_candidates.length, 0);
// Real scanned Indus Motor (Toyota) invoice, 29.10.2026, as read from the OCR text layer. Amounts have stray spaces and dots.
const scan = `Invoico Dato                           29.10.2026
FORTUNER 645B/481D 4X2 GAT                        2TRB483383                  TGN166R-0895950                 218 Attitude Black             8,693,296.51
                                       2694CC
                                      Ex-Factory Price                                                            MOTO                                                             11.953.282. 70
                                       NEV Adoption Levy @3.00%
                                                                                                                                                                                    12.435.000.00
                                      Invoice Value with Levy
                                     GROSS AMOUNT                                                                                                                                  12,556, 000.00
Gross Amount (words) : RUPEES TWELVE MILLION FIVE HUNDRED FIFTY-SIX THOUSAND ONLY
Rs. 1.130.040.00 from the customer`;
const s = parseInvoice(scan);
eq('scan price', s.price_candidates[0]?.value, 12556000);
eq('scan date', s.invoice_date, '2026-10-29');
eq('scan cc', s.engine_cc, 2694);
eq('amount 12.435.000.00', parseAmount('12.435.000.00'), 12435000);
eq('amount 11.953.282. 70', parseAmount('11.953.282. 70'), 11953282.7);
eq('amount plain', parseAmount('9,309,140'), 9309140);
// Fallback when labels are lost: largest amount wins
eq('fallback price', parseInvoice('x 8,693,296.51 y 12,556,000.00 z 1.130.040.00').price_candidates[0]?.value, 12556000);
process.exit(fail ? 1 : 0);
