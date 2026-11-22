import { useCallback, useEffect, useState } from 'react';
import { supabase, type AppNotification } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

/** My notifications. Also runs the reminder worker (idempotent) now and every minute while the app is open. Silent if the M5 tables are not installed. */
export function useNotifications() {
  const { session } = useAuth();
  const me = session?.user.id;
  const [items, setItems] = useState<AppNotification[]>([]);
  const [ready, setReady] = useState(false);
  const reload = useCallback(async () => {
    if (!me) return;
    const { error } = await supabase.rpc('process_due_reminders');
    if (error) { setReady(false); return; }
    const { data, error: e2 } = await supabase.from('notifications').select('*').eq('user_id', me).order('created_at', { ascending: false }).limit(30);
    if (e2) { setReady(false); return; }
    setItems((data ?? []) as AppNotification[]); setReady(true);
  }, [me]);
  useEffect(() => {
    reload();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 60_000);
    const onVis = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [reload]);
  const markRead = useCallback(async (ids?: string[]) => {
    await supabase.rpc('mark_notifications_read', { p_ids: ids ?? null });
    setItems(list => list.map(n => (!ids || ids.includes(n.id)) && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n));
  }, []);
  return { items, unread: items.filter(n => !n.read_at).length, ready, reload, markRead };
}
