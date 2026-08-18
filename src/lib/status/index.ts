/**
 * Canonical status helpers — single source of truth for loads, stops e documents.
 */

export const TRIP_ACTIVE_STATUSES = [
  'planned',
  'loading',
  'dispatched',
  'in_progress',
  'in_transit',
] as const;
export type TripActiveStatus = (typeof TRIP_ACTIVE_STATUSES)[number];

export const LOAD_ACTIVE_STATUSES = [
  'ready',
  'loading',
  'loaded',
  'in_transit',
  'partial_delivery',
] as const;
export type LoadActiveStatus = (typeof LOAD_ACTIVE_STATUSES)[number];

export const TRIP_STATUS_LABELS: Record<string, string> = {
  planned: 'Planejada',
  loading: 'Em carregamento',
  dispatched: 'Despachada',
  in_progress: 'Em andamento',
  in_transit: 'Em trânsito',
  completed: 'Concluída',
  cancelled: 'Cancelada',
};

export const tripStatusLabel = (s: string | null | undefined) =>
  (s && TRIP_STATUS_LABELS[s]) || s || '—';

export * from './loadStatus';
export * from './stopStatus';
export * from './documentStatus';