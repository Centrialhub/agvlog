import type { RouteStopDraft, RouteStopSortMode } from './routePlanningTypes';
import { consolidateLoadsIntoStops, type ConsolidationLoad } from './stopConsolidation';
import { applySmartSequence, applyOriginalOrder, autoSequenceStops } from './simpleStopSequencing';
import { simulateStopTimeline } from './timelineSimulation';
import { normalizeCity as norm } from '@/lib/utils/normalizeCity';

const keyFor = (s: Pick<RouteStopDraft, 'client_id' | 'recipient_name' | 'city' | 'neighborhood'>) => [
  s.client_id ? `c:${s.client_id}` : `r:${norm(s.recipient_name)}`,
  norm(s.city),
  norm(s.neighborhood),
].join('|');

/**
 * Recria as paradas a partir das cargas atuais, preservando edições manuais
 * (janelas, tempo de serviço, prioridade, ordem manual e notas) feitas em paradas
 * que continuam existindo (mesmo client/destinatário/cidade/bairro).
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