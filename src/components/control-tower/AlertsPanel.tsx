import { AlertTriangle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SEVERITY_ORDER, STATE_COLORS, type ActiveTripLive, type TripAlert } from '@/lib/controlTower/types';

const sevColor: Record<string, string> = {
  critical: 'border-l-red-700 bg-red-500/5',
  danger: 'border-l-red-500 bg-red-500/5',
  warning: 'border-l-orange-500 bg-orange-500/5',
  info: 'border-l-blue-500 bg-blue-500/5',
  success: 'border-l-emerald-500 bg-emerald-500/5',
};

function alertTrip(alert:TripAlert):ActiveTripLive|null{
  if(!alert.trip_id)return null;
  const state=alert.type in STATE_COLORS?alert.type as ActiveTripLive['state']:'unknown';
  return {trip_id:alert.trip_id,tenant_id:alert.tenant_id,trip_status:alert.trip_status??'unknown',tracking_enabled:false,
    trip_code:alert.trip_code??alert.trip_id.slice(0,8),vehicle_id:alert.vehicle_id,vehicle_plate:alert.vehicle_plate??null,vehicle_name:null,
    driver_id:null,driver_name:alert.driver_name??null,driver_phone:null,lat:null,lng:null,speed_kmh:null,heading:null,state,severity:alert.severity,
    status_message:alert.message,route_geometry_geojson:null,distance_from_route_meters:null,delay_minutes:null,stopped_minutes:null,
    average_speed_kmh:null,eta_next_stop_at:null,last_signal_at:null,last_signal_age_seconds:null,position_captured_at:null,
    next_stop:null,previous_stops:[],previous_stops_total:0,previous_stops_truncated:false,
    pending_stops:[],pending_stops_total:0,pending_stops_truncated:false,loads:[],loads_total:0,loads_truncated:false};
}

export default function AlertsPanel({
  alerts,
  trips,
  totalCount,
  truncated,
  onSelectTrip,
}: {
  alerts: TripAlert[];
  trips: ActiveTripLive[];
  totalCount: number;
  truncated: boolean;
  onSelectTrip: (trip: ActiveTripLive) => void;
}) {
  const sorted = [...alerts].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );

  if (!sorted.length) {
    return (
      <div className="text-xs text-muted-foreground text-center py-6">
        Nenhum alerta aberto.
      </div>
    );
  }

  return (
    <div>
      {truncated && <p role="status" className="mb-2 rounded bg-warning/10 px-2 py-1 text-[11px] text-warning">Exibindo {alerts.length} de {totalCount} alertas, priorizados por severidade e abertura.</p>}
      <ScrollArea className="h-64">
      <div className="space-y-1.5 pr-2">
        {sorted.map((a) => {
          const trip = trips.find((t) => t.trip_id === a.trip_id);
          const selectableTrip=trip??alertTrip(a);
          return (
            <button
              key={a.id}
              onClick={() => selectableTrip&&onSelectTrip(selectableTrip)}
              disabled={!selectableTrip}
              className={`w-full text-left border-l-4 rounded-md px-2.5 py-2 hover:bg-accent/30 transition-colors ${sevColor[a.severity] ?? sevColor.warning}`}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: STATE_COLORS[trip?.state ?? 'normal'] }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">
                    {trip?.vehicle_plate ?? a.vehicle_plate ?? 'Viagem sem veículo'} · {a.title}
                  </p>
                  {a.message && (
                    <p className="text-[11px] text-muted-foreground truncate">{a.message}</p>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      </ScrollArea>
    </div>
  );
}
