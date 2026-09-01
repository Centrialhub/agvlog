import { useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MapAutoFit } from '@/components/maps/MapAutoFit';
import { createTruckMarkerIcon, DEFAULT_BRAZIL_MAP_CENTER } from '@/lib/maps/leaflet';
import { useFleetPositions } from '@/hooks/usePositions';
import { useVehicles } from '@/hooks/useVehicles';
import { useFleetState, VehicleState, MovementState, stateLabel, stateColor, stateBadgeClasses, stateDotClass, formatStoppedDuration } from '@/hooks/useVehiclesState';
import { useTenant, useIsAdmin } from '@/hooks/useTenant';
import { useTenantCapabilities } from '@/hooks/useTenantCapabilities';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Search, MapPin, Clock, Gauge, RefreshCw, Eye, Radio, Activity, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ptBR } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { resolvePositionTelemetry } from '@/lib/positionTelemetry';

interface PipelineHealth {
  last_run_at?: string;
  last_successful_poll_at?: string;
  last_rate_limit_at?: string;
  last_persistence_failure_at?: string;
  consecutive_failures?: number;
}

function createVehicleIcon(state: MovementState) {
  const color = stateColor(state);
  return createTruckMarkerIcon({
    color,
    opacity: state === 'offline' || state === 'unknown' ? 0.6 : 1,
    className: 'custom-vehicle-marker',
  });
}

