import { describe, expect, it } from 'vitest';
import {
  clearDriverRouteSnapshots,
  getNextDriverStop,
  readDriverRouteSnapshot,
  saveDriverRouteSnapshot,
} from '@/lib/driver/offlineRouteSnapshot';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

const route = {
  tenantId: 'tenant',
  userId: 'user',
  driver: { id: 'driver', name: 'Motorista QA' },
  trip: { id: 'trip', status: 'in_transit', actual_start_at: '2026-09-01T10:00:00Z', loads: { load_number: '1012' } },
  stops: [
    { id: 'done', stop_order: 1, destination: 'A', status: 'delivered' },
    { id: 'next', stop_order: 2, destination: 'B', status: 'pending' },
    { id: 'later', stop_order: 3, destination: 'C', status: 'pending' },
  ],
};

describe('driver route offline snapshot', () => {
  it('restores the scoped route and resolves the next non-terminal stop', () => {
    const storage = memoryStorage();
    const saved = saveDriverRouteSnapshot(route, storage, new Date('2026-09-01T12:00:00Z'));
    expect(saved?.cachedAt).toBe('2026-09-01T12:00:00.000Z');
    const snapshot = readDriverRouteSnapshot('tenant', 'user', storage, new Date('2026-09-01T12:05:00Z').getTime());
    expect(snapshot?.driver.name).toBe('Motorista QA');
    expect(getNextDriverStop(snapshot?.stops ?? [])?.id).toBe('next');
    expect(readDriverRouteSnapshot('tenant', 'other-user', storage)).toBeNull();
  });

  it('rejects malformed version-one snapshots instead of returning a partial route', () => {
    const storage = memoryStorage();
    const key = 'agvlog:driver-route:v1:tenant:user';
    const malformed = {
      ...route,
      version: 1,
      cachedAt: '2026-09-01T12:00:00.000Z',
      driver: { id: 'driver' },
    };
    storage.setItem(key, JSON.stringify(malformed));

    expect(readDriverRouteSnapshot('tenant', 'user', storage, new Date('2026-09-01T12:05:00Z').getTime())).toBeNull();
    expect(storage.getItem(key)).toBeNull();
  });

  it('rejects invalid timestamps instead of keeping a snapshot forever', () => {
    const storage = memoryStorage();
    const key = 'agvlog:driver-route:v1:tenant:user';
    storage.setItem(key, JSON.stringify({ ...route, version: 1, cachedAt: 'not-a-date' }));

    expect(readDriverRouteSnapshot('tenant', 'user', storage)).toBeNull();
    expect(storage.getItem(key)).toBeNull();
  });

  it('expires old routes and clears driver snapshots on logout', () => {
    const storage = memoryStorage();
    saveDriverRouteSnapshot(route, storage);
    expect(readDriverRouteSnapshot('tenant', 'user', storage, Date.now() + 8 * 24 * 60 * 60 * 1000)).toBeNull();
    saveDriverRouteSnapshot(route, storage);
    storage.setItem('unrelated', 'keep');
    clearDriverRouteSnapshots(storage);
    expect(storage.getItem('unrelated')).toBe('keep');
    expect(readDriverRouteSnapshot('tenant', 'user', storage)).toBeNull();
  });
});
