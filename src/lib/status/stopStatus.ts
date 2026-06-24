/**
 * Canonical status helpers for dispatch stops.
 * Mirror of public.stop_terminal_statuses() in the database.
 */

export const STOP_TERMINAL_STATUSES = [
  'completed',
  'delivered',
  'cancelled',
  'skipped',
  'refused',
  'returned',
  'partial_delivery',
  'failed',
] as const;

export type StopTerminalStatus = (typeof STOP_TERMINAL_STATUSES)[number];

export const STOP_ACTIVE_STATUSES = [
  'pending',
  'planned',
  'arriving',
  'arrived',
  'in_progress',
  'servicing',
  'departed',
] as const;

export type StopActiveStatus = (typeof STOP_ACTIVE_STATUSES)[number];

export const STOP_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  planned: 'Planejada',
  arriving: 'Chegando',
  arrived: 'No local',
  in_progress: 'Em atendimento',
  servicing: 'Em atendimento',
  departed: 'Saiu do local',
  completed: 'Concluída',
  delivered: 'Entregue',
  cancelled: 'Cancelada',
  skipped: 'Pulada',
  refused: 'Recusada',
  returned: 'Devolvida',
  partial_delivery: 'Entrega parcial',
  failed: 'Falha na entrega',
};

export const STOP_STATUS_TONE: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  planned: 'bg-muted text-muted-foreground',
  arriving: 'bg-info/10 text-info',
  arrived: 'bg-primary/10 text-primary',
  in_progress: 'bg-primary/10 text-primary',
  servicing: 'bg-primary/10 text-primary',
  departed: 'bg-info/10 text-info',
  completed: 'bg-success/10 text-success',
  delivered: 'bg-success/10 text-success',
  cancelled: 'bg-muted text-muted-foreground',
  skipped: 'bg-muted text-muted-foreground',
  refused: 'bg-destructive/10 text-destructive',
  returned: 'bg-warning/10 text-warning',
  partial_delivery: 'bg-warning/10 text-warning',
  failed: 'bg-destructive/10 text-destructive',
};

export function isStopTerminal(s: string | null | undefined): boolean {
  return !!s && (STOP_TERMINAL_STATUSES as readonly string[]).includes(s);
}

export function isStopActive(s: string | null | undefined): boolean {
  return !!s && (STOP_ACTIVE_STATUSES as readonly string[]).includes(s);
}

export function stopStatusLabel(s: string | null | undefined): string {
  if (!s) return '—';
  return STOP_STATUS_LABELS[s] ?? s;
}