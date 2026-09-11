import type { RouteStopDraft, RouteStopSortMode } from './routePlanningTypes';
import { consolidateLoadsIntoStops, deliveryGroupingKey as keyFor, type ConsolidationLoad } from './stopConsolidation';
import { applySmartSequence, applyOriginalOrder, autoSequenceStops } from './simpleStopSequencing';
import { simulateStopTimeline } from './timelineSimulation';

/**
 * Recria as paradas a partir das cargas atuais, preservando edições manuais
 * (janelas, tempo de serviço, prioridade, ordem manual e notas) feitas em paradas
 * que continuam existindo (mesmo destinatário, localização e fornecedor).
 */
export function regenerateStopsPreservingEdits(
  loads: ConsolidationLoad[],
  previousStops: RouteStopDraft[] | undefined,
  sortMode: RouteStopSortMode | undefined,
  plannedStartAt?: string,
  initialTransitMinutes = 30,
): RouteStopDraft[] {
  const fresh = consolidateLoadsIntoStops(loads);
  if (previousStops && previousStops.length) {
    const prevByKey = new Map(previousStops.map(s => [keyFor(s), s]));
    fresh.forEach(s => {
      const prev = prevByKey.get(keyFor(s));
      if (!prev) return;
      if (prev.delivery_window_start) s.delivery_window_start = prev.delivery_window_start;
      if (prev.delivery_window_end) s.delivery_window_end = prev.delivery_window_end;
      if (typeof prev.service_time_minutes === 'number') s.service_time_minutes = prev.service_time_minutes;
      if (typeof prev.priority === 'number') s.priority = prev.priority;
      if (prev.notes) s.notes = prev.notes;
      if (typeof prev.manual_order === 'number') s.manual_order = prev.manual_order;
      if (typeof prev.latitude === 'number') s.latitude = prev.latitude;
      if (typeof prev.longitude === 'number') s.longitude = prev.longitude;
      if (prev.location_source) s.location_source = prev.location_source;
      if (prev.location_address) s.location_address = prev.location_address;
      if (prev.location_provider) s.location_provider = prev.location_provider;
      if (typeof prev.location_accuracy_m === 'number') s.location_accuracy_m = prev.location_accuracy_m;
      if (typeof prev.location_confidence === 'number') s.location_confidence = prev.location_confidence;
      if (prev.location_audit) s.location_audit = prev.location_audit;
      if (typeof prev.geofence_radius_m === 'number') s.geofence_radius_m = prev.geofence_radius_m;
    });
  }
  // Reaplica o sortMode atual quando aplicável.
  if (sortMode === 'smart') return applySmartSequence(fresh);
  if (sortMode === 'auto') {
    const seq = autoSequenceStops(fresh);
    return simulateStopTimeline(seq, plannedStartAt, { initialTransitMinutes });
  }
  if (sortMode === 'manual') {
    // Mantém ordem manual onde existir; novos stops vão para o fim.
    return [...fresh].sort((a, b) => {
      const ao = a.manual_order ?? Number.MAX_SAFE_INTEGER;
      const bo = b.manual_order ?? Number.MAX_SAFE_INTEGER;
      return ao - bo;
    });
  }
  return applyOriginalOrder(fresh);
}
