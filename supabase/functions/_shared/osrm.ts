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
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lng) || Math.abs(c.lat)>90 || Math.abs(c.lng)>180) {
      throw new Error('Invalid OSRM coordinate');
    }
  }

  const profile = opts.profile ?? 'driving';
  // OSRM uses lng,lat order
  const coordStr = coordinates.map((c) => `${c.lng},${c.lat}`).join(';');
  const url = `${OSRM_BASE_URL}/route/v1/${profile}/${coordStr}?overview=full&geometries=geojson&steps=false`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const data = await res.json();
    if (data?.code !== 'Ok' || !Array.isArray(data.routes) || data.routes.length === 0) throw new Error('OSRM returned no route');
    const route = data.routes[0];
    const point=(v:unknown):v is [number,number]=>Array.isArray(v) && v.length===2 && v.every(Number.isFinite) && Math.abs(v[0])<=180 && Math.abs(v[1])<=90;
    if (!Number.isFinite(route?.distance) || route.distance<0 || !Number.isFinite(route.duration) || route.duration<0 ||
      route.geometry?.type!=='LineString' || !Array.isArray(route.geometry.coordinates) ||
      route.geometry.coordinates.length<2 || route.geometry.coordinates.length>100000 || !route.geometry.coordinates.every(point) ||
      !Array.isArray(data.waypoints) || data.waypoints.length!==coordinates.length ||
      !data.waypoints.every((w:{location:unknown})=>w && point(w.location))) throw new Error('Invalid OSRM response');
    return { provider:'osrm',geometryGeoJson:route.geometry,distanceMeters:route.distance,durationSeconds:route.duration,
      waypoints:data.waypoints.map((w:{location:[number,number]})=>({location:w.location})) };
  } finally { clearTimeout(t); }
}

export { haversineMeters, pointToLineDistanceMeters };
import { haversineMeters, pointToLineDistanceMeters } from './geo.ts';
