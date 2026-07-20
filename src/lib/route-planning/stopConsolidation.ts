import type { RouteStopDraft } from './routePlanningTypes';

export interface ConsolidationLoadItem {
  id: string;
  load_id: string;
  pallet_count: number | null;
  weight_kg: number | null;
  volume_m3: number | null;
  fiscal_document_id: string | null;
  fiscal_documents?: {
    invoice_number: string | null;
    recipient: string | null;
    recipient_city: string | null;
    recipient_state: string | null;
    recipient_neighborhood: string | null;
    client_id?: string | null;
    value: number | null;
    weight_kg: number | null;
  } | null;
}

export interface ConsolidationLoad {
  id: string;
  load_number: string;
  destination: string | null;
  items: ConsolidationLoadItem[];
}

const norm = (v?: string | null) =>
  (v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

/**
 * Consolida cargas + NF-es em paradas operacionais.
 * Regra: agrupa por (client_id | recipient) + city + neighborhood.
 * Conservadora: prefere paradas separadas quando há dúvida.
 */
export function consolidateLoadsIntoStops(loads: ConsolidationLoad[]): RouteStopDraft[] {
  const buckets = new Map<string, RouteStopDraft>();

  loads.forEach((load) => {
    load.items.forEach((it) => {
      const fd = it.fiscal_documents || ({} as any);
      const recipient = fd.recipient || load.destination || load.load_number || '—';
      const city = fd.recipient_city || null;
      const neighborhood = fd.recipient_neighborhood || null;
      const state = fd.recipient_state || null;
      const clientId = (fd as any).client_id || null;

      const key = [
        clientId ? `c:${clientId}` : `r:${norm(recipient)}`,
        norm(city),
        norm(neighborhood),
      ].join('|');

      let stop = buckets.get(key);
      if (!stop) {
        stop = {
          id: crypto.randomUUID(),
          client_id: clientId,
          recipient_name: recipient,
          destination: [recipient, city, state].filter(Boolean).join(' - '),
          city,
          state,
          neighborhood,
          load_ids: [],
          fiscal_document_ids: [],
          invoice_numbers: [],
          total_weight_kg: 0,
          total_volume_m3: 0,
          total_pallet_count: 0,
          total_value: 0,
          service_time_minutes: 20,
          priority: 0,
          risk_level: 'normal',
        };
        buckets.set(key, stop);
      }

      if (!stop.load_ids.includes(load.id)) stop.load_ids.push(load.id);
      if (it.fiscal_document_id && !stop.fiscal_document_ids.includes(it.fiscal_document_id)) {
        stop.fiscal_document_ids.push(it.fiscal_document_id);
        if (fd.invoice_number) stop.invoice_numbers.push(fd.invoice_number);
      }
      stop.total_weight_kg += Number(it.weight_kg) || Number(fd.weight_kg) || 0;
      stop.total_volume_m3 += Number(it.volume_m3) || 0;
      stop.total_pallet_count += Number(it.pallet_count) || 0;
      stop.total_value += Number(fd.value) || 0;
    });
  });

  const stops = Array.from(buckets.values());
  stops.forEach((s, idx) => {
    s.original_order = idx + 1;
    if (s.fiscal_document_ids.length === 0) {
      s.risk_level = 'warning';
      s.risk_reason = 'Parada sem documentos fiscais vinculados';
    }
  });
  return stops;
}
