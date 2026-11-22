import { useRef, useState } from 'react';
import { createBackup, parseBackup, restoreBackup, type BackupFile } from '@/lib/backup';
import { downloadBlob } from '@/lib/share';
import { Card, Button } from '@/components/ui';
import { Download, Upload, ShieldCheck } from 'lucide-react';
import { useCan } from '@/lib/permissions';
import { pkToday } from '@/lib/time';

export default function BackupPanel() {
  const isOwner = useCan('admin');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [pending, setPending] = useState<BackupFile | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function backup() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const { file, counts, report } = await createBackup({ isOwner });
      const stamp = pkToday();
      downloadBlob(new Blob([JSON.stringify(file)], { type: 'application/json' }), `LiaqatBrothers-backup-${stamp}.json`);
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      setMsg(`Backup downloaded: ${total} records (${counts.clients ?? 0} clients, ${counts.quotations ?? 0} quotations, ${(counts.payments ?? 0) + (counts.client_payments ?? 0)} payments).${report.missing.length ? ` WARNING: these tables do not exist in this database and were NOT backed up: ${report.missing.join(', ')}.` : ' Every table was read in full and its row count was checked.'}${report.notIncluded.length ? ` Owner-only history not included: ${report.notIncluded.join(', ')}.` : ''} Keep the file somewhere safe, for example Google Drive or a USB.`);
    } catch (e: any) { setErr(e?.message || 'Backup failed.'); }
    finally { setBusy(false); }
  }

  async function pick(f: File | undefined) {
    if (!f) return;
    setErr(''); setMsg(''); setPending(null);
    try { setPending(parseBackup(await f.text())); } catch (e: any) { setErr(e?.message || 'Could not read the file.'); }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function restore() {
    if (!pending) return;
    setBusy(true); setErr(''); setMsg('Restoring...');
    try {
      const r = await restoreBackup(pending, m => setMsg(m));
      const total = Object.values(r.restored).reduce((a, b) => a + b, 0);
      setMsg(`Restored ${total} records.`); setPending(null);
      if (r.errors.length) setErr('Some tables had problems: ' + r.errors.join(' | '));
    } catch (e: any) { setErr(e?.message || 'Restore failed.'); setMsg(''); }
    finally { setBusy(false); }
  }

  const counts = pending ? Object.entries(pending.tables).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.length}`).join(', ') : '';
  return (
    <Card className="p-4 mb-4">
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-slate-900">Backup & restore</h2>
          <p className="text-xs text-slate-500 mt-0.5">One file with all clients, vehicles, quotations, payments (ledger), transfers, cases, tasks, inventory and settings. Take a backup regularly, for example every week and before any big change.</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Button onClick={backup} disabled={busy}><Download className="w-4 h-4" /> {busy && !pending ? 'Working...' : 'Download backup'}</Button>
            {isOwner && <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}><Upload className="w-4 h-4" /> Restore from file</Button>}
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={e => pick(e.target.files?.[0])} />
          </div>
          {pending && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">Backup from {new Date(pending.created_at).toLocaleString()}</p>
              <p className="text-xs mt-1">{counts}</p>
              <p className="text-xs mt-1">Restore adds missing records and overwrites records with the same ID by the backup version. It never deletes anything. Records changed after the backup will go back to how they were then.</p>
              <div className="flex gap-2 mt-2"><Button size="sm" onClick={restore} disabled={busy}>Yes, restore</Button><Button size="sm" variant="ghost" onClick={() => setPending(null)}>Cancel</Button></div>
            </div>
          )}
          {msg && <p className="text-xs text-emerald-700 mt-2">{msg}</p>}
          {err && <p className="text-xs text-rose-600 mt-2">{err}</p>}
        </div>
      </div>
    </Card>
  );
}
