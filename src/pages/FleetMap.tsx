import { useState, useMemo, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useFleetPositions, PositionLast } from '@/hooks/usePositions';
import { useVehicles, Vehicle } from '@/hooks/useVehicles';
import { useTenant } from '@/hooks/useTenant';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Search, MapPin, Clock, Gauge, RefreshCw, Eye, Radio, Activity, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useIsAdmin } from '@/hooks/useTenant';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ptBR } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';

// Fix Leaflet default icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const ONLINE_THRESHOLD_MS = 15 * 60 * 1000;   // 15 min
const OFFLINE_RECENT_THRESHOLD_MS = 3 * 60 * 60 * 1000; // 3 h

type VehicleStatus = 'moving' | 'stopped' | 'offline_recent' | 'stale' | 'no_position';

function parseTimestamp(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const ms = new Date(ts).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function getFreshnessTimestamp(capturedAt: string | null, receivedAt: string | null): number | null {
  const capturedMs = parseTimestamp(capturedAt);
  const receivedMs = parseTimestamp(receivedAt);
  if (capturedMs == null && receivedMs == null) return null;
  if (capturedMs == null) return receivedMs;
  if (receivedMs == null) return capturedMs;
  return Math.max(capturedMs, receivedMs);
}

function getVehicleStatus(capturedAt: string | null, receivedAt: string | null, speed: number | null): VehicleStatus {
  const freshTs = getFreshnessTimestamp(capturedAt, receivedAt);
  if (freshTs == null) return 'no_position';
  const age = Date.now() - freshTs;
  if (age > OFFLINE_RECENT_THRESHOLD_MS) return 'stale';
  if (age > ONLINE_THRESHOLD_MS) return 'offline_recent';
  return speed != null && speed > 2 ? 'moving' : 'stopped';
}

function statusColor(status: VehicleStatus): string {
  switch (status) {
    case 'moving': return '#22c55e';
    case 'stopped': return '#f59e0b';
    case 'offline_recent': return '#94a3b8';
    case 'stale': return '#64748b';
    case 'no_position': return '#cbd5e1';
  }
}

function statusLabel(status: VehicleStatus): string {
  switch (status) {
    case 'moving': return 'Movendo';
    case 'stopped': return 'Parado';
    case 'offline_recent': return 'Offline';
    case 'stale': return 'Posição antiga';
    case 'no_position': return 'Sem posição';
  }
}

function statusBadgeClasses(status: VehicleStatus): string {
  switch (status) {
    case 'moving': return 'bg-success/10 text-success border-success/30';
    case 'stopped': return 'bg-warning/10 text-warning border-warning/30';
    case 'offline_recent': return 'bg-muted text-muted-foreground';
    case 'stale': return 'bg-destructive/10 text-destructive border-destructive/30';
    case 'no_position': return 'bg-muted/50 text-muted-foreground/50';
  }
}

function statusDotClass(status: VehicleStatus): string {
  switch (status) {
    case 'moving': return 'bg-success';
    case 'stopped': return 'bg-warning';
    case 'offline_recent': return 'bg-muted-foreground';
    case 'stale': return 'bg-destructive/60';
    case 'no_position': return 'bg-muted-foreground/30';
  }
}

function createVehicleIcon(status: VehicleStatus) {
  const color = statusColor(status);
  const opacity = status === 'stale' || status === 'no_position' ? '0.6' : '1';
  return L.divIcon({
    className: 'custom-vehicle-marker',
    html: `<div style="
      width: 32px; height: 32px; border-radius: 50%;
      background: ${color}; border: 3px solid white;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      display: flex; align-items: center; justify-content: center;
      opacity: ${opacity};
    "><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
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

/** Returns human-readable age description with freshness context */
function ageDescription(capturedAt: string, receivedAt?: string | null): string {
  const capturedMs = Date.now() - new Date(capturedAt).getTime();
  const freshnessTs = getFreshnessTimestamp(capturedAt, receivedAt ?? null);
  const freshMs = freshnessTs == null ? capturedMs : Date.now() - freshnessTs;

  const toLabel = (ageMs: number) => {
    const min = Math.floor(ageMs / 60000);
    const hours = Math.floor(min / 60);
    const days = Math.floor(hours / 24);
    if (min < 1) return 'agora';
    if (min < 60) return `${min} min`;
    if (hours < 24) return `${hours} h`;
    return `${days} dia${days > 1 ? 's' : ''}`;
  };

  const freshLabel = freshMs < 1 ? 'Último sinal agora' : `Último sinal há ${toLabel(freshMs)}`;

  // If provider keeps returning old GPS with fresh polling, show both contexts.
  if (capturedMs - freshMs > 30 * 60000) {
    return `${freshLabel} · GPS há ${toLabel(capturedMs)}`;
  }

  return freshLabel;
}

/** Pipeline health summary component */
function PipelineHealthBanner({ tenantId }: { tenantId: string }) {
  const { data: tenant } = useQuery({
    queryKey: ['tenant_health', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('tenants').select('settings').eq('id', tenantId).single();
      return (data?.settings as any)?.pipeline_health || null;
    },
    enabled: !!tenantId,
    refetchInterval: 60000,
  });

  if (!tenant) return null;

  const lastRun = tenant.last_run_at ? new Date(tenant.last_run_at) : null;
  const lastSuccess = tenant.last_successful_poll_at ? new Date(tenant.last_successful_poll_at) : null;
  const lastRateLimit = tenant.last_rate_limit_at ? new Date(tenant.last_rate_limit_at) : null;
  const lastPersistenceErr = tenant.last_persistence_failure_at ? new Date(tenant.last_persistence_failure_at) : null;

  const isHealthy = lastSuccess && (Date.now() - lastSuccess.getTime()) < 15 * 60 * 1000;
  const isStale = lastSuccess && (Date.now() - lastSuccess.getTime()) > 30 * 60 * 1000;
  const hasRecentRateLimit = lastRateLimit && (Date.now() - lastRateLimit.getTime()) < 30 * 60 * 1000;
  const hasRecentPersistErr = lastPersistenceErr && (Date.now() - lastPersistenceErr.getTime()) < 60 * 60 * 1000;

  return (
    <div className={`px-3 py-1.5 text-xs flex items-center gap-3 border-b border-border ${
      hasRecentPersistErr ? 'bg-destructive/10 text-destructive' :
      hasRecentRateLimit ? 'bg-warning/10 text-warning' :
      isHealthy ? 'bg-success/5 text-muted-foreground' :
      isStale ? 'bg-warning/5 text-warning' :
      'bg-muted/50 text-muted-foreground'
    }`}>
      {hasRecentPersistErr ? (
        <><XCircle className="h-3.5 w-3.5" /> Erro de persistência recente</>
      ) : hasRecentRateLimit ? (
        <><AlertTriangle className="h-3.5 w-3.5" /> Rate limit SSX recente</>
      ) : isHealthy ? (
        <><CheckCircle className="h-3.5 w-3.5" /> Pipeline ativo</>
      ) : isStale ? (
        <><AlertTriangle className="h-3.5 w-3.5" /> Pipeline sem dados recentes</>
      ) : (
        <><Activity className="h-3.5 w-3.5" /> Aguardando dados</>
      )}
      {lastRun && (
        <span className="ml-auto opacity-70">
          Último poll: {formatDistanceToNow(lastRun, { addSuffix: true, locale: ptBR })}
        </span>
      )}
    </div>
  );
}

export default function FleetMap() {
  const { currentTenant } = useTenant();
  const { data: positions = [], isLoading: posLoading, refetch } = useFleetPositions();
  const { data: vehicles = [] } = useVehicles();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline' | 'stale' | 'no_position'>('all');
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const queryClient = useQueryClient();

  const { data: accounts = [] } = useQuery({
    queryKey: ['integration_accounts_brief', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase.from('integration_accounts').select('id, status').eq('tenant_id', currentTenant.id);
      return data || [];
    },
    enabled: !!currentTenant && isAdmin,
  });

  // Manual collection = diagnostic tool only (force_rediscovery, wider lookback)
  const pollMutation = useMutation({
    mutationFn: async () => {
      for (const acc of accounts) {
        await supabase.functions.invoke('agvlog-pipeline-run', {
          body: {
            tenant_id: currentTenant?.id,
            integration_account_id: acc.id,
            pipeline_mode: 'manual',
            manual_run: true,
            force_rediscovery: true,
            lookback_minutes: 43200,
          },
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['positions_last'] });
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['provider_units'] });
      queryClient.invalidateQueries({ queryKey: ['tenant_health'] });
      refetch();
    },
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
      status: getVehicleStatus(p.captured_at, p.received_at, p.speed),
    }));
  }, [positions, vehicleMap]);

  const filtered = useMemo(() => {
    return enriched.filter(p => {
      const v = p.vehicle;
      if (!v) return false;
      const q = search.toLowerCase();
      if (q && !v.plate.toLowerCase().includes(q) && !(v.nickname || '').toLowerCase().includes(q)) return false;
      if (statusFilter === 'online' && p.status !== 'moving' && p.status !== 'stopped') return false;
      if (statusFilter === 'offline' && p.status !== 'offline_recent' && p.status !== 'stale') return false;
      if (statusFilter === 'stale' && p.status !== 'stale') return false;
      return true;
    });
  }, [enriched, search, statusFilter]);

  const vehiclesWithoutPosition = useMemo(() => {
    const withPos = new Set(positions.map(p => p.vehicle_id));
    return vehicles.filter(v => !withPos.has(v.id));
  }, [vehicles, positions]);

  const filteredNoPos = useMemo(() => {
    if (statusFilter !== 'all' && statusFilter !== 'no_position') return [];
    const q = search.toLowerCase();
    return vehiclesWithoutPosition.filter(v => {
      if (!q) return true;
      return v.plate.toLowerCase().includes(q) || (v.nickname || '').toLowerCase().includes(q);
    });
  }, [vehiclesWithoutPosition, search, statusFilter]);

  const stats = useMemo(() => {
    const online = enriched.filter(p => p.status === 'moving' || p.status === 'stopped').length;
    const offlineRecent = enriched.filter(p => p.status === 'offline_recent').length;
    const stale = enriched.filter(p => p.status === 'stale').length;
    return {
      total: vehicles.length,
      online,
      offline: offlineRecent + stale,
      stale,
      noPos: vehiclesWithoutPosition.length,
    };
  }, [vehicles, enriched, vehiclesWithoutPosition]);

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
            <button onClick={() => setStatusFilter('offline')} className={`rounded-md p-1.5 text-xs transition-colors ${statusFilter === 'offline' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'}`}>
              <div className="font-bold text-sm text-destructive">{stats.offline}</div>
              <div>Offline</div>
            </button>
            <button onClick={() => setStatusFilter('no_position')} className={`rounded-md p-1.5 text-xs transition-colors ${statusFilter === 'no_position' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'}`}>
              <div className="font-bold text-sm text-muted-foreground">{stats.noPos}</div>
              <div>S/ pos.</div>
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
            <Button variant="secondary" size="sm" className="w-full" onClick={() => pollMutation.mutate()} disabled={pollMutation.isPending}>
              <Radio className={`h-4 w-4 mr-2 ${pollMutation.isPending ? 'animate-spin' : ''}`} />
              {pollMutation.isPending ? 'Coletando...' : 'Diagnóstico SSX (manual)'}
            </Button>
          )}
        </div>

        {/* Pipeline health banner */}
        {currentTenant && isAdmin && (
          <PipelineHealthBanner tenantId={currentTenant.id} />
        )}

        {/* Vehicle list */}
        <div className="flex-1 overflow-y-auto">
          {posLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Carregando posições...</div>
          ) : filtered.length === 0 && filteredNoPos.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              Nenhum veículo encontrado.
              {vehicles.length === 0 && ' Cadastre veículos e vincule rastreadores.'}
            </div>
          ) : (
            <>
              {filtered.map(p => (
                <button
                  key={p.vehicle_id}
                  onClick={() => navigate(`/vehicles/${p.vehicle_id}`)}
                  className={`w-full text-left px-4 py-3 border-b border-border hover:bg-accent/50 transition-colors ${p.status === 'stale' ? 'opacity-70' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${statusDotClass(p.status)}`} />
                      <span className="font-medium text-sm text-foreground">{p.vehicle?.plate}</span>
                    </div>
                    <Badge variant="outline" className={`text-[10px] ${statusBadgeClasses(p.status)}`}>
                      {statusLabel(p.status)}
                    </Badge>
                  </div>
                  {p.vehicle?.nickname && (
                    <p className="text-xs text-muted-foreground mt-0.5 ml-5">{p.vehicle.nickname}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1 ml-5 text-xs text-muted-foreground">
                    {p.speed != null && p.status === 'moving' && (
                      <span className="flex items-center gap-1">
                        <Gauge className="h-3 w-3" /> {Math.round(p.speed)} km/h
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {ageDescription(p.captured_at, p.received_at)}
                    </span>
                  </div>
                </button>
              ))}
              {filteredNoPos.map(v => (
                <button
                  key={v.id}
                  onClick={() => navigate(`/vehicles/${v.id}`)}
                  className="w-full text-left px-4 py-3 border-b border-border hover:bg-accent/50 transition-colors opacity-50"
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${statusDotClass('no_position')}`} />
                    <span className="font-medium text-sm text-foreground">{v.plate}</span>
                    <Badge variant="outline" className={`text-[10px] ml-auto ${statusBadgeClasses('no_position')}`}>
                      Sem posição
                    </Badge>
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
              icon={createVehicleIcon(p.status)}
            >
              <Popup>
                <div className="min-w-[180px]">
                  <p className="font-bold text-sm">{p.vehicle?.plate}</p>
                  {p.vehicle?.nickname && <p className="text-xs text-gray-500">{p.vehicle.nickname}</p>}
                  <div className="mt-2 space-y-1 text-xs">
                    <p>Status: <strong>{statusLabel(p.status)}</strong></p>
                    {p.speed != null && <p>Velocidade: <strong>{Math.round(p.speed)} km/h</strong></p>}
                    {p.heading != null && <p>Direção: {Math.round(p.heading)}°</p>}
                    <p>{ageDescription(p.captured_at, p.received_at)}</p>
                    {p.status === 'stale' && (
                      <p className="text-red-500 font-medium">⚠ Posição muito antiga — dados podem estar desatualizados</p>
                    )}
                    {p.status === 'offline_recent' && (
                      <p className="text-amber-500 font-medium">Veículo offline recente</p>
                    )}
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
