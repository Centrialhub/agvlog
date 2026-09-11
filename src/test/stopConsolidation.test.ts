import { describe, it, expect } from 'vitest';
import { regenerateStopsPreservingEdits } from '@/lib/route-planning/regenerateStops';
import {
  consolidateLoadsIntoStops,
  type ConsolidationLoad,
  type ConsolidationLoadItem,
} from '@/lib/route-planning/stopConsolidation';

type FiscalDocumentFixture = NonNullable<ConsolidationLoadItem['fiscal_documents']>;

const mkItem = (over: Partial<FiscalDocumentFixture> = {}): ConsolidationLoadItem => ({
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
    supplier_id: 'supplier-1',
    value: 10,
    weight_kg: 100,
    ...over,
  },
});

describe('consolidateLoadsIntoStops – dedup por cidade/destinatário normalizados', () => {
  it('separa fornecedores no mesmo destino e preserva as edições da entrega correta', () => {
    const loads: ConsolidationLoad[] = [{ id: 'L1', load_number: 'L1', destination: null,
      items: [mkItem({ supplier_id: 's1' }), mkItem({ supplier_id: 's2' })] }];
    const stops = consolidateLoadsIntoStops(loads);
    expect(stops).toHaveLength(2);
    stops[0].notes = 'Descarregar na doca 1';
    stops[1].notes = 'Conferir na doca 2';
    loads[0].items.reverse();
    const regenerated = regenerateStopsPreservingEdits(loads, stops, 'original');
    expect(regenerated.find(s => s.supplier_id === 's1')?.notes).toBe('Descarregar na doca 1');
    expect(regenerated.find(s => s.supplier_id === 's2')?.notes).toBe('Conferir na doca 2');
  });

  it('não agrupa NFs de fornecedor desconhecido e evidencia a pendência', () => {
    const loads: ConsolidationLoad[] = [{ id: 'L1', load_number: 'L1', destination: null,
      items: [mkItem({ supplier_id: null }), mkItem({ supplier_id: null })] }];
    const stops = consolidateLoadsIntoStops(loads);
    expect(stops).toHaveLength(2);
    expect(stops.every(s => s.risk_level === 'warning' && s.risk_reason?.includes('Fornecedor'))).toBe(true);
  });

  it('separa localidades homônimas de estados diferentes', () => {
    const loads: ConsolidationLoad[] = [{ id: 'L1', load_number: 'L1', destination: null,
      items: [mkItem({ recipient_state: 'MG' }), mkItem({ recipient_state: 'SP' })] }];
    expect(consolidateLoadsIntoStops(loads)).toHaveLength(2);
  });

  it('não replica edições de uma antiga parada sem fornecedor nas novas entregas', () => {
    const loads: ConsolidationLoad[] = [{ id: 'L1', load_number: 'L1', destination: null,
      items: [mkItem({ supplier_id: 's1' }), mkItem({ supplier_id: 's2' })] }];
    const previous = consolidateLoadsIntoStops(loads);
    previous[0].supplier_id = undefined;
    previous[0].notes = 'Anotação de origem ambígua';
    const regenerated = regenerateStopsPreservingEdits(loads, [previous[0]], 'original');
    expect(regenerated.every(s => !s.notes)).toBe(true);
  });
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

  it('reaproveita a geocodificação verificada do endereço canônico do cliente', () => {
    const loads: ConsolidationLoad[] = [{ id: 'L1', load_number: 'L1', destination: null, items: [mkItem({
      client_id: 'client-1', client_address: 'Rua A, 10, Centro, Janaúba, MG, 39440-000',
      client_location: { latitude: -15.802, longitude: -43.307, provider: 'nominatim', accuracy_m: 50,
        confidence: 0.82, address_hash: 'verified-hash' },
    })] }];
    const [stop] = consolidateLoadsIntoStops(loads);
    expect(stop).toMatchObject({
      latitude: -15.802, longitude: -43.307, location_source: 'address_geocoded',
      location_provider: 'nominatim', location_audit: {
        selection: 'reused_verified_client', client_address_hash: 'verified-hash',
      },
    });
  });
});
