import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { PortalTrackingItem } from '@/hooks/portal/usePortalTracking';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

function vehicleIcon(label: string) {
  return L.divIcon({
    className: 'portal-tracking-marker',
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
        <div style="background:#2563eb;color:white;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4);white-space:nowrap;">${label}</div>
        <div style="width:12px;height:12px;border-radius:50%;background:#2563eb;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4);"></div>
      </div>
    `,
    iconSize: [60, 40],
    iconAnchor: [30, 40],
  });
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView(points[0], 11);
      return;
    }
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
  }, [points.length, points.map((p) => p.join(',')).join('|')]);
  return null;
}

export default function PortalTrackingMap({
  items,
  onSelect,
  selectedLoadId,
}: {
  items: PortalTrackingItem[];
  onSelect?: (item: PortalTrackingItem) => void;
  selectedLoadId?: string | null;
}) {
  const withPosition = useMemo(
    () => items.filter((i) => typeof i.lat === 'number' && typeof i.lng === 'number'),
    [items],
  );
  const points = useMemo<[number, number][]>(
    () => withPosition.map((i) => [i.lat as number, i.lng as number]),
    [withPosition],
  );
  const center: [number, number] = points[0] ?? [-14.235, -51.9253];

  return (
    <div className="h-[420px] w-full rounded-md overflow-hidden border border-border">
      <MapContainer center={center} zoom={5} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={points} />
        {withPosition.map((i) => (
          <Marker
            key={i.load_id}
            position={[i.lat as number, i.lng as number]}
            icon={vehicleIcon(i.plate || i.load_number)}
            eventHandlers={{ click: () => onSelect?.(i) }}
          >
            <Popup>
              <div className="text-xs space-y-1">
                <div className="font-semibold">Carga {i.load_number}</div>
                {i.plate && <div>Veículo: {i.plate}</div>}
                {typeof i.speed === 'number' && <div>Velocidade: {Math.round(i.speed)} km/h</div>}
                {i.next_stop?.city && (
                  <div>Próxima parada: {i.next_stop.city}{i.next_stop.state ? `/${i.next_stop.state}` : ''}</div>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}