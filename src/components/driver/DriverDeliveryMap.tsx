import { useEffect, useId, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MapAutoFit } from '@/components/maps/MapAutoFit';
import { createTruckMarkerIcon, DEFAULT_BRAZIL_MAP_CENTER, L } from '@/lib/maps/leaflet';

export type DeliveryPoint = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  status: 'done' | 'pending' | 'current';
  sequence?: number;
};

export type VehiclePoint = { lat: number; lng: number; plate?: string } | null;

function stopIcon(p: DeliveryPoint) {
  const color = p.status === 'done' ? '#16a34a' : p.status === 'current' ? '#2563eb' : '#94a3b8';
  return L.divIcon({
    className: 'driver-stop-marker',
    html: `<div style="width:28px;height:28px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:700;">${p.sequence ?? ''}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function vehicleIcon() {
  return createTruckMarkerIcon({ color: 'hsl(var(--primary))', className: 'driver-vehicle-marker' });
}

export default function DriverDeliveryMap({
  stops,
  vehicle,
  height = 260,
}: {
  stops: DeliveryPoint[];
  vehicle: VehiclePoint;
  height?: number;
}) {
  const mapId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);
  const all = useMemo<[number, number][]>(() => [
    ...stops.map((s) => ({ lat: s.lat, lng: s.lng })),
    ...(vehicle ? [{ lat: vehicle.lat, lng: vehicle.lng }] : []),
  ].map((point) => [point.lat, point.lng]), [stops, vehicle]);
  const center: [number, number] = all[0] ?? DEFAULT_BRAZIL_MAP_CENTER;
  const routeLine: [number, number][] = stops.map((s) => [s.lat, s.lng]);

  return (
    <div className="rounded-lg overflow-hidden border border-border" style={{ height }}>
      {mounted && (
      <MapContainer key={mapId} center={center} zoom={11} className="h-full w-full z-0" zoomControl={false}>
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapAutoFit points={all} padding={40} maxZoom={13} />
        {routeLine.length > 1 && (
          <Polyline positions={routeLine} pathOptions={{ color: '#2563eb', weight: 3, opacity: 0.6, dashArray: '6 6' }} />
        )}
        {stops.map((s) => (
          <Marker key={s.id} position={[s.lat, s.lng]} icon={stopIcon(s)}>
            <Popup>
              <div className="text-xs">
                <p className="font-bold">{s.name}</p>
                <p className="text-muted-foreground capitalize">
                  {s.status === 'done' ? 'Entregue' : s.status === 'current' ? 'Atual' : 'Pendente'}
                </p>
              </div>
            </Popup>
          </Marker>
        ))}
        {vehicle && (
          <Marker position={[vehicle.lat, vehicle.lng]} icon={vehicleIcon()}>
            <Popup>
              <div className="text-xs">
                <p className="font-bold">{vehicle.plate || 'Meu veículo'}</p>
                <p className="text-muted-foreground">Posição atual</p>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
      )}
    </div>
  );
}
