import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useCan } from '@/lib/permissions';
import { PageHeader, Card, Spinner, EmptyState, Badge, Button, Field, Input, Select, Textarea, Pager, PAGE_SIZE } from '@/components/ui';
import TemplatePicker from '@/components/TemplatePicker';
import { LEAD_SOURCES, LEAD_STATUSES, ACTIVITY_KINDS, type Lead } from '@/lib/crm';
import { friendlyError, telUrl } from '@/lib/errors';
import { fetchAll } from '@/lib/fetchAll';
import { formatDate } from '@/lib/format';
import { pkToday } from '@/lib/time';
import { Target, Plus, Phone, X, UserCheck, Trash2 } from 'lucide-react';

interface Act { id: string; kind: string; note: string; created_at: string }
const blank = { name: '', phone: '', source: 'walk_in', interest: '', vehicle_info: '', next_follow_up: '', notes: '' };
const tone: Record<string, string> = { new: 'bg-blue-100 text-blue-700', contacted: 'bg-amber-100 text-amber-700', quoted: 'bg-violet-100 text-violet-700', won: 'bg-emerald-100 text-emerald-700', lost: 'bg-slate-200 text-slate-600' };

export default function Leads({ onOpenClient }: { onOpenClient?: (id: string) => void }) {
  const { user } = useAuth();
  const canDelete = useCan('manager');
  const [rows, setRows] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'open' | 'due' | 'won' | 'lost' | 'all'>('open');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [form, setForm] = useState<typeof blank | null>(null);
  const [sel, setSel] = useState<Lead | null>(null);
  const [acts, setActs] = useState<Act[]>([]);
  const [actKind, setActKind] = useState('call');
  const [actNote, setActNote] = useState('');
  const [lost, setLost] = useState('');
  const [next, setNext] = useState('');
  const today = pkToday();

  async function load() {
    setLoading(true);
    const r = await fetchAll<Lead>((a, b) => supabase.from('leads').select('*').order('created_at', { ascending: false }).order('id').range(a, b) as never);
    if (r.error) setError('Leads could not be loaded: ' + friendlyError(r.error));
    setRows(r.data ?? []); setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  async function openLead(l: Lead) {
    setSel(l); setLost(l.lost_reason ?? ''); setNext(l.next_follow_up ?? ''); setError('');
    const { data } = await supabase.from('crm_activities').select('id,kind,note,created_at').eq('lead_id', l.id).order('created_at', { ascending: false });
    setActs((data ?? []) as Act[]);
  }
  async function refreshSel(id: string) { await load(); const { data } = await supabase.from('leads').select('*').eq('id', id).maybeSingle(); if (data) await openLead(data as Lead); }

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter(r => {
      const open = r.status !== 'won' && r.status !== 'lost';
      if (filter === 'open' && !open) return false;
      if (filter === 'due' && !(open && r.next_follow_up && r.next_follow_up <= today)) return false;
      if (filter === 'won' && r.status !== 'won') return false;
      if (filter === 'lost' && r.status !== 'lost') return false;
      return !t || `${r.name} ${r.phone ?? ''} ${r.interest ?? ''} ${r.vehicle_info ?? ''}`.toLowerCase().includes(t);
    });
  }, [rows, filter, q, today]);

  async function save() {
    if (!form) return;
    if (!form.name.trim()) { setError('Name is required.'); return; }
    const { error: e } = await supabase.from('leads').insert({ name: form.name.trim(), phone: form.phone.trim() || null, source: form.source, interest: form.interest.trim() || null, vehicle_info: form.vehicle_info.trim() || null, next_follow_up: form.next_follow_up || null, notes: form.notes.trim() || null });
    if (e) { setError(friendlyError(e)); return; }
    setForm(null); setError(''); await load();
  }
  async function setStatus(l: Lead, status: string) {
    if (status === 'lost' && !lost.trim()) { setError('Write why the lead was lost first.'); return; }
    const { error: e } = await supabase.from('leads').update({ status, lost_reason: status === 'lost' ? lost.trim() : null, next_follow_up: status === 'won' || status === 'lost' ? null : next || null }).eq('id', l.id);
    if (e) { setError(friendlyError(e)); return; }
    setError(''); await refreshSel(l.id);
  }
  async function saveFollow(l: Lead) {
    const { error: e } = await supabase.from('leads').update({ next_follow_up: next || null }).eq('id', l.id);
    if (e) setError(friendlyError(e)); else { setError(''); await refreshSel(l.id); }
  }
  async function addActivity(l: Lead) {
    if (!actNote.trim()) { setError('Write a short note.'); return; }
    const { error: e } = await supabase.from('crm_activities').insert({ lead_id: l.id, kind: actKind, note: actNote.trim() });
    if (e) { setError(friendlyError(e)); return; }
    if (l.status === 'new') await supabase.from('leads').update({ status: 'contacted' }).eq('id', l.id);
    setActNote(''); setError(''); await refreshSel(l.id);
  }
  async function convert(l: Lead) {
    const { data, error: e } = await supabase.rpc('convert_lead_to_client', { p_lead: l.id });
    if (e) { setError(friendlyError(e)); return; }
    await refreshSel(l.id);
    if (data && onOpenClient) onOpenClient(String(data));
  }
  async function remove(l: Lead) {
    if (!confirm(`Delete lead "${l.name}"? This cannot be undone.`)) return;
    const { error: e } = await supabase.from('leads').delete().eq('id', l.id);
    if (e) { setError(friendlyError(e)); return; }
    setSel(null); await load();
  }

  const page_rows = shown.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const open = sel && sel.status !== 'won' && sel.status !== 'lost';

  return (
    <div>
      <PageHeader title="Leads & Follow-up" subtitle="Every enquiry in one place. Never forget to call back." action={<Button onClick={() => { setForm({ ...blank }); setError(''); }}><Plus className="w-4 h-4" /> New lead</Button>} />
      {error && <div role="alert" className="mb-3 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}

      <div className="flex flex-wrap gap-2 mb-3">
        {(['open', 'due', 'won', 'lost', 'all'] as const).map(f => <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-full text-sm border ${filter === f ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-slate-600 border-slate-200'}`}>{f === 'due' ? 'Follow-up due' : f[0].toUpperCase() + f.slice(1)}</button>)}
        <Input value={q} onChange={e => { setQ(e.target.value); setPage(0); }} placeholder="Search name, phone, vehicle…" className="max-w-xs" />
      </div>

      {loading ? <Spinner /> : shown.length === 0 ? <EmptyState icon={Target} title="No leads here" subtitle="Add an enquiry with “New lead”." /> : (
        <div className="space-y-2">
          {page_rows.map(l => {
            const overdue = !!l.next_follow_up && l.next_follow_up <= today && l.status !== 'won' && l.status !== 'lost';
            return (
              <Card key={l.id} className="p-3 sm:p-4 cursor-pointer hover:border-amber-300" >
                <div onClick={() => void openLead(l)} className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{l.name} <span className="font-normal text-slate-500 text-sm">{l.phone}</span></p>
                    <p className="text-xs text-slate-500 truncate">{LEAD_SOURCES[l.source]}{l.interest ? ` · ${l.interest}` : ''}{l.vehicle_info ? ` · ${l.vehicle_info}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {l.next_follow_up && <Badge className={overdue ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}>{overdue ? 'Due ' : 'Follow-up '}{formatDate(l.next_follow_up)}</Badge>}
                    <Badge className={tone[l.status]}>{LEAD_STATUSES[l.status]}</Badge>
                  </div>
                </div>
              </Card>
            );
          })}
          <Pager page={page} total={shown.length} onPage={setPage} resetKey={`${filter}|${q}`} />
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="New lead">
          <Card className="w-full sm:max-w-lg p-4 sm:p-6 max-h-[92vh] overflow-y-auto rounded-b-none sm:rounded-b-xl">
            <div className="flex justify-between mb-3"><h2 className="font-bold text-lg">New lead</h2><button aria-label="Close" onClick={() => setForm(null)}><X className="w-5 h-5" /></button></div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Name" required><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Phone"><Input inputMode="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></Field>
              <Field label="Source"><Select value={form.source} onChange={e => setForm({ ...form, source: e.target.value })}>{Object.entries(LEAD_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Follow up on"><Input type="date" min={today} value={form.next_follow_up} onChange={e => setForm({ ...form, next_follow_up: e.target.value })} /></Field>
              <Field label="Interested in"><Input value={form.interest} onChange={e => setForm({ ...form, interest: e.target.value })} placeholder="e.g. Transfer, token tax" /></Field>
              <Field label="Vehicle"><Input value={form.vehicle_info} onChange={e => setForm({ ...form, vehicle_info: e.target.value })} placeholder="e.g. Corolla 2019" /></Field>
            </div>
            <Field label="Notes"><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
            <div className="flex justify-end gap-2 mt-4"><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button onClick={save}>Save lead</Button></div>
          </Card>
        </div>
      )}

      {sel && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Lead details">
          <Card className="w-full sm:max-w-2xl p-4 sm:p-6 max-h-[92vh] overflow-y-auto rounded-b-none sm:rounded-b-xl">
            <div className="flex justify-between items-start mb-3">
              <div><h2 className="font-bold text-lg">{sel.name}</h2><p className="text-sm text-slate-500">{sel.phone} · {LEAD_SOURCES[sel.source]} · added {formatDate(sel.created_at)}</p></div>
              <button aria-label="Close" onClick={() => setSel(null)}><X className="w-5 h-5" /></button>
            </div>
            {error && <div role="alert" className="mb-3 p-2 rounded bg-red-50 text-red-700 text-sm">{error}</div>}
            <div className="flex flex-wrap gap-2 mb-3">
              {sel.phone && <a href={telUrl(sel.phone) ?? '#'} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-sm"><Phone className="w-4 h-4" /> Call</a>}
              <TemplatePicker phone={sel.phone} name={sel.name} vehicle={sel.vehicle_info ?? ''} defaultKey="follow_up" />
            </div>
            <p className="text-sm text-slate-700 mb-1">{sel.interest}{sel.vehicle_info ? ` · ${sel.vehicle_info}` : ''}</p>
            {sel.notes && <p className="text-sm text-slate-500 mb-3 whitespace-pre-wrap">{sel.notes}</p>}
            <p className="mb-3"><Badge className={tone[sel.status]}>{LEAD_STATUSES[sel.status]}</Badge>{sel.status === 'lost' && sel.lost_reason ? <span className="text-sm text-slate-500 ml-2">Reason: {sel.lost_reason}</span> : null}</p>

            {open && (
              <div className="grid sm:grid-cols-2 gap-3 mb-4">
                <Field label="Next follow-up"><div className="flex gap-2"><Input type="date" value={next} onChange={e => setNext(e.target.value)} /><Button variant="secondary" onClick={() => saveFollow(sel)}>Set</Button></div></Field>
                <Field label="Move to"><Select value="" onChange={e => e.target.value && void setStatus(sel, e.target.value)}><option value="">Change status…</option>{['contacted', 'quoted'].filter(s => s !== sel.status).map(s => <option key={s} value={s}>{LEAD_STATUSES[s]}</option>)}</Select></Field>
                <Field label="If lost, why?"><div className="flex gap-2"><Input value={lost} onChange={e => setLost(e.target.value)} placeholder="Price, went elsewhere…" /><Button variant="danger" onClick={() => setStatus(sel, 'lost')}>Lost</Button></div></Field>
                <div className="flex items-end"><Button onClick={() => convert(sel)}><UserCheck className="w-4 h-4" /> Won → make client</Button></div>
              </div>
            )}
            {sel.client_id && onOpenClient && <Button variant="secondary" onClick={() => onOpenClient(sel.client_id!)}>Open client</Button>}

            <h3 className="font-semibold mt-4 mb-2 text-sm">Contact log</h3>
            <div className="flex flex-wrap gap-2 mb-2">
              <Select value={actKind} onChange={e => setActKind(e.target.value)} className="max-w-[8rem]">{Object.entries(ACTIVITY_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
              <Input className="flex-1 min-w-[10rem]" value={actNote} onChange={e => setActNote(e.target.value)} placeholder="What was said?" />
              <Button onClick={() => addActivity(sel)}>Add</Button>
            </div>
            <ul className="space-y-1.5">{acts.map(a => <li key={a.id} className="text-sm border-l-2 border-amber-300 pl-3"><span className="font-medium">{ACTIVITY_KINDS[a.kind]}</span> <span className="text-xs text-slate-400">{formatDate(a.created_at)}</span><br />{a.note}</li>)}{acts.length === 0 && <li className="text-sm text-slate-400">No contact yet.</li>}</ul>
            {canDelete && <div className="mt-4 pt-3 border-t"><Button variant="ghost" onClick={() => remove(sel)}><Trash2 className="w-4 h-4" /> Delete lead</Button></div>}
          </Card>
        </div>
      )}
      <span className="hidden">{user?.id}</span>
    </div>
  );
}
