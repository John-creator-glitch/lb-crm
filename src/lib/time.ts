// One place for "what day is it" in the business: Pakistan time (Asia/Karachi, UTC+5, no daylight saving).
// Never use new Date().toISOString().slice(0, 10) for a business date: that is the UTC day and is wrong
// between midnight and 5 am in Pakistan.
export const PK_TZ = 'Asia/Karachi';
const PK_OFFSET = '+05:00';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: PK_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Calendar date (YYYY-MM-DD) in Pakistan for a moment in time (Date, ISO string from the database, or ms). */
export function pkDateOf(when: Date | string | number = new Date()): string {
  return fmt.format(new Date(when));
}
export const pkToday = (): string => pkDateOf(new Date());

/** Add (or subtract) whole days to a YYYY-MM-DD date. Pure calendar arithmetic, no time zone involved. */
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const pkMonthStart = (ymd: string = pkToday()): string => `${ymd.slice(0, 7)}-01`;
export const pkYearStart = (ymd: string = pkToday()): string => `${ymd.slice(0, 4)}-01-01`;
export const compactDate = (ymd: string = pkToday()): string => ymd.replace(/-/g, '');

/** The exact UTC moment a Pakistan day begins, as an ISO string for filtering timestamptz columns. */
export const pkDayStartUtc = (ymd: string): string => new Date(`${ymd}T00:00:00${PK_OFFSET}`).toISOString();

/** Filter bounds for timestamptz columns covering the Pakistan days from..to inclusive: gte(from) and lt(toExclusive). */
export function pkRangeUtc(fromYmd: string, toYmd: string): { from: string; toExclusive: string } {
  return { from: pkDayStartUtc(fromYmd), toExclusive: pkDayStartUtc(addDays(toYmd, 1)) };
}
