import { APP_TIME_ZONE, dateOnlyUtcRange, datePickerInputValue, localDateInputValue } from '@/lib/utils/formatDate';

export function operationalEventDateBounds(dateFrom?: Date | null, dateTo?: Date | null, timeZone = APP_TIME_ZONE) {
  const fromRange = dateFrom ? dateOnlyUtcRange(datePickerInputValue(dateFrom), timeZone) : null;
  const toRange = dateTo ? dateOnlyUtcRange(datePickerInputValue(dateTo), timeZone) : null;
  return {
    fromInclusive: fromRange?.from ?? null,
    toInclusive: toRange ? new Date(Date.parse(toRange.toExclusive) - 1).toISOString() : null,
    toExclusive: toRange?.toExclusive ?? null,
  };
}

export function operationalEventMonthKey(value: Date | string, timeZone = APP_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : localDateInputValue(date, timeZone).slice(0, 7);
}

export function trailingOperationalEventMonths(today: string, count = 12) {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(today);
  if (!match) return [];
  const current = Number(match[1]) * 12 + Number(match[2]) - 1;
  return Array.from({ length: count }, (_, index) => {
    const serial = current - (count - 1 - index);
    const year = Math.floor(serial / 12);
    const month = serial % 12 + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const label = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' })
      .format(new Date(`${key}-01T12:00:00.000Z`));
    return { key, label };
  });
}
