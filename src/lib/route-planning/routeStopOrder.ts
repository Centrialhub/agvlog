export interface RouteStopOrderable {
  manual_order?: number | null;
  optimized_order?: number | null;
  original_order?: number | null;
}

/**
 * Canonical stop ordering for route planning.
 * Prefer manual override > optimizer > original ingestion order > fallback.
 */
export const routeStopOrder = (s: RouteStopOrderable): number =>
  s.manual_order ?? s.optimized_order ?? s.original_order ?? 9999;