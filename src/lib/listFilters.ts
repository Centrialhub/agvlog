/** Text search shared by local list filters and navigation. */
export function normalizeSearch(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[./-]/g, '').toLocaleLowerCase('pt-BR').trim();
}

export function matchesSearch(query: string, ...values: unknown[]): boolean {
  const text = values.map(normalizeSearch).join(' ');
  return normalizeSearch(query).split(/\s+/).filter(Boolean).every(term => text.includes(term));
}

/** Date inputs represent calendar days; timestamps include the whole final day. */
export function matchesDateRange(value: string | null | undefined, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!value) return false;
  const day = calendarDay(value);
  if (!day) return false;
  return (!from || day >= from) && (!to || day <= to);
}

/** Keep date-only columns unchanged; display timestamps in the user's local calendar. */
export function calendarDay(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.isNaN(new Date(value + 'T12:00:00').getTime()) ? '' : value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

/** Exclusive upper bound also includes fractional seconds and daylight-saving changes. */
export function localDayBoundary(day: string, nextDay = false): string {
  const date = new Date(day + 'T00:00:00');
  if (nextDay) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

export function localDayEnd(day: string): string {
  return new Date(Date.parse(localDayBoundary(day, true)) - 1).toISOString();
}

export function filterOptions(values: (string | null | undefined)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
