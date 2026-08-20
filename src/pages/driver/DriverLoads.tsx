import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentDriver } from '@/hooks/useCurrentDriver';
import { useDriverWorkspace, useDriverExecution } from '@/hooks/useDriverWorkspace';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Package, MapPin, Truck, ArrowRight, Calendar, Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { LOAD_STATUS_LABELS, LOAD_ACTIVE_STATUSES } from '@/lib/status';

export default function DriverLoads() {
  const { data: driver, isLoading: driverLoading } = useCurrentDriver();
  const { data: workspace, isLoading: workspaceLoading } = useDriverWorkspace();
  const { reportEvent } = useDriverExecution();
  const navigate = useNavigate();

  const loads = workspace?.loads || [];
  const loading = driverLoading || workspaceLoading;

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
          {loads.map((load: any) => (
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

                  {load.status && (LOAD_ACTIVE_STATUSES as readonly string[]).includes(load.status) && workspace?.trip?.id && (
                    <Button 
                      size="sm" 
                      className="w-full mt-2" 
                      onClick={() => {
                        reportEvent.mutate({
                          tripId: workspace.trip!.id,
                          eventType: 'trip_start',
                          idempotencyKey: `start-trip-${workspace.trip!.id}`
                        });
                        navigate(`/driver/stops`);
                      }}
                    >
                      Acessar Viagem
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}