// Shared helpers to normalize legacy spreadsheet rows and XML payloads
// into a canonical "LoadControl import" shape.

export type FinancialStatus =
  | 'unpaid'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'disputed'
  | 'cancelled';

/** Split "45671/45672;45673" into ["45671","45672","45673"]. Empty in => []. */
export function splitMultiValue(v: unknown): string[] {
  if (v == null) return [];
  return String(v)
    .split(/[;/|,\s]+/g)
    .map(s => s.trim())
    .filter(Boolean);
}

/** Excel serial date (days since 1899-12-30) => ISO YYYY-MM-DD. */
export function excelSerialToIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'number' && isFinite(v) && v > 59) {
    // Excel bug epoch (skip 1900-02-29)
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === 'string') {
    const s = v.trim();
    // dd/mm/yyyy
    const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (br) {
      const y = br[3].length === 2 ? '20' + br[3] : br[3];
      return `${y}-${br[2].padStart(2,'0')}-${br[1].padStart(2,'0')}`;
    }
    // yyyy-mm-dd
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  }
  return null;
}

/** Try to extract a due date ("PREVISÃO PAGAMENTO DIA 23/01/2026") from legacy STATUS text. */
export function extractLegacyExpectedPayment(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = String(text).match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/g);
  if (!m || !m.length) return null;
  // Take the last date in the string (usually the payment forecast)
  const last = m[m.length - 1];
  return excelSerialToIso(last);
}

/** Try to extract a "closed at" date ("FECHADO 08/01"). Returns YYYY-MM-DD or null. */
export function extractLegacyClosedDate(text: string | null | undefined, fallbackYear = new Date().getFullYear()): string | null {
  if (!text) return null;
  const m = /FECHAD[OA]\s+(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/i.exec(String(text));
  if (!m) return null;
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const yy = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : String(fallbackYear);
  return `${yy}-${mm}-${dd}`;
}

/** Parse a number that may come with "R$", pt-BR separators or already numeric. */
export function toNumber(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const s = String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

/** Percent may be entered as 0.09 (=9%) or "9%". Normalized to fractional. */
export function toPercentFraction(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 1 ? v / 100 : v;
  const s = String(v).trim();
  const raw = toNumber(s.replace('%',''));
  if (!raw) return null;
  return s.includes('%') || raw > 1 ? raw / 100 : raw;
}

/**
 * Compute canonical financial status.
 * Rules:
 *  - cancelled load -> 'cancelled'
 *  - received >= freight (freight>0) -> 'paid'
 *  - received > 0 -> 'partially_paid'
 *  - received = 0 and expected_payment_date < today -> 'overdue'
 *  - otherwise -> 'unpaid'
 */
export function computeFinancialStatus(input: {
  freight_amount: number;
  received_amount: number;
  expected_payment_date?: string | null;
  operational_status?: string | null;
  today?: Date;
}): FinancialStatus {
  if ((input.operational_status || '').toLowerCase() === 'cancelled') return 'cancelled';
  const f = Number(input.freight_amount || 0);
  const r = Number(input.received_amount || 0);
  if (f > 0 && r >= f - 0.0049) return 'paid';
  if (r > 0) return 'partially_paid';
  const today = input.today ?? new Date();
  const iso = today.toISOString().slice(0, 10);
  if (input.expected_payment_date && input.expected_payment_date < iso) return 'overdue';
  return 'unpaid';
}

export interface NormalizedSummaryRow {
  external_load_number: string;
  load_date: string | null;
  arrival_date: string | null;
  gross_cargo_value: number;
  freight_amount: number;
  cte_numbers: string[];
  legacy_status_text: string | null;
  expected_payment_date: string | null;
  closed_at: string | null;
}

export interface NormalizedDetailRow {
  external_load_number: string;
  invoice_numbers: string[];
  issuer_name: string | null;
  issue_date: string | null;
  recipient_name: string | null;
  destination_city: string | null;
  freight_percent: number | null;
  weight_kg: number;
  cargo_value: number;
  freight_value: number;
}

export interface NormalizedUnloadingRow {
  invoice_numbers: string[];
  client_name: string | null;
  supplier_names: string[];
  city: string | null;
  service_date: string | null;
  amount: number;
}
