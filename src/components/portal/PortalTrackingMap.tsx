import { useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { PortalTrackingItem } from '@/hooks/portal/usePortalTracking';
import { MapAutoFit } from '@/components/maps/MapAutoFit';
import { DEFAULT_BRAZIL_MAP_CENTER, L } from '@/lib/maps/leaflet';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

function escapeHtml(label: string): string {
  return label.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[character] ?? character);
}

function vehicleIcon(label: string, fresh: boolean) {
  const color = fresh ? '#2563eb' : '#64748b';
  return L.divIcon({
    className: 'portal-tracking-marker',
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
        <div style="background:${color};color:white;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4);white-space:nowrap;">${escapeHtml(label)}</div>
        <div style="width:12px;height:12px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4);"></div>
      </div>
    `,
    iconSize: [60, 40],
    iconAnchor: [30, 40],
  });
}

export default function PortalTrackingMap({
  items,
  onSelect,
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
  const center: [number, number] = points[0] ?? DEFAULT_BRAZIL_MAP_CENTER;

  return (
    <div className="h-[420px] w-full rounded-md overflow-hidden border border-border">
      <MapContainer center={center} zoom={5} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapAutoFit points={points} padding={40} maxZoom={12} singlePointZoom={11} />
        {withPosition.map((i) => (
          <Marker
            key={i.load_id}
            position={[i.lat as number, i.lng as number]}
            icon={vehicleIcon(i.plate || i.load_number, i.telemetry_freshness === 'fresh')}
            eventHandlers={{ click: () => onSelect?.(i) }}
          >
            <Popup>
              <div className="text-xs space-y-1">
                <div className="font-semibold">Carga {i.load_number}</div>
                {i.plate && <div>Veículo: {i.plate}</div>}
                {typeof i.speed === 'number' && <div>Velocidade: {Math.round(i.speed)} km/h</div>}
                {i.captured_at && (
                  <div>
                    {i.telemetry_freshness === 'fresh' ? 'Posição observada' : 'Última posição conhecida'}{' '}
                    {formatDistanceToNow(new Date(i.captured_at), { addSuffix: true, locale: ptBR })}
                  </div>
                )}
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
