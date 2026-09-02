import type { ImportedNoteFilters } from '@/hooks/useImportedNotesSummary';

export function normalizeImportedNoteFilters(filters: ImportedNoteFilters): ImportedNoteFilters {
  return Object.fromEntries(Object.entries(filters).map(([key, value]) => [
    key, typeof value === 'string' ? value.trim() || null : value,
  ]));
}

function localDayBoundary(day: string, nextDay = false): string {
  const date = new Date(`${day}T00:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(date.getTime())) {
    throw new Error('Informe uma data de importação válida.');
  }
  if (nextDay) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

/** Match the same imported_at ?? created_at date shown in the note details. */
export function buildImportedAtFilter({ importFrom, importTo }: ImportedNoteFilters): string | null {
  if (!importFrom && !importTo) return null;
  if (importFrom && importTo && importFrom > importTo) {
    throw new Error('A data inicial de importação deve ser anterior ou igual à data final.');
  }
  const bounds: string[] = [];
  if (importFrom) bounds.push(`gte.${localDayBoundary(importFrom)}`);
  // Exclusive next-day boundary includes fractional seconds and the entire local day.
  if (importTo) bounds.push(`lt.${localDayBoundary(importTo, true)}`);
  return [
    `and(${bounds.map(bound => `imported_at.${bound}`).join(',')})`,
    `and(imported_at.is.null,${bounds.map(bound => `created_at.${bound}`).join(',')})`,
  ].join(',');
}
