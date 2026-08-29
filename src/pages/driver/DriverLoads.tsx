import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentDriver } from '@/hooks/useCurrentDriver';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Package, MapPin, Truck, ArrowRight, Calendar, Info, AlertCircle, RefreshCcw } from 'lucide-react';
import { LOAD_STATUS_LABELS, LOAD_ACTIVE_STATUSES } from '@/lib/status/loadStatus';
import { useDriverTripActions } from '@/hooks/useDriverTripActions';
import { resolveCanonicalTripLink } from '@/lib/driverTrip';
import { TRIP_ACTIVE_STATUSES } from '@/lib/status';

export default function DriverLoads() {
  const {
    data: driver,
    isLoading: driverLoading,
    isError: driverFailed,
    refetch: refetchDriver,
  } = useCurrentDriver();
  const { accessTrip, isStartingTrip } = useDriverTripActions();

  const {
    data: loads = [],
    isLoading: loadsLoading,
    isError: loadsFailed,
    refetch: refetchLoads,
  } = useQuery({
    queryKey: ['driver_all_assigned_loads', driver?.id],
    queryFn: async () => {
      if (!driver) return [];
      const { data, error } = await supabase
        .from('loads')
        .select(`
          id, 
          load_number, 
          origin, 
          destination, 
          status, 
          scheduled_load_at,
          total_pallet_count, 
          total_weight_kg,
          vehicles(plate, nickname),
          dispatch_trip_loads!dispatch_trip_loads_load_id_fkey(
            dispatch_trip_id,
            dispatch_trips!dispatch_trip_loads_dispatch_trip_id_fkey(status)
          )
        `)
        .eq('driver_id', driver.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!driver,
  });

  const loading = driverLoading || loadsLoading;
  const failed = driverFailed || loadsFailed;

  const retry = async () => {
    await Promise.all([refetchDriver(), refetchLoads()]);
  };

  return (
    <div className="space-y-4 pb-20">
      <div>
        <h1 className="text-lg font-bold">Minhas Cargas</h1>
        <p className="text-sm text-muted-foreground">Histórico e cargas atribuídas</p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 w-full animate-pulse bg-muted rounded-xl" />
          ))}
        </div>
      ) : failed ? (
        <Card role="alert" className="border-destructive/40">
          <CardContent className="py-10 text-center space-y-3">
            <AlertCircle className="h-10 w-10 text-destructive mx-auto" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Não foi possível carregar suas cargas</p>
              <p className="text-xs text-muted-foreground">
                Confira sua conexão e tente novamente. Nenhum dado foi tratado como vazio.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => void retry()}>
              <RefreshCcw className="h-3.5 w-3.5 mr-1.5" />
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      ) : loads.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center space-y-3">
            <Package className="h-10 w-10 text-muted-foreground mx-auto" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Nenhuma carga encontrada</p>
              <p className="text-xs text-muted-foreground">
                As cargas atribuídas a você pela operação aparecerão aqui.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {loads.map((load) => {
            const tripLink = resolveCanonicalTripLink(load.dispatch_trip_loads, TRIP_ACTIVE_STATUSES);
            const tripStatus = tripLink?.dispatch_trips?.status ?? null;

            return (
            <Card key={load.id} className="overflow-hidden">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <Package className="h-4 w-4 text-primary" />
                    </div>
                    <span className="font-bold text-sm">Carga {load.load_number}</span>
                  </div>
                  <Badge variant={load.status === 'in_transit' ? 'default' : 'secondary'} className="text-[10px] uppercase">
                    {LOAD_STATUS_LABELS[load.status as keyof typeof LOAD_STATUS_LABELS] || load.status}
                  </Badge>
                </div>

                <div className="space-y-2 text-xs text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="font-medium text-foreground">{load.origin || 'Origem não informada'}</span>
                      <ArrowRight className="h-3 w-3" />
                      <span className="font-medium text-foreground">{load.destination || 'Destino não informado'}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-y-2 pt-1 border-t border-border/50">
                    <div className="flex items-center gap-1.5">
                      <Truck className="h-3.5 w-3.5" />
                      <span>{load.vehicles?.plate || 'S/ Veículo'}</span>
                    </div>
                    {load.scheduled_load_at && (
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        <span>{new Date(load.scheduled_load_at).toLocaleDateString('pt-BR')}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <Info className="h-3.5 w-3.5" />
                      <span>{load.total_pallet_count || 0} pallets</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Info className="h-3.5 w-3.5 opacity-0" />
                      <span>{Number(load.total_weight_kg || 0).toLocaleString('pt-BR')} kg</span>
                    </div>
                  </div>

                  {load.status && (LOAD_ACTIVE_STATUSES as readonly string[]).includes(load.status) && tripLink && (
                    <Button 
                      size="sm" 
                      className="w-full mt-2" 
                      disabled={isStartingTrip}
                      onClick={() => accessTrip(tripLink.dispatch_trip_id, tripStatus)}
                    >
                      {tripStatus === 'in_transit' ? 'Acessar Viagem' : 'Iniciar Viagem'}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
