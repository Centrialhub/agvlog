/**
 * Field validation + UNKNOWN-fallback helpers for ORT extraction.
 * When the AI returns a value that is partially illegible (e.g. CEP "12345" instead of "12345-678"),
 * we mark it as UNKNOWN so the user knows to fix it manually.
 */

export const UNKNOWN = 'UNKNOWN';

const onlyDigits = (v: string) => v.replace(/\D/g, '');

/** CEP must be 8 digits. Anything shorter/longer → UNKNOWN. */
export function normalizeZip(raw: string | undefined | null): string {
  const s = String(raw ?? '').trim();
  if (!s || /unknown|ileg|n\/?a|nao informado/i.test(s)) return UNKNOWN;
  const digits = onlyDigits(s);
  if (digits.length !== 8) return UNKNOWN;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

/** Brazilian phone: 10 or 11 digits (with DDD). Otherwise UNKNOWN. */
export function normalizePhone(raw: string | undefined | null): string {
  const s = String(raw ?? '').trim();
  if (!s || /unknown|ileg|n\/?a|nao informado/i.test(s)) return UNKNOWN;
  const digits = onlyDigits(s);
  if (digits.length < 10 || digits.length > 11) return UNKNOWN;
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
}

/** Address number: must contain at least one digit OR explicit S/N. */
export function normalizeAddressNumber(raw: string | undefined | null): string {
  const s = String(raw ?? '').trim();
  if (!s || /unknown|ileg|n\/?a|nao informado/i.test(s)) return UNKNOWN;
  if (/^s\/?n$|^sn$/i.test(s)) return 'S/N';
  if (!/\d/.test(s)) return UNKNOWN;
  return s;
}

/** Street/address: at least 3 chars, must contain a letter. */
export function normalizeAddress(raw: string | undefined | null): string {
  const s = String(raw ?? '').trim();
  if (!s || /unknown|ileg|n\/?a|nao informado/i.test(s)) return UNKNOWN;
  if (s.length < 3 || !/[a-zà-ú]/i.test(s)) return UNKNOWN;
  return s;
}

/** CNPJ (14) or CPF (11) — anything else → UNKNOWN. */
export function normalizeTaxId(raw: string | undefined | null): string {
  const s = String(raw ?? '').trim();
  if (!s || /unknown|ileg|n\/?a/i.test(s)) return UNKNOWN;
  const digits = onlyDigits(s);
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  return UNKNOWN;
}

/** Generic short text (city, neighborhood). */
export function normalizeShortText(raw: string | undefined | null): string {
  const s = String(raw ?? '').trim();
  if (!s || /unknown|ileg|n\/?a|nao informado/i.test(s)) return UNKNOWN;
  return s;
}

export interface FallbackReport {
  unknownFields: string[];
  fixedFields: string[]; // value normalized but not unknown
}

export const isUnknown = (v: unknown) => String(v ?? '').trim().toUpperCase() === UNKNOWN;

/** Apply fallbacks to an ORT-shaped object. Returns the patched object + report. */
export function applyOrtFallbacks<T extends {
  recipientZip?: string;
  recipientPhone?: string;
  recipientAddress?: string;
  recipientAddressNumber?: string;
  recipientCnpj?: string;
  recipientNeighborhood?: string;
  recipientCity?: string;
}>(input: T): { patched: T; report: FallbackReport } {
  const unknownFields: string[] = [];
  const fixedFields: string[] = [];

  const map: Array<[keyof T, (raw: any) => string]> = [
    ['recipientZip', normalizeZip],
    ['recipientPhone', normalizePhone],
    ['recipientAddress', normalizeAddress],
    ['recipientAddressNumber', normalizeAddressNumber],
    ['recipientCnpj', normalizeTaxId],
    ['recipientNeighborhood', normalizeShortText],
  ];

  const patched: any = { ...input };
  for (const [field, fn] of map) {
    const original = String((input as any)[field] ?? '').trim();
    const normalized = fn(original);
    patched[field] = normalized;
    if (normalized === UNKNOWN) {
      unknownFields.push(String(field));
    } else if (original && original !== normalized) {
      fixedFields.push(String(field));
    }
  }

  return { patched, report: { unknownFields, fixedFields } };
}