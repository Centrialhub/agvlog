import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { AlertTriangle, ArrowRight, Bell, CircleDot, Eye, MapPin, ShieldAlert } from 'lucide-react';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MapAutoFit } from '@/components/maps/MapAutoFit';
import { createTruckMarkerIcon, DEFAULT_BRAZIL_MAP_CENTER } from '@/lib/maps/leaflet';
import { formatStoppedDuration, stateColor, stateLabel, type MovementState } from '@/hooks/useVehiclesState';
import { displayOperationsValue, INCIDENT_SEVERITY_COLORS } from './operationsCenterPresentation';
import type { OperationsCenterViewModel } from './operationsCenterTypes';

function createVehicleIcon(state: MovementState) {
  return createTruckMarkerIcon({
    color: stateColor(state),
    opacity: state === 'offline' || state === 'unknown' ? 0.6 : 1,
    className: 'custom-vehicle-marker',
  });
}

export function OperationsCenterMonitoring({ model, onNavigate }: {
  model: OperationsCenterViewModel;
  onNavigate: (path: string) => void;
}) {
  const {
    mapPoints, vehiclesWithPosition, fleetStats, alerts, alertTotal, incidents, stats,
    fleetPending, fleetUnavailable, alertsPending, alertsUnavailable,
    incidentsPending, incidentsUnavailable, hasOpenIncidents,
  } = model;

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      <Card className="lg:col-span-3 overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /> Frota em Tempo Real</CardTitle>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><CircleDot className="h-2.5 w-2.5 text-green-500" /> {displayOperationsValue(fleetPending, fleetUnavailable, fleetStats.moving)}</span>
                <span className="flex items-center gap-1"><CircleDot className="h-2.5 w-2.5 text-amber-500" /> {displayOperationsValue(fleetPending, fleetUnavailable, fleetStats.stopped)}</span>
                <span className="flex items-center gap-1"><CircleDot className="h-2.5 w-2.5 text-slate-400" /> {displayOperationsValue(fleetPending, fleetUnavailable, fleetStats.offline)}</span>
              </div>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => onNavigate('/fleet-map')}><Eye className="h-3 w-3 mr-1" /> Expandir</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {fleetPending ? (
            <div role="status" className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">Carregando telemetria da frota…</div>
          ) : fleetUnavailable ? (
            <div role="alert" className="flex h-[320px] items-center justify-center px-6 text-center text-sm text-destructive">Telemetria indisponível. O mapa e os estados anteriores foram ocultados.</div>
          ) : (
            <div className="h-[320px] w-full">
              <MapContainer center={mapPoints[0] ?? DEFAULT_BRAZIL_MAP_CENTER} zoom={4} style={{ height: '100%', width: '100%' }} zoomControl={true}>
                <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                {mapPoints.length > 0 && <MapAutoFit points={mapPoints} padding={20} maxZoom={12} />}
                {vehiclesWithPosition.map((entry) => (
                  <Marker key={entry.vehicle.id} position={[entry.lat!, entry.lng!]} icon={createVehicleIcon(entry.state)} title={`${entry.vehicle.plate} — ${stateLabel(entry.state)}`}>
                    <Popup>
                      <div className="min-w-[180px]">
                        <p className="font-bold text-sm">{entry.vehicle.plate}</p>
                        {entry.vehicle.nickname && <p className="text-xs text-gray-500">{entry.vehicle.nickname}</p>}
                        <div className="mt-2 space-y-1 text-xs">
                          <p>Status: <strong>{stateLabel(entry.state)}</strong></p>
                          <p>Velocidade: <strong>{entry.speed != null ? `${Math.round(entry.speed)} km/h` : 'indisponível'}</strong></p>
                          {(entry.state === 'stopped' || entry.state === 'idle') && entry.stoppedDuration > 0 && <p>Parado há: <strong>{formatStoppedDuration(entry.stoppedDuration)}</strong></p>}
                          {entry.lastPositionAt && <p>Última posição: {formatDistanceToNow(new Date(entry.lastPositionAt), { addSuffix: true, locale: ptBR })}</p>}
                        </div>
                        <button onClick={() => onNavigate(`/vehicles/${entry.vehicle.id}`)} className="mt-2 text-xs text-blue-600 hover:underline flex items-center gap-1"><Eye className="h-3 w-3" /> Ver detalhes</button>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="lg:col-span-2 space-y-4">
        <Card className={`${!alertsPending && !alertsUnavailable && alertTotal > 0 ? 'border-destructive/20' : ''}`}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Bell className="h-4 w-4 text-destructive" /> Alertas Ativos
                {!alertsPending && !alertsUnavailable && alertTotal > 0 && <Badge variant="destructive" className="text-[9px] h-4 px-1.5">{alertTotal}</Badge>}
              </CardTitle>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => onNavigate('/alerts')}>Ver todos <ArrowRight className="h-3 w-3 ml-1" /></Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5 max-h-[140px] overflow-y-auto">
            {alertsPending ? (
              <p role="status" className="text-xs text-muted-foreground text-center py-4">Carregando alertas ativos…</p>
            ) : alertsUnavailable ? (
              <p role="alert" className="text-xs text-destructive text-center py-4">Alertas indisponíveis. Não é possível afirmar que não há alertas ativos.</p>
            ) : alerts.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Nenhum alerta ativo ✓</p>
            ) : (
              <>
                {alerts.slice(0, 6).map((alert) => (
                  <div key={alert.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-muted/30 hover:bg-muted/60 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium truncate">{alert.alert_rules?.rule_type || 'Alerta'}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{alert.vehicles?.plate || '—'} · {formatDistanceToNow(new Date(alert.opened_at), { addSuffix: true, locale: ptBR })}</p>
                    </div>
                    <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 ml-2" />
                  </div>
                ))}
                <p className="pt-1 text-center text-[9px] text-muted-foreground">Exibindo até 6 de {alertTotal} alerta(s) ativo(s).</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className={`${hasOpenIncidents ? 'border-warning/20' : ''}`}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-warning" /> Incidentes</CardTitle>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => onNavigate('/incidents')}>Ver todos <ArrowRight className="h-3 w-3 ml-1" /></Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5 max-h-[120px] overflow-y-auto">
            {incidentsPending ? (
              <p role="status" className="text-xs text-muted-foreground text-center py-4">Carregando incidentes…</p>
            ) : incidentsUnavailable ? (
              <p role="alert" className="text-xs text-destructive text-center py-4">Incidentes indisponíveis. Nenhum estado vazio foi presumido.</p>
            ) : incidents.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Sem incidentes abertos ✓</p>
            ) : (
              <>
                {incidents.slice(0, 5).map((incident) => (
                  <div key={incident.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-muted/30">
                    <div className="min-w-0 flex-1"><p className="text-[11px] font-medium truncate">{incident.title}</p><p className="text-[10px] text-muted-foreground">{incident.incident_type}</p></div>
                    <Badge className={`text-[9px] shrink-0 ml-2 ${INCIDENT_SEVERITY_COLORS[incident.severity] || ''}`}>{incident.severity}</Badge>
                  </div>
                ))}
                <p className="pt-1 text-center text-[9px] text-muted-foreground">Exibindo até 5 de {stats.openIncidents} incidente(s) aberto(s).</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
