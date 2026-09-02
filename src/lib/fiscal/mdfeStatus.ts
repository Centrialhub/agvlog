export type MdfeLifecycleStatus =
  | 'draft'
  | 'processing'
  | 'provider_unknown'
  | 'authorized'
  | 'rejected'
  | 'closing'
  | 'closed'
  | 'cancelled';

export const MDFE_STATUS_LABELS: Record<MdfeLifecycleStatus, string> = {
  draft: 'Pronto para transmitir',
  processing: 'Em processamento',
  provider_unknown: 'Aguardando conciliação',
  authorized: 'Autorizado',
  rejected: 'Rejeitado',
  closing: 'Encerramento em processamento',
  closed: 'Encerrado',
  cancelled: 'Cancelado',
};

export function normalizeMdfeStatus(value: string | null | undefined): MdfeLifecycleStatus {
  const status = String(value || '').toLowerCase();
  if (status === 'authorized') return 'authorized';
  if (status === 'rejected' || status === 'denied' || status === 'inutilized') return 'rejected';
  if (status === 'closing' || status === 'cancel_processing') return 'closing';
  if (status === 'closed' || status === 'encerrado') return 'closed';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  if (status === 'provider_unknown' || status === 'error' || status === 'interrupted') return 'provider_unknown';
  if (status === 'draft') return 'draft';
  return 'processing';
}

export function canCloseMdfe(status: string | null | undefined): boolean {
  return normalizeMdfeStatus(status) === 'authorized';
}

export function canDownloadMdfe(status: string | null | undefined): boolean {
  return ['authorized', 'closing', 'closed'].includes(normalizeMdfeStatus(status));
}
