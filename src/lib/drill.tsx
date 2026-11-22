import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** A dashboard KPI that was clicked: the page it opens shows exactly these records (ids come from the database's kpi_ids, the same list the KPI counted). */
export interface Drill { route: string; kind: string; label: string; ids: string[] }
interface Ctx { drill: Drill | null; clear: () => void }
const DrillContext = createContext<Ctx>({ drill: null, clear: () => {} });
export function DrillProvider({ drill, clear, children }: { drill: Drill | null; clear: () => void; children: ReactNode }) {
  const v = useMemo(() => ({ drill, clear }), [drill, clear]);
  return <DrillContext.Provider value={v}>{children}</DrillContext.Provider>;
}
/** Ids to restrict a page to (null = no drill-down for this page). */
export function useDrillIds(route: string): { ids: Set<string> | null; drill: Drill | null } {
  const { drill } = useContext(DrillContext);
  return useMemo(() => drill && drill.route === route ? { ids: new Set(drill.ids), drill } : { ids: null, drill: null }, [drill, route]);
}
/** Banner shown above a drilled list. `shown` = how many of the KPI's records this page could display. */
export function DrillBanner({ route, shown }: { route: string; shown?: number }) {
  const { drill, clear } = useContext(DrillContext);
  if (!drill || drill.route !== route) return null;
  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      <span className="flex-1">From the dashboard: <b>{drill.label}</b> · {drill.ids.length} record{drill.ids.length === 1 ? '' : 's'}{shown !== undefined && shown < drill.ids.length ? ` (${shown} could be loaded here; narrow the list or open the report)` : ''}</span>
      <button onClick={clear} className="inline-flex items-center gap-1 text-xs font-medium underline"><X className="w-3.5 h-3.5" /> Show all</button>
    </div>
  );
}
