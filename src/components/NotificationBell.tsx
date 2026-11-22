import type React from 'react';
import { useState } from 'react';
import { Bell } from 'lucide-react';
import { fmtPk } from '@/lib/reminders';
import type { AppNotification } from '@/lib/supabase';

export default function NotificationBell({ items, unread, onOpenAll, onMarkRead, className = '', label }: { items: AppNotification[]; unread: number; onOpenAll: () => void; onMarkRead: (ids?: string[]) => void; className?: string; label?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(o => !o)} className={`relative ${className}`} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} title="Notifications">
        <Bell className="w-4 h-4 flex-shrink-0" />{label}
        {unread > 0 && <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] leading-4 text-center font-semibold">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed z-50 top-16 left-3 right-3 sm:left-auto sm:right-4 sm:w-96 lg:left-4 lg:right-auto lg:w-80 bg-white text-slate-900 rounded-xl shadow-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
              <p className="text-sm font-semibold">Notifications</p>
              {unread > 0 && <button className="text-xs text-slate-500 hover:text-slate-800 underline" onClick={() => onMarkRead()}>Mark all read</button>}
            </div>
            <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
              {items.length === 0 ? <p className="p-4 text-sm text-slate-500 text-center">No notifications yet.</p> : items.map(n => (
                <button key={n.id} onClick={() => { onMarkRead([n.id]); setOpen(false); onOpenAll(); }} className={`w-full text-left px-4 py-2.5 hover:bg-slate-50 ${n.read_at ? '' : 'bg-amber-50/60'}`}>
                  <p className="text-sm font-medium truncate">{n.title}</p>
                  {n.body && <p className="text-xs text-slate-500 truncate">{n.body}</p>}
                  {n.delivery_status === 'failed' && <p className="text-xs text-rose-600">Not sent: {n.failure_reason}</p>}
                  <p className="text-[11px] text-slate-500">{fmtPk(n.created_at)}</p>
                </button>
              ))}
            </div>
            <button onClick={() => { setOpen(false); onOpenAll(); }} className="w-full px-4 py-2.5 text-sm text-amber-700 hover:bg-slate-50 border-t border-slate-100">Open reminders</button>
          </div>
        </>
      )}
    </>
  );
}
