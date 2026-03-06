import { useState, useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useFleetPositions, PositionLast } from '@/hooks/usePositions';
import { useVehicles, Vehicle } from '@/hooks/useVehicles';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Truck, Search, MapPin, Clock, Gauge, RefreshCw, Eye, Radio } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useIsAdmin } from '@/hooks/useTenant';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ptBR } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';

// Fix Leaflet default icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

function createVehicleIcon(isOnline: boolean, isMoving: boolean) {
  const color = !isOnline ? '#94a3b8' : isMoving ? '#22c55e' : '#f59e0b';
  return L.divIcon({
    className: 'custom-vehicle-marker',
    html: `<div style="
      width: 32px; height: 32px; border-radius: 50%;
      background: ${color}; border: 3px solid white;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      display: flex; align-items: center; justify-content: center;
    "><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

function isVehicleOnline(capturedAt: string): boolean {
  return Date.now() - new Date(capturedAt).getTime() < 10 * 60 * 1000; // 10min
}

function isVehicleMoving(speed: number | null): boolean {
  return speed != null && speed > 2;
}

function FitBounds({ positions }: { positions: PositionLast[] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length === 0) return;
    const bounds = L.latLngBounds(positions.map(p => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
  }, [positions.length]);
  return null;
}

export default function FleetMap() {
  const { currentTenant } = useTenant();
  const { data: positions = [], isLoading: posLoading, refetch } = useFleetPositions();
  const { data: vehicles = [] } = useVehicles();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline' | 'moving' | 'stopped'>('all');
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();

  // Get integration accounts for SSX polling
  const { data: accounts = [] } = useQuery({
    queryKey: ['integration_accounts_brief', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase.from('integration_accounts').select('id, status').eq('tenant_id', currentTenant.id).eq('status', 'ok');
      return data || [];
    },
    enabled: !!currentTenant && isAdmin,
  });

  const pollMutation = useMutation({
    mutationFn: async () => {
      for (const acc of accounts) {
        await supabase.functions.invoke('ssx-login', { body: { integration_account_id: acc.id } });
        await supabase.functions.invoke('ssx-poll-positions', { body: { integration_account_id: acc.id } });
      }
    },
    onSuccess: () => { refetch(); },
  });

  const vehicleMap = useMemo(() => {
    const map: Record<string, Vehicle> = {};
    for (const v of vehicles) map[v.id] = v;
    return map;
  }, [vehicles]);

  const enriched = useMemo(() => {
    return positions.map(p => ({
      ...p,
      vehicle: vehicleMap[p.vehicle_id],
      online: isVehicleOnline(p.captured_at),
      moving: isVehicleMoving(p.speed),
    }));
  }, [positions, vehicleMap]);

  const filtered = useMemo(() => {
    return enriched.filter(p => {
      const v = p.vehicle;
      if (!v) return false;
      const q = search.toLowerCase();
      if (q && !v.plate.toLowerCase().includes(q) && !(v.nickname || '').toLowerCase().includes(q)) return false;
      if (statusFilter === 'online' && !p.online) return false;
      if (statusFilter === 'offline' && p.online) return false;
      if (statusFilter === 'moving' && !p.moving) return false;
      if (statusFilter === 'stopped' && p.moving) return false;
      return true;
    });
  }, [enriched, search, statusFilter]);

  // Vehicles without positions
  const vehiclesWithoutPosition = useMemo(() => {
    const withPos = new Set(positions.map(p => p.vehicle_id));
    return vehicles.filter(v => !withPos.has(v.id));
  }, [vehicles, positions]);

  const stats = useMemo(() => ({
    total: vehicles.length,
    online: enriched.filter(p => p.online).length,
    moving: enriched.filter(p => p.moving).length,
    offline: vehicles.length - enriched.filter(p => p.online).length,
  }), [vehicles, enriched]);

  return (
    <div className="animate-fade-in flex h-[calc(100vh-3rem)] -m-6">
      {/* Sidebar */}
      <div className="w-80 flex flex-col border-r border-border bg-card overflow-hidden">
        <div className="p-4 border-b border-border space-y-3">
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Mapa da Frota
          </h1>

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-1 text-center">
            <button onClick={() => setStatusFilter('all')} className={`rounded-md p-1.5 text-xs transition-colors ${statusFilter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'}`}>
              <div className="font-bold text-sm">{stats.total}</div>
              <div>Total</div>
            </button>
            <button onClick={() => setStatusFilter('online')} className={`rounded-md p-1.5 text-xs transition-colors ${statusFilter === 'online' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'}`}>
              <div className="font-bold text-sm text-success">{stats.online}</div>
              <div>Online</div>
            </button>
            <button onClick={() => setStatusFilter('moving')} className={`rounded-md p-1.5 text-xs transition-colors ${statusFilter === 'moving' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'}`}>
              <div className="font-bold text-sm text-success">{stats.moving}</div>
              <div>Mov.</div>
            </button>
            <button onClick={() => setStatusFilter('offline')} className={`rounded-md p-1.5 text-xs transition-colors ${statusFilter === 'offline' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'}`}>
              <div className="font-bold text-sm text-destructive">{stats.offline}</div>
              <div>Offline</div>
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar placa ou apelido..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>

          <Button variant="outline" size="sm" className="w-full" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" /> Recarregar do banco
          </Button>
          {isAdmin && accounts.length > 0 && (
            <Button variant="default" size="sm" className="w-full" onClick={() => pollMutation.mutate()} disabled={pollMutation.isPending}>
              <Radio className={`h-4 w-4 mr-2 ${pollMutation.isPending ? 'animate-spin' : ''}`} /> Coletar da SSX agora
            </Button>
          )}
        </div>

        {/* Vehicle list */}
        <div className="flex-1 overflow-y-auto">
          {posLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Carregando posições...</div>
          ) : filtered.length === 0 && vehiclesWithoutPosition.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              Nenhum veículo com posição registrada.
              {vehicles.length === 0 && ' Cadastre veículos e vincule rastreadores.'}
            </div>
          ) : (
            <>
              {filtered.map(p => (
                <button
                  key={p.vehicle_id}
                  onClick={() => navigate(`/vehicles/${p.vehicle_id}`)}
                  className="w-full text-left px-4 py-3 border-b border-border hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${p.online ? (p.moving ? 'bg-success' : 'bg-warning') : 'bg-muted-foreground'}`} />
                      <span className="font-medium text-sm text-foreground">{p.vehicle?.plate}</span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {p.online ? (p.moving ? 'Movendo' : 'Parado') : 'Offline'}
                    </Badge>
                  </div>
                  {p.vehicle?.nickname && (
                    <p className="text-xs text-muted-foreground mt-0.5 ml-5">{p.vehicle.nickname}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1 ml-5 text-xs text-muted-foreground">
                    {p.speed != null && (
                      <span className="flex items-center gap-1">
                        <Gauge className="h-3 w-3" /> {Math.round(p.speed)} km/h
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(p.captured_at), { addSuffix: true, locale: ptBR })}
                    </span>
                  </div>
                </button>
              ))}
              {vehiclesWithoutPosition.map(v => (
                <button
                  key={v.id}
                  onClick={() => navigate(`/vehicles/${v.id}`)}
                  className="w-full text-left px-4 py-3 border-b border-border hover:bg-accent/50 transition-colors opacity-60"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/30" />
                    <span className="font-medium text-sm text-foreground">{v.plate}</span>
                    <Badge variant="outline" className="text-[10px] ml-auto">Sem posição</Badge>
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <MapContainer
          center={[-14.235, -51.925]}
          zoom={4}
          className="h-full w-full z-0"
          zoomControl={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds positions={filtered} />
          {filtered.map(p => (
            <Marker
              key={p.vehicle_id}
              position={[p.lat, p.lng]}
              icon={createVehicleIcon(p.online, p.moving)}
            >
              <Popup>
                <div className="min-w-[180px]">
                  <p className="font-bold text-sm">{p.vehicle?.plate}</p>
                  {p.vehicle?.nickname && <p className="text-xs text-gray-500">{p.vehicle.nickname}</p>}
                  <div className="mt-2 space-y-1 text-xs">
                    <p>Status: <strong>{p.online ? (p.moving ? 'Em movimento' : 'Parado') : 'Offline'}</strong></p>
                    {p.speed != null && <p>Velocidade: <strong>{Math.round(p.speed)} km/h</strong></p>}
                    {p.heading != null && <p>Direção: {Math.round(p.heading)}°</p>}
                    <p>Atualizado: {formatDistanceToNow(new Date(p.captured_at), { addSuffix: true, locale: ptBR })}</p>
                  </div>
                  <button
                    onClick={() => navigate(`/vehicles/${p.vehicle_id}`)}
                    className="mt-2 text-xs text-blue-600 hover:underline flex items-center gap-1"
                  >
                    <Eye className="h-3 w-3" /> Ver detalhes
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
