import { describe, expect, it } from 'vitest';
import { assessNominatimCandidate } from '../../supabase/functions/_shared/geocoding-quality';

describe('Nominatim geocoding quality', () => {
  it('trusts an exact street and house-number match independently of popularity', () => {
    expect(assessNominatimCandidate({
      display_name: 'Rua das Flores, 120, Centro, Montes Claros, MG, Brasil',
      importance: 0.01,
      addresstype: 'house',
      address: { road: 'Rua das Flores', house_number: '120', postcode: '39400-000' },
    }, 'Rua das Flores, 120, Centro, Montes Claros - MG, 39400-000, Brasil')).toEqual({
      confidence: 0.96,
      accuracy_m: 30,
      quality: 'address_exact',
    });
  });

  it('keeps a city or district centroid below the automatic-resolution threshold', () => {
    expect(assessNominatimCandidate({
      display_name: 'Centro, Montes Claros, Minas Gerais, Brasil',
      addresstype: 'suburb',
      address: { suburb: 'Centro', city: 'Montes Claros' },
    }, 'Centro, Montes Claros - MG').confidence).toBeLessThan(0.75);
    expect(assessNominatimCandidate({
      display_name: 'Montes Claros, Minas Gerais, Brasil',
      addresstype: 'city',
    }, 'Montes Claros - MG').accuracy_m).toBe(5000);
  });
});
