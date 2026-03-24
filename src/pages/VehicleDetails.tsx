import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useVehicleHistory, PositionRaw } from '@/hooks/usePositions';
import { useVehicleState, stateLabel, stateBadgeClasses, formatStoppedDuration } from '@/hooks/useVehiclesState';
import { MapContainer, TileLayer, Marker, Polyline, Popup, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  ArrowLeft, MapPin, Clock, Gauge, Navigation, Activity, AlertTriangle, Info,
  Route, StopCircle, Bell, Hexagon, Fuel, Zap, Moon, Save,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

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
  const queryClient = useQueryClient();

  const { data: vehicle } = useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select('*').eq('id', vehicleId!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!vehicleId,
  });

  const { data: capabilities } = useQuery({
    queryKey: ['vehicle_capabilities', vehicleId],
    queryFn: async () => {
      if (!currentTenant || !vehicleId) return null;
      const { data } = await supabase.from('vehicle_capabilities').select('capabilities')
        .eq('tenant_id', currentTenant.id).eq('vehicle_id', vehicleId).single();
      return (data?.capabilities as Record<string, boolean>) || {};
    },
    enabled: !!currentTenant && !!vehicleId,
  });

  const { data: vehicleState } = useVehicleState(vehicleId || null);

  const { data: positionLast } = useQuery({
    queryKey: ['position_last', currentTenant?.id, vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase.from('positions_last').select('*')
        .eq('tenant_id', currentTenant!.id).eq('vehicle_id', vehicleId!).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant && !!vehicleId,
    refetchInterval: 30000,
  });

  // Today metrics for overview KPIs
  const { data: todayMetrics } = useQuery({
    queryKey: ['vehicle_today_metrics', currentTenant?.id, vehicleId],
    queryFn: async () => {
      if (!currentTenant || !vehicleId) return null;
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase.from('metrics_daily').select('*')
        .eq('tenant_id', currentTenant.id).eq('vehicle_id', vehicleId).eq('day', today).maybeSingle();
      return data;
    },
    enabled: !!currentTenant && !!vehicleId,
  });

  const today = new Date().toISOString().split('T')[0];
  const [historyDate, setHistoryDate] = useState(today);
  const { data: history = [], isLoading: historyLoading } = useVehicleHistory(vehicleId || null, `${historyDate}T00:00:00Z`, `${historyDate}T23:59:59Z`);

  const { data: trips = [] } = useQuery({
    queryKey: ['vehicle_trips', currentTenant?.id, vehicleId, historyDate],
    queryFn: async () => {
      if (!currentTenant || !vehicleId) return [];
      const { data, error } = await supabase.from('trips').select('*')
        .eq('tenant_id', currentTenant.id).eq('vehicle_id', vehicleId)
        .gte('start_at', `${historyDate}T00:00:00Z`).lte('start_at', `${historyDate}T23:59:59Z`)
        .order('start_at');
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant && !!vehicleId,
  });

  const { data: stops = [] } = useQuery({
    queryKey: ['vehicle_stops', currentTenant?.id, vehicleId, historyDate],
    queryFn: async () => {
      if (!currentTenant || !vehicleId) return [];
      const { data, error } = await supabase.from('trip_stops').select('*, pois:poi_id(name)')
        .eq('tenant_id', currentTenant.id).eq('vehicle_id', vehicleId)
        .gte('start_at', `${historyDate}T00:00:00Z`).lte('start_at', `${historyDate}T23:59:59Z`)
        .order('start_at');
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant && !!vehicleId,
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['vehicle_alerts', currentTenant?.id, vehicleId],
    queryFn: async () => {
      if (!currentTenant || !vehicleId) return [];
      const { data, error } = await supabase.from('alert_instances').select('*, alert_rules(rule_type)')
        .eq('tenant_id', currentTenant.id).eq('vehicle_id', vehicleId)
        .order('opened_at', { ascending: false }).limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant && !!vehicleId,
  });

  const { data: geoEvents = [] } = useQuery({
    queryKey: ['vehicle_geo_events', currentTenant?.id, vehicleId],
    queryFn: async () => {
      if (!currentTenant || !vehicleId) return [];
      const { data, error } = await supabase.from('geofence_events').select('*, geofences(name)')
        .eq('tenant_id', currentTenant.id).eq('vehicle_id', vehicleId)
        .order('event_at', { ascending: false }).limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant && !!vehicleId,
  });

  const { data: overspeedEvents = [] } = useQuery({
    queryKey: ['vehicle_overspeed', currentTenant?.id, vehicleId, historyDate],
    queryFn: async () => {
      if (!currentTenant || !vehicleId) return [];
      const { data, error } = await supabase.from('events').select('*')
        .eq('tenant_id', currentTenant.id).eq('vehicle_id', vehicleId)
        .eq('event_type', 'overspeed').eq('source', 'engine')
        .gte('event_at', `${historyDate}T00:00:00Z`).lte('event_at', `${historyDate}T23:59:59Z`)
        .order('event_at');
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant && !!vehicleId,
  });

  const { data: fuelReadings = [] } = useQuery({
    queryKey: ['vehicle_fuel', currentTenant?.id, vehicleId, historyDate],
    queryFn: async () => {
      if (!currentTenant || !vehicleId) return [];
      const { data, error } = await supabase.from('fuel_readings').select('*')
        .eq('tenant_id', currentTenant.id).eq('vehicle_id', vehicleId)
        .gte('captured_at', `${historyDate}T00:00:00Z`).lte('captured_at', `${historyDate}T23:59:59Z`)
        .order('captured_at');
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant && !!vehicleId,
  });

  const { data: pois = [] } = useQuery({
    queryKey: ['pois', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('pois').select('id, name, category')
        .eq('tenant_id', currentTenant.id);
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  const movementState = vehicleState?.movement_state || 'unknown';
  const isOnline = movementState === 'moving' || movementState === 'stopped' || movementState === 'idle';
  const isMoving = movementState === 'moving';
  const historyPath = useMemo(() => history.map((p: PositionRaw) => [p.lat, p.lng] as [number, number]), [history]);
  const telemetry = positionLast?.telemetry_snapshot as Record<string, any> | null;
  const hasFuel = capabilities?.fuel === true;
  const hasSpeed = history.some(p => p.speed != null);

  const fmtHours = (s: number | null) => { if (!s) return '—'; return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`; };

  // Speed chart data
  const speedChartData = useMemo(() => {
    if (!hasSpeed) return [];
    return history
      .filter(p => p.speed != null)
      .map(p => ({
        time: format(new Date(p.captured_at), 'HH:mm'),
        speed: Math.round(p.speed!),
      }));
  }, [history, hasSpeed]);

  // Fuel chart data
  const fuelChartData = useMemo(() => {
    return (fuelReadings as any[]).map((r: any) => ({
      time: format(new Date(r.captured_at), 'HH:mm'),
      value: r.fuel_value,
    }));
  }, [fuelReadings]);

  // Save stop as POI
  const savePOIMutation = useMutation({
    mutationFn: async ({ lat, lng, name }: { lat: number; lng: number; name: string }) => {
      if (!currentTenant) throw new Error('No tenant');
      const dedupeKey = `${Math.round(lat * 1e4)}|${Math.round(lng * 1e4)}`;
      const { error } = await supabase.from('pois').upsert({
        tenant_id: currentTenant.id, lat, lng, name, category: 'manual', source: 'manual', dedupe_key: dedupeKey,
      }, { onConflict: 'tenant_id,dedupe_key' });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['pois'] }); toast.success('POI salvo'); },
    onError: (e: any) => toast.error(e.message),
  });

  const linkPOIMutation = useMutation({
    mutationFn: async ({ stopId, poiId }: { stopId: string; poiId: string }) => {
      const { error } = await supabase.from('trip_stops').update({ poi_id: poiId }).eq('id', stopId);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['vehicle_stops'] }); toast.success('POI vinculado'); },
    onError: (e: any) => toast.error(e.message),
  });

  const [poiDialogStop, setPoiDialogStop] = useState<any>(null);
  const [poiName, setPoiName] = useState('');
  const [linkPoiId, setLinkPoiId] = useState('');

  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="h-5 w-5" /></Button>
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            {vehicle?.plate || '...'} {vehicle?.nickname && <span className="text-sm font-normal text-muted-foreground">({vehicle.nickname})</span>}
          </h1>
          <div className="flex items-center gap-2 mt-0.5">
            {vehicleState ? (
              <>
                <Badge variant="outline" className={stateBadgeClasses(movementState as any)}>
                  {stateLabel(movementState as any)}
                </Badge>
                {vehicleState.speed > 0 && (
                  <span className="text-xs text-muted-foreground">{Math.round(vehicleState.speed)} km/h</span>
                )}
                {(movementState === 'stopped' || movementState === 'idle') && vehicleState.stopped_duration_seconds > 0 && (
                  <span className="text-xs text-muted-foreground">Parado há {formatStoppedDuration(vehicleState.stopped_duration_seconds)}</span>
                )}
                {vehicleState.last_position_at && (
                  <span className="text-xs text-muted-foreground">Atualizado {formatDistanceToNow(new Date(vehicleState.last_position_at), { addSuffix: true, locale: ptBR })}</span>
                )}
              </>
            ) : positionLast ? (
              <span className="text-xs text-muted-foreground">Atualizado {formatDistanceToNow(new Date(positionLast.captured_at), { addSuffix: true, locale: ptBR })}</span>
            ) : <Badge variant="outline">Sem posição registrada</Badge>}
          </div>
        </div>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="trips">Viagens ({trips.length})</TabsTrigger>
          <TabsTrigger value="stops">Paradas ({stops.length})</TabsTrigger>
          <TabsTrigger value="speed">Velocidade</TabsTrigger>
          <TabsTrigger value="fuel">Combustível</TabsTrigger>
          <TabsTrigger value="alerts">Alertas ({alerts.length})</TabsTrigger>
          <TabsTrigger value="geofences">Geofences ({geoEvents.length})</TabsTrigger>
          <TabsTrigger value="telemetry">Telemetria</TabsTrigger>
        </TabsList>

        {/* Overview with KPIs */}
        <TabsContent value="overview" className="space-y-4">
          {/* Today KPIs */}
          {todayMetrics && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <MiniKPI icon={<Route className="h-4 w-4" />} label="Km hoje" value={`${Math.round(todayMetrics.km_estimated || 0)} km`} />
              <MiniKPI icon={<MapPin className="h-4 w-4" />} label="Viagens" value={String(todayMetrics.trips_count || 0)} />
              <MiniKPI icon={<StopCircle className="h-4 w-4" />} label="Paradas" value={String(todayMetrics.stops_count || 0)} />
              <MiniKPI icon={<Activity className="h-4 w-4" />} label="Em mov." value={fmtHours(todayMetrics.moving_time_seconds)} />
              <MiniKPI icon={<Gauge className="h-4 w-4" />} label="Excesso vel." value={String(todayMetrics.overspeed_events || 0)} variant={todayMetrics.overspeed_events > 0 ? 'destructive' : undefined} />
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="space-y-4">
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" />Localização</CardTitle></CardHeader>
                <CardContent className="text-sm space-y-2">
                  {positionLast ? (<><div className="flex justify-between"><span className="text-muted-foreground">Lat</span><span className="font-mono">{positionLast.lat.toFixed(6)}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Lng</span><span className="font-mono">{positionLast.lng.toFixed(6)}</span></div></>) : <p className="text-muted-foreground text-xs"><Info className="h-3 w-3 inline mr-1" />Indisponível</p>}
                </CardContent>
              </Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Gauge className="h-4 w-4 text-primary" />Velocidade</CardTitle></CardHeader>
                <CardContent>{positionLast?.speed != null ? <div className="text-3xl font-bold text-foreground">{Math.round(positionLast.speed)} <span className="text-sm font-normal text-muted-foreground">km/h</span></div> : <p className="text-muted-foreground text-xs"><Info className="h-3 w-3 inline mr-1" />Indisponível</p>}</CardContent>
              </Card>
              <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4 text-primary" />Última Atualização</CardTitle></CardHeader>
                <CardContent className="text-sm">{positionLast ? <><p className="font-medium">{format(new Date(positionLast.captured_at), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}</p><p className="text-xs text-muted-foreground mt-1">{formatDistanceToNow(new Date(positionLast.captured_at), { addSuffix: true, locale: ptBR })}</p></> : <p className="text-muted-foreground text-xs">Sem dados</p>}</CardContent>
              </Card>
            </div>
            <div className="lg:col-span-2">
              <Card className="h-[500px] overflow-hidden">
                <MapContainer center={positionLast ? [positionLast.lat, positionLast.lng] : [-14.235, -51.925]} zoom={positionLast ? 15 : 4} className="h-full w-full z-0">
                  <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  {positionLast && <Marker position={[positionLast.lat, positionLast.lng]}><Popup><strong>{vehicle?.plate}</strong>{positionLast.speed != null && <br />}{positionLast.speed != null && `${Math.round(positionLast.speed)} km/h`}</Popup></Marker>}
                </MapContainer>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Timeline with stop markers */}
        <TabsContent value="timeline" className="space-y-4">
          <div className="flex items-center gap-4">
            <Input type="date" value={historyDate} onChange={e => setHistoryDate(e.target.value)} className="w-48" />
            <span className="text-sm text-muted-foreground">{historyLoading ? 'Carregando...' : `${history.length} pontos`}</span>
          </div>
          <Card className="h-[500px] overflow-hidden">
            <MapContainer center={history.length > 0 ? [history[0].lat, history[0].lng] : positionLast ? [positionLast.lat, positionLast.lng] : [-14.235, -51.925]} zoom={history.length > 0 ? 13 : 4} className="h-full w-full z-0">
              <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {historyPath.length > 1 && <Polyline positions={historyPath} color="hsl(215, 80%, 48%)" weight={3} opacity={0.8} />}
              {history.length > 0 && (<><Marker position={[history[0].lat, history[0].lng]}><Popup><strong>Início</strong><br />{format(new Date(history[0].captured_at), "HH:mm:ss")}</Popup></Marker><Marker position={[history[history.length - 1].lat, history[history.length - 1].lng]}><Popup><strong>Fim</strong><br />{format(new Date(history[history.length - 1].captured_at), "HH:mm:ss")}</Popup></Marker></>)}
              {/* Stop markers */}
              {(stops as any[]).map((s: any) => (
                <CircleMarker key={s.id} center={[s.lat, s.lng]} radius={8} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.7 }}>
                  <Popup><strong>Parada</strong><br />{format(new Date(s.start_at), 'HH:mm')} — {s.duration_seconds ? fmtHours(s.duration_seconds) : '?'}<br />{s.pois?.name || s.stop_class}</Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </Card>
          {hasSpeed && (
            <Card><CardContent className="py-3 flex gap-4 text-xs text-muted-foreground">
              <span>Pontos: {history.length}</span>
              <span>Máx: {Math.round(Math.max(...history.filter(p => p.speed != null).map(p => p.speed!)))} km/h</span>
              <span>Méd: {Math.round(history.filter(p => p.speed != null).reduce((s, p) => s + p.speed!, 0) / history.filter(p => p.speed != null).length)} km/h</span>
            </CardContent></Card>
          )}
          {history.length > 0 && !hasSpeed && (
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Info className="h-3 w-3" />Velocidade estimada via GPS no processamento</p>
          )}
        </TabsContent>

        {/* Trips */}
        <TabsContent value="trips" className="space-y-4">
          <div className="flex items-center gap-4">
            <Input type="date" value={historyDate} onChange={e => setHistoryDate(e.target.value)} className="w-48" />
          </div>
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Início</TableHead><TableHead>Fim</TableHead><TableHead>Km</TableHead><TableHead>Mov.</TableHead><TableHead>Parado</TableHead><TableHead>Modo</TableHead></TableRow></TableHeader>
              <TableBody>
                {trips.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhuma viagem detectada neste dia</TableCell></TableRow>
                ) : (trips as any[]).map((t: any) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs">{format(new Date(t.start_at), 'HH:mm')}</TableCell>
                    <TableCell className="text-xs">{t.end_at ? format(new Date(t.end_at), 'HH:mm') : '—'}</TableCell>
                    <TableCell>{t.distance_km_estimated ? `${t.distance_km_estimated.toFixed(1)} km` : '—'}</TableCell>
                    <TableCell className="text-xs">{fmtHours(t.moving_time_seconds)}</TableCell>
                    <TableCell className="text-xs">{fmtHours(t.stopped_time_seconds)}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{t.detection_mode}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Info className="h-3 w-3" />Estimado via GPS (modo básico). Maior precisão com ignição/odômetro.</p>
        </TabsContent>

        {/* Stops */}
        <TabsContent value="stops" className="space-y-4">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Início</TableHead><TableHead>Duração</TableHead><TableHead>Classe</TableHead><TableHead>POI</TableHead><TableHead>Localização</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {stops.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhuma parada detectada</TableCell></TableRow>
                ) : (stops as any[]).map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-xs">{format(new Date(s.start_at), 'HH:mm')}</TableCell>
                    <TableCell className="text-xs">{s.duration_seconds ? fmtHours(s.duration_seconds) : '—'}</TableCell>
                    <TableCell>
                      <Badge variant={s.stop_class === 'overnight' ? 'destructive' : s.stop_class === 'long' ? 'destructive' : s.stop_class === 'operational' ? 'secondary' : 'outline'} className="text-[10px]">
                        {s.stop_class === 'overnight' && <Moon className="h-3 w-3 mr-1" />}
                        {s.stop_class}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{s.pois?.name || (s.poi_id ? 'Vinculado' : '—')}</TableCell>
                    <TableCell className="font-mono text-[10px]">{s.lat.toFixed(4)}, {s.lng.toFixed(4)}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => { setPoiDialogStop(s); setPoiName(''); setLinkPoiId(''); }}>
                        <Save className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>

          <Dialog open={!!poiDialogStop} onOpenChange={(v) => !v && setPoiDialogStop(null)}>
            <DialogContent className="max-w-sm">
              <DialogHeader><DialogTitle>Gerenciar POI</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Salvar como novo POI</Label>
                  <Input value={poiName} onChange={e => setPoiName(e.target.value)} placeholder="Nome do local" />
                  <Button size="sm" disabled={!poiName} onClick={() => {
                    if (poiDialogStop) {
                      savePOIMutation.mutate({ lat: poiDialogStop.lat, lng: poiDialogStop.lng, name: poiName });
                      setPoiDialogStop(null);
                    }
                  }}>Salvar como POI</Button>
                </div>
                <div className="border-t border-border pt-4 space-y-2">
                  <Label>Vincular a POI existente</Label>
                  <Select value={linkPoiId} onValueChange={setLinkPoiId}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {pois.map((p: any) => (
                        <SelectItem key={p.id} value={p.id}>{p.name || p.category}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" disabled={!linkPoiId} onClick={() => {
                    if (poiDialogStop && linkPoiId) {
                      linkPOIMutation.mutate({ stopId: poiDialogStop.id, poiId: linkPoiId });
                      setPoiDialogStop(null);
                    }
                  }}>Vincular</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </TabsContent>

        {/* Speed with chart */}
        <TabsContent value="speed" className="space-y-4">
          <div className="flex items-center gap-4">
            <Input type="date" value={historyDate} onChange={e => setHistoryDate(e.target.value)} className="w-48" />
          </div>
          {!hasSpeed && history.length > 0 ? (
            <Card><CardContent className="py-8 text-center">
              <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground">Velocidade indisponível para este veículo</p>
              <p className="text-xs text-muted-foreground mt-1">Este rastreador não reporta velocidade</p>
            </CardContent></Card>
          ) : history.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Nenhum dado para este dia</CardContent></Card>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Máxima</CardTitle></CardHeader>
                  <CardContent><div className="text-2xl font-bold text-foreground">{Math.round(Math.max(...history.filter(p => p.speed != null).map(p => p.speed!)))} <span className="text-sm font-normal text-muted-foreground">km/h</span></div></CardContent>
                </Card>
                <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Média</CardTitle></CardHeader>
                  <CardContent><div className="text-2xl font-bold text-foreground">{Math.round(history.filter(p => p.speed != null).reduce((s, p) => s + p.speed!, 0) / Math.max(1, history.filter(p => p.speed != null).length))} <span className="text-sm font-normal text-muted-foreground">km/h</span></div></CardContent>
                </Card>
                <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Sessões Excesso</CardTitle></CardHeader>
                  <CardContent><div className="text-2xl font-bold text-foreground">{overspeedEvents.length}</div></CardContent>
                </Card>
              </div>

              {/* Speed Chart */}
              {speedChartData.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Velocidade ao longo do dia</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={speedChartData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" className="fill-muted-foreground" />
                        <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" unit=" km/h" />
                        <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                        {vehicle?.speed_limit_kmh && (
                          <Line type="monotone" dataKey={() => vehicle.speed_limit_kmh} stroke="hsl(var(--destructive))" strokeDasharray="5 5" strokeWidth={1} dot={false} name="Limite" />
                        )}
                        <Line type="monotone" dataKey="speed" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Velocidade" />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {overspeedEvents.length > 0 && (
                <Card><CardContent className="p-0">
                  <Table>
                    <TableHeader><TableRow><TableHead>Início</TableHead><TableHead>Fim</TableHead><TableHead>Máx</TableHead><TableHead>Média</TableHead><TableHead>Pontos</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(overspeedEvents as any[]).map((ev: any) => {
                        const p = ev.payload as any;
                        return (
                          <TableRow key={ev.id}>
                            <TableCell className="text-xs">{p?.start_at ? format(new Date(p.start_at), 'HH:mm:ss') : '—'}</TableCell>
                            <TableCell className="text-xs">{p?.end_at ? format(new Date(p.end_at), 'HH:mm:ss') : '—'}</TableCell>
                            <TableCell className="font-medium">{p?.max_speed || '—'} km/h</TableCell>
                            <TableCell>{p?.avg_speed || '—'} km/h</TableCell>
                            <TableCell className="text-xs">{p?.count_points || '—'}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent></Card>
              )}
            </>
          )}
        </TabsContent>

        {/* Fuel with chart */}
        <TabsContent value="fuel" className="space-y-4">
          {!hasFuel ? (
            <Card><CardContent className="py-8 text-center">
              <Fuel className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground">Combustível indisponível</p>
              <p className="text-xs text-muted-foreground mt-1">Este rastreador não possui sensor de combustível mapeado</p>
            </CardContent></Card>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <Input type="date" value={historyDate} onChange={e => setHistoryDate(e.target.value)} className="w-48" />
                <span className="text-sm text-muted-foreground">{fuelReadings.length} leituras</span>
              </div>

              {fuelReadings.length > 0 ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Início do dia</CardTitle></CardHeader>
                      <CardContent><div className="text-2xl font-bold text-foreground">{(fuelReadings[0] as any).fuel_value?.toFixed(1)} <span className="text-sm font-normal text-muted-foreground">{(fuelReadings[0] as any).fuel_unit === 'liters' ? 'L' : '%'}</span></div></CardContent>
                    </Card>
                    <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Fim do dia</CardTitle></CardHeader>
                      <CardContent><div className="text-2xl font-bold text-foreground">{(fuelReadings[fuelReadings.length - 1] as any).fuel_value?.toFixed(1)} <span className="text-sm font-normal text-muted-foreground">{(fuelReadings[0] as any).fuel_unit === 'liters' ? 'L' : '%'}</span></div></CardContent>
                    </Card>
                    <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Variação</CardTitle></CardHeader>
                      <CardContent>
                        {(() => {
                          const delta = (fuelReadings[0] as any).fuel_value - (fuelReadings[fuelReadings.length - 1] as any).fuel_value;
                          return <div className={`text-2xl font-bold ${delta > 0 ? 'text-destructive' : 'text-success'}`}>{delta > 0 ? '-' : '+'}{Math.abs(delta).toFixed(1)}</div>;
                        })()}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Fuel Chart */}
                  {fuelChartData.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">Nível de combustível ao longo do dia</CardTitle></CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={250}>
                          <AreaChart data={fuelChartData}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                            <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" className="fill-muted-foreground" />
                            <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                            <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                            <Area type="monotone" dataKey="value" stroke="hsl(var(--success))" fill="hsl(var(--success))" fillOpacity={0.15} strokeWidth={2} name="Combustível" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  )}
                </>
              ) : (
                <Card><CardContent className="py-8 text-center text-muted-foreground">Nenhuma leitura de combustível neste dia</CardContent></Card>
              )}
            </>
          )}
        </TabsContent>

        {/* Alerts */}
        <TabsContent value="alerts" className="space-y-4">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Status</TableHead><TableHead>Aberto</TableHead><TableHead>Fechado</TableHead></TableRow></TableHeader>
              <TableBody>
                {alerts.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground"><Bell className="h-6 w-6 mx-auto mb-1 text-muted-foreground/50" />Nenhum alerta</TableCell></TableRow>
                ) : (alerts as any[]).map((a: any) => (
                  <TableRow key={a.id}>
                    <TableCell><Badge variant="outline" className="text-xs">{a.alert_rules?.rule_type || '—'}</Badge></TableCell>
                    <TableCell><Badge variant={a.status === 'open' ? 'destructive' : 'secondary'} className="text-xs">{a.status}</Badge></TableCell>
                    <TableCell className="text-xs">{new Date(a.opened_at).toLocaleString('pt-BR')}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.closed_at ? new Date(a.closed_at).toLocaleString('pt-BR') : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {/* Geofences */}
        <TabsContent value="geofences" className="space-y-4">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Geofence</TableHead><TableHead>Direção</TableHead><TableHead>Quando</TableHead></TableRow></TableHeader>
              <TableBody>
                {geoEvents.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground"><Hexagon className="h-6 w-6 mx-auto mb-1 text-muted-foreground/50" />Nenhum evento</TableCell></TableRow>
                ) : (geoEvents as any[]).map((ev: any) => (
                  <TableRow key={ev.id}>
                    <TableCell className="font-medium">{ev.geofences?.name || '—'}</TableCell>
                    <TableCell><Badge variant={ev.direction === 'enter' ? 'default' : 'secondary'} className="text-xs">{ev.direction === 'enter' ? 'Entrada' : 'Saída'}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(ev.event_at).toLocaleString('pt-BR')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        {/* Telemetry */}
        <TabsContent value="telemetry" className="space-y-4">
          <Card><CardHeader><CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4 text-primary" />Snapshot de Telemetria</CardTitle></CardHeader>
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
                <p className="text-sm text-muted-foreground flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Nenhuma telemetria adicional disponível.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MiniKPI({ icon, label, value, variant }: { icon: React.ReactNode; label: string; value: string; variant?: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-muted-foreground mb-0.5">{icon}<span className="text-[10px]">{label}</span></div>
        <p className={`text-lg font-bold ${variant === 'destructive' ? 'text-destructive' : 'text-foreground'}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
