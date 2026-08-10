/**
 * Status fiscais que NÃO devem ser considerados no faturamento/receita.
 * Um documento cancelado, rejeitado ou denegado não gera valor financeiro.
 */
export const VOID_FISCAL_STATUSES = new Set([
  'cancelled',
  'canceled',
  'cancelada',
  'cancelado',
  'rejected',
  'rejeitada',
  'rejeitado',
  'denied',
  'denegada',
  'denegado',
  'inutilizada',
  'error',
  'erro',
  'failed',
]);

export function isVoidFiscalStatus(status?: string | null): boolean {
  return VOID_FISCAL_STATUSES.has(String(status || '').trim().toLowerCase());
}

/** Documento válido para somar em receita/faturamento. */
export function isBillableFiscalDoc(doc: { status?: string | null; sefaz_status?: string | null } | null | undefined): boolean {
  if (!doc) return false;
  return !isVoidFiscalStatus(doc.status) && !isVoidFiscalStatus(doc.sefaz_status);
}

/**
 * Receita de um CT-e sem dupla contagem: `value` do CT-e espelha o frete,
 * então nunca somamos os dois campos.
 */
export function fiscalDocRevenue(doc: { freight_value?: any; value?: any } | null | undefined): number {
  if (!doc) return 0;
  const freight = Number(doc.freight_value) || 0;
  if (freight > 0) return freight;
  return Number(doc.value) || 0;
}
