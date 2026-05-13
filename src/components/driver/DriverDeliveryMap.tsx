import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

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
  return L.divIcon({
    className: 'driver-vehicle-marker',
    html: `<div style="width:32px;height:32px;border-radius:50%;background:hsl(var(--primary));border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function FitBounds({ points }: { points: { lat: number; lng: number }[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  }, [points.length]);
  return null;
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
  const all = [
    ...stops.map((s) => ({ lat: s.lat, lng: s.lng })),
    ...(vehicle ? [{ lat: vehicle.lat, lng: vehicle.lng }] : []),
  ];
  const center: [number, number] = all.length ? [all[0].lat, all[0].lng] : [-14.235, -51.925];
  const routeLine: [number, number][] = stops.map((s) => [s.lat, s.lng]);

  return (
    <div className="rounded-lg overflow-hidden border border-border" style={{ height }}>
      <MapContainer center={center} zoom={11} className="h-full w-full z-0" zoomControl={false}>
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={all} />
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
    </div>
  );
}