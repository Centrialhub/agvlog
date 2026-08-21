import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useFleetState, stateLabel, formatStoppedDuration } from '@/hooks/useVehiclesState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Truck, TruckIcon, AlertTriangle, Clock, Route, MapPin, Gauge, Zap, Activity } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function Dashboard() {
  const { currentTenant, memberships } = useTenant();
  const navigate = useNavigate();
  const { data: fleetState = [] } = useFleetState();

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
      const { data, error } = await supabase.from('metrics_daily').select('km_estimated, trips_count, overspeed_events, stops_count, moving_time_seconds, stopped_time_seconds')
        .eq('tenant_id', currentTenant.id).eq('day', today);
      if (error) throw error;
      const totals = (data || []).reduce((acc, m) => ({
        km: acc.km + (m.km_estimated || 0),
        trips: acc.trips + (m.trips_count || 0),
        overspeed: acc.overspeed + (m.overspeed_events || 0),
        stops: acc.stops + (m.stops_count || 0),
        moving: acc.moving + (m.moving_time_seconds || 0),
        stopped: acc.stopped + (m.stopped_time_seconds || 0),
      }), { km: 0, trips: 0, overspeed: 0, stops: 0, moving: 0, stopped: 0 });
      return totals;
    },
    enabled: !!currentTenant,
  });

  // Last 7 days metrics for charts
  const { data: weeklyMetrics = [] } = useQuery({
    queryKey: ['dashboard_weekly', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const from = new Date();
      from.setDate(from.getDate() - 6);
      const { data, error } = await supabase.from('metrics_daily')
        .select('day, vehicle_id, km_estimated, trips_count, overspeed_events, moving_time_seconds')
        .eq('tenant_id', currentTenant.id)
        .gte('day', from.toISOString().slice(0, 10))
        .order('day');
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });

  // Km by vehicle (last 7 days)
  const { data: vehiclesForChart = [] } = useQuery({
    queryKey: ['dashboard_vehicles_list', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase.from('vehicles').select('id, plate').eq('tenant_id', currentTenant.id).eq('active', true);
      return data || [];
    },
    enabled: !!currentTenant,
  });

  // Recent alerts
  const { data: recentAlerts = [] } = useQuery({
    queryKey: ['dashboard_recent_alerts', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('alert_instances')
        .select('id, status, opened_at, vehicle_id, vehicles(plate), alert_rules(rule_type)')
        .eq('tenant_id', currentTenant.id)
        .order('opened_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });

  // Recent events (last 24h)
  const { data: recentEvents = [] } = useQuery({
    queryKey: ['dashboard_recent_events', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data, error } = await supabase.from('events')
        .select('id, event_type, severity, event_at, vehicle_id, vehicles(plate)')
        .eq('tenant_id', currentTenant.id)
        .gte('event_at', since)
        .order('event_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });

  const onlineCount = fleetState.filter(s => s.movement_state === 'moving' || s.movement_state === 'stopped' || s.movement_state === 'idle').length;
  const offlineCount = vehicleCount - onlineCount;

  // Aggregate weekly data by day
  const dailyChartData = useMemo(() => {
    const byDay: Record<string, { day: string; km: number; trips: number; overspeed: number }> = {};
    for (const m of weeklyMetrics as any[]) {
      if (!byDay[m.day]) byDay[m.day] = { day: m.day, km: 0, trips: 0, overspeed: 0 };
      byDay[m.day].km += m.km_estimated || 0;
      byDay[m.day].trips += m.trips_count || 0;
      byDay[m.day].overspeed += m.overspeed_events || 0;
    }
    return Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)).map(d => ({
      ...d,
      km: Math.round(d.km),
      label: d.day.slice(5), // MM-DD
    }));
  }, [weeklyMetrics]);

  // Km by vehicle chart
  const vehicleKmData = useMemo(() => {
    const plateMap: Record<string, string> = {};
    for (const v of vehiclesForChart as any[]) plateMap[v.id] = v.plate;
    const byVehicle: Record<string, number> = {};
    for (const m of weeklyMetrics as any[]) {
      const plate = plateMap[m.vehicle_id] || m.vehicle_id?.slice(0, 8);
      if (!plate) continue;
      byVehicle[plate] = (byVehicle[plate] || 0) + (m.km_estimated || 0);
    }
    return Object.entries(byVehicle)
      .map(([plate, km]) => ({ plate, km: Math.round(km) }))
      .sort((a, b) => b.km - a.km)
      .slice(0, 10);
  }, [weeklyMetrics, vehiclesForChart]);

  // Offline vehicles from state engine
  const offlineVehicles = useMemo(() => {
    return fleetState
      .filter(s => s.movement_state === 'offline')
      .sort((a, b) => (a.last_position_at || '').localeCompare(b.last_position_at || ''))
      .slice(0, 5);
  }, [fleetState]);

  const fmtHours = (s: number) => `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {currentTenant?.name} — Visão geral da frota
          {vehicleCount === 0 && memberships.length > 1 && (
            <span className="ml-2 text-warning animate-pulse">
              (Esta empresa parece estar vazia. Verifique o seletor de empresa na barra lateral.)
            </span>
          )}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard title="Veículos" value={vehicleCount} subtitle="Cadastrados" icon={<Truck className="h-5 w-5" />} onClick={() => navigate('/vehicles')} />
        <StatCard title="Online" value={onlineCount} subtitle="< 10 min" icon={<TruckIcon className="h-5 w-5" />} variant="success" onClick={() => navigate('/fleet-map')} />
        <StatCard title="Offline" value={offlineCount} subtitle="Sem atualização" icon={<Clock className="h-5 w-5" />} variant="destructive" onClick={() => navigate('/fleet-map')} />
        <StatCard title="Alertas" value={openAlerts} subtitle="Abertos" icon={<AlertTriangle className="h-5 w-5" />} variant="warning" onClick={() => navigate('/alerts')} />
        <StatCard title="Km hoje" value={todayMetrics ? Math.round(todayMetrics.km) : 0} subtitle="Via GPS" icon={<Route className="h-5 w-5" />} />
        <StatCard title="Viagens hoje" value={todayMetrics?.trips || 0} subtitle="Detectadas" icon={<MapPin className="h-5 w-5" />} />
      </div>

      {/* Extra today KPIs */}
      {todayMetrics && (todayMetrics.overspeed > 0 || todayMetrics.moving > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard title="Excesso vel." value={todayMetrics.overspeed} subtitle="Hoje" icon={<Gauge className="h-4 w-4" />} variant={todayMetrics.overspeed > 0 ? 'destructive' : undefined} />
          <StatCard title="Paradas" value={todayMetrics.stops} subtitle="Hoje" icon={<MapPin className="h-4 w-4" />} />
          <StatCard title="Em movimento" value={fmtHours(todayMetrics.moving)} subtitle="Hoje" icon={<Activity className="h-4 w-4" />} />
          <StatCard title="Parado" value={fmtHours(todayMetrics.stopped)} subtitle="Hoje" icon={<Clock className="h-4 w-4" />} />
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Daily activity chart */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Atividade Diária (7 dias)</CardTitle></CardHeader>
          <CardContent>
            {dailyChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={dailyChartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" className="text-xs fill-muted-foreground" tick={{ fontSize: 11 }} />
                  <YAxis className="text-xs fill-muted-foreground" tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="km" stroke="hsl(var(--primary))" strokeWidth={2} name="Km" dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="trips" stroke="hsl(var(--success))" strokeWidth={2} name="Viagens" dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-sm text-muted-foreground">
                Sem dados de métricas. Execute o pipeline de processamento.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Km by vehicle */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Km por Veículo (7 dias)</CardTitle></CardHeader>
          <CardContent>
            {vehicleKmData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={vehicleKmData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" className="text-xs fill-muted-foreground" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="plate" type="category" width={90} className="text-xs fill-muted-foreground" tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="km" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} name="Km" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-sm text-muted-foreground">
                Sem dados de quilometragem.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom row: Alerts, Events, Offline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent Alerts */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-warning" />Alertas Recentes</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {recentAlerts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nenhum alerta</p>
            ) : (recentAlerts as any[]).map((a: any) => (
              <div key={a.id} className="flex items-center justify-between text-sm border-b border-border pb-2 last:border-0">
                <div>
                  <span className="font-medium text-foreground">{a.vehicles?.plate || '—'}</span>
                  <span className="text-xs text-muted-foreground ml-2">{a.alert_rules?.rule_type || '—'}</span>
                </div>
                <Badge variant={a.status === 'open' ? 'destructive' : 'secondary'} className="text-[10px]">{a.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Recent Events */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Zap className="h-4 w-4 text-primary" />Eventos (24h)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {recentEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Nenhum evento nas últimas 24h</p>
            ) : (recentEvents as any[]).map((ev: any) => (
              <div key={ev.id} className="flex items-center justify-between text-sm border-b border-border pb-2 last:border-0">
                <div>
                  <span className="font-medium text-foreground">{ev.vehicles?.plate || '—'}</span>
                  <Badge variant="outline" className="text-[10px] ml-2">{ev.event_type}</Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(ev.event_at), { addSuffix: true, locale: ptBR })}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Offline Vehicles */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4 text-destructive" />Veículos Offline</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {offlineVehicles.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Todos os veículos estão online</p>
            ) : offlineVehicles.map((s: any) => {
              const v = vehiclesForChart.find((v: any) => v.id === s.vehicle_id) as any;
              return (
                <div key={s.vehicle_id} className="flex items-center justify-between text-sm border-b border-border pb-2 last:border-0 cursor-pointer hover:bg-accent/50 -mx-2 px-2 rounded" onClick={() => navigate(`/vehicles/${s.vehicle_id}`)}>
                  <span className="font-medium text-foreground">{v?.plate || s.vehicle_id.slice(0, 8)}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.last_position_at ? formatDistanceToNow(new Date(s.last_position_at), { addSuffix: true, locale: ptBR }) : 'Sem posição'}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
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
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
            <p className="text-[10px] text-muted-foreground">{subtitle}</p>
          </div>
          <div className={colorClass}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}
