import { describe, expect, it } from 'vitest';
import { vehicleDetailQueryFlags } from '@/lib/fleet/vehicleDetailQueryFlags';

describe('consultas sob demanda da ficha do veículo', () => {
  it('não habilita leituras históricas pesadas na visão geral', () => {
    expect(vehicleDetailQueryFlags('overview', false, true)).toEqual({
      history: false,
      trips: false,
      stops: false,
      overspeed: false,
      fuel: false,
      pois: false,
    });
  });

  it('habilita somente os dados consumidos por cada aba', () => {
    expect(vehicleDetailQueryFlags('timeline', false, true)).toMatchObject({ history: true, stops: true, trips: false });
    expect(vehicleDetailQueryFlags('trips', false, true)).toMatchObject({ history: true, trips: true, stops: false });
    expect(vehicleDetailQueryFlags('speed', false, true)).toMatchObject({ history: true, overspeed: true });
    expect(vehicleDetailQueryFlags('fuel', false, true).fuel).toBe(true);
    expect(vehicleDetailQueryFlags('fuel', false, false).fuel).toBe(false);
    expect(vehicleDetailQueryFlags('stops', false, true).pois).toBe(false);
    expect(vehicleDetailQueryFlags('stops', true, true).pois).toBe(true);
  });
});
