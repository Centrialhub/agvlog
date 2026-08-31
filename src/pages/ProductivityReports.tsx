import { useMemo } from 'react';
import { useListFilters } from '@/hooks/useListFilters';
import { ListFilterBar } from '@/components/ui/list-filter-bar';
import { matchesDateRange } from '@/lib/listFilters';

import { useLoads } from '@/hooks/useLoads';
import { useOperationalEvents } from '@/hooks/useOperationalEvents';
import { useClients } from '@/hooks/useClients';
import { useVehicles } from '@/hooks/useVehicles';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, Users, AlertTriangle, Truck } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';

function useDriversAll() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['drivers_all', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase.from('drivers').select('id, name, active').eq('tenant_id', currentTenant.id);
      return data || [];
    },
    enabled: !!currentTenant,
  });
}

export default function ProductivityReports() {
  const { data: allLoads = [], isLoading: loadsLoading } = useLoads();
  const { data: allEvents = [], isLoading: eventsLoading } = useOperationalEvents();
  const { data: clients = [] } = useClients();
  const { data: vehicles = [] } = useVehicles();
  const { data: drivers = [] } = useDriversAll();

  const { filters, setFilter, resetFilters, activeCount } = useListFilters({ driver: 'all', vehicle: 'all', from: '', to: '' });
  const loads = useMemo(() => allLoads.filter(row =>
    (filters.driver === 'all' || row.driver_id === filters.driver)
    && (filters.vehicle === 'all' || row.vehicle_id === filters.vehicle)
    && matchesDateRange(row.created_at, filters.from, filters.to)), [allLoads, filters.driver, filters.vehicle, filters.from, filters.to]);
  const events = useMemo(() => allEvents.filter(row =>
    (filters.driver === 'all' || row.driver_id === filters.driver)
    && (filters.vehicle === 'all' || row.vehicle_id === filters.vehicle)
    && matchesDateRange(row.created_at, filters.from, filters.to)), [allEvents, filters.driver, filters.vehicle, filters.from, filters.to]);

  // Driver performance
  const driverMetrics = useMemo(() => {
    const map: Record<string, { name: string; deliveries: number; divergences: number; pallets: number; loads: number }> = {};
    loads.forEach(l => {
      if (!l.driver_id) return;
      const driver = drivers.find(d => d.id === l.driver_id);
      if (!map[l.driver_id]) map[l.driver_id] = { name: driver?.name || 'Desconhecido', deliveries: 0, divergences: 0, pallets: 0, loads: 0 };
      map[l.driver_id].loads++;
      map[l.driver_id].pallets += l.total_pallet_count || 0;
      if (l.status === 'delivered') map[l.driver_id].deliveries++;
      if (l.status === 'divergent') map[l.driver_id].divergences++;
    });
    return Object.entries(map).map(([id, m]) => ({
      id, ...m,
      successRate: m.deliveries + m.divergences > 0 ? Math.round((m.deliveries / (m.deliveries + m.divergences)) * 100) : 100,
      avgPallets: m.loads > 0 ? Math.round(m.pallets / m.loads) : 0,
    })).sort((a, b) => b.loads - a.loads);
  }, [loads, drivers]);

  // Divergence by client
  const clientDivergences = useMemo(() => {
    const map: Record<string, { name: string; total: number; impact: number }> = {};
    events.forEach(e => {
      if (!e.client_id) return;
      const client = clients.find(c => c.id === e.client_id);
      const key = e.client_id;
      if (!map[key]) map[key] = { name: client?.company_name || 'Desconhecido', total: 0, impact: 0 };
      map[key].total++;
      map[key].impact += e.financial_impact || 0;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [events, clients]);

  // Vehicle occupancy efficiency
  const vehicleEfficiency = useMemo(() => {
    return vehicles
      .filter(v => v.max_pallets && v.max_pallets > 0 && (filters.vehicle === 'all' || v.id === filters.vehicle))
      .map(v => {
        const vehicleLoads = loads.filter(l => l.vehicle_id === v.id && ['delivered', 'in_transit', 'loaded'].includes(l.status));
        const totalPallets = vehicleLoads.reduce((s, l) => s + (l.total_pallet_count || 0), 0);
        const trips = vehicleLoads.length;
        const avgOccupancy = trips > 0 ? Math.round((totalPallets / (trips * (v.max_pallets || 1))) * 100) : 0;
        return { plate: v.plate, nickname: v.nickname, maxPallets: v.max_pallets, trips, avgOccupancy, totalPallets };
      })
      .filter(row => filters.driver === 'all' || row.trips > 0)
      .sort((a, b) => b.trips - a.trips);
  }, [vehicles, loads, filters.vehicle, filters.driver]);

  // Chart data
  const driverChartData = driverMetrics.slice(0, 10).map(d => ({
    name: d.name.split(' ')[0],
    cargas: d.loads,
    entregas: d.deliveries,
    divergencias: d.divergences,
  }));

  // Summary KPIs
  const totalDelivered = loads.filter(l => l.status === 'delivered').length;
  const totalDivergent = loads.filter(l => l.status === 'divergent').length;
  const overallSuccess = totalDelivered + totalDivergent > 0 ? Math.round((totalDelivered / (totalDelivered + totalDivergent)) * 100) : 100;
  const totalFinancialImpact = events.reduce((s, e) => s + (e.financial_impact || 0), 0);
  const avgPalletsPerTrip = loads.filter(l => (l.total_pallet_count ?? 0) > 0).length > 0
    ? Math.round(loads.reduce((s, l) => s + (l.total_pallet_count ?? 0), 0) / loads.filter(l => (l.total_pallet_count ?? 0) > 0).length)
    : 0;

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <TrendingUp className="h-6 w-6 text-primary" /> Relatórios de Produtividade
        </h1>
        <p className="text-sm text-muted-foreground">Performance por motorista, divergências por cliente e eficiência de veículos</p>
      </div>

      <ListFilterBar fields={[
        { key: 'driver', label: 'Motorista', value: filters.driver, onChange: value => setFilter('driver', value), options: [{ value: 'all', label: 'Todos os motoristas' }, ...drivers.map(row => ({ value: row.id, label: row.name }))] },
        { key: 'vehicle', label: 'Veículo', value: filters.vehicle, onChange: value => setFilter('vehicle', value), options: [{ value: 'all', label: 'Todos os veículos' }, ...vehicles.map(row => ({ value: row.id, label: row.plate }))] },
        { key: 'from', label: 'Registrado de', type: 'date', value: filters.from, max: filters.to || undefined, onChange: value => setFilter('from', value) },
        { key: 'to', label: 'Registrado até', type: 'date', value: filters.to, min: filters.from || undefined, onChange: value => setFilter('to', value) },
      ]} onReset={resetFilters} activeCount={activeCount} resultCount={loads.length} totalCount={allLoads.length} loading={loadsLoading || eventsLoading}
        description={`Cargas e ocorrências filtradas pela data de cadastro e vínculos próprios. ${events.length} ocorrências no recorte. Indicadores calculados sobre os registros carregados.`} />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="pt-3 pb-2">
            <span className="text-[10px] text-muted-foreground">Taxa de Sucesso</span>
            <div className={`text-xl font-bold ${overallSuccess >= 90 ? 'text-success' : 'text-warning'}`}>{overallSuccess}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-2">
            <span className="text-[10px] text-muted-foreground">Entregas</span>
            <div className="text-xl font-bold">{totalDelivered}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-2">
            <span className="text-[10px] text-muted-foreground">Divergências</span>
            <div className="text-xl font-bold text-destructive">{totalDivergent}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-2">
            <span className="text-[10px] text-muted-foreground">Impacto Financeiro</span>
            <div className="text-xl font-bold text-destructive">R$ {totalFinancialImpact.toLocaleString('pt-BR')}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-2">
            <span className="text-[10px] text-muted-foreground">Paletes/Viagem</span>
            <div className="text-xl font-bold">{avgPalletsPerTrip}</div>
          </CardContent>
        </Card>
      </div>

      {/* Driver chart */}
      {driverChartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Desempenho por Motorista</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={driverChartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="entregas" fill="hsl(var(--success))" name="Entregas" radius={[4, 4, 0, 0]} />
                <Bar dataKey="divergencias" fill="hsl(var(--destructive))" name="Divergências" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Driver table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" /> Motoristas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Motorista</TableHead>
                  <TableHead>Cargas</TableHead>
                  <TableHead>Pal/Viagem</TableHead>
                  <TableHead>Sucesso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {driverMetrics.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4 text-sm">Sem dados</TableCell></TableRow>
                ) : driverMetrics.map(d => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>{d.loads}</TableCell>
                    <TableCell>{d.avgPallets}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={d.successRate} className={`w-12 h-2 ${d.successRate < 80 ? '[&>div]:bg-destructive' : d.successRate < 95 ? '[&>div]:bg-warning' : ''}`} />
                        <span className={`text-xs font-medium ${d.successRate < 80 ? 'text-destructive' : ''}`}>{d.successRate}%</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Divergence by client */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" /> Divergências por Cliente
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Ocorrências</TableHead>
                  <TableHead>Impacto (R$)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientDivergences.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-4 text-sm">Nenhuma divergência 🎉</TableCell></TableRow>
                ) : clientDivergences.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell><Badge variant="outline" className="bg-destructive/10 text-destructive">{c.total}</Badge></TableCell>
                    <TableCell className="text-destructive font-medium">R$ {c.impact.toLocaleString('pt-BR')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Vehicle efficiency */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Truck className="h-4 w-4" /> Eficiência de Veículos
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Veículo</TableHead>
                <TableHead>Viagens</TableHead>
                <TableHead>Paletes Total</TableHead>
                <TableHead>Capacidade</TableHead>
                <TableHead>Ocupação Média</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vehicleEfficiency.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4 text-sm">Configure capacidade dos veículos</TableCell></TableRow>
              ) : vehicleEfficiency.map(v => (
                <TableRow key={v.plate}>
                  <TableCell className="font-medium">{v.plate}{v.nickname ? ` (${v.nickname})` : ''}</TableCell>
                  <TableCell>{v.trips}</TableCell>
                  <TableCell>{v.totalPallets}</TableCell>
                  <TableCell className="text-muted-foreground">{v.maxPallets} pal</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={v.avgOccupancy} className={`w-16 h-2 ${v.avgOccupancy < 50 ? '[&>div]:bg-warning' : ''}`} />
                      <span className={`text-xs font-medium ${v.avgOccupancy < 50 ? 'text-warning' : ''}`}>{v.avgOccupancy}%</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
