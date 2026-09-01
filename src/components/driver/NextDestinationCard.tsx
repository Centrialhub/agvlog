import { MapPin, Route, StickyNote } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { NavigationLauncher } from '@/components/driver/NavigationLauncher';

export interface DriverDestinationStop {
  id: string;
  stop_order?: number | null;
  destination?: string | null;
  status: string;
  latitude?: number | null;
  longitude?: number | null;
  notes?: string | null;
  actual_arrival_at?: string | null;
  actual_departure_at?: string | null;
  clients?: { company_name?: string | null } | null;
}

interface NextDestinationCardProps {
  stop: DriverDestinationStop;
  remainingStops: number;
  offline?: boolean;
}

export function NextDestinationCard({ stop, remainingStops, offline = false }: NextDestinationCardProps) {
  const name = stop.clients?.company_name || stop.destination || 'Destino sem nome';
  const address = stop.destination && stop.destination !== name ? stop.destination : null;
  const isAtDestination = ['arrived', 'servicing'].includes(stop.status);

  return (
    <Card className="overflow-hidden border-primary/30 shadow-md">
      <div className="bg-primary px-4 py-2.5 text-primary-foreground">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em]">
            <Route className="h-4 w-4" />
            {isAtDestination ? 'Destino atual' : 'Próximo destino'}
          </p>
          <Badge className="border-primary-foreground/30 bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/15">
            {offline ? 'Salvo offline' : `${remainingStops} restante${remainingStops === 1 ? '' : 's'}`}
          </Badge>
        </div>
      </div>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <MapPin className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground">
              Parada {stop.stop_order ?? '—'}
            </p>
            <h2 className="break-words text-xl font-bold leading-tight">{name}</h2>
            {address && <p className="mt-1 break-words text-sm text-muted-foreground">{address}</p>}
          </div>
        </div>

        {stop.notes && (
          <div className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-sm">
            <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p className="break-words">{stop.notes}</p>
          </div>
        )}

        <NavigationLauncher
          destination={{
            label: name,
            address: stop.destination,
            latitude: stop.latitude,
            longitude: stop.longitude,
          }}
        />
      </CardContent>
    </Card>
  );
}
