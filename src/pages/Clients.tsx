import { pkToday } from '@/lib/time';
import { useEffect, useMemo, useState } from 'react';
import { useDrillIds, DrillBanner } from '@/lib/drill';
import { supabase, type Client, type ClientPayment, type Payment, type Quotation, type Vehicle } from '@/lib/supabase';
import { PAGE_SIZE, Pager, PageHeader, Card, Spinner, EmptyState, Button, Input, Badge } from '@/components/ui';
import { buildHaystack, matchesQuery } from '@/lib/search';
import { formatPKR } from '@/lib/format';
import { useSettings } from '@/lib/settings';
import { pendingByAccount, payerOf, type LClient } from '@/lib/ledger';
import { normPhone } from '@/lib/duplicates';
import { useDuplicates, useDupAck } from '@/lib/useDuplicates';
import DuplicateWarning from '@/components/DuplicateWarning';
import BackupPanel from '@/components/BackupPanel';
import { useCan } from '@/lib/permissions';
import { useAuth } from '@/lib/auth';
import { ClientForm, clientPayload, clientProblem, blankForm, typeMeta, Balance, type AllData, type CType } from '@/components/clientShared';
import Client360, { type Client360Tab } from '@/pages/Client360';
import type { Route } from '@/components/Layout';
import type { Prefill } from '@/lib/prefill';
import { Users, Search, Plus, ChevronRight, Phone, X, Car, ShieldCheck, Building2, AlertTriangle } from 'lucide-react';
import { friendlyError } from '@/lib/errors';
import { fetchAll } from '@/lib/fetchAll';

export interface ClientTarget { id: string; tab?: Client360Tab; nonce: number }

