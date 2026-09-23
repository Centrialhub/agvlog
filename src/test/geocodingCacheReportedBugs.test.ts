import { describe, expect, it } from 'vitest';
import { candidatesFromCache, GEOCODING_PROVIDER_LIMIT } from '../../supabase/functions/_shared/geocoding-cache';

describe('geocoding cache requests', () => {
  it('retries a provider after empty or malformed cache responses', () => {
    expect(candidatesFromCache([], 5)).toBeNull();
    expect(candidatesFromCache(null, 5)).toBeNull();
  });

  it('serves the requested subset from a full provider response', () => {
    const candidates = Array.from({ length: GEOCODING_PROVIDER_LIMIT }, (_, index) => ({ id: index }));
    expect(candidatesFromCache(candidates, 1)).toEqual([{ id: 0 }]);
    expect(candidatesFromCache(candidates, 5)).toEqual(candidates);
  });
});
