import { localDateInputValue, shiftDateInputValue } from '@/lib/utils/formatDate';

export function reportsDefaultPeriod(now = new Date()): { from: string; to: string } {
  const to = localDateInputValue(now);
  return { from: shiftDateInputValue(to, -6), to };
}
