import { pkToday } from '@/lib/time';
import { useEffect, useState } from 'react';
import { supabase, PROVINCES, TRANSACTION_TYPES, VEHICLE_CATEGORIES, COMPUTATION_TYPES, type FeeRule, type Province, type TransactionType, type VehicleCategory, type ComputationType } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { PageHeader, Card, Spinner, EmptyState, Badge, Button, Field, Input, Select, Textarea } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { Settings, Plus, Search, X, History, CheckCircle, XCircle, ExternalLink, AlertTriangle } from 'lucide-react';

export default function FeeRules() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [rules, setRules] = useState<FeeRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [provinceFilter, setProvinceFilter] = useState<string>('all');
  const [showEdit, setShowEdit] = useState(false);
  const [editing, setEditing] = useState<FeeRule | null>(null);
  const [showHistory, setShowHistory] = useState<FeeRule | null>(null);
  const [revisions, setRevisions] = useState<any[]>([]);

  useEffect(() => {
    loadRules();
  }, []);

  async function loadRules() {
    setLoading(true);
    const { data } = await supabase.from('fee_rules').select('*').order('created_at', { ascending: false });
    setRules((data as FeeRule[]) ?? []);
    setLoading(false);
  }

  function startEdit(rule: FeeRule | null) {
    setEditing(rule);
    setShowEdit(true);
  }

  async function toggleActive(rule: FeeRule) {
    await supabase.from('fee_rules').update({ is_active: !rule.is_active }).eq('id', rule.id);
    await supabase.from('audit_logs').insert({
      action: rule.is_active ? 'fee_rule_deactivated' : 'fee_rule_activated',
      entity_type: 'fee_rule',
      entity_id: rule.id,
      details: { fee_type: rule.fee_type, province: rule.province },
    });
    loadRules();
  }

  async function viewHistory(rule: FeeRule) {
    const { data } = await supabase
      .from('fee_rule_revisions')
      .select('*')
      .eq('fee_rule_id', rule.id)
      .order('changed_at', { ascending: false })
      .limit(20);
    setRevisions(data ?? []);
    setShowHistory(rule);
  }

  const filtered = rules.filter(r => {
    if (provinceFilter !== 'all' && r.province !== provinceFilter) return false;
    if (search.trim()) {
      const s = search.toLowerCase();
      return r.fee_type.toLowerCase().includes(s) || r.label.toLowerCase().includes(s) || r.vehicle_category.toLowerCase().includes(s);
    }
    return true;
  });

  if (loading) return <Spinner label="Loading fee rules..." />;

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Fee Rules" />
        <Card className="p-8">
          <EmptyState icon={AlertTriangle} title="Admin access required" subtitle="Only administrators can manage fee rules. Contact your administrator." />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Fee Rules Management"
        subtitle={`${rules.length} rules · ${rules.filter(r => r.is_active).length} active`}
        action={<Button onClick={() => startEdit(null)}><Plus className="w-4 h-4" /> Add Rule</Button>}
      />

      <Card className="p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by fee type, label, or category..."
              className="w-full pl-10 pr-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/30"
            />
          </div>
          <Select value={provinceFilter} onChange={e => setProvinceFilter(e.target.value)} className="w-auto">
            <option value="all">All Provinces</option>
            {PROVINCES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState icon={Settings} title="No fee rules found" subtitle="Add a rule to start calculating fees." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3 font-semibold">Fee</th>
                  <th className="px-4 py-3 font-semibold">Province</th>
                  <th className="px-4 py-3 font-semibold">Transaction</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Computation</th>
                  <th className="px-4 py-3 font-semibold">Verified</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{r.label}</p>
                      <p className="text-xs text-slate-500">{r.fee_type}</p>
                    </td>
                    <td className="px-4 py-3 capitalize text-slate-600">{r.province}</td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{TRANSACTION_TYPES.find(t => t.value === r.transaction_type)?.label ?? r.transaction_type}</td>
                    <td className="px-4 py-3 capitalize text-slate-600">{r.vehicle_category}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{COMPUTATION_TYPES.find(c => c.value === r.computation_type)?.label ?? r.computation_type}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDate(r.last_verified_date)}</td>
                    <td className="px-4 py-3">
                      {r.is_active ? <Badge className="bg-emerald-100 text-emerald-700">Active</Badge> : <Badge className="bg-gray-100 text-gray-500">Inactive</Badge>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => viewHistory(r)} title="History" className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded transition">
                          <History className="w-4 h-4" />
                        </button>
                        <button onClick={() => startEdit(r)} title="Edit" className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-slate-100 rounded transition">
                          <Settings className="w-4 h-4" />
                        </button>
                        <button onClick={() => toggleActive(r)} title={r.is_active ? 'Deactivate' : 'Activate'} className="p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded transition">
                          {r.is_active ? <XCircle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Edit/Add modal */}
      {showEdit && <FeeRuleEditor rule={editing} onClose={() => { setShowEdit(false); setEditing(null); }} onSaved={() => { setShowEdit(false); setEditing(null); loadRules(); }} />}

      {/* History modal */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowHistory(null)}>
          <Card className="max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6" >
            <div onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-slate-900">Revision History</h3>
                  <p className="text-sm text-slate-500">{showHistory.label} · {showHistory.rate_version}</p>
                </div>
                <button onClick={() => setShowHistory(null)} className="text-slate-500 hover:text-slate-600"><X className="w-5 h-5" /></button>
              </div>
              {revisions.length === 0 ? (
                <p className="text-sm text-slate-500 py-8 text-center">No revisions recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {revisions.map((rev, i) => {
                    const snap = rev.snapshot;
                    return (
                      <div key={rev.id} className="border border-slate-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-slate-500">Revision {revisions.length - i}</span>
                          <span className="text-xs text-slate-500">{formatDate(rev.changed_at)}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div><span className="text-slate-500">Amount/Rate:</span> <span className="font-medium text-slate-700">{JSON.stringify(snap.params)}</span></div>
                          <div><span className="text-slate-500">Active:</span> <span className="font-medium text-slate-700">{String(snap.is_active)}</span></div>
                          <div><span className="text-slate-500">Version:</span> <span className="font-medium text-slate-700">{snap.rate_version}</span></div>
                          <div><span className="text-slate-500">Verified:</span> <span className="font-medium text-slate-700">{formatDate(snap.last_verified_date)}</span></div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

function FeeRuleEditor({ rule, onClose, onSaved }: { rule: FeeRule | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    province: (rule?.province ?? 'punjab') as Province,
    transaction_type: (rule?.transaction_type ?? 'new_registration') as TransactionType,
    vehicle_category: (rule?.vehicle_category ?? 'car') as VehicleCategory,
    fee_type: rule?.fee_type ?? '',
    label: rule?.label ?? '',
    computation_type: (rule?.computation_type ?? 'fixed') as ComputationType,
    params: rule ? JSON.stringify(rule.params, null, 2) : '{\n  "amount": 0\n}',
    source_url: rule?.source_url ?? '',
    effective_date: rule?.effective_date ?? pkToday(),
    last_verified_date: rule?.last_verified_date ?? pkToday(),
    rate_version: rule?.rate_version ?? 'v1',
    is_active: rule?.is_active ?? true,
    notes: rule?.notes ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    let parsedParams: any;
    try {
      parsedParams = JSON.parse(form.params);
    } catch {
      setError('Params must be valid JSON.');
      setSaving(false);
      return;
    }

    const payload = {
      province: form.province,
      transaction_type: form.transaction_type,
      vehicle_category: form.vehicle_category,
      fee_type: form.fee_type,
      label: form.label,
      computation_type: form.computation_type,
      params: parsedParams,
      source_url: form.source_url || null,
      effective_date: form.effective_date,
      last_verified_date: form.last_verified_date || null,
      rate_version: form.rate_version,
      is_active: form.is_active,
      notes: form.notes || null,
    };

    if (rule) {
      await supabase.from('fee_rules').update(payload).eq('id', rule.id);
      await supabase.from('audit_logs').insert({
        action: 'fee_rule_updated',
        entity_type: 'fee_rule',
        entity_id: rule.id,
        details: { fee_type: form.fee_type, province: form.province },
      });
    } else {
      const { data } = await supabase.from('fee_rules').insert(payload).select().maybeSingle();
      if (data) {
        await supabase.from('audit_logs').insert({
          action: 'fee_rule_created',
          entity_type: 'fee_rule',
          entity_id: data.id,
          details: { fee_type: form.fee_type, province: form.province },
        });
      }
    }
    setSaving(false);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <Card className="max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6" >
        <div onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-bold text-slate-900 text-lg">{rule ? 'Edit Fee Rule' : 'Add Fee Rule'}</h3>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-600"><X className="w-5 h-5" /></button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Label" required>
              <Input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="e.g. Registration Fee" />
            </Field>
            <Field label="Fee Type (key)" required>
              <Input value={form.fee_type} onChange={e => setForm({ ...form, fee_type: e.target.value })} placeholder="e.g. registration_fee" />
            </Field>
            <Field label="Province" required>
              <Select value={form.province} onChange={e => setForm({ ...form, province: e.target.value as Province })}>
                {PROVINCES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </Select>
            </Field>
            <Field label="Transaction Type" required>
              <Select value={form.transaction_type} onChange={e => setForm({ ...form, transaction_type: e.target.value as TransactionType })}>
                {TRANSACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="Vehicle Category" required>
              <Select value={form.vehicle_category} onChange={e => setForm({ ...form, vehicle_category: e.target.value as VehicleCategory })}>
                {VEHICLE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
            </Field>
            <Field label="Computation Type" required>
              <Select value={form.computation_type} onChange={e => setForm({ ...form, computation_type: e.target.value as ComputationType })}>
                {COMPUTATION_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
            </Field>
            <div className="col-span-2">
              <Field label="Parameters (JSON)" required hint='e.g. {"amount": 1200} or {"rate": 0.01} or {"slabs": [{"max_cc": 1000, "amount": 10000}]}' >
                <Textarea rows={4} value={form.params} onChange={e => setForm({ ...form, params: e.target.value })} className="font-mono text-xs" />
              </Field>
            </div>
            <Field label="Source URL">
              <Input value={form.source_url} onChange={e => setForm({ ...form, source_url: e.target.value })} placeholder="https://excise.punjab.gov.pk/..." />
            </Field>
            <Field label="Rate Version">
              <Input value={form.rate_version} onChange={e => setForm({ ...form, rate_version: e.target.value })} placeholder="e.g. punjab-v2025" />
            </Field>
            <Field label="Effective Date">
              <Input type="date" value={form.effective_date} onChange={e => setForm({ ...form, effective_date: e.target.value })} />
            </Field>
            <Field label="Last Verified Date">
              <Input type="date" value={form.last_verified_date} onChange={e => setForm({ ...form, last_verified_date: e.target.value })} />
            </Field>
            <div className="col-span-2">
              <Field label="Notes">
                <Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </Field>
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="rounded" />
                Active
              </label>
            </div>
          </div>

          {error && <p className="text-sm text-rose-600 mt-3">{error}</p>}

          {form.source_url && (
            <a href={form.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-3">
              <ExternalLink className="w-3 h-3" /> Open source URL
            </a>
          )}

          <div className="flex justify-end gap-3 mt-5">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.label || !form.fee_type}>
              {saving ? <Spinner label="" /> : null}
              {rule ? 'Update Rule' : 'Create Rule'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
