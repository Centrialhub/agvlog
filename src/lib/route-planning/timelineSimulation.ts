import type { RouteStopDraft, RouteStopRiskLevel } from './routePlanningTypes';
import { normalizeCity as norm } from '@/lib/utils/normalizeCity';

export interface SimulateOptions {
  /** Tempo de deslocamento do ponto de partida (depósito/origem) até a 1ª parada, em minutos. */
  initialTransitMinutes?: number;
  /** Cidade do ponto de partida (depósito), usada para estimar a 1ª perna. */
  originCity?: string | null;
  /** Estado/UF do ponto de partida. */
  originState?: string | null;
  /** Bairro do ponto de partida. */
  originNeighborhood?: string | null;
}

/**
 * Estimativa heurística de deslocamento entre dois pontos sem coordenadas:
 * - mesmo bairro: 15 min
 * - mesma cidade, bairro diferente: 25 min
 * - mesmo estado, cidade diferente: 75 min
 * - estados diferentes: 180 min
 * - sem informação: 60 min
 */
function estimateTransitMinutes(
  from: { city?: string | null; state?: string | null; neighborhood?: string | null },
  to: { city?: string | null; state?: string | null; neighborhood?: string | null },
): number {
  const fc = norm(from.city), tc = norm(to.city);
  const fs = norm(from.state), ts = norm(to.state);
  const fn = norm(from.neighborhood), tn = norm(to.neighborhood);
  if (!tc && !fc) return 60;
  if (fc && tc && fc === tc) {
    if (fn && tn && fn === tn) return 15;
    return 25;
  }
  if (fs && ts && fs !== ts) return 180;
  return 75;
}

/**
 * Simulação operacional encadeada (sem cálculo geográfico real).
 * Cada parada = chegada da anterior + tempo de serviço + deslocamento estimado.
 * A 1ª parada considera o deslocamento do depósito/origem (initialTransitMinutes
 * ou heurística a partir de originCity/originState).
 */
export function simulateStopTimeline(
  stops: RouteStopDraft[],
  plannedStartAt?: string | null,
  options: SimulateOptions = {},
): RouteStopDraft[] {
  if (!plannedStartAt) return stops.map(s => ({ ...s }));
  const start = new Date(plannedStartAt);
  if (isNaN(start.getTime())) return stops.map(s => ({ ...s }));

  let cursor = start.getTime();
  let prevLoc: { city?: string | null; state?: string | null; neighborhood?: string | null } | null =
    options.originCity || options.originState
      ? { city: options.originCity, state: options.originState, neighborhood: options.originNeighborhood }
      : null;
  // Deslocamento até a 1ª parada: usa override explícito ou heurística a partir da origem.
  const firstTransitOverride = typeof options.initialTransitMinutes === 'number'
    ? Math.max(0, options.initialTransitMinutes)
    : null;

  return stops.map((s) => {
    let transitMin = 0;
    if (prevLoc) {
      transitMin = estimateTransitMinutes(prevLoc, s);
    } else if (firstTransitOverride !== null) {
      transitMin = firstTransitOverride;
    }
    cursor += transitMin * 60_000;

    const arrival = new Date(cursor);
    const serviceMin = Math.max(0, Number(s.service_time_minutes) || 20);
    cursor += serviceMin * 60_000;
    const departure = new Date(cursor);

    let risk_level: RouteStopRiskLevel = s.risk_level || 'normal';
    let risk_reason: string | null = s.risk_reason || null;

    if (s.fiscal_document_ids.length === 0) {
      risk_level = 'critical';
      risk_reason = 'Parada sem documentos fiscais vinculados';
    } else if (s.delivery_window_end) {
      const [h, m] = s.delivery_window_end.split(':').map(Number);
      const windowEnd = new Date(arrival);
      windowEnd.setHours(h || 0, m || 0, 0, 0);
      const diffMin = (windowEnd.getTime() - arrival.getTime()) / 60_000;
      if (diffMin < 0) {
        risk_level = 'critical';
        risk_reason = 'Previsão aproximada após o fim da janela de recebimento.';
      } else if (diffMin < 30) {
        risk_level = 'warning';
        risk_reason = 'Previsão aproximada próxima do fim da janela.';
      } else if (risk_level !== 'critical') {
        risk_level = 'normal';
        risk_reason = null;
      }
    } else if (risk_level !== 'critical') {
      // Sem janela: mantém warning informativo somente se ainda não havia outro
      if (!risk_reason) {
        risk_level = 'warning';
        risk_reason = 'Cliente sem janela cadastrada; usando ordem por cidade/bairro.';
      }
    }

    prevLoc = { city: s.city, state: s.state, neighborhood: s.neighborhood };
    return {
      ...s,
      planned_arrival_at: arrival.toISOString(),
      estimated_departure_at: departure.toISOString(),
      risk_level,
      risk_reason,
    };
  });
}