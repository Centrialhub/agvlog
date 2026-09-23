export const GEOCODING_PROVIDER_LIMIT = 5;

export function candidatesFromCache(candidates: unknown, requestedLimit: number): unknown[] | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  return candidates.slice(0, requestedLimit);
}
