import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cargoTripIdentityKey, getDriverCargoTripIdentity } from '@/lib/driver/cargoTripIdentity';
import { DRIVER_TRIP_SELECT } from '@/lib/driverTrip';

const ids = {
  tenant: '72000000-0000-4000-8000-000000000001',
  actor: '72000000-0000-4000-8000-000000000002',
  driver: '72000000-0000-4000-8000-000000000003',
  trip: '72000000-0000-4000-8000-000000000004',
  vehicle: '72000000-0000-4000-8000-000000000005',
  load1: '72000000-0000-4000-8000-000000000006',
  load2: '72000000-0000-4000-8000-000000000007',
  other: '72999999-0000-4000-8000-000000000001',
};
const input = { tenantId: ids.tenant, actorId: ids.actor, driverId: ids.driver, tripId: ids.trip };
const mocks = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(),
  abortSignal: vi.fn(), maybeSingle: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));

const load = (id: string, loadNumber: string) => ({
  load_id: id,
  loads: { id, load_number: loadNumber, origin: 'Origem QA', destination: 'Destino QA', status: 'ready' },
});

function trip() {
  return {
    id: ids.trip, tenant_id: ids.tenant, driver_id: ids.driver, vehicle_id: ids.vehicle,
    load_id: ids.load2, status: 'planned', actual_start_at: null, actual_end_at: null,
    vehicles: { plate: 'PVL8973', nickname: null },
    dispatch_trip_loads: [load(ids.load1, '1003'), load(ids.load2, '1012')],
  };
}

function respond(data: unknown, error: unknown = null) {
  mocks.maybeSingle.mockResolvedValue({ data, error });
}

beforeEach(() => {
  vi.clearAllMocks();
  const chain = { select: mocks.select, eq: mocks.eq, abortSignal: mocks.abortSignal,
    maybeSingle: mocks.maybeSingle };
  mocks.from.mockReturnValue(chain);
  mocks.select.mockReturnValue(chain);
  mocks.eq.mockReturnValue(chain);
  mocks.abortSignal.mockReturnValue(chain);
  respond(trip());
});