/** Pipeline health summary component */
function PipelineHealthBanner({ tenantId }: { tenantId: string }) {
  const { data: tenant } = useQuery({
    queryKey: ['tenant_health', tenantId],
    queryFn: async () => {
      const { data } = await supabase.from('tenants').select('settings').eq('id', tenantId).single();
      const settings = data?.settings;
      if (!settings || Array.isArray(settings) || typeof settings !== 'object') return null;
      const health = (settings as Record<string, unknown>).pipeline_health;
      if (!health || Array.isArray(health) || typeof health !== 'object') return null;
      return health as PipelineHealth;
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
  const { isEnabled } = useTenantCapabilities();
  const ssxEnabled = isEnabled('ssx');
  const { data: positions = [], isLoading: posLoading, refetch } = useFleetPositions();
  const { data: vehicles = [] } = useVehicles();
  const { data: vehicleStates = [] } = useFleetState();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline' | 'unknown'>('all');
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
    enabled: !!currentTenant && isAdmin && ssxEnabled,
  });

  const pollMutation = useMutation({
    mutationFn: async () => {
      if (!ssxEnabled) throw new Error('Integração SSX em implantação');
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
      queryClient.invalidateQueries({ queryKey: ['vehicles_state'] });
      queryClient.invalidateQueries({ queryKey: ['tenant_health'] });
      refetch();
    },
  });

  // Build state map from vehicles_state table
  const stateMap = useMemo(() => {
    const map: Record<string, VehicleState> = {};
    for (const s of vehicleStates) map[s.vehicle_id] = s;
    return map;
  }, [vehicleStates]);
  const positionMap = useMemo(
    () => new Map(positions.map((position) => [position.vehicle_id, position])),
    [positions],
  );

  // Enrich vehicles: combine vehicle info + state + position
  const enriched = useMemo(() => {
    return vehicles.map(v => {
      const state = stateMap[v.id];
      const pos = positionMap.get(v.id);
      const telemetry = resolvePositionTelemetry(pos, state);
      return {
        vehicle: v,
        state: telemetry.movementState,
        speed: telemetry.speed,
        stoppedDuration: telemetry.movementState === 'stopped' || telemetry.movementState === 'idle'
          ? state?.stopped_duration_seconds ?? 0
          : 0,
        lastPositionAt: telemetry.capturedAt,
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
        heading: pos?.heading ?? null,
      };
    });
  }, [vehicles, stateMap, positionMap]);

  const filtered = useMemo(() => {
    return enriched.filter(e => {
      const q = search.toLowerCase();
      if (q && !e.vehicle.plate.toLowerCase().includes(q) && !(e.vehicle.nickname || '').toLowerCase().includes(q)) return false;
      if (statusFilter === 'online' && e.state !== 'moving' && e.state !== 'stopped' && e.state !== 'idle') return false;
      if (statusFilter === 'offline' && e.state !== 'offline') return false;
      if (statusFilter === 'unknown' && e.state !== 'unknown') return false;
      return true;
    });
  }, [enriched, search, statusFilter]);

  const withPosition = useMemo(() => filtered.filter(e => e.lat != null && e.lng != null), [filtered]);
  const mapPoints = useMemo<[number, number][]>(
    () => withPosition.map((entry) => [entry.lat as number, entry.lng as number]),
    [withPosition],
  );

  const stats = useMemo(() => {
    const online = enriched.filter(e => e.state === 'moving' || e.state === 'stopped' || e.state === 'idle').length;
    const offline = enriched.filter(e => e.state === 'offline').length;
    const unknown = enriched.filter(e => e.state === 'unknown').length;
    return { total: vehicles.length, online, offline, unknown };
  }, [vehicles, enriched]);

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
            <button onClick={() => setStatusFilter('unknown')} className={`rounded-md p-1.5 text-xs transition-colors ${statusFilter === 'unknown' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'}`}>
              <div className="font-bold text-sm text-muted-foreground">{stats.unknown}</div>
              <div>S/ dados</div>
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

          <Button variant="outline" size="sm" className="w-full" onClick={() => { refetch(); queryClient.invalidateQueries({ queryKey: ['vehicles_state'] }); }}>
            <RefreshCw className="h-4 w-4 mr-2" /> Recarregar
          </Button>
          {isAdmin && ssxEnabled && accounts.length > 0 && (
            <Button variant="secondary" size="sm" className="w-full" onClick={() => pollMutation.mutate()} disabled={pollMutation.isPending}>
              <Radio className={`h-4 w-4 mr-2 ${pollMutation.isPending ? 'animate-spin' : ''}`} />
              {pollMutation.isPending ? 'Coletando...' : 'Diagnóstico SSX (manual)'}
            </Button>
          )}
        </div>

        {currentTenant && isAdmin && ssxEnabled && <PipelineHealthBanner tenantId={currentTenant.id} />}

        {/* Vehicle list */}
        <div className="flex-1 overflow-y-auto">
          {posLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Carregando...</div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              Nenhum veículo encontrado.
              {vehicles.length === 0 && ' Cadastre veículos e vincule rastreadores.'}
            </div>
          ) : (
            filtered.map(e => (
              <button
                key={e.vehicle.id}
                onClick={() => navigate(`/vehicles/${e.vehicle.id}`)}
                className={`w-full text-left px-4 py-3 border-b border-border hover:bg-accent/50 transition-colors ${e.state === 'offline' || e.state === 'unknown' ? 'opacity-70' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${stateDotClass(e.state)}`} />
                    <span className="font-medium text-sm text-foreground">{e.vehicle.plate}</span>
                  </div>
                  <Badge variant="outline" className={`text-[10px] ${stateBadgeClasses(e.state)}`}>
                    {stateLabel(e.state)}
                  </Badge>
                </div>
                {e.vehicle.nickname && (
                  <p className="text-xs text-muted-foreground mt-0.5 ml-5">{e.vehicle.nickname}</p>
                )}
                <div className="flex items-center gap-3 mt-1 ml-5 text-xs text-muted-foreground">
                  {e.state === 'moving' && e.speed != null && (
                    <span className="flex items-center gap-1">
                      <Gauge className="h-3 w-3" /> {Math.round(e.speed)} km/h
                    </span>
                  )}
                  {(e.state === 'stopped' || e.state === 'idle') && e.stoppedDuration > 0 && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> Parado há {formatStoppedDuration(e.stoppedDuration)}
                    </span>
                  )}
                  {e.lastPositionAt && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(e.lastPositionAt), { addSuffix: true, locale: ptBR })}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <MapContainer
          center={mapPoints[0] ?? DEFAULT_BRAZIL_MAP_CENTER}
          zoom={4}
          className="h-full w-full z-0"
          zoomControl={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapAutoFit points={mapPoints} padding={50} maxZoom={14} />
          {withPosition.map(e => (
            <Marker
              key={e.vehicle.id}
              position={[e.lat!, e.lng!]}
              icon={createVehicleIcon(e.state)}
            >
              <Popup>
                <div className="min-w-[180px]">
                  <p className="font-bold text-sm">{e.vehicle.plate}</p>
                  {e.vehicle.nickname && <p className="text-xs text-gray-500">{e.vehicle.nickname}</p>}
                  <div className="mt-2 space-y-1 text-xs">
                    <p>Status: <strong>{stateLabel(e.state)}</strong></p>
                    <p>Velocidade: <strong>{e.speed != null ? `${Math.round(e.speed)} km/h` : 'indisponível'}</strong></p>
                    {e.heading != null && <p>Direção: {Math.round(e.heading)}°</p>}
                    {(e.state === 'stopped' || e.state === 'idle') && e.stoppedDuration > 0 && (
                      <p>Parado há: <strong>{formatStoppedDuration(e.stoppedDuration)}</strong></p>
                    )}
                    {e.lastPositionAt && (
                      <p>Última posição: {formatDistanceToNow(new Date(e.lastPositionAt), { addSuffix: true, locale: ptBR })}</p>
                    )}
                  </div>
                  <button
                    onClick={() => navigate(`/vehicles/${e.vehicle.id}`)}
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
