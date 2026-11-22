import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SearchOption { value: string; label: string; hint?: string }

/** A dropdown you can type in to find a name. Replaces a long plain <select>. */
export default function SearchSelect({ value, onChange, options, emptyLabel = 'None', placeholder = 'Type to search…', disabled }: { value: string; onChange: (v: string) => void; options: SearchOption[]; emptyLabel?: string; placeholder?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = options.find(o => o.value === value);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return options.filter(o => !t || `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(t)).slice(0, 100);
  }, [options, q]);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away); return () => document.removeEventListener('mousedown', away);
  }, []);
  const pick = (v: string) => { onChange(v); setOpen(false); setQ(''); };
  return (
    <div ref={box} className="relative">
      <div className="relative">
        <input
          role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" disabled={disabled}
          value={open ? q : (current?.label ?? '')} placeholder={open ? placeholder : emptyLabel}
          onFocus={() => { setOpen(true); setQ(''); setHi(0); }}
          onChange={e => { setQ(e.target.value); setOpen(true); setHi(0); }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, list.length)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); pick(hi === 0 ? '' : list[hi - 1]?.value ?? ''); }
            else if (e.key === 'Escape') setOpen(false);
          }}
          className="w-full px-3 py-2 pr-9 bg-white border border-slate-300 rounded-lg text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30"
        />
        <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
      {open && (
        <ul id={listId} role="listbox" className="absolute z-40 mt-1 w-full max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg text-sm">
          <li role="option" aria-selected={!value} onMouseDown={e => { e.preventDefault(); pick(''); }} className={`px-3 py-2 cursor-pointer text-slate-500 ${hi === 0 ? 'bg-amber-50' : ''}`}>{emptyLabel}</li>
          {list.map((o, i) => <li key={o.value} role="option" aria-selected={o.value === value} onMouseDown={e => { e.preventDefault(); pick(o.value); }} className={`px-3 py-2 cursor-pointer ${hi === i + 1 ? 'bg-amber-50' : 'hover:bg-slate-50'} ${o.value === value ? 'font-semibold' : ''}`}>{o.label}{o.hint && <span className="text-xs text-slate-400 ml-2">{o.hint}</span>}</li>)}
          {list.length === 0 && <li className="px-3 py-2 text-slate-400">No match</li>}
        </ul>
      )}
    </div>
  );
}
