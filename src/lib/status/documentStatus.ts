/**
 * Canonical status helpers for fiscal documents.
 */

export const DOCUMENT_STATUSES = [
  'pending',
  'confirmed',
  'assigned',
  'loading',
  'loaded',
  'in_transit',
  'delivered',
  'partial_delivery',
  'returned',
  'refused',
  'failed',
  'cancelled',
  'not_delivered',
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  confirmed: 'Confirmado',
  assigned: 'Alocado',
  loading: 'Carregando',
  loaded: 'Carregado',
  in_transit: 'Em trânsito',
  delivered: 'Entregue',
  partial_delivery: 'Entrega parcial',
  returned: 'Devolvido',
  refused: 'Recusado',
  failed: 'Falha na entrega',
  cancelled: 'Cancelado',
  not_delivered: 'Não entregue',
};

export const DOCUMENT_STATUS_TONE: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  confirmed: 'bg-muted text-foreground',
  assigned: 'bg-info/10 text-info',
  loading: 'bg-warning/10 text-warning',
  loaded: 'bg-info/10 text-info',
  in_transit: 'bg-info/10 text-info',
  delivered: 'bg-success/10 text-success',
  partial_delivery: 'bg-warning/10 text-warning',
  returned: 'bg-warning/10 text-warning',
  refused: 'bg-destructive/10 text-destructive',
  failed: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
  not_delivered: 'bg-destructive/10 text-destructive',
};

export const TERMINAL_DOCUMENT_STATUSES = [
  'delivered',
  'partial_delivery',
  'returned',
  'refused',
  'failed',
  'cancelled',
  'not_delivered',
] as const;

export function documentStatusLabel(s: string | null | undefined): string {
  if (!s) return '—';
  return DOCUMENT_STATUS_LABELS[s] ?? s;
}

export function isDocumentTerminal(s: string | null | undefined): boolean {
  return !!s && (TERMINAL_DOCUMENT_STATUSES as readonly string[]).includes(s);
}

/** 
 * Status de documento de saída que ainda não são receita confirmada: 
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

/** 
 * Status fiscais que NÃO devem ser considerados no faturamento/receita.
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