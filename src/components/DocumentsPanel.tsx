import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useCan } from '@/lib/permissions';
import { Card, Spinner, Button, Select, EmptyState } from '@/components/ui';
import { DOC_TYPES, docProblem, safeFileName, type ClientDocument } from '@/lib/crm';
import { friendlyError } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { FileText, Upload, Trash2, ExternalLink } from 'lucide-react';

const BUCKET = 'lb-documents';

/** Private files for one client (CNIC, book, challan). Opened only through a link that expires in 60 seconds. */
export default function DocumentsPanel({ clientId, caseId, vehicleId }: { clientId: string; caseId?: string | null; vehicleId?: string | null }) {
  const canDelete = useCan('manager');
  const [docs, setDocs] = useState<ClientDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [type, setType] = useState('cnic');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('client_documents').select('*').eq('client_id', clientId).order('created_at', { ascending: false });
    if (caseId) q = q.eq('case_id', caseId);
    const { data, error: e } = await q;
    if (e) setError(friendlyError(e, 'Load'));
    setDocs((data ?? []) as ClientDocument[]); setLoading(false);
  }, [clientId, caseId]);
  useEffect(() => { void load(); }, [load]);

  async function upload(file: File) {
    const p = docProblem({ type: file.type, size: file.size });
    if (p) { setError(p); return; }
    setBusy(true); setError('');
    const path = `${clientId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) { setBusy(false); setError(friendlyError(up.error, 'Upload')); return; }
    const { error: e } = await supabase.from('client_documents').insert({ client_id: clientId, case_id: caseId ?? null, vehicle_id: vehicleId ?? null, doc_type: type, file_name: file.name.slice(0, 120), storage_path: path, mime_type: file.type, size_bytes: file.size });
    if (e) { await supabase.storage.from(BUCKET).remove([path]); setError(friendlyError(e, 'Upload')); }
    setBusy(false); if (input.current) input.current.value = ''; await load();
  }
  async function view(d: ClientDocument) {
    const { data, error: e } = await supabase.storage.from(BUCKET).createSignedUrl(d.storage_path, 60);
    if (e || !data) { setError(friendlyError(e, 'Open')); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }
  async function remove(d: ClientDocument) {
    if (!confirm(`Delete "${d.file_name}"?`)) return;
    const { error: e } = await supabase.from('client_documents').delete().eq('id', d.id);
    if (e) { setError(friendlyError(e)); return; }
    await supabase.storage.from(BUCKET).remove([d.storage_path]);
    await load();
  }

  return (
    <div>
      {error && <div role="alert" className="mb-3 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
      <Card className="p-3 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={type} onChange={e => setType(e.target.value)} aria-label="Document type" className="max-w-[12rem]">{Object.entries(DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          <Button loading={busy} onClick={() => input.current?.click()}><Upload className="w-4 h-4" /> Upload file</Button>
          <span className="text-xs text-slate-500">JPG, PNG, WEBP or PDF, up to 5 MB. Files are private.</span>
        </div>
      </Card>
      {loading ? <Spinner /> : docs.length === 0 ? <EmptyState icon={FileText} title="No files yet" /> : (
        <div className="space-y-2">{docs.map(d => (
          <Card key={d.id} className="p-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0"><p className="font-medium truncate">{d.file_name}</p><p className="text-xs text-slate-500">{DOC_TYPES[d.doc_type]} · {(d.size_bytes / 1024).toFixed(0)} KB · {formatDate(d.created_at)}</p></div>
            <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => view(d)}><ExternalLink className="w-4 h-4" /> Open</Button>{canDelete && <Button size="sm" variant="ghost" onClick={() => remove(d)}><Trash2 className="w-4 h-4" /></Button>}</div>
          </Card>))}</div>
      )}
    </div>
  );
}
