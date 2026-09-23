import {TripCancellationDialog} from './TripCancellationDialog';
import {TripMaterializedCorrectionDialog} from './TripMaterializedCorrectionDialog';
import {useTenant} from '@/hooks/useTenant';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Truck, MapPin, Clock, AlertTriangle, RefreshCw, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { STATE_COLORS, STATE_LABELS, type ActiveTripLive } from '@/lib/controlTower/types';
import { Link } from 'react-router-dom';
import { calculateTripRoute } from '@/lib/controlTower/routeCalculation';
import { useAuth } from '@/hooks/useAuth';
import { useQueryClient } from '@tanstack/react-query';
import TripOperationalEventsPanel from '@/components/control-tower/TripOperationalEventsPanel';

function fmtTime(iso?: string | null) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return '—'; }
}
function fmtAge(s?: number | null) {
  if (s == null) return '—';
  if (s < 60) return `${s}s atrás`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min}min atrás`;
  return `${Math.round(min / 60)}h atrás`;
}

export default function TripDetailsDrawer({
  trip,
  open,
  onOpenChange,
}: {
  trip: ActiveTripLive | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const {currentTenant,currentRole}=useTenant();
  const [cancellation,setCancellation]=useState<{tenant:string;actor:string;trip:string}|null>(null);
  const [correction,setCorrection]=useState<{tenant:string;actor:string;trip:string}|null>(null);
  const client = useQueryClient();
  const [recalculating, setRecalculating] = useState(false);

  if (!trip) return null;

  const color = STATE_COLORS[trip.state];

  const handleRecalc = async () => {
    if(!user || recalculating)return;
    setRecalculating(true);
    try {
      await calculateTripRoute(trip.tenant_id,user.id,trip.trip_id);
      toast({ title: 'Rota recalculada', description: 'Geometria atualizada via OSRM.' });
      await client.invalidateQueries({queryKey:['active-trips-live',trip.tenant_id]});
    } catch (error) {
      toast({ title: 'Falha ao calcular rota', description: error instanceof Error ? error.message : 'Confirmação pendente. Tente novamente.', variant: 'destructive' });
    } finally {
      setRecalculating(false);
    }
  };

  return (
    <><Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ background: color }} />
            <SheetTitle className="flex-1">{trip.vehicle_plate ?? '—'}</SheetTitle>
            <Badge variant="outline" style={{ borderColor: color, color }}>{STATE_LABELS[trip.state]}</Badge>
          </div>
          <SheetDescription>
            Viagem {trip.trip_code} · {trip.driver_name ?? 'sem motorista'}
          </SheetDescription>
        </SheetHeader>

        {trip.status_message && (
          <div className="mt-4 flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
            <AlertTriangle className="h-4 w-4 mt-0.5" style={{ color }} />
            <p>{trip.status_message}</p>
          </div>
        )}

        {/* Dados atuais */}
        <section className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <Kv label="Velocidade" value={trip.speed_kmh != null ? `${Math.round(trip.speed_kmh)} km/h` : '—'} />
          <Kv label="Vel. média" value={trip.average_speed_kmh != null ? `${Math.round(trip.average_speed_kmh)} km/h` : '—'} />
          <Kv label="Dist. da rota" value={trip.distance_from_route_meters != null ? `${Math.round(trip.distance_from_route_meters)} m` : '—'} />
          <Kv label="Atraso" value={trip.delay_minutes != null ? `${trip.delay_minutes} min` : '—'} />
          <Kv label="Tempo parado" value={trip.stopped_minutes != null ? `${trip.stopped_minutes} min` : '—'} />
          <Kv label="Último sinal" value={fmtAge(trip.last_signal_age_seconds)} />
        </section>

        <Separator className="my-4" />

        {/* Próxima parada */}
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Próxima parada</h4>
          {trip.next_stop ? (
            <div className="rounded-md border p-3 text-xs space-y-1">
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium">{trip.next_stop.sequence}. {trip.next_stop.client_name}</span>
              </div>
              <p className="text-muted-foreground"><Clock className="h-3 w-3 inline mr-1" />Planejado: {fmtTime(trip.next_stop.planned_arrival_at)}</p>
              {trip.eta_next_stop_at && (
                <p className="text-muted-foreground">ETA: {fmtTime(trip.eta_next_stop_at)}</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Nenhuma parada pendente.</p>
          )}
        </section>

        {/* Paradas */}
        {trip.previous_stops.length > 0 && (
          <section className="mt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Concluídas ({trip.previous_stops_truncated?`${trip.previous_stops.length} de ${trip.previous_stops_total}`:trip.previous_stops.length})</h4>
            <ul className="space-y-1 text-xs">
              {trip.previous_stops.map((s) => (
                <li key={s.id} className="flex justify-between text-muted-foreground">
                  <span>{s.sequence}. {s.client_name}</span>
                  <span>{fmtTime(s.actual_arrival_at)}</span>
                </li>
              ))}
            </ul>
            {trip.previous_stops_truncated&&<p className="mt-1 text-[11px] text-warning">Histórico de paradas resumido neste painel.</p>}
          </section>
        )}

        {trip.pending_stops.length > 1 && (
          <section className="mt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Pendentes ({trip.pending_stops_truncated?`${trip.pending_stops.length} de ${trip.pending_stops_total}`:trip.pending_stops.length})</h4>
            <ul className="space-y-1 text-xs">
              {trip.pending_stops.map((s) => (
                <li key={s.id} className="flex justify-between">
                  <span>{s.sequence}. {s.client_name}</span>
                  <span className="text-muted-foreground">{fmtTime(s.planned_arrival_at)}</span>
                </li>
              ))}
            </ul>
            {trip.pending_stops_truncated&&<p className="mt-1 text-[11px] text-warning">Paradas pendentes resumidas neste painel e no mapa.</p>}
          </section>
        )}

        {/* Cargas */}
        {trip.loads.length > 0 && (
          <section className="mt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Cargas ({trip.loads_truncated?`${trip.loads.length} de ${trip.loads_total}`:trip.loads.length})</h4>
            <ul className="space-y-1 text-xs">
              {trip.loads.map((l) => (
                <li key={l.id} className="flex justify-between">
                  <span className="flex items-center gap-1"><Truck className="h-3 w-3" />{l.code ?? l.id.slice(0, 8)}</span>
                  <span className="text-muted-foreground">{l.documents_count ?? 0} docs · {l.total_weight ?? 0} kg</span>
                </li>
              ))}
            </ul>
            {trip.loads_truncated&&<p className="mt-1 text-[11px] text-warning">Lista de cargas resumida neste painel.</p>}
          </section>
        )}

        <Separator className="my-4" />

        <TripOperationalEventsPanel tripId={trip.trip_id} />

        <Separator className="my-4" />

        {/* Ações */}
        <div className="flex flex-col gap-2">
          {user&&currentTenant?.id===trip.tenant_id&&['owner','admin','operator'].includes(currentRole||'')&&<Button variant="outline" size="sm" onClick={()=>setCancellation({tenant:trip.tenant_id,actor:user.id,trip:trip.trip_id})}>Cancelar viagem incorreta</Button>}
          {user&&currentTenant?.id===trip.tenant_id&&['owner','admin','operator'].includes(currentRole||'')&&<Button variant="outline" size="sm" onClick={()=>setCorrection({tenant:trip.tenant_id,actor:user.id,trip:trip.trip_id})}>Corrigir viagem já iniciada</Button>}
          <Button size="sm" variant="outline" onClick={handleRecalc} disabled={recalculating}>
            <RefreshCw className={`h-3.5 w-3.5 mr-2 ${recalculating ? 'animate-spin' : ''}`} />
            Recalcular rota (OSRM)
          </Button>
          {trip.loads[0] && (
            <Button size="sm" variant="outline" asChild>
              <Link to={`/loads/${trip.loads[0].id}`}>
                <ExternalLink className="h-3.5 w-3.5 mr-2" />
                Abrir carga
              </Link>
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
    {open&&cancellation&&cancellation.trip===trip.trip_id&&<TripCancellationDialog {...cancellation} onClose={()=>setCancellation(null)} onCancelled={()=>{setCancellation(null);onOpenChange(false);toast({title:"Viagem cancelada",description:"O planejamento foi cancelado e o histórico foi preservado."});}}/>}
    {open&&correction&&correction.trip===trip.trip_id&&<TripMaterializedCorrectionDialog {...correction} onClose={()=>setCorrection(null)} onCorrected={()=>{setCorrection(null);onOpenChange(false);toast({title:"Viagem corrigida",description:"A viagem saiu das operações ativas; vínculos e documentos foram preservados."});}}/>}</>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}
