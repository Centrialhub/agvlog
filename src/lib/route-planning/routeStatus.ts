import type { ConsistencyResult } from './routeConsistency';

export type RoutePlanStatusExt =
  | 'ready'
  | 'review'
  | 'blocked'
  | 'dirty'
  | 'dispatching'
  | 'dispatched'
  | 'failed';

export interface StatusVisual {
  label: string;
  cls: string;
  /** True if this status forbids any dispatch attempt. */
  blocksDispatch: boolean;
  /** True if batch dispatch should include it by default. */
  batchEligible: boolean;
}

export const STATUS_VISUALS: Record<RoutePlanStatusExt, StatusVisual> = {
  ready: { label: 'Pronta', cls: 'bg-green-100 text-green-700 border-green-300', blocksDispatch: false, batchEligible: true },
  review: { label: 'Revisão', cls: 'bg-amber-100 text-amber-700 border-amber-300', blocksDispatch: false, batchEligible: false },
  blocked: { label: 'Bloqueada', cls: 'bg-destructive/10 text-destructive border-destructive/30', blocksDispatch: true, batchEligible: false },
  dirty: { label: 'Recalcular', cls: 'bg-orange-100 text-orange-700 border-orange-300', blocksDispatch: true, batchEligible: false },
  dispatching: { label: 'Despachando…', cls: 'bg-blue-100 text-blue-700 border-blue-300', blocksDispatch: true, batchEligible: false },
  dispatched: { label: 'Despachada', cls: 'bg-slate-100 text-slate-600 border-slate-300', blocksDispatch: true, batchEligible: false },
  failed: { label: 'Falhou', cls: 'bg-rose-100 text-rose-700 border-rose-300', blocksDispatch: false, batchEligible: false },
};

export function computeRouteStatus(input: {
  dirty?: boolean;
  dispatching?: boolean;
  dispatched?: boolean;
  failed?: boolean;
  consistency: ConsistencyResult;
}): RoutePlanStatusExt {
  if (input.dispatched) return 'dispatched';
  if (input.dispatching) return 'dispatching';
  if (input.dirty) return 'dirty';
  if (!input.consistency.valid) return 'blocked';
  if (input.failed) return 'failed';
  if (input.consistency.warnings.length > 0) return 'review';
  return 'ready';
}