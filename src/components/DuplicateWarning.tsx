import { AlertTriangle, Loader2 } from 'lucide-react';
import { hasDuplicates, reasonText, type DuplicateResult } from '@/lib/duplicates';

/** Shows possible duplicates next to a form. It only informs: the person decides, nothing is merged, blocked or deleted. */
export default function DuplicateWarning({ result, checking, onOpenClient, acknowledged, openLabel = 'Open this client' }: {
  result: DuplicateResult; checking?: boolean; onOpenClient?: (id: string) => void; acknowledged?: boolean; openLabel?: string;
}) {
  if (!hasDuplicates(result)) {
    return checking ? <p className="text-xs text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Checking for duplicates...</p> : null;
  }
  return (
    <div className={`rounded-lg border p-3 text-sm ${acknowledged ? 'border-slate-200 bg-slate-50 text-slate-700' : 'border-amber-300 bg-amber-50 text-amber-900'}`} role="alert">
      <p className="font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4 flex-shrink-0" /> Possible duplicate. Please check before saving.</p>
      <ul className="mt-2 space-y-1.5">
        {result.clients.map(c => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
            <span><b>{c.name}</b>{c.archived ? ' (archived)' : ''} <span className="text-xs opacity-80">{[c.phone, c.cnic].filter(Boolean).join(' · ')}</span><br /><span className="text-xs">{reasonText(c.reasons)}</span></span>
            {onOpenClient && <button type="button" onClick={() => onOpenClient(c.id)} className="text-xs font-medium underline">{openLabel}</button>}
          </li>
        ))}
        {result.vehicles.map(v => (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-2">
            <span><b>{v.registration_number || v.chassis_number || 'Vehicle'}</b> <span className="text-xs opacity-80">{v.client_name ? `owner: ${v.client_name}` : 'no owner linked'}</span><br /><span className="text-xs">{reasonText(v.reasons)}</span></span>
            {onOpenClient && v.client_id && <button type="button" onClick={() => onOpenClient(v.client_id!)} className="text-xs font-medium underline">Open owner</button>}
          </li>
        ))}
      </ul>
      <p className="text-xs mt-2 opacity-80">Nothing is merged automatically. If this is really a different {result.vehicles.length && !result.clients.length ? 'vehicle' : 'person'}, you can still save.</p>
    </div>
  );
}
