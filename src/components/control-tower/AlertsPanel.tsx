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

export default function AlertsPanel({
  alerts,
  trips,
  onSelectTrip,
}: {
  alerts: TripAlert[];
  trips: ActiveTripLive[];
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
    <ScrollArea className="h-64">
      <div className="space-y-1.5 pr-2">
        {sorted.map((a) => {
          const trip = trips.find((t) => t.trip_id === a.trip_id);
          return (
            <button
              key={a.id}
              onClick={() => trip && onSelectTrip(trip)}
              className={`w-full text-left border-l-4 rounded-md px-2.5 py-2 hover:bg-accent/30 transition-colors ${sevColor[a.severity] ?? sevColor.warning}`}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: STATE_COLORS[trip?.state ?? 'normal'] }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">
                    {trip?.vehicle_plate ?? '—'} · {a.title}
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
  );
}