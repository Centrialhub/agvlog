// Shared OSRM client for Edge Functions.
// Defaults to the public demo server. Set OSRM_BASE_URL to point at a self-hosted instance.

export const OSRM_BASE_URL =
  Deno.env.get('OSRM_BASE_URL')?.replace(/\/$/, '') || 'https://router.project-osrm.org';

export type OsrmCoordinate = { lat: number; lng: number };

export interface OsrmRouteResult {
  provider: 'osrm';
  geometryGeoJson: { type: 'LineString'; coordinates: [number, number][] };
  distanceMeters: number;
  durationSeconds: number;
  waypoints?: unknown[];
  raw?: unknown;
}

export async function calculateOsrmRoute(
  coordinates: OsrmCoordinate[],
  opts: { profile?: 'driving' | 'car' | 'bike' | 'foot'; timeoutMs?: number } = {},
): Promise<OsrmRouteResult> {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    throw new Error('OSRM requires at least 2 coordinates');
  }
  for (const c of coordinates) {
    if (typeof c.lat !== 'number' || typeof c.lng !== 'number' || Number.isNaN(c.lat) || Number.isNaN(c.lng)) {
      throw new Error('Invalid OSRM coordinate');
    }
  }

  const profile = opts.profile ?? 'driving';
  // OSRM uses lng,lat order
  const coordStr = coordinates.map((c) => `${c.lng},${c.lat}`).join(';');
  const url = `${OSRM_BASE_URL}/route/v1/${profile}/${coordStr}?overview=full&geometries=geojson&steps=false`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } catch (e) {
    throw new Error(`OSRM request failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OSRM HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  if (data.code !== 'Ok' || !Array.isArray(data.routes) || data.routes.length === 0) {
    throw new Error(`OSRM error: ${data.code || 'no_route'} ${data.message || ''}`);
  }
  const route = data.routes[0];
  return {
    provider: 'osrm',
    geometryGeoJson: route.geometry,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    waypoints: data.waypoints,
    raw: data,
  };
}

/** Haversine distance in meters. */
export function haversineMeters(a: OsrmCoordinate, b: OsrmCoordinate): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distance (meters) from a point to the nearest vertex of a GeoJSON LineString.
 * Approximate but cheap — good enough for off-route detection at city scale.
 * For higher precision, sample the line every ~100m before calling. */
export function pointToLineDistanceMeters(
  point: OsrmCoordinate,
  line: { type: 'LineString'; coordinates: [number, number][] },
): number {
  if (!line?.coordinates?.length) return Number.POSITIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;
  for (const [lng, lat] of line.coordinates) {
    const d = haversineMeters(point, { lat, lng });
    if (d < min) min = d;
  }
  return min;
}