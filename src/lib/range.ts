// Date ranges for the dashboard and reports. Always whole Pakistan days (Asia/Karachi); the database filters on the same Pakistan dates.
import { pkToday, addDays, pkMonthStart, pkYearStart } from './time';

export type Period = 'today' | 'week' | 'month' | 'year' | 'custom';
export const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Today' }, { value: 'week', label: 'Last 7 days' }, { value: 'month', label: 'This month' }, { value: 'year', label: 'This year' }, { value: 'custom', label: 'Custom range' },
];
/** [from, to] as YYYY-MM-DD. A custom range with one end missing uses today; a reversed custom range is swapped so it never silently shows nothing. */
export function rangeFor(p: Period, from = '', to = '', today: string = pkToday()): [string, string] {
  if (p === 'today') return [today, today];
  if (p === 'week') return [addDays(today, -6), today];
  if (p === 'month') return [pkMonthStart(today), today];
  if (p === 'year') return [pkYearStart(today), today];
  const a = from || today, b = to || today;
  return a <= b ? [a, b] : [b, a];
}
