import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseTripCargoLoadDrafts } from '@/lib/driver/tripCargoConfirmation';
import { normalizeCargoWeightKg } from '@/lib/driver/cargoWeightKg';
import { updateDriverTripCargo } from '@/lib/driver/tripCargoCustody';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
const trip = '73000000-0000-4000-8000-000000000004';
const parse = (weight: string, volume = '1.25') => parseTripCargoLoadDrafts([
  { load_id: 'load', volume_count: volume, pallet_count: '1', weight_kg: weight },
], ['load']);
beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: { version: 1, confirmed: true, trip_id: trip, control_id: trip, status: 'loading' }, error: null });
});

describe('manual cargo weight numeric JSON precision', () => {
  it.each(['90071992547409.91', '90071992547409,91', '9999999999999999.99',
    '9007199254740993', '1' + '0'.repeat(300) + '.01'])('rejects lost digits in %s before issuing a command', async input => {
    await expect((async () => {
      const loads = parse(input);
      await updateDriverTripCargo({ tenantId: trip, tripId: trip, requestId: trip,
        action: 'confirm_cargo', payload: { loads } });
    })()).rejects.toThrow(/Peso.*precisão de duas casas/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['7691.73', '7691.73'], [' 007691,73 ', '7691.73'], ['0', '0'], ['0,01', '0.01'],
    ['12.30', '12.3'], ['90071992547409.90', '90071992547409.9'],
    ['90071992547409.92', '90071992547409.92'], ['10000000000000000', '10000000000000000'],
    ['1' + '0'.repeat(21), '1e+21'], ['1' + '0'.repeat(300), '1e+300'],
  ])('preserves the exact entered decimal %s through JSON and the command', async (input, wire) => {
    mocks.rpc.mockResolvedValue({ data: { version: 1, confirmed: true, trip_id: trip, control_id: trip, status: 'loading' }, error: null });
    const loads = parse(input);
    expect(JSON.stringify(loads[0].weight_kg)).toBe(wire);
    expect(loads[0]).toMatchObject({ volume_count: 1.25, pallet_count: 1 });
    await updateDriverTripCargo({ tenantId: trip, tripId: trip, requestId: trip, action: 'confirm_cargo', payload: { loads } });
    expect(mocks.rpc).toHaveBeenCalledWith('driver_update_trip_cargo_v1', expect.objectContaining({
      _tenant_id: trip, _trip_id: trip, _request_id: trip, _action: 'confirm_cargo', _payload: { loads },
    }));
    const args = mocks.rpc.mock.calls[0][1];
    expect(JSON.stringify(args._payload.loads[0].weight_kg)).toBe(wire);
  });

  it.each(['-1', '1.005', '1,005', '1e3', '1.2.3', '', 'Infinity'])('keeps syntax rejection for %s', input => {
    expect(() => parse(input)).toThrow(/Peso.*duas casas/);
  });

  it('keeps decimal volumes compatible without applying the weight precision rule', () => {
    expect(parse('1.23', '90071992547409.91')[0].volume_count).toBe(Number('90071992547409.91'));
  });

  it.each([7691.72607421875, 1.005, 2.675, 9.995])('preserves explicitly rounded source weight %s in the parser', input => {
    const normalized = normalizeCargoWeightKg(input);
    expect(normalized.rounded).toBe(true);
    expect(JSON.stringify(parse(normalized.value)[0].weight_kg)).toBe(JSON.stringify(Number(normalized.value)));
  });
});
