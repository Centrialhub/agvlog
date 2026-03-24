import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Truck, MapPin, Package, Clock, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function DriverHome() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const navigate = useNavigate();

  // For now, show a driver-oriented home with current trip info
  const { data: activeTrips = [] } = useQuery({
    queryKey: ['driver_active_trips', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('dispatch_trips')
        .select('*, loads(load_number, origin, destination, status), vehicles(plate, nickname), drivers(name)')
        .eq('tenant_id', currentTenant.id)
        .in('status', ['planned', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });

  const statusLabels: Record<string, string> = {
    planned: 'Planejada',
    in_progress: 'Em Andamento',
    completed: 'Concluída',
    cancelled: 'Cancelada',
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Olá, Motorista</h1>
        <p className="text-sm text-muted-foreground">Seu painel de viagem</p>
      </div>

      {activeTrips.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Truck className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium">Nenhuma viagem ativa</p>
            <p className="text-xs text-muted-foreground mt-1">
              Aguarde a atribuição de uma nova carga pela operação.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {activeTrips.map((trip: any) => (
            <Card key={trip.id} className="border-l-4 border-l-primary">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">
                      Carga {(trip as any).loads?.load_number || '—'}
                    </span>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">
                    {statusLabels[trip.status] || trip.status}
                  </Badge>
                </div>

                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-3 w-3" />
                    <span>{(trip as any).loads?.origin || '—'}</span>
                    <ArrowRight className="h-3 w-3" />
                    <span>{(trip as any).loads?.destination || '—'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Truck className="h-3 w-3" />
                    <span>{(trip as any).vehicles?.plate || 'Sem veículo'}</span>
                  </div>
                </div>

                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => navigate(`/driver/stops?trip=${trip.id}`)}
                >
                  Ver Paradas
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        <Card
          className="cursor-pointer hover:bg-accent/50 transition-colors"
          onClick={() => navigate('/driver/journey')}
        >
          <CardContent className="p-3 flex flex-col items-center gap-1.5">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs font-medium">Jornada</span>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:bg-accent/50 transition-colors"
          onClick={() => navigate('/driver/expenses')}
        >
          <CardContent className="p-3 flex flex-col items-center gap-1.5">
            <Package className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs font-medium">Despesas</span>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
