import type { ImportedNoteFilters } from '@/hooks/useImportedNotesSummary';
import { APP_TIME_ZONE, dateOnlyUtcRange } from '@/lib/utils/formatDate';

export function normalizeImportedNoteFilters(filters: ImportedNoteFilters): ImportedNoteFilters {
  return Object.fromEntries(Object.entries(filters).map(([key, value]) => [
    key, typeof value === 'string' ? value.trim() || null : value,
  ]));
}

export function validateImportedNoteFilters(filters: ImportedNoteFilters): void {
  const normalized = normalizeImportedNoteFilters(filters);
  if (normalized.issueFrom && normalized.issueTo && normalized.issueFrom > normalized.issueTo) {
    throw new Error('A data inicial de emissão deve ser anterior ou igual à data final.');
  }
  if (normalized.importFrom && normalized.importTo && normalized.importFrom > normalized.importTo) {
    throw new Error('A data inicial de importação deve ser anterior ou igual à data final.');
  }
}

/** Match the same imported_at ?? created_at date shown in the note details. */
export function buildImportedAtFilter(
  { importFrom, importTo }: ImportedNoteFilters,
  timeZone = APP_TIME_ZONE,
): string | null {
  if (!importFrom && !importTo) return null;
  if (importFrom && importTo && importFrom > importTo) {
    throw new Error('A data inicial de importação deve ser anterior ou igual à data final.');
  }
  const bounds: string[] = [];
  try {
    if (importFrom) bounds.push(`gte.${dateOnlyUtcRange(importFrom, timeZone).from}`);
    // Exclusive next-day boundary includes fractional seconds and the entire tenant day.
    if (importTo) bounds.push(`lt.${dateOnlyUtcRange(importTo, timeZone).toExclusive}`);
  } catch {
    throw new Error('Informe uma data de importação válida.');
  }
  return [
    `and(${bounds.map(bound => `imported_at.${bound}`).join(',')})`,
    `and(imported_at.is.null,${bounds.map(bound => `created_at.${bound}`).join(',')})`,
  ].join(',');
}
