import { useEffect, useMemo, useState } from 'react';
import {
  supabase, type Quotation, type Client, type Vehicle, type QuotationStatus,
  QUOTATION_STATUSES, PROVINCES, TRANSACTION_TYPES, VEHICLE_CATEGORIES,
} from '@/lib/supabase';
import { PAGE_SIZE, Pager, PageHeader, Card, Spinner, EmptyState, Badge } from '@/components/ui';
import { formatPKR, formatDateTime } from '@/lib/format';
import { useDrillIds, DrillBanner } from '@/lib/drill';
import { pkToday } from '@/lib/time';
import { isQuotationExpired, followUpState } from '@/lib/workflow';
import { buildHaystack, matchesQuery } from '@/lib/search';
import { FileText, Search, ChevronRight, X, Car, Phone } from 'lucide-react';
import { friendlyError } from '@/lib/errors';
import { fetchAll } from '@/lib/fetchAll';

interface QuotationRow extends Quotation {
  client: Client | null;
  vehicle: Vehicle | null;
  hay: { text: string; squashed: string };
}

const label = <T extends string>(list: { value: T; label: string }[], v: string | null | undefined) =>
  list.find(x => x.value === v)?.label ?? v ?? '';

export default function QuotationsList({ onSelect, initialSearch = '' }: { onSelect: (id: string) => void; initialSearch?: string }) {
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<QuotationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState<QuotationStatus | 'all'>('all');
  const [provinceFilter, setProvinceFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    (async () => {
      const { data: quots, error } = await fetchAll<Quotation>((a, b) => supabase.from('quotations').select('*').order('created_at', { ascending: false }).order('id').range(a, b));
      if (error) { setLoadError(friendlyError(error)); setLoading(false); return; }
      const list = (quots ?? []) as Quotation[];
      const clientIds = [...new Set(list.map(q => q.client_id).filter(Boolean))] as string[];
      const vehicleIds = [...new Set(list.map(q => q.vehicle_id).filter(Boolean))] as string[];
      const [cRes, vRes] = await Promise.all([
        clientIds.length ? supabase.from('clients').select('*').in('id', clientIds) : Promise.resolve({ data: [] as Client[] }),
        vehicleIds.length ? supabase.from('vehicles').select('*').in('id', vehicleIds) : Promise.resolve({ data: [] as Vehicle[] }),
      ]);
      const cMap = Object.fromEntries(((cRes.data ?? []) as Client[]).map(c => [c.id, c]));
      const vMap = Object.fromEntries(((vRes.data ?? []) as Vehicle[]).map(v => [v.id, v]));
      setRows(list.map(q => {
        const client = q.client_id ? cMap[q.client_id] ?? null : null;
        const vehicle = q.vehicle_id ? vMap[q.vehicle_id] ?? null : null;
        const hay = buildHaystack([
          q.quotation_number, client?.name, client?.phone, client?.cnic, client?.email,
          vehicle?.registration_number, vehicle?.company, vehicle?.model, vehicle?.manufacturing_year, vehicle?.engine_cc,
          label(PROVINCES, vehicle?.province), label(TRANSACTION_TYPES, q.transaction_type), label(VEHICLE_CATEGORIES, vehicle?.vehicle_category),
          label(QUOTATION_STATUSES, q.status), Math.round(q.grand_total),
        ]);
        return { ...q, client, vehicle, hay };
      }));
      setLoading(false);
    })();
  }, []);

  const { ids: drillIds } = useDrillIds('quotations');
  const filtered = useMemo(() => rows.filter(r => {
    if (drillIds && !drillIds.has(r.id)) return false;
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (provinceFilter !== 'all' && r.vehicle?.province !== provinceFilter) return false;
    if (typeFilter !== 'all' && r.transaction_type !== typeFilter) return false;
    return !search.trim() || matchesQuery(search, r.hay);
  }), [rows, search, statusFilter, provinceFilter, typeFilter, drillIds]);

  if (loading) return <Spinner label="Loading quotations..." />;

  const sel = 'px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/30';
  const filtersOn = search.trim() || statusFilter !== 'all' || provinceFilter !== 'all' || typeFilter !== 'all';

  return (
    <>
      <DrillBanner route="quotations" shown={drillIds ? rows.filter(r => drillIds.has(r.id)).length : undefined} />
      <PageHeader title="Quotations" subtitle={`${filtered.length} of ${rows.length} quotations`} />

      <Card className="p-4 mb-4">
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search client name, phone, CNIC, vehicle number, company/model, quotation no. or amount..."
              className="w-full pl-10 pr-9 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/50 transition"
            />
            {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600"><X className="w-4 h-4" /></button>}
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as QuotationStatus | 'all')} className={sel}>
              <option value="all">All Statuses</option>
              {QUOTATION_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select value={provinceFilter} onChange={e => setProvinceFilter(e.target.value)} className={sel}>
              <option value="all">All Provinces</option>
              {PROVINCES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={sel}>
              <option value="all">All Transactions</option>
              {TRANSACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            {filtersOn && (
              <button onClick={() => { setSearch(''); setStatusFilter('all'); setProvinceFilter('all'); setTypeFilter('all'); }}
                className="text-sm text-amber-700 hover:underline px-2">Clear filters</button>
            )}
          </div>
        </div>
      </Card>

      {loadError && <Card className="p-4 mb-4 border-rose-200 bg-rose-50 text-sm text-rose-700">Could not load quotations: {loadError}</Card>}

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState icon={FileText} title="No quotations found" subtitle={filtersOn ? 'Nothing matches this search. Try fewer words or clear the filters.' : 'Create a quotation from the Fee Calculator.'} />
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(r => {
              const statusMeta = QUOTATION_STATUSES.find(s => s.value === r.status);
              const v = r.vehicle;
              const vehicleLine = v ? [v.registration_number, [v.company, v.model].filter(Boolean).join(' '), v.manufacturing_year].filter(Boolean).join(' · ') : '';
              return (
                <button key={r.id} onClick={() => onSelect(r.id)}
                  className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 sm:px-5 py-4 hover:bg-slate-50 transition text-left group">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0"><FileText className="w-5 h-5 text-slate-500" /></div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{r.quotation_number}</p>
                      <p className="text-xs text-slate-600 flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{r.client?.name ?? 'Walk-in'}</span>
                        {r.client?.phone && <span className="inline-flex items-center gap-1 text-slate-500"><Phone className="w-3 h-3" />{r.client.phone}</span>}
                      </p>
                      {vehicleLine && <p className="text-xs text-slate-500 flex items-center gap-1"><Car className="w-3 h-3" />{vehicleLine}</p>}
                      <p className="text-[11px] text-slate-500">
                        {[label(PROVINCES, v?.province), label(TRANSACTION_TYPES, r.transaction_type), formatDateTime(r.created_at)].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 pl-[52px] sm:pl-0">
                    <Badge className={statusMeta?.color ?? 'bg-gray-100 text-gray-700'}>{statusMeta?.label ?? r.status}</Badge>
                    {isQuotationExpired(r, pkToday()) && <Badge className="bg-rose-100 text-rose-700">Expired</Badge>}
                    {(() => { const fu = followUpState(r.follow_up_on, r.status, pkToday()); return fu === 'overdue' ? <Badge className="bg-rose-100 text-rose-700">Follow-up overdue</Badge> : fu === 'today' ? <Badge className="bg-amber-100 text-amber-700">Follow up today</Badge> : null; })()}
                    <span className="text-sm font-bold text-slate-900 tabular-nums">{formatPKR(r.grand_total)}</span>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
        <div className="px-4 pb-4"><Pager page={page} total={filtered.length} onPage={setPage} resetKey={filtered.length} /></div>
      </Card>
    </>
  );
}
