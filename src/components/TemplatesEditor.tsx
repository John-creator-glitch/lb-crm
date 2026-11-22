import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/permissions';
import { Card, Button, Textarea, Input } from '@/components/ui';
import { friendlyError } from '@/lib/errors';
import type { MessageTemplate } from '@/lib/crm';

/** WhatsApp message wording. Only the owner can change it. Placeholders: {name} {vehicle} {amount} {date} {business} */
export default function TemplatesEditor() {
  const isOwner = useCan('admin');
  const [list, setList] = useState<MessageTemplate[]>([]);
  const [msg, setMsg] = useState('');
  async function load() { const { data } = await supabase.from('message_templates').select('*').order('sort_order'); setList((data ?? []) as MessageTemplate[]); }
  useEffect(() => { void load(); }, []);
  const edit = (id: string, patch: Partial<MessageTemplate>) => setList(l => l.map(t => t.id === id ? { ...t, ...patch } : t));
  async function save(t: MessageTemplate) {
    if (!t.title.trim() || !t.body.trim()) { setMsg('Title and message cannot be empty.'); return; }
    const { error } = await supabase.from('message_templates').update({ title: t.title.trim(), body: t.body, active: t.active }).eq('id', t.id);
    setMsg(error ? friendlyError(error) : `Saved “${t.title}”.`);
  }
  return (
    <Card className="p-4 sm:p-5 mt-6">
      <h2 className="font-semibold text-slate-900 mb-1">WhatsApp messages</h2>
      <p className="text-xs text-slate-500 mb-3">Use {'{name} {vehicle} {amount} {date} {business}'} and they are filled in automatically.</p>
      {msg && <p role="status" className="text-sm mb-2 text-slate-700">{msg}</p>}
      <div className="space-y-4">{list.map(t => (
        <div key={t.id} className="border border-slate-200 rounded-lg p-3">
          <Input value={t.title} disabled={!isOwner} onChange={e => edit(t.id, { title: e.target.value })} className="mb-2" aria-label="Title" />
          <Textarea rows={3} value={t.body} disabled={!isOwner} onChange={e => edit(t.id, { body: e.target.value })} aria-label="Message" />
          {isOwner && <div className="flex items-center justify-between mt-2"><label className="text-sm flex items-center gap-2"><input type="checkbox" checked={t.active} onChange={e => edit(t.id, { active: e.target.checked })} /> In use</label><Button size="sm" onClick={() => save(t)}>Save</Button></div>}
        </div>))}</div>
    </Card>
  );
}
