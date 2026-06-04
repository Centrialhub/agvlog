import { Fragment, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet';
import L, { type LatLngExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { STATE_COLORS, type ActiveTripLive } from '@/lib/controlTower/types';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

function vehicleIcon(trip: ActiveTripLive) {
  const color = STATE_COLORS[trip.state] ?? '#2563eb';
  const pulse = trip.severity === 'critical' || trip.state === 'off_route';
  const speed = trip.speed_kmh ? `${Math.round(trip.speed_kmh)} km/h` : '';
  return L.divIcon({
    className: 'control-tower-vehicle-marker',
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
        <div style="background:${color};color:white;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4);white-space:nowrap;">
          ${trip.vehicle_plate ?? '—'}${speed ? `<br/><span style="font-weight:400;opacity:.85;">${speed}</span>` : ''}
        </div>
        <div style="width:14px;height:14px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4);${pulse ? 'animation:ctPulse 1.4s ease-out infinite;' : ''}"></div>
      </div>
      <style>@keyframes ctPulse{0%{box-shadow:0 0 0 0 ${color}80}70%{box-shadow:0 0 0 14px ${color}00}100%{box-shadow:0 0 0 0 ${color}00}}</style>
    `,
    iconSize: [60, 44],
    iconAnchor: [30, 44],
  });
}

function stopIcon(seq: number, done: boolean) {
  const color = done ? '#16a34a' : '#94a3b8';
  return L.divIcon({
    className: 'control-tower-stop-marker',
    html: `<div style="width:22px;height:22px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:700;">${seq}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 12 });
  }, [points.length]);
  return null;
}

export default function ControlTowerMap({
  trips,
  onSelectTrip,
}: {
  trips: ActiveTripLive[];
  onSelectTrip: (trip: ActiveTripLive) => void;
}) {
  const allPoints = useMemo<[number, number][]>(() => {
    const p: [number, number][] = [];
    for (const t of trips) {
      if (t.lat != null && t.lng != null) p.push([t.lat, t.lng]);
      const coords = t.route_geometry_geojson?.coordinates;
      if (coords?.length) {
        p.push([coords[0][1], coords[0][0]]);
        p.push([coords[coords.length - 1][1], coords[coords.length - 1][0]]);
      }
    }
    return p;
  }, [trips]);

  const center: [number, number] = allPoints[0] ?? [-14.235, -51.925];

  return (
    <div className="h-full w-full rounded-lg overflow-hidden border border-border">
      <MapContainer center={center} zoom={5} className="h-full w-full z-0">
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={allPoints} />

        {trips.map((t) => {
          const color = STATE_COLORS[t.state] ?? '#2563eb';
          return (
            <Fragment key={t.trip_id}>
              {t.route_geometry_geojson?.coordinates && (
                <Polyline
                  positions={t.route_geometry_geojson.coordinates.map(
                    ([lng, lat]) => [lat, lng] as LatLngExpression,
                  )}
                  pathOptions={{ color, weight: 4, opacity: 0.75 }}
                />
              )}
              {t.pending_stops.map((s, i) => {
                const lat = (s as any).latitude ?? null;
                const lng = (s as any).longitude ?? null;
                if (lat == null || lng == null) return null;
                return (
                  <Marker key={`${t.trip_id}-s-${s.id}`} position={[lat, lng]} icon={stopIcon(s.sequence ?? i + 1, false)} />
                );
              })}
              {t.lat != null && t.lng != null && (
                <Marker
                  position={[t.lat, t.lng]}
                  icon={vehicleIcon(t)}
                  eventHandlers={{ click: () => onSelectTrip(t) }}
                />
              )}
            </Fragment>
          );
        })}
      </MapContainer>
    </div>
  );
}