export default function Clients({ onOpenQuotation, onOpenCase, onStart, target }: { onOpenQuotation?: (id: string) => void; onOpenCase?: (id: string) => void; onStart: (route: Route, prefill?: Prefill) => void; target?: ClientTarget | null }) {
  const [page, setPage] = useState(0);
  useSettings();
  const { ids: drillIds } = useDrillIds('clients');
  const canManage = useCan('manager');
  const { profile } = useAuth();
  const [data, setData] = useState<AllData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(target?.id ?? null);
  const [selectedTab, setSelectedTab] = useState<Client360Tab | undefined>(target?.tab);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | CType>('all');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [showInactive, setShowInactive] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [sort, setSort] = useState<'new' | 'pending' | 'name'>('new');
  const [showAdd, setShowAdd] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [addMsg, setAddMsg] = useState('');

  // opened from the global search (or another page): jump straight to that client
  useEffect(() => { if (target) { setSelectedId(target.id); setSelectedTab(target.tab); } }, [target]);

  async function load() {
    const [c, q, p, cp, v, cs, pr, probe, al] = await Promise.all([
      fetchAll<any>((a, b) => supabase.from('clients').select('*').order('created_at', { ascending: false }).order('id').range(a, b)),
      fetchAll<any>((a, b) => supabase.from('quotations').select('*').order('id').range(a, b)),
      fetchAll<any>((a, b) => supabase.from('payments').select('*').order('id').range(a, b)),
      fetchAll<any>((a, b) => supabase.from('client_payments').select('*').order('payment_date', { ascending: false }).order('id').range(a, b)),
      fetchAll<any>((a, b) => supabase.from('vehicles').select('*').order('id').range(a, b)),
      fetchAll<any>((a, b) => supabase.from('cases').select('*').order('id').range(a, b)),
      supabase.from('profiles').select('id, full_name, role, active'),
      supabase.from('clients').select('status, assigned_to, business_type').limit(1),
      fetchAll<any>((a, b) => supabase.from('payment_allocations').select('*').order('id').range(a, b)),
    ]);
    if (c.error) setLoadErr('Clients could not be loaded: ' + friendlyError(c.error) + '. Check your connection, then reload the page.'); else setLoadErr('');
    setData({
      clients: (c.data ?? []) as Client[], quotations: (q.data ?? []) as Quotation[], payments: (p.data ?? []) as Payment[], clientPayments: (cp.data ?? []) as ClientPayment[], allocations: (al.error ? [] : al.data ?? []) as AllData['allocations'],
      vehicles: (v.data ?? []) as Vehicle[], cases: (cs.data ?? []) as AllData['cases'], profiles: (pr.data ?? []) as AllData['profiles'],
      migrated: !cp.error, m2: !probe.error, m4: !al.error,
    });
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const model = useMemo(() => {
    if (!data) return null;
    const lc: LClient[] = data.clients;
    const pend = pendingByAccount({ clients: lc, quotations: data.quotations, payments: data.payments, clientPayments: data.clientPayments });
    const nameOf = new Map(data.clients.map(c => [c.id, c.name]));
    const qCount: Record<string, number> = {}; data.quotations.forEach(q => { if (q.client_id) qCount[q.client_id] = (qCount[q.client_id] ?? 0) + 1; });
    const vCount: Record<string, number> = {}; data.vehicles.forEach(v => { if (v.client_id) vCount[v.client_id] = (vCount[v.client_id] ?? 0) + 1; });
    const vtext: Record<string, string> = {}; data.vehicles.forEach(v => { if (v.client_id) vtext[v.client_id] = ((vtext[v.client_id] ?? '') + ' ' + [v.registration_number, v.chassis_number, v.company, v.model].filter(Boolean).join(' ')).trim(); });
    const accounts = data.clients.filter(c => !c.archived_at && payerOf(c) === c.id);
    const totalPending = accounts.reduce((t, c) => t + Math.max(0, pend.get(c.id)?.pending ?? 0), 0);
    const owing = accounts.filter(c => (pend.get(c.id)?.pending ?? 0) > 0).length;
    const month = pkToday().slice(0, 7);
    const receivedMonth = data.payments.filter(p => p.payment_date.startsWith(month)).reduce((t, p) => t + p.amount, 0) + data.clientPayments.filter(p => p.payment_date.startsWith(month)).reduce((t, p) => t + p.amount, 0);
    const assignee = new Map(data.profiles.map(p => [p.id, p.full_name]));
    return { pend, nameOf, qCount, vCount, vtext, totalPending, owing, receivedMonth, assignee };
  }, [data]);

  const addDup = useDuplicates(showAdd ? { phone: form.phone, cnic: form.cnic } : {});
  const addAck = useDupAck(addDup.result);

  if (loading || !data || !model) return <Spinner label="Loading clients..." />;

  const parents = data.clients.filter(c => !c.archived_at && (c.client_type === 'showroom' || c.client_type === 'agent'));
  const selected = selectedId ? data.clients.find(c => c.id === selectedId) : null;

  async function addClient() {
    const problem = clientProblem(form); if (problem) { setAddMsg(problem); return; }
    if (addAck.needsConfirm) { addAck.confirm(); setAddMsg(''); return; }
    setAddMsg('');
    const { data: created, error } = await supabase.from('clients').insert(clientPayload(form, data!)).select().maybeSingle();
    if (error || !created) { setAddMsg('Could not save: ' + (error?.message ?? 'unknown error')); return; }
    setData({ ...data!, clients: [created as Client, ...data!.clients] });
    setForm(blankForm); setShowAdd(false);
  }

  const openClient = (id: string) => { setSelectedId(id); setSelectedTab(undefined); window.scrollTo({ top: 0 }); };
  if (selected) {
    return <Client360 client={selected} data={data} reload={load} onBack={() => { setSelectedId(null); setSelectedTab(undefined); }} onOpen={openClient} onOpenQuotation={onOpenQuotation} onOpenCase={onOpenCase} onStart={onStart} initialTab={selectedTab} />;
  }
  const q = search.trim();
  const qPhone = normPhone(q);
  let rows = drillIds ? data.clients.filter(c => drillIds.has(c.id)) : data.clients.filter(c => !!c.archived_at === showArchived);
  if (!drillIds && typeFilter !== 'all') rows = rows.filter(c => (c.client_type ?? 'direct') === typeFilter);
  if (!drillIds && !showInactive) rows = rows.filter(c => (c.status ?? 'active') === 'active');
  if (mineOnly) rows = rows.filter(c => c.assigned_to && c.assigned_to === profile?.id);
  if (pendingOnly) rows = rows.filter(c => (model.pend.get(c.id)?.pending ?? 0) > 0);
  if (q) rows = rows.filter(c => matchesQuery(q, buildHaystack([c.name, c.phone, c.cnic, c.email, c.address, c.care_of, c.business_type, c.parent_id ? model.nameOf.get(c.parent_id) : '', model.vtext[c.id]])) || (!!qPhone && normPhone(c.phone) === qPhone));
  rows = [...rows].sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'pending' ? (model.pend.get(b.id)?.pending ?? 0) - (model.pend.get(a.id)?.pending ?? 0) : 0);
  const countOf = (t: CType) => data.clients.filter(c => !c.archived_at && (c.client_type ?? 'direct') === t).length;

  return (
    <>
      <DrillBanner route="clients" shown={drillIds ? rows.length : undefined} />
      <PageHeader title="Clients" subtitle={`${data.clients.filter(c => !c.archived_at).length} active clients`}
        action={<div className="flex gap-2">
          {canManage && <Button variant="secondary" onClick={() => setShowBackup(!showBackup)}><ShieldCheck className="w-4 h-4" /> Backup</Button>}
          <Button onClick={() => setShowAdd(!showAdd)}><Plus className="w-4 h-4" /> Add Client</Button>
        </div>} />

      {loadErr && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">{loadErr}</div>}
      {!data.migrated && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>Client ledger is not switched on yet. In Supabase, open the SQL Editor and run <span className="font-mono text-xs">supabase/migrations/20261108150000_client_management.sql</span> once. Until then showrooms, payments on account and archive are not available.</span></div>
      )}
      {data.migrated && !data.m2 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>Client 360 database update is not run yet (assignment, status, chassis search, duplicate warnings). Run <span className="font-mono text-xs">supabase/migrations/20261117090000_m2_client_360_vehicles.sql</span> once on staging first. Everything else keeps working meanwhile.</span></div>
      )}
      {showBackup && <BackupPanel />}

      <div className={`grid ${canManage ? 'grid-cols-3' : 'grid-cols-2'} gap-3 mb-4`}>
        <Card className="p-3 sm:p-4"><p className="text-[11px] sm:text-xs text-slate-500">Total pending</p><p className="text-base sm:text-xl font-bold text-rose-600 tabular-nums">{formatPKR(model.totalPending)}</p></Card>
        <Card className="p-3 sm:p-4"><p className="text-[11px] sm:text-xs text-slate-500">Clients with pending</p><p className="text-base sm:text-xl font-bold text-slate-900">{model.owing}</p></Card>
        {canManage && <Card className="p-3 sm:p-4"><p className="text-[11px] sm:text-xs text-slate-500">Received this month</p><p className="text-base sm:text-xl font-bold text-emerald-600 tabular-nums">{formatPKR(model.receivedMonth)}</p></Card>}
      </div>

      {showAdd && (
        <Card className="p-4 sm:p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">New Client</h2>
            <button onClick={() => setShowAdd(false)} className="p-1 text-slate-500 hover:text-slate-600" aria-label="Close"><X className="w-4 h-4" /></button>
          </div>
          <ClientForm form={form} setForm={setForm} parents={parents} migrated={data.migrated} m2={data.m2} />
          <div className="mt-4 space-y-3">
            <DuplicateWarning result={addDup.result} checking={addDup.checking} onOpenClient={openClient} acknowledged={!addAck.needsConfirm} />
            {addMsg && <p className="text-sm text-rose-600" role="alert">{addMsg}</p>}
            <div className="flex justify-end"><Button onClick={addClient} disabled={!form.name.trim()}>{addAck.needsConfirm ? 'Save (I checked the duplicate)' : 'Save Client'}</Button></div>
          </div>
        </Card>
      )}

      <Card className="p-3 sm:p-4 mb-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, phone, CNIC, C/O, showroom or vehicle / chassis number..." aria-label="Search clients"
            className="w-full pl-10 pr-3 py-2 bg-white border border-slate-300 rounded-lg text-base sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/50 transition" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {([['all', `All`], ['direct', `Individual (${countOf('direct')})`], ['showroom', `Showrooms (${countOf('showroom')})`], ['agent', `Contact persons (${countOf('agent')})`]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setTypeFilter(v)} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${typeFilter === v ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>{l}</button>
          ))}
          <span className="w-px h-5 bg-slate-200 mx-1 hidden sm:block" />
          <button onClick={() => setPendingOnly(!pendingOnly)} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${pendingOnly ? 'bg-rose-50 border-rose-300 text-rose-700' : 'bg-white border-slate-200 text-slate-500'}`}>Pending only</button>
          {data.m2 && <button onClick={() => setMineOnly(!mineOnly)} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${mineOnly ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-white border-slate-200 text-slate-500'}`}>Assigned to me</button>}
          {data.m2 && <button onClick={() => setShowInactive(!showInactive)} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${!showInactive ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-500'}`}>{showInactive ? 'Hide inactive' : 'Inactive hidden'}</button>}
          <button onClick={() => setShowArchived(!showArchived)} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${showArchived ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-500'}`}>Archived</button>
          <select value={sort} onChange={e => setSort(e.target.value as typeof sort)} className="ml-auto text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-600" aria-label="Sort">
            <option value="new">Newest first</option><option value="pending">Highest pending</option><option value="name">Name A to Z</option>
          </select>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={Users} title={showArchived ? 'No archived clients' : 'No clients found'} subtitle={showArchived ? 'Clients you archive are kept here with all their records.' : 'Add a client or change the filters.'} />
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(c => {
              const t = typeMeta(c.client_type);
              const toParent = c.bill_to_parent && c.parent_id;
              const info = model.pend.get(c.id);
              const vc = model.vCount[c.id] ?? 0;
              return (
                <button key={c.id} onClick={() => openClient(c.id)} className="w-full text-left flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 hover:bg-slate-50 transition">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${c.client_type === 'showroom' ? 'bg-indigo-100 text-indigo-700' : c.client_type === 'agent' ? 'bg-teal-100 text-teal-700' : 'bg-amber-100 text-amber-700'}`}>
                      {c.client_type === 'showroom' ? <Building2 className="w-5 h-5" /> : <span className="font-semibold">{c.name.charAt(0).toUpperCase()}</span>}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{c.name}{c.client_type && c.client_type !== 'direct' && <Badge className={`ml-2 !py-0 ${t.color}`}>{t.label}</Badge>}{c.status === 'inactive' && <Badge className="ml-2 !py-0 bg-slate-200 text-slate-600">Inactive</Badge>}</p>
                      <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                        {c.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {c.phone}</span>}
                        {c.parent_id && <span>via {model.nameOf.get(c.parent_id) ?? 'showroom'}</span>}
                        {c.care_of && <span>C/O {c.care_of}</span>}
                        <span className="flex items-center gap-1"><Car className="w-3 h-3" /> {vc}</span>
                        <span>{model.qCount[c.id] ?? 0} quotations</span>
                        {c.assigned_to && model.assignee.get(c.assigned_to) && <span>→ {model.assignee.get(c.assigned_to)}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {toParent ? <p className="text-xs text-slate-500 text-right">billed to<br />{model.nameOf.get(c.parent_id!)}</p> : <Balance amount={info?.pending ?? 0} />}
                    <ChevronRight className="w-4 h-4 text-slate-300" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
        <div className="px-4 pb-4"><Pager page={page} total={rows.length} onPage={setPage} resetKey={rows.length} /></div>
      </Card>
    </>
  );
}
