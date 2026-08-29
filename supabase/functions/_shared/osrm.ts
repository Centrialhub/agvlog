// Shared OSRM client for Edge Functions.
// Production must point OSRM_BASE_URL at an approved provider or self-hosted
// instance. Vehicle coordinates must never fall back to a public demo server.

export const OSRM_BASE_URL =
  Deno.env.get('OSRM_BASE_URL')?.replace(/\/$/, '') || '';

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
  if (!OSRM_BASE_URL) {
    throw new Error('OSRM_BASE_URL is not configured with an approved routing provider');
  }
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

export { haversineMeters, pointToLineDistanceMeters };
import { haversineMeters, pointToLineDistanceMeters } from './geo.ts';
