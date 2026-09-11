export interface CurrencyAllocationEntry {
  key: string;
  weight: number;
}

function toCents(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Valor monetário inválido para rateio.');
  }
  return Math.round((value + Number.EPSILON) * 100);
}

/**
 * Splits a non-negative currency amount without creating or losing cents.
 * Remaining cents follow the largest-remainder method; ties are broken by the
 * stable entry key so selecting the same sources in another order is harmless.
 */
export function allocateCurrency(
  total: number,
  entries: CurrencyAllocationEntry[],
): Record<string, number> {
  if (entries.length === 0) return {};
  if (new Set(entries.map((entry) => entry.key)).size !== entries.length) {
    throw new Error('Chaves duplicadas no rateio monetário.');
  }

  const totalCents = toCents(total);
  const normalizedWeights = entries.map((entry) => (
    Number.isFinite(entry.weight) && entry.weight > 0 ? entry.weight : 0
  ));
  const weightTotal = normalizedWeights.reduce((sum, weight) => sum + weight, 0);
  const weights = weightTotal > 0 ? normalizedWeights : entries.map(() => 1);
  const denominator = weights.reduce((sum, weight) => sum + weight, 0);
  const allocatedCents = weights.map((weight) => Math.floor(totalCents * weight / denominator));
  let residue = totalCents - allocatedCents.reduce((sum, cents) => sum + cents, 0);

  const residueOrder = entries.map((entry, index) => ({
    index,
    key: entry.key,
    remainder: totalCents * weights[index] / denominator - allocatedCents[index],
  })).sort((left, right) => right.remainder - left.remainder || left.key.localeCompare(right.key));

  for (let index = 0; residue > 0; index = (index + 1) % residueOrder.length) {
    allocatedCents[residueOrder[index].index] += 1;
    residue -= 1;
  }

  return Object.fromEntries(entries.map((entry, index) => [entry.key, allocatedCents[index] / 100]));
}
