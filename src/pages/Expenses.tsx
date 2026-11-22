import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { PageHeader, Card, Spinner, EmptyState, Badge, Button, Field, Input, Select, Textarea } from '@/components/ui';
import { EXPENSE_CATEGORIES, PAID_FROM, type Expense } from '@/lib/crm';
import { friendlyError } from '@/lib/errors';
import { fetchAll } from '@/lib/fetchAll';
import { formatDate } from '@/lib/format';
import { formatPKR } from '@/lib/format';
import { pkToday, addDays } from '@/lib/time';
import { Wallet, Plus, X, Ban } from 'lucide-react';

interface Summary { total: number; count: number; by_category: { category: string; total: number }[]; by_method: Record<string, number> }
const blank = () => ({ expense_date: pkToday(), category: 'other', amount: '', paid_from: 'cash', description: '' });

export default function Expenses() {
  const today = pkToday();
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [cat, setCat] = useState('');
  const [rows, setRows] = useState<Expense[]>([]);
  const [sum, setSum] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState<ReturnType<typeof blank> | null>(null);
  const [voiding, setVoiding] = useState<Expense | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [r, s] = await Promise.all([
      fetchAll<Expense>((a, b) => supabase.from('expenses').select('*').gte('expense_date', from).lte('expense_date', to).order('expense_date', { ascending: false }).order('id').range(a, b) as never),
      supabase.rpc('expense_summary', { p_from: from, p_to: to }),
    ]);
    if (r.error) setError('Expenses could not be loaded: ' + friendlyError(r.error));
    setRows(r.data ?? []);
    setSum(s.error ? null : (s.data as Summary));
    setLoading(false);
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!form) return;
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setError('Enter an amount greater than zero.'); return; }
    if (form.expense_date > addDays(today, 1)) { setError('Date cannot be in the future.'); return; }
    const { error: e } = await supabase.from('expenses').insert({ expense_date: form.expense_date, category: form.category, amount, paid_from: form.paid_from, description: form.description.trim() || null });
    if (e) { setError(friendlyError(e)); return; }
    setForm(null); setError(''); await load();
  }
  async function doVoid() {
    if (!voiding) return;
    if (reason.trim().length < 3) { setError('Write the reason for cancelling.'); return; }
    const { error: e } = await supabase.rpc('void_expense', { p_id: voiding.id, p_reason: reason.trim() });
    if (e) { setError(friendlyError(e)); return; }
    setVoiding(null); setReason(''); setError(''); await load();
  }

  const shown = rows.filter(r => !cat || r.category === cat);
  return (
    <div>
      <PageHeader title="Expenses" subtitle="Rent, salaries, fuel, agent payments. Nothing is deleted. A wrong entry is cancelled with a reason." action={<Button onClick={() => { setForm(blank()); setError(''); }}><Plus className="w-4 h-4" /> Add expense</Button>} />
      {error && <div role="alert" className="mb-3 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <Field label="From"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
        <Field label="Category"><Select value={cat} onChange={e => setCat(e.target.value)}><option value="">All</option>{Object.entries(EXPENSE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      </div>
      {sum && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Card className="p-3"><p className="text-xs text-slate-500">Total spent</p><p className="text-lg font-bold">{formatPKR(Number(sum.total))}</p><p className="text-xs text-slate-400">{sum.count} entries</p></Card>
          {(sum.by_category ?? []).slice(0, 3).map(c => <Card key={c.category} className="p-3"><p className="text-xs text-slate-500">{EXPENSE_CATEGORIES[c.category] ?? c.category}</p><p className="text-lg font-bold">{formatPKR(Number(c.total))}</p></Card>)}
        </div>
      )}
      {loading ? <Spinner /> : shown.length === 0 ? <EmptyState icon={Wallet} title="No expenses in this period" /> : (
        <div className="space-y-2">
          {shown.map(r => (
            <Card key={r.id} className={`p-3 ${r.voided_at ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className={`font-semibold ${r.voided_at ? 'line-through' : ''}`}>{formatPKR(Number(r.amount))} <span className="font-normal text-slate-500 text-sm">· {EXPENSE_CATEGORIES[r.category]} · {PAID_FROM[r.paid_from]}</span></p>
                  <p className="text-xs text-slate-500">{formatDate(r.expense_date)}{r.description ? ` · ${r.description}` : ''}{r.voided_at ? ` · Cancelled: ${r.void_reason}` : ''}</p>
                </div>
                {r.voided_at ? <Badge className="bg-slate-200 text-slate-600">Cancelled</Badge> : <Button size="sm" variant="ghost" onClick={() => { setVoiding(r); setReason(''); setError(''); }}><Ban className="w-4 h-4" /> Cancel</Button>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {form && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Add expense">
          <Card className="w-full sm:max-w-lg p-4 sm:p-6 rounded-b-none sm:rounded-b-xl">
            <div className="flex justify-between mb-3"><h2 className="font-bold text-lg">Add expense</h2><button aria-label="Close" onClick={() => setForm(null)}><X className="w-5 h-5" /></button></div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Date"><Input type="date" max={today} value={form.expense_date} onChange={e => setForm({ ...form, expense_date: e.target.value })} /></Field>
              <Field label="Amount (PKR)" required><Input type="number" inputMode="decimal" min="1" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></Field>
              <Field label="Category"><Select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{Object.entries(EXPENSE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Paid from"><Select value={form.paid_from} onChange={e => setForm({ ...form, paid_from: e.target.value })}>{Object.entries(PAID_FROM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            </div>
            <Field label="Details"><Textarea rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="flex justify-end gap-2 mt-4"><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button onClick={save}>Save</Button></div>
          </Card>
        </div>
      )}
      {voiding && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Cancel expense">
          <Card className="w-full max-w-md p-5">
            <h2 className="font-bold mb-1">Cancel this expense?</h2>
            <p className="text-sm text-slate-500 mb-3">{formatPKR(Number(voiding.amount))} · {EXPENSE_CATEGORIES[voiding.category]}. It stays in the record, marked cancelled.</p>
            <Field label="Reason" required><Input value={reason} onChange={e => setReason(e.target.value)} /></Field>
            <div className="flex justify-end gap-2 mt-4"><Button variant="secondary" onClick={() => setVoiding(null)}>Back</Button><Button variant="danger" onClick={doVoid}>Cancel expense</Button></div>
          </Card>
        </div>
      )}
    </div>
  );
}
