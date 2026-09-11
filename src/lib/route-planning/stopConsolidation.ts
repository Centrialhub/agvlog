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
    supplier_id?: string | null;
    client_address?: string | null;
    client_location?: {
      latitude: number;
      longitude: number;
      provider: string | null;
      accuracy_m: number | null;
      confidence: number | null;
      address_hash: string;
    } | null;
    value: number | null;
    weight_kg: number | null;
  } | null;
}

export interface ConsolidationLoad {
  id: string;
  load_number: string;
  destination: string | null;
  /** Pré-atribuições vindas de /loads — se todas as cargas do grupo
   *  coincidirem, o planejador herda ao invés de sugerir. */
  vehicle_id?: string | null;
  driver_id?: string | null;
  items: ConsolidationLoadItem[];
}

import { normalizeCity as norm } from '@/lib/utils/normalizeCity';

export function deliveryGroupingKey(stop: Pick<RouteStopDraft,
  'client_id' | 'supplier_id' | 'recipient_name' | 'city' | 'state' | 'neighborhood' | 'fiscal_document_ids' | 'id'>): string {
  return JSON.stringify([
    stop.client_id ? `c:${stop.client_id}` : `r:${norm(stop.recipient_name)}`,
    norm(stop.city), norm(stop.state), norm(stop.neighborhood),
    stop.supplier_id ? `s:${stop.supplier_id}` : `unknown:${[...stop.fiscal_document_ids].sort().join(',') || stop.id}`,
  ]);
}

/**
 * Consolida cargas + NF-es em paradas operacionais.
 * Regra: mesmo destinatário, localização e fornecedor; fornecedor desconhecido fica separado por NF.
 * Conservadora: prefere paradas separadas quando há dúvida.
 */
export function consolidateLoadsIntoStops(loads: ConsolidationLoad[]): RouteStopDraft[] {
  const buckets = new Map<string, RouteStopDraft>();

  loads.forEach((load) => {
    load.items.forEach((it) => {
      const fd = it.fiscal_documents;
      const recipient = fd?.recipient || load.destination || load.load_number || '—';
      const city = fd?.recipient_city || null;
      const neighborhood = fd?.recipient_neighborhood || null;
      const state = fd?.recipient_state || null;
      const clientId = fd?.client_id || null;
      const clientAddress = fd?.client_address || null;
      const clientLocation = fd?.client_location || null;

      const supplierId = fd?.supplier_id || null;
      const key = deliveryGroupingKey({ id: it.id, client_id: clientId, supplier_id: supplierId,
        recipient_name: recipient, city, state, neighborhood,
        fiscal_document_ids: it.fiscal_document_id ? [it.fiscal_document_id] : [] });

      let stop = buckets.get(key);
      if (!stop) {
        stop = {
          id: crypto.randomUUID(),
          client_id: clientId,
          supplier_id: supplierId,
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
          location_address: clientAddress || [recipient, neighborhood, city, state].filter(Boolean).join(', '),
          latitude: clientLocation?.latitude ?? null,
          longitude: clientLocation?.longitude ?? null,
          location_source: clientLocation ? 'address_geocoded' : 'legacy_coordinates',
          location_provider: clientLocation?.provider ?? null,
          location_accuracy_m: clientLocation?.accuracy_m ?? null,
          location_confidence: clientLocation?.confidence ?? null,
          location_audit: clientLocation ? { selection: 'reused_verified_client', client_address_hash: clientLocation.address_hash } : {},
          priority: 0,
          risk_level: 'normal',
        };
        buckets.set(key, stop);
      }

      if (!stop.load_ids.includes(load.id)) stop.load_ids.push(load.id);
      if (it.fiscal_document_id && !stop.fiscal_document_ids.includes(it.fiscal_document_id)) {
        stop.fiscal_document_ids.push(it.fiscal_document_id);
        if (fd?.invoice_number) stop.invoice_numbers.push(fd.invoice_number);
      }
      stop.total_weight_kg += Number(it.weight_kg) || Number(fd?.weight_kg) || 0;
      stop.total_volume_m3 += Number(it.volume_m3) || 0;
      stop.total_pallet_count += Number(it.pallet_count) || 0;
      stop.total_value += Number(fd?.value) || 0;
    });
  });

  const stops = Array.from(buckets.values());
  stops.forEach((s, idx) => {
    s.original_order = idx + 1;
    if (s.fiscal_document_ids.length === 0) {
      s.risk_level = 'warning';
      s.risk_reason = 'Parada sem documentos fiscais vinculados';
    } else if (!s.supplier_id) {
      s.risk_level = 'warning';
      s.risk_reason = 'Fornecedor da NF pendente; cobrança de descarga indisponível';
    }
  });
  return stops;
}
