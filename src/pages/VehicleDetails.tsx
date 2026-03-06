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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, MapPin, Clock, Gauge, Navigation, Activity, AlertTriangle, Info, Route, StopCircle, Bell, Hexagon } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

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

  const { data: vehicle } = useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select('*').eq('id', vehicleId!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!vehicleId,
  });

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

  const today = new Date().toISOString().split('T')[0];
  const [historyDate, setHistoryDate] = useState(today);
  const { data: history = [], isLoading: historyLoading } = useVehicleHistory(vehicleId || null, `${historyDate}T00:00:00Z`, `${historyDate}T23:59:59Z`);

  // Trips for date
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

  // Stops for date
  const { data: stops = [] } = useQuery({
    queryKey: ['vehicle_stops', currentTenant?.id, vehicleId, historyDate],
    queryFn: async () => {
      if (!currentTenant || !vehicleId) return [];
      const { data, error } = await supabase.from('trip_stops').select('*')
        .eq('tenant_id', currentTenant.id).eq('vehicle_id', vehicleId)
        .gte('start_at', `${historyDate}T00:00:00Z`).lte('start_at', `${historyDate}T23:59:59Z`)
        .order('start_at');
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant && !!vehicleId,
  });

  // Alerts for vehicle
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

  // Geofence events for vehicle
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

  const isOnline = positionLast ? Date.now() - new Date(positionLast.captured_at).getTime() < 10 * 60 * 1000 : false;
  const isMoving = positionLast?.speed != null && positionLast.speed > 2;
  const historyPath = useMemo(() => history.map((p: PositionRaw) => [p.lat, p.lng] as [number, number]), [history]);
  const telemetry = positionLast?.telemetry_snapshot as Record<string, any> | null;

  const fmtHours = (s: number | null) => { if (!s) return '—'; return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`; };

  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="h-5 w-5" /></Button>
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            {vehicle?.plate || '...'} {vehicle?.nickname && <span className="text-sm font-normal text-muted-foreground">({vehicle.nickname})</span>}
          </h1>
          <div className="flex items-center gap-2 mt-0.5">
            {positionLast ? (
              <>
                <Badge variant={isOnline ? (isMoving ? 'default' : 'secondary') : 'destructive'}>
                  {isOnline ? (isMoving ? 'Em movimento' : 'Parado') : 'Offline'}
                </Badge>
                <span className="text-xs text-muted-foreground">Atualizado {formatDistanceToNow(new Date(positionLast.captured_at), { addSuffix: true, locale: ptBR })}</span>
              </>
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
          <TabsTrigger value="alerts">Alertas ({alerts.length})</TabsTrigger>
          <TabsTrigger value="geofences">Geofences ({geoEvents.length})</TabsTrigger>
          <TabsTrigger value="telemetry">Telemetria</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4">
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

        {/* Timeline */}
        <TabsContent value="timeline" className="space-y-4">
          <div className="flex items-center gap-4">
            <Input type="date" value={historyDate} onChange={e => setHistoryDate(e.target.value)} className="w-48" />
            <span className="text-sm text-muted-foreground">{historyLoading ? 'Carregando...' : `${history.length} pontos`}</span>
          </div>
          <Card className="h-[500px] overflow-hidden">
            <MapContainer center={history.length > 0 ? [history[0].lat, history[0].lng] : positionLast ? [positionLast.lat, positionLast.lng] : [-14.235, -51.925]} zoom={history.length > 0 ? 13 : 4} className="h-full w-full z-0">
              <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {historyPath.length > 1 && <Polyline positions={historyPath} color="#3b82f6" weight={3} opacity={0.8} />}
              {history.length > 0 && (<><Marker position={[history[0].lat, history[0].lng]}><Popup><strong>Início</strong><br />{format(new Date(history[0].captured_at), "HH:mm:ss")}</Popup></Marker><Marker position={[history[history.length - 1].lat, history[history.length - 1].lng]}><Popup><strong>Fim</strong><br />{format(new Date(history[history.length - 1].captured_at), "HH:mm:ss")}</Popup></Marker></>)}
            </MapContainer>
          </Card>
          {history.length > 0 && history.some(p => p.speed != null) && (
            <Card><CardContent className="py-3 flex gap-4 text-xs text-muted-foreground">
              <span>Pontos: {history.length}</span>
              <span>Máx: {Math.round(Math.max(...history.filter(p => p.speed != null).map(p => p.speed!)))} km/h</span>
              <span>Méd: {Math.round(history.filter(p => p.speed != null).reduce((s, p) => s + p.speed!, 0) / history.filter(p => p.speed != null).length)} km/h</span>
            </CardContent></Card>
          )}
          {history.length > 0 && !history.some(p => p.speed != null) && (
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Info className="h-3 w-3" />Velocidade indisponível — estimada via GPS</p>
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
              <TableHeader><TableRow><TableHead>Início</TableHead><TableHead>Duração</TableHead><TableHead>Classe</TableHead><TableHead>Localização</TableHead></TableRow></TableHeader>
              <TableBody>
                {stops.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Nenhuma parada detectada</TableCell></TableRow>
                ) : (stops as any[]).map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-xs">{format(new Date(s.start_at), 'HH:mm')}</TableCell>
                    <TableCell className="text-xs">{s.duration_seconds ? fmtHours(s.duration_seconds) : '—'}</TableCell>
                    <TableCell><Badge variant={s.stop_class === 'long' ? 'destructive' : s.stop_class === 'operational' ? 'secondary' : 'outline'} className="text-[10px]">{s.stop_class}</Badge></TableCell>
                    <TableCell className="font-mono text-[10px]">{s.lat.toFixed(4)}, {s.lng.toFixed(4)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
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
