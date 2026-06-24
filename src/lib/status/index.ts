/**
 * Canonical status sets shared across UI, hooks and policies.
 * Keep these in sync with the database transitions in statusPipeline.
 */

export const TRIP_ACTIVE_STATUSES = [
  'planned',
  'loading',
  'dispatched',
  'in_progress',
] as const;

export type TripActiveStatus = (typeof TRIP_ACTIVE_STATUSES)[number];

/** Paradas que ainda não foram visitadas. */
export const STOP_PENDING_STATUSES = ['pending', 'planned'] as const;

/** Motorista está no cliente (ou chegando). */
export const STOP_ARRIVED_STATUSES = ['arriving', 'arrived', 'in_progress'] as const;

/** Paradas finalizadas (entregues / canceladas / puladas). */
export const STOP_COMPLETED_STATUSES = [
  'completed',
  'delivered',
  'cancelled',
  'skipped',
] as const;

export const TRIP_STATUS_LABELS: Record<string, string> = {
  planned: 'Planejada',
  loading: 'Em carregamento',
  dispatched: 'Despachada',
  in_progress: 'Em andamento',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};

export const STOP_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  planned: 'Planejada',
  arriving: 'Chegando',
  arrived: 'No local',
  in_progress: 'Em atendimento',
  completed: 'Concluída',
  delivered: 'Entregue',
  cancelled: 'Cancelada',
  skipped: 'Pulada',
};

export const tripStatusLabel = (s: string | null | undefined) =>
  (s && TRIP_STATUS_LABELS[s]) || s || '—';

export const stopStatusLabel = (s: string | null | undefined) =>
  (s && STOP_STATUS_LABELS[s]) || s || '—';

export const isStopArrived = (s: string | null | undefined) =>
  !!s && (STOP_ARRIVED_STATUSES as readonly string[]).includes(s);

export const isStopCompleted = (s: string | null | undefined) =>
  !!s && (STOP_COMPLETED_STATUSES as readonly string[]).includes(s);

export const isStopPending = (s: string | null | undefined) =>
  !!s && (STOP_PENDING_STATUSES as readonly string[]).includes(s);