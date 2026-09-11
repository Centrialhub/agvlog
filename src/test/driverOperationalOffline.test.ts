import { describe, expect, it, vi } from 'vitest';

import { createMemoryDriverOfflineOutbox } from '@/lib/driver/driverOfflineOutbox';
import { createDriverOperationalCommandService, createMemoryDriverOperationalSnapshotStore,
  type DriverOperationalSnapshot } from '@/lib/driver/driverOperationalOffline';

const tenant = '20000000-0000-4000-8000-000000000001';
const actor = '10000000-0000-4000-8000-000000000003';
const trip = '80000000-0000-4000-8000-000000000001';
const stop = '82000000-0000-4000-8000-000000000001';
const request = 'a0000000-0000-4000-8000-000000000001';

function receipt(replayed = false) {
  return { version: 1, confirmed: true, replayed, tenant_id: tenant, actor_id: actor,
    request_id: request, command: 'departure', trip_id: trip,
    entity_id: 'b0000000-0000-4000-8000-000000000001' };
}

describe('driver operational offline command service', () => {
  it('persists before returning offline and recovers the same request identity', async () => {
    const outbox = createMemoryDriverOfflineOutbox();
    let online = false;
    const send = vi.fn(async () => receipt());
    const service = createDriverOperationalCommandService({ outbox, send, uuid: () => request,
      now: () => new Date('2026-09-10T12:00:00Z'), isOnline: () => online });

    const queued = await service.submit(tenant, actor, { kind: 'departure', aggregateId: trip,
      payload: { trip_id: trip, stop_id: stop, notes: null } });
    expect(queued).toMatchObject({ id: request, queued: true, state: 'queued' });
    expect(send).not.toHaveBeenCalled();
    expect(await outbox.list(tenant, actor, 'departure')).toHaveLength(1);

    online = true;
    await expect(service.recover(tenant, actor)).resolves.toEqual({ confirmed: 1, pending: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ id: request, attempts: 0, aggregateId: trip }));
  });

  it('keeps an uncertain transport failure queued and retries without creating a new request', async () => {
    const outbox = createMemoryDriverOfflineOutbox();
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce(receipt(true));
    const service = createDriverOperationalCommandService({ outbox, send, uuid: () => request,
      now: () => new Date('2026-09-10T12:00:00Z'), isOnline: () => true });

    await expect(service.submit(tenant, actor, { kind: 'departure', aggregateId: trip,
      payload: { trip_id: trip, stop_id: stop, notes: null } })).resolves.toMatchObject({ state: 'queued' });
    expect((await outbox.list(tenant, actor))[0]).toMatchObject({ id: request, attempts: 1, state: 'queued' });
    await service.recover(tenant, actor);
    expect(send.mock.calls.map(([record]) => record.id)).toEqual([request, request]);
    expect(await outbox.list(tenant, actor)).toHaveLength(0);
  });

  it('quarantines a mismatched acknowledgement instead of reporting success', async () => {
    const outbox = createMemoryDriverOfflineOutbox();
    const service = createDriverOperationalCommandService({ outbox, send: async () => ({ ...receipt(), actor_id: tenant }),
      uuid: () => request, now: () => new Date('2026-09-10T12:00:00Z'), isOnline: () => true });
    const result = await service.submit(tenant, actor, { kind: 'departure', aggregateId: trip,
      payload: { trip_id: trip, stop_id: stop, notes: null } });
    expect(result).toMatchObject({ queued: true, state: 'needs_attention' });
    expect((await outbox.list(tenant, actor))[0]).toMatchObject({ state: 'needs_attention', attempts: 1 });
    await expect(service.recover(tenant, actor)).resolves.toEqual({ confirmed: 0, pending: 1 });
  });
});

describe('driver operational snapshot store contract', () => {
  it('keeps trip, stop, document, instruction, checklist, journey and cargo data scoped to the session', async () => {
    const store = createMemoryDriverOperationalSnapshotStore();
    const snapshot: DriverOperationalSnapshot = {
      version: 1, tenantId: tenant, actorId: actor, tripId: trip, cachedAt: '2026-09-10T12:00:00Z',
      trip: { id: trip, status: 'in_transit', actualStartAt: '2026-09-10T10:00:00Z', actualEndAt: null,
        driver: { id: 'driver', name: 'Motorista QA' }, vehicle: { id: 'vehicle', plate: 'ABC1D23', nickname: null } },
      loads: [{ id: 'load', loadNumber: '1012', status: 'in_transit', origin: 'Origem', destination: 'Destino',
        volumeCount: 10, palletCount: 2, weightKg: 800 }],
      stops: [{ id: stop, order: 1, status: 'pending', destination: 'Rua QA', latitude: -15.8, longitude: -43.3,
        notes: 'Acessar pela portaria 2', client: { id: null, name: 'Cliente QA' }, actualArrivalAt: null, actualDepartureAt: null }],
      documents: [{ id: 'doc', loadId: 'load', kind: 'nfse', referenceNumber: 'NFS-77' }],
      deliveryItemsByStop: { [stop]: [{ id: 'item', fiscalDocumentId: 'doc', attemptId: null,
        isHistorical: false, sku: 'doc', name: 'Serviço', qty: 1, unit: 'UN', price: 0,
        documentStatus: 'in_transit' }] },
      instructions: ['Acessar pela portaria 2'],
      checklist: { pre: { id: 'pre', boundaryId: null, checkedItems: [0, 1] },
        post: { id: null, boundaryId: 'start', checkedItems: [] } },
      journey: { events: [{ id: 'start', tripId: trip, type: 'start_shift', eventAt: '2026-09-10T09:50:00Z' }],
        lastStartId: 'start', lastEndId: null },
      occurrences: [{ id: '90000000-0000-4000-8000-000000000001', tenant_id: tenant,
        driver_id: 'driver', dispatch_trip_id: trip, dispatch_stop_id: stop,
        event_type: 'damaged', severity: 'medium', description: 'Avaria registrada',
        report_details: null, payload: null, created_at: '2026-09-10T11:30:00Z' }],
      cargo: null,
    };
    await store.put(snapshot);
    expect(await store.read(tenant, actor, trip)).toEqual(snapshot);
    expect(await store.read(tenant, 'other-actor', trip)).toBeNull();
    expect(await store.readLatest(tenant, 'other-actor')).toBeNull();
    expect(await store.readLatest(tenant, actor)).toEqual(snapshot);
    expect((await store.readLatest(tenant, actor))?.occurrences?.[0].description).toBe('Avaria registrada');
    await expect(store.put({ ...snapshot, occurrences: snapshot.occurrences?.map(event => ({
      ...event, tenant_id: 'other-tenant',
    })) })).rejects.toThrow('snapshot operacional é inválido');
    expect((await store.read(tenant, actor, trip))?.occurrences?.[0].tenant_id).toBe(tenant);
    await store.remove(tenant, actor, trip);
    expect(await store.read(tenant, actor, trip)).toBeNull();
  });
});
