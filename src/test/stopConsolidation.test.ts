import { describe, it, expect } from 'vitest';
import { consolidateLoadsIntoStops, type ConsolidationLoad } from '@/lib/route-planning/stopConsolidation';

const mkItem = (over: Partial<any> = {}) => ({
  id: crypto.randomUUID(),
  load_id: 'L1',
  pallet_count: 1,
  weight_kg: 100,
  volume_m3: 0.5,
  fiscal_document_id: crypto.randomUUID(),
  fiscal_documents: {
    invoice_number: '1',
    recipient: 'MERCADO X',
    recipient_city: 'Janaúba',
    recipient_state: 'MG',
    recipient_neighborhood: 'Centro',
    client_id: null,
    value: 10,
    weight_kg: 100,
    ...over,
  },
});

describe('consolidateLoadsIntoStops – dedup por cidade/destinatário normalizados', () => {
  it('unifica variações acentuadas da mesma cidade em uma única parada', () => {
    const loads: ConsolidationLoad[] = [{
      id: 'L1', load_number: 'L1', destination: null,
      items: [
        mkItem({ recipient_city: 'Janaúba', invoice_number: '1', client_id: 'c1' }),
        mkItem({ recipient_city: 'JANAUBA', invoice_number: '2', client_id: 'c1' }),
        mkItem({ recipient_city: 'janauba ', invoice_number: '3', client_id: 'c1' }),
      ] as any,
    }];
    const stops = consolidateLoadsIntoStops(loads);
    expect(stops).toHaveLength(1);
    expect(stops[0].fiscal_document_ids).toHaveLength(3);
    expect(stops[0].total_pallet_count).toBe(3);
  });

  it('mantém paradas separadas para cidades distintas', () => {
    const loads: ConsolidationLoad[] = [{
      id: 'L1', load_number: 'L1', destination: null,
      items: [
        mkItem({ recipient_city: 'Janaúba', client_id: 'c1', invoice_number: '1' }),
        mkItem({ recipient_city: 'Montes Claros', client_id: 'c1', invoice_number: '2' }),
      ] as any,
    }];
    const stops = consolidateLoadsIntoStops(loads);
    expect(stops).toHaveLength(2);
  });

  it('dedupe por destinatário quando não há client_id, ignorando caixa/acento', () => {
    const loads: ConsolidationLoad[] = [{
      id: 'L1', load_number: 'L1', destination: null,
      items: [
        mkItem({ recipient: 'Comércio São João', client_id: null, invoice_number: '1' }),
        mkItem({ recipient: 'COMERCIO SAO JOAO', client_id: null, invoice_number: '2' }),
      ] as any,
    }];
    const stops = consolidateLoadsIntoStops(loads);
    expect(stops).toHaveLength(1);
  });
});