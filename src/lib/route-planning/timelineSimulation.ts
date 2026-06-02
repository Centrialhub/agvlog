import type { RouteStopDraft, RouteStopRiskLevel } from './routePlanningTypes';

const norm = (v?: string | null) => (v || '').trim().toUpperCase();

/**
 * Simulação operacional aproximada (sem cálculo geográfico real).
 * - 20 min entre paradas na mesma cidade
 * - 30 min entre bairros diferentes
 * - 60 min entre cidades diferentes
 * - + service_time_minutes em cada parada
 * Marca risco quando previsão estoura/aproxima do fim da janela.
 */
export function simulateStopTimeline(
  stops: RouteStopDraft[],
  plannedStartAt?: string | null,
): RouteStopDraft[] {
  if (!plannedStartAt) return stops.map(s => ({ ...s }));
  const start = new Date(plannedStartAt);
  if (isNaN(start.getTime())) return stops.map(s => ({ ...s }));

  let cursor = start.getTime();
  let prev: RouteStopDraft | null = null;

  return stops.map((s) => {
    if (prev) {
      const sameCity = norm(prev.city) === norm(s.city) && !!norm(s.city);
      const sameNeighborhood = sameCity && norm(prev.neighborhood) === norm(s.neighborhood);
      let transitMin = 60;
      if (sameCity) transitMin = sameNeighborhood ? 20 : 30;
      cursor += transitMin * 60_000;
    }

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

    prev = s;
    return {
      ...s,
      planned_arrival_at: arrival.toISOString(),
      estimated_departure_at: departure.toISOString(),
      risk_level,
      risk_reason,
    };
  });
}