describe('driver cargo trip identity using a scoped canonical trip read', () => {
  it('reads the selected trip with tenant and driver filters and retains every canonical load', async () => {
    const identity = await getDriverCargoTripIdentity(input);

    expect(mocks.from).toHaveBeenCalledExactlyOnceWith('dispatch_trips');
    expect(mocks.select).toHaveBeenCalledExactlyOnceWith(DRIVER_TRIP_SELECT);
    expect(mocks.eq.mock.calls).toEqual(expect.arrayContaining([
      ['tenant_id', ids.tenant], ['driver_id', ids.driver], ['id', ids.trip],
    ]));
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(1);
    expect(identity).toEqual({
      tripId: ids.trip, tenantId: ids.tenant, driverId: ids.driver,
      vehicleId: ids.vehicle, plate: 'PVL8973',
      loads: [
        { id: ids.load1, loadNumber: '1003', origin: 'Origem QA', destination: 'Destino QA', status: 'ready' },
        { id: ids.load2, loadNumber: '1012', origin: 'Origem QA', destination: 'Destino QA', status: 'ready' },
      ],
    });
  });

  it('passes cancellation through the Supabase query', async () => {
    const controller = new AbortController();
    await getDriverCargoTripIdentity(input, controller.signal);
    expect(mocks.abortSignal).toHaveBeenCalledExactlyOnceWith(controller.signal);
  });

  it('does not install a cancellation signal when none was supplied', async () => {
    await getDriverCargoTripIdentity(input);
    expect(mocks.abortSignal).not.toHaveBeenCalled();
  });

  it('returns null for an empty authorized response without querying another trip', async () => {
    respond(null);
    await expect(getDriverCargoTripIdentity(input)).resolves.toBeNull();
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it('propagates a query error instead of returning missing or stale identity', async () => {
    respond(null, { message: 'Consulta indisponível', code: '42501' });
    await expect(getDriverCargoTripIdentity(input)).rejects.toThrow();
  });

  it.each(['id', 'tenant_id', 'driver_id'] as const)('rejects a response with a mismatched %s', async column => {
    respond({ ...trip(), [column]: ids.other });
    await expect(getDriverCargoTripIdentity(input)).rejects.toThrow();
  });

  it('keeps load identity attached to its canonical ID when links arrive in another order', async () => {
    respond({ ...trip(), dispatch_trip_loads: [load(ids.load2, '1012'), load(ids.load1, '1003')] });
    const identity = await getDriverCargoTripIdentity(input);
    expect(identity?.loads.find(item => item.id === ids.load1)?.loadNumber).toBe('1003');
    expect(identity?.loads.find(item => item.id === ids.load2)?.loadNumber).toBe('1012');
    expect(identity?.loads).toHaveLength(2);
  });

  it('does not create a load from the legacy primary load_id without a canonical link', async () => {
    respond({ ...trip(), dispatch_trip_loads: [] });
    expect((await getDriverCargoTripIdentity(input))?.loads).toEqual([]);
  });

  it('does not invent identity for a linked load hidden or absent in the response', async () => {
    respond({ ...trip(), dispatch_trip_loads: [{ load_id: ids.load1, loads: null }] });
    expect((await getDriverCargoTripIdentity(input))?.loads).toEqual([
      { id: ids.load1, loadNumber: '', origin: null, destination: null, status: '' },
    ]);
  });

  it('never substitutes technical identifiers for missing plate or load number', async () => {
    respond({ ...trip(), vehicles: null, dispatch_trip_loads: [{
      load_id: ids.load1, loads: { ...load(ids.load1, '1003').loads, load_number: null },
    }] });
    const identity = await getDriverCargoTripIdentity(input);
    expect(identity?.plate).toBeNull();
    expect(identity?.loads.find(item => item.id === ids.load1)?.loadNumber).toBeFalsy();
    expect(identity?.loads.find(item => item.id === ids.load1)?.loadNumber).not.toBe(ids.load1.slice(0, 8));
  });

  it('returns no vehicle identity when the trip has no assigned vehicle', async () => {
    respond({ ...trip(), vehicle_id: null, vehicles: null });
    expect(await getDriverCargoTripIdentity(input)).toMatchObject({ vehicleId: null, plate: null });
  });

  it('rejects a canonical link whose load_id differs from the nested load ID', async () => {
    respond({ ...trip(), dispatch_trip_loads: [{ ...load(ids.load1, '1003'), load_id: ids.load2 }] });
    await expect(getDriverCargoTripIdentity(input)).rejects.toThrow();
  });

  it('rejects duplicate load IDs with conflicting labels', async () => {
    respond({ ...trip(), dispatch_trip_loads: [load(ids.load1, '1003'), load(ids.load1, 'WRONG')] });
    await expect(getDriverCargoTripIdentity(input)).rejects.toThrow();
  });

  it('rejects repeated canonical load links even when their labels match', async () => {
    respond({ ...trip(), dispatch_trip_loads: [load(ids.load1, '1003'), load(ids.load1, '1003')] });
    await expect(getDriverCargoTripIdentity(input)).rejects.toThrow();
  });

  it('trims readable labels while retaining the full canonical IDs', async () => {
    respond({ ...trip(), vehicles: { plate: '  PVL8973  ' },
      dispatch_trip_loads: [load(ids.load1, '  1003  ')] });
    expect(await getDriverCargoTripIdentity(input)).toMatchObject({
      vehicleId: ids.vehicle, plate: 'PVL8973', loads: [{ id: ids.load1, loadNumber: '1003' }],
    });
  });

  it('treats an empty vehicle label as unavailable rather than using the vehicle UUID', async () => {
    respond({ ...trip(), vehicles: { plate: '   ' } });
    expect((await getDriverCargoTripIdentity(input))?.plate).toBeNull();
  });

  it.each(['tenantId', 'actorId', 'driverId', 'tripId'] as const)('rejects missing %s before making a read', async field => {
    await expect(getDriverCargoTripIdentity({ ...input, [field]: '' })).rejects.toThrow();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('rejects malformed UUIDs in the response', async () => {
    respond({ ...trip(), vehicle_id: 'not-a-vehicle-id' });
    await expect(getDriverCargoTripIdentity(input)).rejects.toThrow();
  });

  it('accepts a missing canonical collection without discovering the legacy primary load', async () => {
    respond({ ...trip(), dispatch_trip_loads: null });
    expect((await getDriverCargoTripIdentity(input))?.loads).toEqual([]);
  });

  it('rejects duplicate load IDs with conflicting route data', async () => {
    respond({ ...trip(), dispatch_trip_loads: [load(ids.load1, '1003'), {
      ...load(ids.load1, '1003'), loads: { ...load(ids.load1, '1003').loads, destination: 'Outro destino' },
    }] });
    await expect(getDriverCargoTripIdentity(input)).rejects.toThrow();
  });

  it('rejects malformed collections instead of using the primary load fallback', async () => {
    respond({ ...trip(), dispatch_trip_loads: 'not-an-array' });
    await expect(getDriverCargoTripIdentity(input)).rejects.toThrow();
  });
});

describe('cargo trip identity cache keys', () => {
  it('includes the complete tenant, actor, driver and selected-trip context', () => {
    expect(cargoTripIdentityKey(input)).toEqual([
      'driver_cargo_trip_identity', ids.tenant, ids.actor, ids.driver, ids.trip,
    ]);
  });

  it.each(['tenantId', 'actorId', 'driverId', 'tripId'] as const)('isolates a different %s', field => {
    expect(cargoTripIdentityKey({ ...input, [field]: ids.other })).not.toEqual(cargoTripIdentityKey(input));
  });
});
