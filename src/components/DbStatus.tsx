import { useState } from 'react';
import { checkDatabase, type DbCheckRow } from '@/lib/dbCheck';
import { Card, Button } from '@/components/ui';
import { CheckCircle2, XCircle } from 'lucide-react';

export default function DbStatus() {
  const [rows, setRows] = useState<DbCheckRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() { setBusy(true); setRows(await checkDatabase()); setBusy(false); }
  const bad = rows?.filter(r => !r.ok).length ?? 0;
  return (
    <Card className="p-5 mt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-800">Database connection</h3>
          <p className="text-xs text-slate-500">Checks that Supabase is reachable and every table the app needs exists.</p>
        </div>
        <Button onClick={run} disabled={busy}>{busy ? 'Checking...' : 'Check database'}</Button>
      </div>
      {rows && (
        <div className="mt-3 space-y-1 text-sm">
          <p className={bad ? 'text-rose-600 font-medium' : 'text-emerald-600 font-medium'}>{bad ? `${bad} problem(s) found` : 'All tables reachable'}</p>
          {rows.map(r => (
            <div key={r.table} className="flex items-start gap-2">
              {r.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5" /> : <XCircle className="w-4 h-4 text-rose-500 mt-0.5" />}
              <span className="font-mono text-xs">{r.table}</span>
              <span className="text-xs text-slate-500">{r.ok ? '' : r.detail}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
