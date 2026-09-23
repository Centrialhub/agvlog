import { describe, it, expect } from 'vitest';
import {
  computeSpecificity,
  calculateFreight,
  freightBreakdownFromJson,
  freightBreakdownToJson,
  type FreightBreakdown,
  type FreightInput,
} from '@/hooks/useFreightCalculator';

const baseInput: FreightInput = {
  tenantId: 't',
  totalValue: 8800.16,
  totalWeight: 759.738,
  totalPallets: 5,
};

interface FreightTableFixture {
  payer_group?: string | null;
  payer?: string | null;
  per_kg_value?: number;
  rate_percent?: number;
}

describe('computeSpecificity — payer restrictions require known matching inputs', () => {
  it('does NOT disqualify an all-wildcard table when input.payerGroup is missing', () => {
    const table: FreightTableFixture = { payer_group: null, per_kg_value: 0.696 };
    const { score } = computeSpecificity(table, baseInput);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('disqualifies a payer_group-specific table when input.payerGroup is missing', () => {
    const table: FreightTableFixture = { payer_group: 'TABELA TRANSVILA' };
    const { score, ignored } = computeSpecificity(table, { ...baseInput, payerGroup: null });
    expect(score).toBeLessThan(0);
    expect(ignored).toContain('payer_group: table="TABELA TRANSVILA" vs input="(vazio)"');
  });

  it('DOES disqualify on a real payer_group mismatch (both sides present, different)', () => {
    const table: FreightTableFixture = { payer_group: 'TABELA TRANSVILA' };
    const { score } = computeSpecificity(table, { ...baseInput, payerGroup: 'OUTRO' });
    expect(score).toBeLessThan(0);
  });

  it('keeps a wildcard table eligible and rejects a specific table without payer group', () => {
    const jmacedo: FreightTableFixture = { payer_group: null, per_kg_value: 0.696 };
    const transvila: FreightTableFixture = { payer_group: 'TABELA TRANSVILA', rate_percent: 6 };
    const r1 = computeSpecificity(jmacedo, baseInput);
    const r2 = computeSpecificity(transvila, baseInput);
    expect(r1.score).toBeGreaterThanOrEqual(0);
    expect(r2.score).toBeLessThan(0);
  });

  it('rejects a payer-specific table when no payer name is available', () => {
    const table: FreightTableFixture = { payer: 'some-client-uuid' };
    const { score } = computeSpecificity(table, { ...baseInput, clientId: null });
    expect(score).toBeLessThan(0);
  });

  it('never offsets a hard mismatch with many exact matches', () => {
    const table = {
      client_id: 'other-client', payer_group: 'GROUP', payer: 'PAYER',
      origin_state: 'SP', destination_state: 'RJ', origin_municipality: 'São Paulo',
      destination_municipality: 'Rio de Janeiro', origin_region: 'CAPITAL',
      destination_region: 'METRO', route: 'R1', distribution_type: 'D1', cargo_type: 'C1',
    } as FreightTableFixture & Record<string,string>;
    const result = computeSpecificity(table, {
      ...baseInput, clientId: 'wanted-client', payerGroup: 'GROUP', payerName: 'PAYER',
      originState: 'SP', destinationState: 'RJ', originMunicipality: 'São Paulo',
      destinationMunicipality: 'Rio de Janeiro', origin: 'CAPITAL', destination: 'METRO',
      route: 'R1', distributionType: 'D1', cargoType: 'C1',
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.eligible).toBe(false);
  });
});

describe('freight metric validation', () => {
  it.each([
    ['valor da nota', { totalValue: -1 }],
    ['peso', { totalWeight: -0.01 }],
    ['quantidade de paletes', { totalPallets: -1 }],
  ])('rejects negative %s before querying freight tables', async (label, override) => {
    const result = await calculateFreight({ ...baseInput, ...override });
    expect(result).toEqual({
      success: false,
      value: 0,
      breakdown: null,
      error: `O ${label} deve ser um número maior ou igual a zero`,
    });
  });
});

describe('freight breakdown JSON boundary', () => {
  it('round-trips a valid breakdown and rejects malformed payloads', () => {
    const breakdown: FreightBreakdown = {
      tableName: 'Tabela padrão', tableId: 'table-1', tableCode: 1,
      regionId: null, regionName: null, matchedCriteria: { destination_state: 'SP' },
      ignoredCriteria: [], specificityScore: 10,
      components: {
        ratePercent: 1, rateValue: 10, fixedValue: 0, perKgValue: 0, perKgTotal: 0,
        perPalletValue: 0, perPalletTotal: 0, dispatchValue: 0, trackingValue: 0,
        tollValue: 0, loadingValue: 0, grisValue: 0, insurancePercent: 0, insuranceValue: 0,
      },
      baseValue: 10, minValue: 0, finalValue: 10, fallbackUsed: false,
    };

    expect(freightBreakdownFromJson(freightBreakdownToJson(breakdown))).toEqual({
      ...breakdown,
      missingFields: [],
      unknownSubstitutions: {},
    });
    expect(freightBreakdownFromJson({ tableName: 'incompleto' })).toBeNull();
  });
});
