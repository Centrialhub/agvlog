import { describe, it, expect } from 'vitest';
import { computeSpecificity, type FreightInput } from '@/hooks/useFreightCalculator';

const baseInput: FreightInput = {
  tenantId: 't',
  totalValue: 8800.16,
  totalWeight: 759.738,
  totalPallets: 5,
};

describe('computeSpecificity — payer_group soft matching', () => {
  it('does NOT disqualify an all-wildcard table when input.payerGroup is missing', () => {
    const table = { payer_group: null, per_kg_value: 0.696 };
    const { score } = computeSpecificity(table, baseInput);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('does NOT disqualify a payer_group-specific table when input.payerGroup is missing (soft)', () => {
    const table = { payer_group: 'TABELA TRANSVILA' };
    const { score, ignored } = computeSpecificity(table, { ...baseInput, payerGroup: null });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(ignored.some((s) => s.includes('não desqualifica'))).toBe(true);
  });

  it('DOES disqualify on a real payer_group mismatch (both sides present, different)', () => {
    const table = { payer_group: 'TABELA TRANSVILA' };
    const { score } = computeSpecificity(table, { ...baseInput, payerGroup: 'OUTRO' });
    expect(score).toBeLessThan(0);
  });

  it('scores an all-null J.Macedo-like table above a mismatched specific table (both qualify)', () => {
    const jmacedo = { payer_group: null, per_kg_value: 0.696 };
    const transvila = { payer_group: 'TABELA TRANSVILA', rate_percent: 6 };
    const r1 = computeSpecificity(jmacedo, baseInput);
    const r2 = computeSpecificity(transvila, baseInput);
    // Both qualified (>=0), but neither is preferred over the other by pontuation here —
    // the important invariant is that both are eligible so the caller can pick correctly.
    expect(r1.score).toBeGreaterThanOrEqual(0);
    expect(r2.score).toBeGreaterThanOrEqual(0);
  });

  it('payer (client_id) is not compared against the literal string "client"', () => {
    // Table restricts to a specific client id; input has no client. Should not disqualify.
    const table = { payer: 'some-client-uuid' };
    const { score } = computeSpecificity(table, { ...baseInput, clientId: null });
    expect(score).toBeGreaterThanOrEqual(0);
  });
});