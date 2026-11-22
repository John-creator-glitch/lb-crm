import { pkToday } from '@/lib/time';
import { useCan } from '@/lib/permissions';
import { useEffect, useState } from 'react';
import { supabase, type TaskRow, type CaseRow } from '@/lib/supabase';
import { PageHeader, Card, Spinner, EmptyState, Button, Field, Input, Select, Textarea, Badge } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { ListChecks, Plus, X, Trash2, Check } from 'lucide-react';
import { friendlyError } from '@/lib/errors';

const PRI = { high: 'bg-rose-100 text-rose-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-slate-100 text-slate-600' } as const;
const blank = { title: '', notes: '', due_date: '', priority: 'medium' as TaskRow['priority'], case_id: '' };

export default function Tasks() {
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(blank);
  const [filter, setFilter] = useState<'pending' | 'completed' | 'all'>('pending');

  async function load() {
    setLoading(true);
    const [t, c] = await Promise.all([
      supabase.from('tasks').select('*').order('due_date', { ascending: true, nullsFirst: false }),
      supabase.from('cases').select('id, case_no').order('created_at', { ascending: false }).limit(200),
    ]);
    if (t.error) setError(t.error.message.includes('tasks') ? 'The tasks table is missing. Run the new migration (20261107090000_crm_cases_tasks_inventory.sql) in Supabase.' : friendlyError(t.error));
    setRows((t.data as TaskRow[]) ?? []);
    setCases((c.data as CaseRow[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!form.title.trim()) return;
    const { error: e } = await supabase.from('tasks').insert({ title: form.title.trim(), notes: form.notes || null, due_date: form.due_date || null, priority: form.priority, case_id: form.case_id || null });
    if (e) { setError(e.message); return; }
    setForm(blank); setShow(false); setError(''); load();
  }

  async function toggle(t: TaskRow) {
    const done = t.status !== 'completed';
    await supabase.from('tasks').update({ status: done ? 'completed' : 'pending', completed_at: done ? new Date().toISOString() : null }).eq('id', t.id);
    load();
  }

  const canDelete = useCan('manager');
  async function remove(t: TaskRow) {
    await supabase.from('tasks').delete().eq('id', t.id);
    setRows(rs => rs.filter(x => x.id !== t.id));
  }

  const today = pkToday();
  const shown = rows.filter(t => filter === 'all' || t.status === filter);
  const caseNo = (id: string | null) => cases.find(c => c.id === id)?.case_no;

  if (loading) return <Spinner label="Loading tasks..." />;

  return (
    <>
      <PageHeader title="Tasks" subtitle={`${rows.filter(t => t.status === 'pending').length} pending`}
        action={<Button onClick={() => setShow(!show)}><Plus className="w-4 h-4" /> Add Task</Button>} />
      {error && <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">{error}</div>}

      {show && (
        <Card className="p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">New Task</h2>
            <button onClick={() => setShow(false)} className="text-slate-500"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2"><Field label="Task" required><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></Field></div>
            <Field label="Due date"><Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></Field>
            <Field label="Priority">
              <Select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as TaskRow['priority'] })}>
                <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Related case">
                <Select value={form.case_id} onChange={e => setForm({ ...form, case_id: e.target.value })}>
                  <option value="">None</option>
                  {cases.map(c => <option key={c.id} value={c.id}>{c.case_no}</option>)}
                </Select>
              </Field>
            </div>
            <div className="sm:col-span-2"><Field label="Notes"><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field></div>
            <div className="sm:col-span-2 flex justify-end"><Button onClick={add} disabled={!form.title.trim()}>Save Task</Button></div>
          </div>
        </Card>
      )}

      <div className="flex gap-2 mb-4">
        {(['pending', 'completed', 'all'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-sm capitalize ${filter === f ? 'bg-slate-900 text-white' : 'bg-white border border-slate-300 text-slate-600'}`}>{f}</button>
        ))}
      </div>

      <Card className="overflow-hidden">
        {shown.length === 0 ? <EmptyState icon={ListChecks} title="No tasks here" /> : (
          <div className="divide-y divide-slate-100">
            {shown.map(t => {
              const overdue = t.status === 'pending' && t.due_date && t.due_date < today;
              return (
                <div key={t.id} className="flex items-start gap-3 px-4 py-3">
                  <button onClick={() => toggle(t)} aria-label="Toggle done" className={`mt-0.5 w-6 h-6 rounded-md border flex items-center justify-center flex-shrink-0 ${t.status === 'completed' ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300'}`}>
                    {t.status === 'completed' && <Check className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${t.status === 'completed' ? 'line-through text-slate-500' : 'text-slate-900'}`}>{t.title}</p>
                    <div className="flex items-center gap-2 flex-wrap mt-0.5">
                      <Badge className={PRI[t.priority]}>{t.priority}</Badge>
                      {t.due_date && <span className={`text-xs ${overdue ? 'text-rose-600 font-medium' : 'text-slate-500'}`}>{overdue ? 'Overdue: ' : 'Due '}{formatDate(t.due_date)}</span>}
                      {caseNo(t.case_id) && <span className="text-xs font-mono text-slate-500">{caseNo(t.case_id)}</span>}
                    </div>
                    {t.notes && <p className="text-xs text-slate-500 mt-1">{t.notes}</p>}
                  </div>
                  {canDelete && <button onClick={() => remove(t)} className="p-2 text-slate-300 hover:text-rose-500" aria-label="Delete"><Trash2 className="w-4 h-4" /></button>}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
