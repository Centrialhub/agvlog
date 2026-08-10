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

/** Status de NFS-e que já representam serviço faturado. */
export const NFSE_BILLABLE_STATUSES = new Set(['issued', 'authorized', 'autorizado', 'processing', 'submitted']);

/**
 * Status de NFS-e que já são receita confirmada (nota realmente emitida).
 * `processing`/`submitted` ainda podem ser rejeitados — não viram receita.
 */
export const NFSE_CONFIRMED_STATUSES = new Set(['issued', 'authorized', 'autorizado']);

/**
 * Status de documento de saída (CT-e) que ainda não são receita confirmada:
 * rascunhos e transmissões em andamento podem virar rejeição.
 */
export const PENDING_FISCAL_STATUSES = new Set([
  'draft',
  'rascunho',
  'pending',
  'pendente',
  'transmitting',
  'transmitindo',
  'processing',
  'processando',
  'submitted',
]);

/** Documento fiscal confirmado (não anulado e não em trânsito) — usar em receita. */
export function isConfirmedFiscalDoc(
  doc: { status?: string | null; sefaz_status?: string | null } | null | undefined,
): boolean {
  if (!isBillableFiscalDoc(doc)) return false;
  const s = String(doc?.status || '').trim().toLowerCase();
  return !PENDING_FISCAL_STATUSES.has(s);
}

/**
 * Um CT-e (rascunho, lote ou emitido) consome a NF do pool de faturamento
 * enquanto não estiver anulado. Rascunhos também consomem: caso contrário a
 * mesma NF entraria em dois lotes diferentes.
 */
export function cteConsumesInvoices(row: { status?: string | null } | null | undefined): boolean {
  if (!row) return false;
  return !isVoidFiscalStatus(row.status);
}

/** NFS-e válida para somar em receita de serviço. */
export function isBillableNfse(doc: { status?: string | null } | null | undefined): boolean {
  if (!doc) return false;
  const s = String(doc.status || '').trim().toLowerCase();
  if (isVoidFiscalStatus(s)) return false;
  return NFSE_BILLABLE_STATUSES.has(s);
}

/** NFS-e com receita confirmada (exclui em processamento). */
export function isConfirmedNfse(doc: { status?: string | null } | null | undefined): boolean {
  if (!doc) return false;
  const s = String(doc.status || '').trim().toLowerCase();
  if (isVoidFiscalStatus(s)) return false;
  return NFSE_CONFIRMED_STATUSES.has(s);
}

/** Receita de uma NFS-e (valor bruto dos serviços). */
export function nfseRevenue(doc: { valor_servicos?: any; valor_liquido?: any } | null | undefined): number {
  if (!doc) return 0;
  const servicos = Number(doc.valor_servicos) || 0;
  if (servicos > 0) return servicos;
  return Number(doc.valor_liquido) || 0;
}
