import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Truck, TruckIcon, AlertTriangle, Clock, Route, MapPin } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const { currentTenant } = useTenant();
  const navigate = useNavigate();

  const { data: vehicleCount = 0 } = useQuery({
    queryKey: ['dashboard_vehicles', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return 0;
      const { count, error } = await supabase.from('vehicles').select('*', { count: 'exact', head: true })
        .eq('tenant_id', currentTenant.id).eq('active', true);
      if (error) throw error;
      return count || 0;
    },
    enabled: !!currentTenant,
  });

  const { data: positions = [] } = useQuery({
    queryKey: ['dashboard_positions', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('positions_last').select('vehicle_id, captured_at, speed')
        .eq('tenant_id', currentTenant.id);
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
    refetchInterval: 30_000,
  });

  const { data: openAlerts = 0 } = useQuery({
    queryKey: ['dashboard_alerts', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return 0;
      const { count, error } = await supabase.from('alert_instances').select('*', { count: 'exact', head: true })
        .eq('tenant_id', currentTenant.id).eq('status', 'open');
      if (error) throw error;
      return count || 0;
    },
    enabled: !!currentTenant,
  });

  const { data: todayMetrics } = useQuery({
    queryKey: ['dashboard_metrics', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return null;
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase.from('metrics_daily').select('km_estimated, trips_count')
        .eq('tenant_id', currentTenant.id).eq('day', today);
      if (error) throw error;
      const totals = (data || []).reduce((acc, m) => ({
        km: acc.km + (m.km_estimated || 0),
        trips: acc.trips + (m.trips_count || 0),
      }), { km: 0, trips: 0 });
      return totals;
    },
    enabled: !!currentTenant,
  });

  const now = Date.now();
  const onlineCount = positions.filter(p => now - new Date(p.captured_at).getTime() < 10 * 60 * 1000).length;
  const offlineCount = vehicleCount - onlineCount;

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">{currentTenant?.name} — Visão geral da frota</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard title="Veículos" value={vehicleCount} subtitle="Cadastrados" icon={<Truck className="h-5 w-5" />} onClick={() => navigate('/vehicles')} />
        <StatCard title="Online" value={onlineCount} subtitle="Última atualização < 10min" icon={<TruckIcon className="h-5 w-5" />} variant="success" onClick={() => navigate('/fleet-map')} />
        <StatCard title="Offline" value={offlineCount} subtitle="Sem atualização" icon={<Clock className="h-5 w-5" />} variant="destructive" onClick={() => navigate('/fleet-map')} />
        <StatCard title="Alertas" value={openAlerts} subtitle="Abertos" icon={<AlertTriangle className="h-5 w-5" />} variant="warning" onClick={() => navigate('/alerts')} />
        <StatCard title="Km hoje" value={todayMetrics ? Math.round(todayMetrics.km) : 0} subtitle="Estimado via GPS" icon={<Route className="h-5 w-5" />} />
        <StatCard title="Viagens hoje" value={todayMetrics?.trips || 0} subtitle="Detectadas" icon={<MapPin className="h-5 w-5" />} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Próximos passos</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>1. Cadastre seus veículos na aba "Veículos"</p>
          <p>2. Configure a integração SSX em "Configurações" e cadastre rastreadores</p>
          <p>3. Vincule rastreadores aos veículos e rode o polling</p>
          <p>4. Acompanhe sua frota no "Mapa da Frota"</p>
          <p>5. Configure alertas e geofences para monitoramento inteligente</p>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ title, value, subtitle, icon, variant, onClick }: {
  title: string; value: number | string; subtitle: string; icon: React.ReactNode;
  variant?: 'success' | 'warning' | 'destructive'; onClick?: () => void;
}) {
  const colorClass = variant === 'success' ? 'text-success' : variant === 'warning' ? 'text-warning' : variant === 'destructive' ? 'text-destructive' : 'text-primary';
  return (
    <Card className={onClick ? 'cursor-pointer hover:bg-accent/50 transition-colors' : ''} onClick={onClick}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <div className={colorClass}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}
