import { ArrowRight, MapPin, Package, Truck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import DriverLoadNotes from '@/components/driver/DriverLoadNotes';
import type { DriverHomeAssignedLoad } from '@/lib/driver/driverHomeTypes';
import type { DriverTrip } from '@/lib/driverTrip';
import { driverTripNeedsReconciliation, isDriverTripStarted } from '@/lib/driverTrip';
import { tripStatusLabel } from '@/lib/status';
import { LOAD_STATUS_LABELS } from '@/lib/status/loadStatus';

interface DriverHomeTripListsProps {
  standaloneLoads: DriverHomeAssignedLoad[];
  trips: DriverTrip[];
  driverName?: string;
  isStartingTrip: boolean;
  onAccessTrip: (trip: DriverTrip) => void;
}

export function DriverHomeTripLists({
  standaloneLoads,
  trips,
  driverName,
  isStartingTrip,
  onAccessTrip,
}: DriverHomeTripListsProps) {
  return (
    <>
      {standaloneLoads.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Cargas atribuídas ({standaloneLoads.length})
          </p>
          {standaloneLoads.map((load) => (
            <Card key={load.id} className="border-l-4 border-l-warning">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-warning" />
                    <span className="text-sm font-medium">Carga {load.load_number}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    {LOAD_STATUS_LABELS[load.status as keyof typeof LOAD_STATUS_LABELS] || load.status}
                  </Badge>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {(load.origin || load.destination) && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3 w-3" />
                      <span>{load.origin || '—'}</span>
                      <ArrowRight className="h-3 w-3" />
                      <span>{load.destination || '—'}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    {load.vehicles?.plate && <span className="flex items-center gap-1"><Truck className="h-3 w-3" />{load.vehicles.plate}</span>}
                    {(load.total_pallet_count ?? 0) > 0 && <span>{load.total_pallet_count} pallets</span>}
                    {(load.total_weight_kg ?? 0) > 0 && <span>{Number(load.total_weight_kg).toLocaleString('pt-BR')} kg</span>}
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground italic">Aguardando liberação da viagem pela equipe de operação.</p>
                <DriverLoadNotes loadId={load.id} loadNumber={load.load_number} vehiclePlate={load.vehicles?.plate} driverName={driverName} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {trips.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Viagens ativas ({trips.length})</p>
          {trips.map((trip) => (
            <Card key={trip.id} className="border-l-4 border-l-primary">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><Package className="h-4 w-4 text-primary" /><span className="text-sm font-medium">Carga {trip.loads?.load_number || '—'}</span></div>
                  <Badge variant="secondary" className="text-[10px]">{tripStatusLabel(trip.status)}</Badge>
                </div>
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5"><MapPin className="h-3 w-3" /><span>{trip.loads?.origin || '—'}</span><ArrowRight className="h-3 w-3" /><span>{trip.loads?.destination || '—'}</span></div>
                  <div className="flex items-center gap-1.5"><Truck className="h-3 w-3" /><span>{trip.vehicles?.plate || 'Sem veículo'}</span></div>
                </div>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={isStartingTrip || driverTripNeedsReconciliation(trip.status, trip.actual_start_at, trip.loads?.status)}
                  onClick={() => onAccessTrip(trip)}
                >
                  {driverTripNeedsReconciliation(trip.status, trip.actual_start_at, trip.loads?.status)
                    ? 'Revisão operacional necessária'
                    : isDriverTripStarted(trip.status, trip.actual_start_at) ? 'Acessar Viagem' : 'Iniciar Viagem'}
                </Button>
                {trip.loads?.id && <DriverLoadNotes loadId={trip.loads.id} loadNumber={trip.loads.load_number} vehiclePlate={trip.vehicles?.plate} driverName={driverName} />}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
