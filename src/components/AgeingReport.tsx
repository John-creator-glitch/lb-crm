import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, Spinner, Button } from '@/components/ui';
import { formatPKR } from '@/lib/format';
import { downloadCSV } from '@/lib/csv';
import { pkToday } from '@/lib/time';
import { Download } from 'lucide-react';
import { friendlyError } from '@/lib/errors';

interface Row { account_id: string; name: string; pending: number; b0: number; b31: number; b61: number; b90: number; advance: number }

/** Outstanding ageing from the database (account_balances): every paying account, not a loaded subset. Money received clears the oldest bills first. */
export default function AgeingReport() {
  const [data, setData] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  const today = pkToday();
  useEffect(() => {
    supabase.rpc('account_balances').then(({ data: d, error }) => {
      if (error) { setErr(friendlyError(error)); return; }
      setData(((d ?? []) as Row[]).map(r => ({ ...r, pending: Number(r.pending), b0: Number(r.b0), b31: Number(r.b31), b61: Number(r.b61), b90: Number(r.b90), advance: Number(r.advance) })));
    });
  }, []);
  const rows = useMemo(() => (data ?? []).filter(r => r.pending > 0.004 || r.advance > 0.004).map(r => ({ account: { id: r.account_id, name: r.name }, age: { current: r.b0, d31: r.b31, d61: r.b61, d90: r.b90, total: r.b0 + r.b31 + r.b61 + r.b90, advance: r.advance } })).sort((x, y) => y.age.total - x.age.total), [data]);
  const tot = rows.reduce((t, r) => ({ current: t.current + r.age.current, d31: t.d31 + r.age.d31, d61: t.d61 + r.age.d61, d90: t.d90 + r.age.d90, total: t.total + r.age.total, advance: t.advance + r.age.advance }), { current: 0, d31: 0, d61: 0, d90: 0, total: 0, advance: 0 });
  if (err) return <Card className="p-4 text-sm text-rose-700">Ageing could not be loaded: {err}</Card>;
  if (!data) return <Spinner label="Building ageing..." />;
  const n = (v: number) => (v > 0.004 ? formatPKR(v) : '');
  return (
    <Card className="overflow-hidden mt-4 border border-slate-200 shadow-sm bg-white">
      <div className="flex items-center justify-between px-4 py-3 bg-slate-50/70 border-b border-slate-200">
        <div><h2 className="font-semibold text-slate-900 text-sm">Outstanding ageing</h2><p className="text-xs text-slate-500">As of today. Payments clear the oldest bills first; draft and rejected quotations are not counted.</p></div>
        <Button size="sm" variant="secondary" onClick={() => downloadCSV(`ageing_${today}.csv`, [['Client', '0-30 days', '31-60', '61-90', '90+', 'Outstanding', 'Advance'], ...rows.map(r => [r.account.name ?? '', r.age.current, r.age.d31, r.age.d61, r.age.d90, r.age.total, r.age.advance]), ['TOTAL', tot.current, tot.d31, tot.d61, tot.d90, tot.total, tot.advance]])}><Download className="w-4 h-4" /> CSV</Button>
      </div>
      {rows.length === 0 ? <p className="p-6 text-sm text-slate-500 text-center">Nothing outstanding.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200"><tr><th className="text-left font-semibold px-4 py-2.5">Client</th><th className="text-right font-semibold px-2 py-2.5">0–30 days</th><th className="text-right font-semibold px-2 py-2.5">31–60</th><th className="text-right font-semibold px-2 py-2.5">61–90</th><th className="text-right font-semibold px-2 py-2.5">90+</th><th className="text-right font-semibold px-2 py-2.5">Outstanding</th><th className="text-right font-semibold px-4 py-2.5">Advance</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r.account.id} className="hover:bg-slate-50/50"><td className="px-4 py-2.5 font-medium text-slate-900">{r.account.name}</td><td className="px-2 py-2.5 text-right tabular-nums text-slate-700">{n(r.age.current)}</td><td className="px-2 py-2.5 text-right tabular-nums text-slate-700">{n(r.age.d31)}</td><td className="px-2 py-2.5 text-right tabular-nums text-slate-700">{n(r.age.d61)}</td><td className="px-2 py-2.5 text-right tabular-nums font-semibold text-rose-600">{n(r.age.d90)}</td><td className="px-2 py-2.5 text-right tabular-nums font-bold text-slate-900">{n(r.age.total)}</td><td className="px-4 py-2.5 text-right tabular-nums font-semibold text-blue-600">{n(r.age.advance)}</td></tr>
              ))}
              <tr className="bg-slate-50 font-bold border-t-2 border-slate-200 text-slate-900"><td className="px-4 py-2.5">Total</td><td className="px-2 py-2.5 text-right tabular-nums">{n(tot.current)}</td><td className="px-2 py-2.5 text-right tabular-nums">{n(tot.d31)}</td><td className="px-2 py-2.5 text-right tabular-nums">{n(tot.d61)}</td><td className="px-2 py-2.5 text-right tabular-nums text-rose-600">{n(tot.d90)}</td><td className="px-2 py-2.5 text-right tabular-nums">{n(tot.total)}</td><td className="px-4 py-2.5 text-right tabular-nums text-blue-600">{n(tot.advance)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
