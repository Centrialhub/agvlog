import { APP_TIME_ZONE, dateOnlyUtcRange } from '@/lib/utils/formatDate';

interface ImportDateDocument {
  imported_at?: string | null;
  created_at: string;
}

export interface ImportDateRange {
  from: number | null;
  toExclusive: number | null;
  error: string | null;
}

/** Same import timestamp used by the imported notes summary, including legacy records. */
export function documentImportTimestamp(document: ImportDateDocument): string {
  return document.imported_at ?? document.created_at;
}

export function newLoadImportDateRange(importFrom: string, importTo: string, timeZone = APP_TIME_ZONE): ImportDateRange {
  if (importFrom && importTo && importFrom > importTo) {
    return { from: null, toExclusive: null, error: 'A data inicial de importação deve ser anterior ou igual à data final.' };
  }
  try {
    return {
      from: importFrom ? Date.parse(dateOnlyUtcRange(importFrom, timeZone).from) : null,
      toExclusive: importTo ? Date.parse(dateOnlyUtcRange(importTo, timeZone).toExclusive) : null,
      error: null,
    };
  } catch {
    return { from: null, toExclusive: null, error: 'Informe uma data de importação válida.' };
  }
}

export function matchesNewLoadImportDate(document: ImportDateDocument, range: ImportDateRange): boolean {
  if (range.error) return false;
  if (range.from === null && range.toExclusive === null) return true;
  const timestamp = Date.parse(documentImportTimestamp(document));
  return Number.isFinite(timestamp)
    && (range.from === null || timestamp >= range.from)
    && (range.toExclusive === null || timestamp < range.toExclusive);
}
