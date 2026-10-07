import { describe, expect, it } from 'vitest';

import { normalizeCargoWeightKg } from '@/lib/driver/cargoWeightKg';

describe('cargo weight in kilograms with two explicit decimal places', () => {
  it.each([
    [7691.72607421875, '7691.73', true],
    [1.005, '1.01', true],
    [2.675, '2.68', true],
    [9.995, '10.00', true],
    [0.005, '0.01', true],
    [1.004, '1.00', true],
    [1.0049999999999997, '1.00', true],
    [0.004, '0.00', true],
    [1e-7, '0.00', true],
    [Number.MIN_VALUE, '0.00', true],
    [0, '0.00', false],
    [42, '42.00', false],
    [1.2, '1.20', false],
    [7.69, '7.69', false],
    [90071992547409.9, '90071992547409.90', false],
  ] as const)('normalizes %s to %s and reports rounding=%s', (input, value, rounded) => {
    expect(normalizeCargoWeightKg(input)).toEqual({ value, raw: String(input), rounded });
  });

  it('keeps the received value available for an explicit rounding notice', () => {
    const input = 7691.72607421875;
    const result = normalizeCargoWeightKg(input);

    expect(result.raw).toBe('7691.72607421875');
    expect(result.value).toBe('7691.73');
    expect(Number(result.value)).toBe(7691.73);
    expect(input).toBe(7691.72607421875);
  });

  it.each([-1, -0.001, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
    Number.MAX_VALUE, Number.MAX_SAFE_INTEGER, 1e21])('rejects invalid or unsafe weight %s', input => {
    expect(() => normalizeCargoWeightKg(input)).toThrow();
  });

  it.each(['1.005', null, undefined, {}, true])('rejects runtime values outside the numeric contract: %s', input => {
    expect(() => normalizeCargoWeightKg(input as unknown as number)).toThrow();
  });
});
