import { describe, expect, it } from 'vitest';

import {
  buildTripCargoDivergenceCommand,
  type TripCargoAvailableSnapshot,
} from '@/lib/driver/tripCargoCustody';

const ids = {
  load1: '81000000-0000-4000-8000-000000000001',
  load2: '81000000-0000-4000-8000-000000000002',
  document1: '82000000-0000-4000-8000-000000000001',
  document2: '82000000-0000-4000-8000-000000000002',
};

const loads = [ids.load1, ids.load2].map((load_id, index) => ({
  id: `83000000-0000-4000-8000-00000000000${index + 1}`,
  load_id,
  expected_volume_count: 10,
  expected_pallet_count: 2,
  expected_weight_kg: 100,
  confirmed_volume_count: null,
  confirmed_pallet_count: null,
  confirmed_weight_kg: null,
  confirmed_at: null,
})) satisfies TripCargoAvailableSnapshot['loads'];

const documents = [{
  id: ids.document1,
  load_id: ids.load1,
  source_kind: 'nfe' as const,
  reference_number: 'NFE-101',
  driver_confirmed: false,
}, {
  id: ids.document2,
  load_id: ids.load2,
  source_kind: 'nfse' as const,
  reference_number: 'NFSE-202',
  driver_confirmed: false,
}] satisfies TripCargoAvailableSnapshot['documents'];

describe('trip cargo divergence command', () => {
  it('sends the explicit document and its affected load in a multi-document trip', () => {
    expect(buildTripCargoDivergenceCommand({
      kind: 'document',
      description: 'Número fiscal divergente na conferência',
      loadId: ids.load2,
      documentCheckId: ids.document2,
      loads,
      documents,
    })).toEqual({
      kind: 'document',
      description: 'Número fiscal divergente na conferência',
      load_id: ids.load2,
      document_check_id: ids.document2,
      observed_value: ids.document2,
    });
  });

  it('does not let an ambiguous document divergence reach the database', () => {
    expect(() => buildTripCargoDivergenceCommand({
      kind: 'document',
      description: 'Documento divergente na conferência',
      loads,
      documents,
    })).toThrow('Selecione o documento afetado');
  });

  it('requires an affected load for a physical divergence with multiple loads', () => {
    expect(() => buildTripCargoDivergenceCommand({
      kind: 'shortage',
      description: 'Faltaram dois volumes na carga',
      loads,
      documents,
    })).toThrow('Selecione a carga afetada');

    expect(buildTripCargoDivergenceCommand({
      kind: 'shortage',
      description: 'Faltaram dois volumes na carga',
      loadId: ids.load1,
      loads,
      documents,
    })).toMatchObject({ kind: 'shortage', load_id: ids.load1 });
  });

  it('rejects a document selected under a different load', () => {
    expect(() => buildTripCargoDivergenceCommand({
      kind: 'document',
      description: 'Documento associado à carga incorreta',
      loadId: ids.load1,
      documentCheckId: ids.document2,
      loads,
      documents,
    })).toThrow('não pertence à carga afetada');
  });
});
