import { useEffect, useState } from 'react';
import { supabase, type Payment, type Quotation, type Client, type ClientPayment } from '@/lib/supabase';
import { PAGE_SIZE, Pager, PageHeader, Card, Spinner, EmptyState, Button } from '@/components/ui';
import { formatDate, formatPKR } from '@/lib/format';
import { downloadCSV } from '@/lib/csv';
import { useSettings } from '@/lib/settings';
import { Receipt, Download, Printer, Search } from 'lucide-react';
import { buildHaystack, matchesQuery } from '@/lib/search';
import { fetchAll } from '@/lib/fetchAll';
import { useCan } from '@/lib/permissions';

export const receiptNo = (p: Payment) => `RC-${p.id.slice(0, 6).toUpperCase()}`;

export default function Receipts() {
  const seesTotals = useCan('manager'); // staff see their own receipts, never a running total of the business's income
  const [page, setPage] = useState(0);
  const s = useSettings();
  const [rows, setRows] = useState<Payment[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quotation>>({});
  const [clients, setClients] = useState<Record<string, Client>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      const [p, q, c, cp] = await Promise.all([
        fetchAll<any>((a, b) => supabase.from('payments').select('*').order('payment_date', { ascending: false }).order('id').range(a, b)),
        fetchAll<any>((a, b) => supabase.from('quotations').select('*').order('id').range(a, b)),
        fetchAll<any>((a, b) => supabase.from('clients').select('*').order('id').range(a, b)),
        fetchAll<any>((a, b) => supabase.from('client_payments').select('*').order('payment_date', { ascending: false }).order('id').range(a, b)),
      ]);
      // On-account payments from a client (for example a showroom paying for several cars) are receipts too.
      const onAccount = ((cp.data as ClientPayment[]) ?? []).map(x => ({ id: x.id, quotation_id: '', amount: x.amount, payment_method: x.payment_method, payment_date: x.payment_date, reference: x.reference, notes: x.notes, created_by: x.created_by, created_at: x.created_at, client_id: x.client_id, reversed_at: x.reversed_at, reversal_reason: x.reversal_reason }) as Payment & { client_id: string });
      setRows([...(((p.data as Payment[]) ?? [])), ...onAccount].sort((a, b) => b.payment_date.localeCompare(a.payment_date)));
      setQuotes(Object.fromEntries(((q.data as Quotation[]) ?? []).map(x => [x.id, x])));
      setClients(Object.fromEntries(((c.data as Client[]) ?? []).map(x => [x.id, x])));
      setLoading(false);
    })();
  }, []);

  const clientOf = (p: Payment) => { const direct = (p as Payment & { client_id?: string }).client_id; if (direct) return clients[direct]?.name ?? ''; const q = quotes[p.quotation_id]; return q?.client_id ? clients[q.client_id]?.name ?? '' : ''; };
  const filtered = rows.filter(p => !search.trim() || matchesQuery(search, buildHaystack([receiptNo(p), clientOf(p), quotes[p.quotation_id]?.quotation_number, p.reference, p.payment_method])));
  const total = filtered.filter(p => !p.reversed_at).reduce((t, p) => t + p.amount, 0);

  function print(p: Payment) {
    const w = window.open('', '_blank', 'width=520,height=640');
    if (!w) return;
    const esc = (t: string) => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
    w.document.write(`<html><head><title>${receiptNo(p)}</title><style>body{font-family:Arial,sans-serif;padding:28px;color:#0f172a}h1{font-size:20px;margin:0}table{width:100%;border-collapse:collapse;margin-top:18px}td{padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:14px}td:first-child{color:#64748b;width:40%}.amt{font-size:22px;font-weight:700;margin-top:18px}</style></head><body>
      <h1>${esc(s.business_name)}</h1><p style="color:#64748b;margin:2px 0 18px">Payment Receipt</p>
      <table><tr><td>Receipt No</td><td>${receiptNo(p)}</td></tr><tr><td>Date</td><td>${formatDate(p.payment_date)}</td></tr>
      <tr><td>Received from</td><td>${esc(clientOf(p) || '-')}</td></tr><tr><td>Quotation</td><td>${esc(quotes[p.quotation_id]?.quotation_number ?? '-')}</td></tr>
      <tr><td>Mode</td><td>${esc(p.payment_method || '-')}</td></tr><tr><td>Reference</td><td>${esc(p.reference || '-')}</td></tr></table>
      <p class="amt">${formatPKR(p.amount)}</p><script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  }

  if (loading) return <Spinner label="Loading receipts..." />;

  return (
    <>
      <PageHeader title="Receipts" subtitle={seesTotals ? `${filtered.length} payments · ${formatPKR(total)}` : `${filtered.length} payments`}
        action={<Button variant="secondary" onClick={() => downloadCSV('receipts.csv', [['Receipt', 'Client', 'Quotation', 'Amount', 'Mode', 'Date'], ...filtered.map(p => [receiptNo(p), clientOf(p), quotes[p.quotation_id]?.quotation_number, p.amount, p.payment_method, p.payment_date])])}><Download className="w-4 h-4" /> CSV</Button>} />
      <Card className="p-4 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search receipt, client, quotation..."
            className="w-full pl-10 pr-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30" />
        </div>
      </Card>
      <Card className="overflow-hidden">
        {filtered.length === 0 ? <EmptyState icon={Receipt} title="No payments recorded" subtitle="Payments you record on a quotation show up here as receipts." /> : (
          <div className="divide-y divide-slate-100">
            {filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(p => (
              <div key={p.id} className={`flex items-center gap-3 px-4 py-3 ${p.reversed_at ? 'opacity-60' : ''}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900">{clientOf(p) || 'No client'} <span className="font-mono text-xs text-slate-500 ml-1">{receiptNo(p)}</span></p>
                  <p className="text-xs text-slate-500">{formatDate(p.payment_date)} · {p.payment_method || 'n/a'} · {quotes[p.quotation_id]?.quotation_number ?? 'On account'}{p.reversed_at ? ` · REVERSED: ${p.reversal_reason ?? ''}` : ''}</p>
                </div>
                <span className={`font-semibold tabular-nums text-slate-900 ${p.reversed_at ? 'line-through' : ''}`}>{formatPKR(p.amount)}</span>
                {!p.reversed_at && <button onClick={() => print(p)} className="p-2 text-slate-500 hover:text-slate-700" aria-label="Print receipt"><Printer className="w-4 h-4" /></button>}
              </div>
            ))}
          </div>
        )}
        <div className="px-4 pb-4"><Pager page={page} total={filtered.length} onPage={setPage} resetKey={filtered.length} /></div>
      </Card>
    </>
  );
}
