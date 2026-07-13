/**
 * Centralized normalization + identity helpers for fiscal documents (NF-e).
 * Mirrors the DB functions `normalize_tax_id` / `normalize_fiscal_number`
 * and the partial unique indexes `uq_fiscal_documents_access_key` /
 * `uq_fiscal_documents_supplier_invoice`.
 */

export function onlyDigits(value?: string | null): string {
  return (value ?? '').replace(/\D/g, '');
}

export function normalizeTaxId(value?: string | null): string {
  return onlyDigits(value);
}

export function normalizeFiscalNumber(value?: string | null): string {
  const digits = onlyDigits(value);
  if (!digits) return '';
  const stripped = digits.replace(/^0+(?=\d)/, '');
  return stripped || '0';
}

export type FiscalIdentityInput = {
  tenantId: string;
  accessKey?: string | null;
  emitterCnpj?: string | null;
  model?: string | null;
  series?: string | null;
  invoiceNumber?: string | null;
};

/**
 * Returns a stable string identifier for de-duplication inside a batch/session.
 * Priority: access key (44-digit chNFe). Fallback: tenant+cnpj+model+series+number.
 * Returns null if the document lacks enough data to be safely deduplicated.
 */
export function buildFiscalDocumentIdentity(input: FiscalIdentityInput): string | null {
  if (!input.tenantId) return null;

  const accessKey = onlyDigits(input.accessKey);
  if (accessKey) return `access-key:${input.tenantId}:${accessKey}`;

  const cnpj = onlyDigits(input.emitterCnpj);
  const number = normalizeFiscalNumber(input.invoiceNumber);
  if (!cnpj || !number) return null;

  const series = normalizeFiscalNumber(input.series) || '0';
  const model = normalizeFiscalNumber(input.model) || '55';

  return ['supplier-invoice', input.tenantId, cnpj, model, series, number].join(':');
}

export class DuplicateFiscalDocumentError extends Error {
  existingDocument?: unknown;
  constraint?: string;
  constructor(existingDocument?: unknown, constraint?: string) {
    super('DUPLICATE_FISCAL_DOCUMENT');
    this.name = 'DuplicateFiscalDocumentError';
    this.existingDocument = existingDocument;
    this.constraint = constraint;
  }
}

/** Detects Postgres unique_violation (SQLSTATE 23505) from Supabase errors. */
export function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  if (e.code === '23505') return true;
  return typeof e.message === 'string' && /duplicate key value|unique constraint/i.test(e.message);
}

/** Human-readable message for the UI. */
export function formatDuplicateFiscalDocumentMessage(existing?: {
  invoice_number?: string | null;
  invoice_series?: string | null;
  fiscal_model?: string | null;
  remitter?: string | null;
  remitter_cnpj?: string | null;
  access_key?: string | null;
}): string {
  if (!existing) return 'Esta nota fiscal já está cadastrada.';
  const parts: string[] = ['Esta nota fiscal já está cadastrada.'];
  if (existing.remitter) parts.push(`Fornecedor: ${existing.remitter}`);
  if (existing.remitter_cnpj) parts.push(`CNPJ: ${existing.remitter_cnpj}`);
  if (existing.invoice_number) parts.push(`Nota: ${existing.invoice_number}`);
  if (existing.invoice_series) parts.push(`Série: ${existing.invoice_series}`);
  if (existing.fiscal_model) parts.push(`Modelo: ${existing.fiscal_model}`);
  if (existing.access_key) parts.push(`Chave: ${existing.access_key}`);
  return parts.join(' • ');
}