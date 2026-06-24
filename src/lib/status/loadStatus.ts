/**
 * Canonical status helpers for loads and stops.
 * Mirror of public.stop_terminal_statuses() in the database.
 */

export const TERMINAL_STOP_STATUSES = [
  'completed',
  'delivered',
  'cancelled',
  'skipped',
  'refused',
  'returned',
  'partial_delivery',
  'failed',
] as const;

export type TerminalStopStatus = typeof TERMINAL_STOP_STATUSES[number];

export const LOAD_STATUSES = [
  'planned',
  'assembling',
  'ready',
  'loading',
  'loaded',
  'in_transit',
  'partial_delivery',
  'returned',
  'refused',
  'failed',
  'cancelled',
  'delivered',
  'divergent',
] as const;

export type LoadStatus = typeof LOAD_STATUSES[number];

export const LOAD_STATUS_LABELS: Record<LoadStatus, string> = {
  planned: 'Planejada',
  assembling: 'Montando',
  ready: 'Pronta',
  loading: 'Carregando',
  loaded: 'Carregada',
  in_transit: 'Em trânsito',
  partial_delivery: 'Entrega parcial',
  returned: 'Devolvida',
  refused: 'Recusada',
  failed: 'Falha na entrega',
  cancelled: 'Cancelada',
  delivered: 'Entregue',
  divergent: 'Divergente',
};

/**
 * Semantic tone tokens (Tailwind class fragments) per status.
 * Use as `bg-${tone}/10 text-${tone}` etc — kept as bg/text pairs for direct use.
 */
export const LOAD_STATUS_TONE: Record<LoadStatus, string> = {
  planned: 'bg-muted text-muted-foreground',
  assembling: 'bg-muted text-muted-foreground',
  ready: 'bg-muted text-foreground',
  loading: 'bg-warning/10 text-warning',
  loaded: 'bg-info/10 text-info',
  in_transit: 'bg-info/10 text-info',
  partial_delivery: 'bg-warning/10 text-warning',
  returned: 'bg-warning/10 text-warning',
  refused: 'bg-destructive/10 text-destructive',
  failed: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
  delivered: 'bg-success/10 text-success',
  divergent: 'bg-destructive/10 text-destructive',
};

export function isTerminalStopStatus(s: string | null | undefined): s is TerminalStopStatus {
  return !!s && (TERMINAL_STOP_STATUSES as readonly string[]).includes(s);
}

export function loadStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return (LOAD_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

/** True if the load reached any terminal state (won't progress further automatically). */
export const TERMINAL_LOAD_STATUSES = [
  'delivered',
  'partial_delivery',
  'returned',
  'refused',
  'failed',
  'cancelled',
] as const;

export function isTerminalLoadStatus(s: string | null | undefined) {
  return !!s && (TERMINAL_LOAD_STATUSES as readonly string[]).includes(s);
}