/**
 * Utilitários para geração/parse de arquivos fixed-width DOCCOB (CTMS).
 */

export function onlyDigits(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\D+/g, '');
}

export function normalizeAsciiUpper(value: string | null | undefined): string {
  if (!value) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .toUpperCase();
}

export function padText(value: string | null | undefined, length: number): string {
  const normalized = normalizeAsciiUpper(value ?? '');
  if (normalized.length >= length) return normalized.slice(0, length);
  return normalized + ' '.repeat(length - normalized.length);
}

export function padNumber(value: string | number | null | undefined, length: number): string {
  const digits = onlyDigits(value);
  if (digits.length >= length) return digits.slice(digits.length - length);
  return '0'.repeat(length - digits.length) + digits;
}

/** Converte valor decimal em string de centavos preenchida com zeros à esquerda. */
export function moneyToCents(value: number | string | null | undefined, length: number): string {
  const raw = typeof value === 'number' ? value : parseFloat(String(value ?? '0').replace(',', '.'));
  const safe = Number.isFinite(raw) ? raw : 0;
  const cents = Math.round(safe * 100);
  return padNumber(String(cents), length);
}

/** Converte Date/string ISO em ddMMyyyy. */
export function dateToDDMMYYYY(date: Date | string | null | undefined): string {
  if (!date) return '00000000';
  const d = typeof date === 'string' ? new Date(date + (date.length === 10 ? 'T00:00:00' : '')) : date;
  if (isNaN(d.getTime())) return '00000000';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getUTCFullYear());
  return `${dd}${mm}${yyyy}`;
}

export function dateToHHMM(date: Date): string {
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hh}${mm}`;
}

export type FixedField =
  | { kind: 'text'; value: string | null | undefined; length: number }
  | { kind: 'number'; value: string | number | null | undefined; length: number }
  | { kind: 'money'; value: number | string | null | undefined; length: number }
  | { kind: 'date'; value: Date | string | null | undefined; length?: number }
  | { kind: 'raw'; value: string; length: number };

export function buildFixedLine(fields: FixedField[]): string {
  return fields
    .map((f) => {
      switch (f.kind) {
        case 'text':
          return padText(f.value ?? '', f.length);
        case 'number':
          return padNumber(f.value ?? '', f.length);
        case 'money':
          return moneyToCents(f.value ?? 0, f.length);
        case 'date':
          return dateToDDMMYYYY(f.value ?? null);
        case 'raw':
          return (f.value ?? '').padEnd(f.length, ' ').slice(0, f.length);
      }
    })
    .join('');
}

export function validateLineLength(recordType: string, line: string, expectedLength: number): string | null {
  if (line.length !== expectedLength) {
    return `Registro ${recordType}: tamanho ${line.length} difere do esperado ${expectedLength}`;
  }
  return null;
}
