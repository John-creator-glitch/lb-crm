import BackupPanel from '@/components/BackupPanel';
import { useSidebarCollapsed } from '@/lib/sidebar';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { PageHeader, Card, Field, Input, Textarea, Button, Spinner, EmptyState } from '@/components/ui';
import { DEFAULT_SETTINGS, type BusinessSettings } from '@/lib/brand';
import { loadSettings, saveSettings, logoToDataUrl } from '@/lib/settings';
import { buildQuotationPdf } from '@/lib/quotationPdf';
import { sampleQuotation } from '@/lib/sampleQuotation';
import { downloadBlob } from '@/lib/share';
import { FIELD_KIND_LABEL, type CustomFieldKind } from '@/lib/customFields';
import { fetchWebsiteLogo } from '@/lib/logoFetch';
import DbStatus from '@/components/DbStatus';
import { AlertTriangle, Plus, Trash2, Upload, FileText, Globe } from 'lucide-react';

import TemplatesEditor from '@/components/TemplatesEditor';

export default function SettingsPage() {
  const collapsed = useSidebarCollapsed();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [s, setS] = useState<BusinessSettings | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [fetching, setFetching] = useState(false);
  useEffect(() => { loadSettings(true).then(setS); }, []);
  // First visit with no logo yet: bring it in from the website automatically (the admin still presses Save).
  useEffect(() => { if (s && !s.logo_data_url) getLogo(true); /* eslint-disable-next-line */ }, [s === null]);
  async function getLogo(auto = false) {
    setFetching(true);
    const url = await fetchWebsiteLogo();
    setFetching(false);
    if (url) { setS(cur => (cur ? { ...cur, logo_data_url: url } : cur)); setMsg('Logo loaded from liaqatbrothers.com. Press Save settings to keep it.'); }
    else if (!auto) setMsg('Could not download the logo from the website right now. Save the logo image from the website and use Upload logo.');
  }
  if (!s) return <Spinner label="Loading settings..." />;
  if (!isAdmin) return (<><PageHeader title="Settings" /><Card className="p-8"><EmptyState icon={AlertTriangle} title="Admin access required" subtitle="Only administrators can change business and quotation settings." /></Card></>);

  const set = <K extends keyof BusinessSettings>(k: K, v: BusinessSettings[K]) => setS({ ...s, [k]: v });
  async function save() {
    setBusy(true); setMsg('');
    const err = await saveSettings(s!);
    setBusy(false);
    setMsg(err ? `Could not save: ${err}. If the app_settings table is missing, run the latest migration in Supabase.` : 'Saved. New quotations and PDFs use these settings.');
  }
  async function onLogo(f: File | undefined) {
    if (!f) return;
    try { set('logo_data_url', await logoToDataUrl(f)); } catch { setMsg('That file could not be read as an image. Use a PNG or JPG.'); }
  }
  function preview() {
    const r = buildQuotationPdf(sampleQuotation(s!));
    downloadBlob(r.blob, 'quotation-preview.pdf');
  }
  const hex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

  return (
    <>
      <PageHeader title="Settings" subtitle="Business details, branding and quotation defaults" />
      <DbStatus />
      {msg && <Card className="p-3 mb-4 text-sm text-slate-700 bg-slate-50">{msg}</Card>}

      <div className="space-y-4 pb-24">
        <Card className="p-5">
          <h2 className="font-semibold text-slate-900 mb-3">Business &amp; branding</h2>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-20 h-20 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden flex-shrink-0">
              {s.logo_data_url ? <img src={s.logo_data_url} alt="Logo" className="max-w-full max-h-full object-contain" /> : <span className="text-xs text-slate-500 text-center px-1">No logo</span>}
            </div>
            <div className="space-y-2">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => onLogo(e.target.files?.[0])} />
              <Button variant="secondary" size="sm" onClick={() => getLogo()} disabled={fetching}><Globe className="w-4 h-4" /> {fetching ? 'Fetching...' : 'Get logo from website'}</Button>
              <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4" /> Upload instead</Button>
              {s.logo_data_url && <Button variant="ghost" size="sm" onClick={() => set('logo_data_url', null)}>Remove</Button>}
              <p className="text-xs text-slate-500">The official logo is taken from liaqatbrothers.com. It appears in the app and on every PDF. Without a logo, a monogram is used.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Business name"><Input value={s.business_name} onChange={e => set('business_name', e.target.value)} /></Field>
            <Field label="Tagline"><Input value={s.tagline} onChange={e => set('tagline', e.target.value)} /></Field>
            <div className="sm:col-span-2"><Field label="Official address"><Input value={s.address} onChange={e => set('address', e.target.value)} /></Field></div>
            <Field label="Phone"><Input inputMode="tel" value={s.phone} onChange={e => set('phone', e.target.value)} /></Field>
            <Field label="WhatsApp"><Input inputMode="tel" value={s.whatsapp} onChange={e => set('whatsapp', e.target.value)} /></Field>
            <Field label="Website"><Input value={s.website} onChange={e => set('website', e.target.value)} /></Field>
            <Field label="Email (optional)"><Input type="email" value={s.email} onChange={e => set('email', e.target.value)} /></Field>
            <Field label="Brand colour (headers, totals)" hint="Hex like #0f172a">
              <div className="flex gap-2"><input type="color" aria-label="Brand colour" value={hex(s.brand_color) ? s.brand_color : '#0f172a'} onChange={e => set('brand_color', e.target.value)} className="h-11 w-14 rounded border border-slate-300 bg-white p-1" /><Input value={s.brand_color} onChange={e => set('brand_color', e.target.value)} /></div>
            </Field>
            <Field label="Accent colour (lines, highlights)" hint="Hex like #d97706">
              <div className="flex gap-2"><input type="color" aria-label="Accent colour" value={hex(s.accent_color) ? s.accent_color : '#d97706'} onChange={e => set('accent_color', e.target.value)} className="h-11 w-14 rounded border border-slate-300 bg-white p-1" /><Input value={s.accent_color} onChange={e => set('accent_color', e.target.value)} /></div>
            </Field>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold text-slate-900 mb-3">Owner quotation</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Document title" hint="e.g. QUOTATION or ESTIMATE"><Input value={s.document_title} onChange={e => set('document_title', e.target.value)} /></Field>
            <Field label="Valid for (days)"><Input type="number" inputMode="numeric" value={s.validity_days} onChange={e => set('validity_days', Math.max(1, Number(e.target.value) || 15))} /></Field>
            <div className="sm:col-span-2"><Field label="Default payment terms"><Input value={s.payment_terms} onChange={e => set('payment_terms', e.target.value)} /></Field></div>
            <div className="sm:col-span-2"><Field label="Notice printed under the total" hint="Shown on every quotation PDF."><Textarea rows={2} value={s.estimate_note} onChange={e => set('estimate_note', e.target.value)} /></Field></div>
          </div>
          <Button variant="secondary" className="mt-4" onClick={preview}><FileText className="w-4 h-4" /> Download sample PDF</Button>
          <p className="text-xs text-slate-500 mt-2">The sample uses your current (unsaved) settings so you can check the design first.</p>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold text-slate-900 mb-1">Quick service charges</h2>
          <p className="text-xs text-slate-500 mb-3">Service charges the operator can add with one tap in the calculator. The first one is added automatically. Amount 0 means the operator types it.</p>
          <div className="space-y-2">
            {s.service_presets.map((p, i) => (
              <div key={i} className="flex gap-2">
                <Input value={p.label} onChange={e => set('service_presets', s.service_presets.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="Charge name" className="flex-1 min-w-0" />
                <Input type="number" inputMode="numeric" value={p.amount || ''} onChange={e => set('service_presets', s.service_presets.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) || 0 } : x)))} placeholder="Rs" className="!w-28 flex-none" />
                <button className="text-slate-500 hover:text-rose-600 px-2" onClick={() => set('service_presets', s.service_presets.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => set('service_presets', [...s.service_presets, { label: '', amount: 0 }])}><Plus className="w-4 h-4" /> Add charge</Button>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold text-slate-900 mb-1">Quick custom fields</h2>
          <p className="text-xs text-slate-500 mb-3">Fields the operator can add with one tap on a quotation (e.g. Token Tax: Paid / Unpaid, Pending Documents).</p>
          <div className="space-y-3">
            {s.field_presets.map((p, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3 space-y-2">
                <div className="flex gap-2">
                  <Input value={p.label} onChange={e => set('field_presets', s.field_presets.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="Field name" className="flex-1" />
                  <button className="text-slate-500 hover:text-rose-600 px-2" onClick={() => set('field_presets', s.field_presets.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 className="w-4 h-4" /></button>
                </div>
                <select className="w-full px-3 py-3 bg-white border border-slate-300 rounded-lg text-base sm:text-sm" value={p.kind} onChange={e => set('field_presets', s.field_presets.map((x, j) => (j === i ? { ...x, kind: e.target.value as CustomFieldKind, options: e.target.value === 'choice' ? (x.options?.length ? x.options : ['Paid', 'Unpaid']) : undefined } : x)))}>
                  {(Object.keys(FIELD_KIND_LABEL) as CustomFieldKind[]).map(k => <option key={k} value={k}>{FIELD_KIND_LABEL[k]}</option>)}
                </select>
                {p.kind === 'choice' && <Input value={(p.options ?? []).join(', ')} onChange={e => set('field_presets', s.field_presets.map((x, j) => (j === i ? { ...x, options: e.target.value.split(',').map(o => o.trim()).filter(Boolean) } : x)))} placeholder="Options, separated by commas" />}
              </div>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => set('field_presets', [...s.field_presets, { label: '', kind: 'text' }])}><Plus className="w-4 h-4" /> Add field</Button>
        </Card>

        <BackupPanel />
        <div className="h-16" />

        <div className={`fixed bottom-16 lg:bottom-0 inset-x-0 ${collapsed ? 'lg:left-16' : 'lg:left-64'} z-20 bg-white/95 backdrop-blur border-t border-slate-200 p-3 flex gap-3 justify-end`}>
          <Button variant="ghost" onClick={() => setS(DEFAULT_SETTINGS)}>Reset to defaults</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save settings'}</Button>
        </div>
      </div>
      <TemplatesEditor />
    </>
  );
}
