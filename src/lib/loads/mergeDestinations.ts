import { normalizeCity } from '@/lib/utils/normalizeCity';

// Merge destination strings preserving uniqueness, e.g.
// "PAI PEDRO" + "PIRAPORA - JAIBA" -> "PAI PEDRO - PIRAPORA - JAIBA"
export function mergeDestinations(
  target?: string | null,
  source?: string | null,
): string | null {
  const split = (value?: string | null) =>
    (value || '')
      .split(/[-,/|]+/)
      .map((token) => token.trim())
      .filter(Boolean);
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const token of [...split(target), ...split(source)]) {
    const key = normalizeCity(token);
    if (!seen.has(key)) {
      seen.add(key);
      tokens.push(token);
    }
  }
  return tokens.length ? tokens.join(' - ') : (target || null);
}
