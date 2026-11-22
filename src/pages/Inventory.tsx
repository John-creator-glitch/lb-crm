import { useCan } from '@/lib/permissions';
import { useEffect, useState } from 'react';
import { supabase, type InventoryItem } from '@/lib/supabase';
import { PageHeader, Card, Spinner, EmptyState, Button, Field, Input, Badge } from '@/components/ui';
import { downloadCSV } from '@/lib/csv';
import { formatDate } from '@/lib/format';
import { Boxes, Plus, X, Trash2, Download, Minus } from 'lucide-react';

const blank = { name: '', category: '', quantity: '', min_level: '' };

export default function Inventory() {
  const [rows, setRows] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(blank);
  const [lowOnly, setLowOnly] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error: e } = await supabase.from('inventory_items').select('*').order('name');
    if (e) setError(e.message.includes('inventory') ? 'The inventory table is missing. Run the new migration (20261107090000_crm_cases_tasks_inventory.sql) in Supabase.' : e.message);
    setRows((data as InventoryItem[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!form.name.trim()) return;
    const { error: e } = await supabase.from('inventory_items').insert({ name: form.name.trim(), category: form.category || null, quantity: Number(form.quantity) || 0, min_level: Number(form.min_level) || 0 });
    if (e) { setError(e.message); return; }
    setForm(blank); setShow(false); setError(''); load();
  }

  async function adjust(i: InventoryItem, delta: number) {
    const q = Math.max(0, i.quantity + delta);
    setRows(rs => rs.map(r => (r.id === i.id ? { ...r, quantity: q } : r)));
    await supabase.from('inventory_items').update({ quantity: q }).eq('id', i.id);
  }

  const canDelete = useCan('manager');
  async function remove(i: InventoryItem) {
    if (!confirm(`Delete ${i.name}?`)) return;
    await supabase.from('inventory_items').delete().eq('id', i.id);
    setRows(rs => rs.filter(r => r.id !== i.id));
  }

  const low = (i: InventoryItem) => i.quantity <= i.min_level;
  const shown = rows.filter(i => !lowOnly || low(i));

  if (loading) return <Spinner label="Loading inventory..." />;

  return (
    <>
      <PageHeader title="Inventory" subtitle={`${rows.filter(low).length} items at or below minimum`}
        action={<div className="flex gap-2">
          <Button variant="secondary" onClick={() => downloadCSV('inventory.csv', [['Item', 'Category', 'In Stock', 'Min Level'], ...rows.map(i => [i.name, i.category, i.quantity, i.min_level])])}><Download className="w-4 h-4" /> CSV</Button>
          <Button onClick={() => setShow(!show)}><Plus className="w-4 h-4" /> Add Item</Button>
        </div>} />
      {error && <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>}

      {show && (
        <Card className="p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">New Item</h2>
            <button onClick={() => setShow(false)} className="text-slate-500"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Item" required><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Category"><Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Forms, plates, stationery" /></Field>
            <Field label="In stock"><Input type="number" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} /></Field>
            <Field label="Minimum level"><Input type="number" value={form.min_level} onChange={e => setForm({ ...form, min_level: e.target.value })} /></Field>
            <div className="sm:col-span-2 flex justify-end"><Button onClick={add} disabled={!form.name.trim()}>Save Item</Button></div>
          </div>
        </Card>
      )}

      <label className="flex items-center gap-2 text-sm text-slate-600 mb-4"><input type="checkbox" checked={lowOnly} onChange={e => setLowOnly(e.target.checked)} /> Show low stock only</label>

      <Card className="overflow-hidden">
        {shown.length === 0 ? <EmptyState icon={Boxes} title="No items" /> : (
          <div className="divide-y divide-slate-100">
            {shown.map(i => (
              <div key={i.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900">{i.name}</p>
                  <p className="text-xs text-slate-500">{i.category || 'Uncategorized'} · min {i.min_level} · updated {formatDate(i.updated_at)}</p>
                </div>
                {low(i) && <Badge className="bg-rose-100 text-rose-700">Low</Badge>}
                <div className="flex items-center gap-1">
                  <button onClick={() => adjust(i, -1)} className="w-8 h-8 rounded-lg border border-slate-300 flex items-center justify-center" aria-label="Decrease"><Minus className="w-4 h-4" /></button>
                  <span className="w-10 text-center font-semibold tabular-nums">{i.quantity}</span>
                  <button onClick={() => adjust(i, 1)} className="w-8 h-8 rounded-lg border border-slate-300 flex items-center justify-center" aria-label="Increase"><Plus className="w-4 h-4" /></button>
                </div>
                {canDelete && <button onClick={() => remove(i)} className="p-2 text-slate-300 hover:text-rose-500" aria-label="Delete"><Trash2 className="w-4 h-4" /></button>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
