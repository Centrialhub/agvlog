import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useVehicleHistory, PositionRaw } from '@/hooks/usePositions';
import { MapContainer, TileLayer, Marker, Polyline, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, MapPin, Clock, Gauge, Navigation, Activity, AlertTriangle, Info } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// Fix Leaflet icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

export default function VehicleDetails() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const navigate = useNavigate();
  const { currentTenant } = useTenant();

  // Fetch vehicle
  const { data: vehicle } = useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('id', vehicleId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!vehicleId,
  });

  // Fetch current position
  const { data: positionLast } = useQuery({
    queryKey: ['position_last', currentTenant?.id, vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('positions_last')
        .select('*')
        .eq('tenant_id', currentTenant!.id)
        .eq('vehicle_id', vehicleId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant && !!vehicleId,
    refetchInterval: 30000,
  });

  // History date range
  const today = new Date().toISOString().split('T')[0];
  const [historyDate, setHistoryDate] = useState(today);
  const startDate = `${historyDate}T00:00:00Z`;
  const endDate = `${historyDate}T23:59:59Z`;
  const { data: history = [], isLoading: historyLoading } = useVehicleHistory(vehicleId || null, startDate, endDate);

  const isOnline = positionLast
    ? Date.now() - new Date(positionLast.captured_at).getTime() < 10 * 60 * 1000
    : false;
  const isMoving = positionLast?.speed != null && positionLast.speed > 2;

  const historyPath = useMemo(() => {
    return history.map((p: PositionRaw) => [p.lat, p.lng] as [number, number]);
  }, [history]);

  // Telemetry snapshot
  const telemetry = positionLast?.telemetry_snapshot as Record<string, any> | null;

  return (
    <div className="animate-fade-in space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            {vehicle?.plate || '...'}
            {vehicle?.nickname && <span className="text-sm font-normal text-muted-foreground">({vehicle.nickname})</span>}
          </h1>
          <div className="flex items-center gap-2 mt-0.5">
            {positionLast ? (
              <>
                <Badge variant={isOnline ? (isMoving ? 'default' : 'secondary') : 'destructive'}>
                  {isOnline ? (isMoving ? 'Em movimento' : 'Parado') : 'Offline'}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Atualizado {formatDistanceToNow(new Date(positionLast.captured_at), { addSuffix: true, locale: ptBR })}
                </span>
              </>
            ) : (
              <Badge variant="outline">Sem posição registrada</Badge>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="telemetry">Telemetria</TabsTrigger>
        </TabsList>

        {/* Overview tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Info cards */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-primary" /> Localização
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-2">
                  {positionLast ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Latitude</span>
                        <span className="font-mono">{positionLast.lat.toFixed(6)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Longitude</span>
                        <span className="font-mono">{positionLast.lng.toFixed(6)}</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-muted-foreground text-xs flex items-center gap-1">
                      <Info className="h-3 w-3" /> Indisponível para este veículo
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Gauge className="h-4 w-4 text-primary" /> Velocidade
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  {positionLast?.speed != null ? (
                    <div className="text-3xl font-bold text-foreground">
                      {Math.round(positionLast.speed)} <span className="text-sm font-normal text-muted-foreground">km/h</span>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-xs flex items-center gap-1">
                      <Info className="h-3 w-3" /> Indisponível para este veículo
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Navigation className="h-4 w-4 text-primary" /> Direção
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  {positionLast?.heading != null ? (
                    <div className="text-xl font-bold text-foreground">
                      {Math.round(positionLast.heading)}°
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-xs flex items-center gap-1">
                      <Info className="h-3 w-3" /> Indisponível para este veículo
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" /> Última Atualização
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  {positionLast ? (
                    <div>
                      <p className="font-medium">{format(new Date(positionLast.captured_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(positionLast.captured_at), { addSuffix: true, locale: ptBR })}
                      </p>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-xs">Sem dados</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Map */}
            <div className="lg:col-span-2">
              <Card className="h-[500px] overflow-hidden">
                <MapContainer
                  center={positionLast ? [positionLast.lat, positionLast.lng] : [-14.235, -51.925]}
                  zoom={positionLast ? 15 : 4}
                  className="h-full w-full z-0"
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  {positionLast && (
                    <Marker position={[positionLast.lat, positionLast.lng]}>
                      <Popup>
                        <strong>{vehicle?.plate}</strong>
                        <br />
                        {positionLast.speed != null && `${Math.round(positionLast.speed)} km/h`}
                      </Popup>
                    </Marker>
                  )}
                </MapContainer>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Timeline tab */}
        <TabsContent value="timeline" className="space-y-4">
          <div className="flex items-center gap-4">
            <Input
              type="date"
              value={historyDate}
              onChange={e => setHistoryDate(e.target.value)}
              className="w-48"
            />
            <span className="text-sm text-muted-foreground">
              {historyLoading ? 'Carregando...' : `${history.length} pontos encontrados`}
            </span>
          </div>

          <Card className="h-[500px] overflow-hidden">
            <MapContainer
              center={
                history.length > 0
                  ? [history[0].lat, history[0].lng]
                  : positionLast
                    ? [positionLast.lat, positionLast.lng]
                    : [-14.235, -51.925]
              }
              zoom={history.length > 0 ? 13 : 4}
              className="h-full w-full z-0"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {historyPath.length > 1 && (
                <Polyline positions={historyPath} color="#3b82f6" weight={3} opacity={0.8} />
              )}
              {history.length > 0 && (
                <>
                  <Marker position={[history[0].lat, history[0].lng]}>
                    <Popup>
                      <strong>Início</strong><br />
                      {format(new Date(history[0].captured_at), "HH:mm:ss", { locale: ptBR })}
                    </Popup>
                  </Marker>
                  <Marker position={[history[history.length - 1].lat, history[history.length - 1].lng]}>
                    <Popup>
                      <strong>Fim</strong><br />
                      {format(new Date(history[history.length - 1].captured_at), "HH:mm:ss", { locale: ptBR })}
                    </Popup>
                  </Marker>
                </>
              )}
            </MapContainer>
          </Card>

          {/* Speed chart placeholder */}
          {history.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Velocidade ao longo do dia</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>Pontos: {history.length}</span>
                  {history.some(p => p.speed != null) && (
                    <>
                      <span>Máx: {Math.round(Math.max(...history.filter(p => p.speed != null).map(p => p.speed!)))} km/h</span>
                      <span>Méd: {Math.round(history.filter(p => p.speed != null).reduce((s, p) => s + p.speed!, 0) / history.filter(p => p.speed != null).length)} km/h</span>
                    </>
                  )}
                  {!history.some(p => p.speed != null) && (
                    <span className="flex items-center gap-1"><Info className="h-3 w-3" /> Velocidade indisponível — estimada via GPS</span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Telemetry tab */}
        <TabsContent value="telemetry" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" /> Snapshot de Telemetria
              </CardTitle>
            </CardHeader>
            <CardContent>
              {telemetry && Object.keys(telemetry).length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {Object.entries(telemetry).map(([key, val]) => (
                    <div key={key} className="rounded-lg border border-border p-3">
                      <p className="text-xs text-muted-foreground font-mono">{key}</p>
                      <p className="text-sm font-medium text-foreground mt-1">{String(val)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Nenhuma telemetria adicional disponível para este veículo.
                  Os dados exibidos na aba "Visão Geral" (posição, velocidade, direção) são os dados básicos disponíveis.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
