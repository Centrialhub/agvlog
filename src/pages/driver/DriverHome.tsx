import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useChecklistStatus } from '@/hooks/useChecklistStatus';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Truck, MapPin, Package, Clock, ArrowRight, ClipboardCheck, AlertTriangle, Receipt } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DemoBanner from '@/components/driver/DemoBanner';
import { useState } from 'react';

const DEMO_TRIP = {
  id: 'demo-trip',
  status: 'in_progress',
  loads: { load_number: '1042 (DEMO)', origin: 'CD Montes Claros/MG', destination: 'PAI PEDRO - PIRAPORA - JAÍBA' },
  vehicles: { plate: 'DEM-1234', nickname: 'Demo' },
};

export default function DriverHome() {
  const { currentTenant } = useTenant();
  const { data: driver, isLoading: driverLoading } = useCurrentDriver();
  const navigate = useNavigate();
  const { data: autoTrip } = useActiveTrip(driver?.id);
  const checklist = useChecklistStatus(autoTrip?.id);
  const [demoActive, setDemoActive] = useState(true);

  const { data: activeTrips = [], isLoading: tripsLoading } = useQuery({
    queryKey: ['driver_my_trips', driver?.id],
    queryFn: async () => {
      if (!driver || !currentTenant) return [];
      const { data, error } = await supabase
        .from('dispatch_trips')
        .select('*, loads(load_number, origin, destination, status), vehicles(plate, nickname)')
        .eq('tenant_id', currentTenant.id)
        .eq('driver_id', driver.id)
        .in('status', ['planned', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return data || [];
    },
    enabled: !!driver && !!currentTenant,
  });

  const statusLabels: Record<string, string> = {
    planned: 'Planejada',
    in_progress: 'Em Andamento',
    completed: 'Concluída',
    cancelled: 'Cancelada',
  };

  const loading = driverLoading || tripsLoading;

  const isDemo = (!driver || activeTrips.length === 0) && demoActive && !loading;
  const tripsToShow: any[] = isDemo ? [DEMO_TRIP] : activeTrips;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Olá, {driver?.name || 'Motorista'}</h1>
        <p className="text-sm text-muted-foreground">Seu painel de viagem</p>
      </div>

      {isDemo && (
        <DemoBanner
          message="Sem viagem real — mostrando uma viagem fictícia."
          onReset={() => setDemoActive(false)}
        />
      )}

      {!driver && !driverLoading && !isDemo && (
        <Card>
          <CardContent className="py-6 text-center">
            <AlertTriangle className="h-8 w-8 text-warning mx-auto mb-2" />
            <p className="text-sm font-medium">Conta não vinculada</p>
            <p className="text-xs text-muted-foreground mt-1">
              Peça ao administrador para vincular seu usuário ao cadastro de motorista.
            </p>
          </CardContent>
        </Card>
      )}

      {driver && activeTrips.length === 0 && !loading && !isDemo && (
        <Card>
          <CardContent className="py-8 text-center">
            <Truck className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium">Nenhuma viagem ativa</p>
            <p className="text-xs text-muted-foreground mt-1">
              Aguarde a atribuição de uma nova carga pela operação.
            </p>
          </CardContent>
        </Card>
      )}

      {tripsToShow.length > 0 && (
        <div className="space-y-3">
          {tripsToShow.map((trip: any) => (
            <Card key={trip.id} className="border-l-4 border-l-primary">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">
                      Carga {trip.loads?.load_number || '—'}
                    </span>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">
                    {statusLabels[trip.status] || trip.status}
                  </Badge>
                </div>

                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-3 w-3" />
                    <span>{trip.loads?.origin || '—'}</span>
                    <ArrowRight className="h-3 w-3" />
                    <span>{trip.loads?.destination || '—'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Truck className="h-3 w-3" />
                    <span>{trip.vehicles?.plate || 'Sem veículo'}</span>
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

      {/* Checklist status banner */}
      {autoTrip && !checklist.isLoading && (!checklist.preCompleted || !checklist.postCompleted) && (
        <Card
          className="border-warning/50 bg-warning/5 cursor-pointer hover:bg-warning/10 transition-colors"
          onClick={() => navigate('/driver/checklist')}
        >
          <CardContent className="p-3 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
            <div className="flex-1">
              <p className="text-xs font-medium">Checklist pendente</p>
              <p className="text-[10px] text-muted-foreground">
                {!checklist.preCompleted
                  ? `Pré-viagem: ${checklist.preCheckedCount}/${checklist.preTotalCount} itens`
                  : `Pós-viagem: ${checklist.postCheckedCount}/${checklist.postTotalCount} itens`}
              </p>
            </div>
            <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
          </CardContent>
        </Card>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => navigate('/driver/journey')}>
          <CardContent className="p-3 flex flex-col items-center gap-1.5">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs font-medium">Jornada</span>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => navigate('/driver/expenses')}>
          <CardContent className="p-3 flex flex-col items-center gap-1.5">
            <Receipt className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs font-medium">Despesas</span>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => navigate('/driver/checklist')}>
          <CardContent className="p-3 flex flex-col items-center gap-1.5">
            <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs font-medium">Checklist</span>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => navigate('/driver/issues')}>
          <CardContent className="p-3 flex flex-col items-center gap-1.5">
            <AlertTriangle className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs font-medium">Ocorrências</span>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
