import type { DriverDestinationStop } from '@/components/driver/NextDestinationCard';

const KEY_PREFIX = 'agvlog:driver-route:v1:';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface DriverRouteSnapshot {
  version: 1;
  tenantId: string;
  userId: string;
  cachedAt: string;
  driver: { id: string; name: string };
  trip: {
    id: string;
    status: string;
    actual_start_at: string | null;
    loads: { load_number: string } | null;
  };
  stops: DriverDestinationStop[];
}

function storageKey(tenantId: string, userId: string): string {
  return `${KEY_PREFIX}${tenantId}:${userId}`;
}

function isSnapshot(value: unknown, tenantId: string, userId: string): value is DriverRouteSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DriverRouteSnapshot>;
  return candidate.version === 1
    && candidate.tenantId === tenantId
    && candidate.userId === userId
    && typeof candidate.cachedAt === 'string'
    && typeof candidate.driver?.id === 'string'
    && typeof candidate.trip?.id === 'string'
    && Array.isArray(candidate.stops);
}

export function readDriverRouteSnapshot(
  tenantId: string | undefined,
  userId: string | undefined,
  storage: Pick<Storage, 'getItem' | 'removeItem'> = localStorage,
  now = Date.now(),
): DriverRouteSnapshot | null {
  if (!tenantId || !userId) return null;
  const key = storageKey(tenantId, userId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isSnapshot(parsed, tenantId, userId) || now - new Date(parsed.cachedAt).getTime() > MAX_AGE_MS) {
      storage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    try { storage.removeItem(key); } catch { /* storage unavailable */ }
    return null;
  }
}

export function saveDriverRouteSnapshot(
  snapshot: Omit<DriverRouteSnapshot, 'version' | 'cachedAt'>,
  storage: Pick<Storage, 'setItem'> = localStorage,
  now = new Date(),
): DriverRouteSnapshot | null {
  const savedSnapshot = {
    ...snapshot,
    version: 1,
    cachedAt: now.toISOString(),
  } satisfies DriverRouteSnapshot;
  try {
    storage.setItem(storageKey(snapshot.tenantId, snapshot.userId), JSON.stringify(savedSnapshot));
    return savedSnapshot;
  } catch {
    // The live route remains usable even when browser storage is unavailable.
    return null;
  }
}

export function clearDriverRouteSnapshots(storage: Pick<Storage, 'length' | 'key' | 'removeItem'> = localStorage): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(KEY_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Best-effort cleanup for browsers with restricted storage.
  }
}

const TERMINAL_STOP_STATUSES = new Set([
  'completed', 'delivered', 'refused', 'returned', 'failed', 'partial_delivery', 'skipped',
]);

export function getPendingDriverStops(stops: DriverDestinationStop[]): DriverDestinationStop[] {
  return stops
    .filter((stop) => !TERMINAL_STOP_STATUSES.has(stop.status))
    .sort((first, second) => (first.stop_order ?? Number.MAX_SAFE_INTEGER) - (second.stop_order ?? Number.MAX_SAFE_INTEGER));
}

export function getNextDriverStop(stops: DriverDestinationStop[]): DriverDestinationStop | null {
  return getPendingDriverStops(stops)[0] ?? null;
}
