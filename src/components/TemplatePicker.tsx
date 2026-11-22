import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Select } from '@/components/ui';
import { fillTemplate, type MessageTemplate } from '@/lib/crm';
import { useSettings } from '@/lib/settings';
import { whatsappUrl } from '@/lib/errors';
import { MessageCircle } from 'lucide-react';

/** Pick a saved message, fill in the customer's details, and open WhatsApp with it. */
export default function TemplatePicker({ phone, name, vehicle, amount, date, defaultKey }: { phone?: string | null; name?: string; vehicle?: string; amount?: string; date?: string; defaultKey?: string }) {
  const s = useSettings();
  const [list, setList] = useState<MessageTemplate[]>([]);
  const [key, setKey] = useState(defaultKey ?? '');
  useEffect(() => { supabase.from('message_templates').select('*').eq('active', true).order('sort_order').then(({ data }) => { const l = (data ?? []) as MessageTemplate[]; setList(l); setKey(k => k || l[0]?.key || ''); }); }, []);
  const t = list.find(x => x.key === key);
  const text = t ? fillTemplate(t.body, { name, vehicle, amount, date, business: s.business_name }) : '';
  const url = t ? whatsappUrl(phone, text) : null;
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={key} onChange={e => setKey(e.target.value)} aria-label="Message template" className="max-w-[14rem]">{list.map(x => <option key={x.key} value={x.key}>{x.title}</option>)}</Select>
      {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"><MessageCircle className="w-4 h-4" /> WhatsApp</a> : <span className="text-xs text-slate-500">No valid phone number</span>}
    </div>
  );
}
