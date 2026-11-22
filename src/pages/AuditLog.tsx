import { useEffect, useState } from 'react';
import { supabase, type AuditLog } from '@/lib/supabase';
import { PageHeader, Card, Spinner, EmptyState } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { Shield, Search } from 'lucide-react';

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      setLogs((data as AuditLog[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const filtered = logs.filter(l => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return l.action.toLowerCase().includes(s) || (l.entity_type?.toLowerCase().includes(s) ?? false);
  });

  if (loading) return <Spinner label="Loading audit log..." />;

  return (
    <>
      <PageHeader title="Audit Log" subtitle="Immutable record of all fee rule changes, overrides, and status updates" />

      <Card className="p-4 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by action or entity type..."
            className="w-full pl-10 pr-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30"
          />
        </div>
      </Card>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState icon={Shield} title="No audit entries" subtitle="Actions like fee rule edits and status changes will appear here." />
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map(l => (
              <div key={l.id} className="px-5 py-3 flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <Shield className="w-4 h-4 text-slate-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-slate-900">{l.action}</p>
                    {l.entity_type && <span className="text-xs text-slate-500">· {l.entity_type}</span>}
                  </div>
                  {l.details && (
                    <p className="text-xs text-slate-500 mt-0.5 font-mono">{JSON.stringify(l.details)}</p>
                  )}
                  <p className="text-xs text-slate-500 mt-1">{formatDateTime(l.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
