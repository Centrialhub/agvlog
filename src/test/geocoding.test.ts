import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDeliveryAddress, geocodeAddress, locationFromCandidate, locationFromMap } from '@/lib/geocoding';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));

beforeEach(() => vi.clearAllMocks());

describe('address-first location resolution', () => {
  it('builds the delivery address from canonical client fields', () => {
    expect(buildDeliveryAddress(['Rua A', '10', null, 'Centro', 'Montes Claros', 'MG', '39400-000']))
      .toBe('Rua A, 10, Centro, Montes Claros, MG, 39400-000');
  });

  it('accepts only a typed bounded geocoding response', async () => {
    mocks.invoke.mockResolvedValue({ data: { query: 'Rua A, 10', provider: 'nominatim', candidates: [{
      label: 'Rua A, 10, Montes Claros', latitude: -16.72, longitude: -43.86, confidence: 0.8,
      accuracy_m: 50, bounds: [-16.73, -16.71, -43.87, -43.85], provider: 'nominatim', provider_type: 'house',
    }] }, error: null });
    const result = await geocodeAddress('tenant', '  Rua A,   10  ');
    expect(mocks.invoke).toHaveBeenCalledWith('geocode-address', {
      body: { tenant_id: 'tenant', address: 'Rua A, 10', limit: 5 },
    });
    expect(locationFromCandidate(result[0], 'Rua A, 10')).toMatchObject({
      source: 'address_geocoded', latitude: -16.72, longitude: -43.86, provider: 'nominatim', accuracy_m: 50,
    });
  });

  it('records an interactive map selection without pretending it was geocoded', () => {
    expect(locationFromMap(-16.72, -43.86, 'Portaria lateral')).toEqual({
      source: 'map_selected', latitude: -16.72, longitude: -43.86, address: 'Portaria lateral',
      provider: 'leaflet_map', accuracy_m: null, confidence: 1, audit: { selected_interactively: true },
    });
  });

  it('fails closed on malformed provider coordinates', async () => {
    mocks.invoke.mockResolvedValue({ data: { query: 'Rua A, 10', provider: 'nominatim', candidates: [{
      label: 'Inválido', latitude: 999, longitude: 0, confidence: 1, accuracy_m: 10,
      bounds: null, provider: 'nominatim', provider_type: null,
    }] }, error: null });
    await expect(geocodeAddress('tenant', 'Rua A, 10')).rejects.toThrow('resposta inválida');
  });
});
