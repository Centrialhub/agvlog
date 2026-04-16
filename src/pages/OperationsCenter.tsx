import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  PackageCheck, AlertTriangle, Truck, Clock, ArrowRight, Receipt,
  TrendingUp, FileText, Wrench, Users, Weight, Layers, MapPin,
  BarChart3, Activity, ShieldAlert, Fuel,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format, formatDistanceToNow, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid, Area, AreaChart,
} from 'recharts';

const COLORS = [
  'hsl(215, 80%, 48%)', 'hsl(142, 64%, 38%)', 'hsl(38, 92%, 50%)',
  'hsl(0, 72%, 51%)', 'hsl(270, 60%, 55%)', 'hsl(180, 60%, 40%)',
];

const STATUS_LABELS: Record<string, string> = {
  planned: 'Planejada', assembling: 'Montando', ready: 'Pronta',
  loading: 'Carregando', loaded: 'Carregada', in_transit: 'Em Trânsito',
  delivered: 'Entregue', divergent: 'Divergente',
};

const STATUS_COLORS: Record<string, string> = {
  planned: 'bg-muted text-muted-foreground',
  assembling: 'bg-blue-100 text-blue-800',
  ready: 'bg-emerald-100 text-emerald-800',
  loading: 'bg-amber-100 text-amber-800',
  loaded: 'bg-indigo-100 text-indigo-800',
  in_transit: 'bg-purple-100 text-purple-800',
  delivered: 'bg-green-100 text-green-800',
  divergent: 'bg-red-100 text-red-800',
};

export default function OperationsCenter() {
  const { currentTenant } = useTenant();
  const navigate = useNavigate();

  // ── Loads ──
  const { data: loads = [] } = useQuery({
    queryKey: ['ops_loads', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase
        .from('loads')
        .select('*, vehicles(plate, nickname), drivers(name)')
        .eq('tenant_id', currentTenant.id)
        .order('updated_at', { ascending: false })
        .limit(200);
      return data || [];
    },
    enabled: !!currentTenant,
    refetchInterval: 30000,
  });

  // ── Fiscal Documents ──
  const { data: fiscalDocs = [] } = useQuery({
    queryKey: ['ops_fiscal', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase
        .from('fiscal_documents')
        .select('id, document_type, value, weight_kg, pallet_count, status, created_at, issue_date')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false })
        .limit(1000);
      return data || [];
    },
    enabled: !!currentTenant,
  });

  // ── Open Events ──
  const { data: openEvents = [] } = useQuery({
    queryKey: ['ops_events', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase
        .from('operational_events')
        .select('*, loads(load_number), drivers(name)')
        .eq('tenant_id', currentTenant.id)
        .is('resolved_at', null)
        .order('created_at', { ascending: false })
        .limit(20);
      return data || [];
    },
    enabled: !!currentTenant,
  });

  // ── Incidents ──
  const { data: incidents = [] } = useQuery({
    queryKey: ['ops_incidents', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase
        .from('incidents')
        .select('id, status, severity, title, incident_type, created_at')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false })
        .limit(50);
      return data || [];
    },
    enabled: !!currentTenant,
  });

  // ── Fleet ──
  const { data: vehicles = [] } = useQuery({
    queryKey: ['ops_vehicles', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase
        .from('vehicles')
        .select('id, plate, active, status, current_driver_id')
        .eq('tenant_id', currentTenant.id);
      return data || [];
    },
    enabled: !!currentTenant,
  });

  // ── Drivers ──
  const { data: drivers = [] } = useQuery({
    queryKey: ['ops_drivers', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase
        .from('drivers')
        .select('id, active')
        .eq('tenant_id', currentTenant.id);
      return data || [];
    },
    enabled: !!currentTenant,
  });

  // ── Pending expenses ──
  const { data: pendingExpenses = 0 } = useQuery({
    queryKey: ['ops_expenses_count', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return 0;
      const { count } = await supabase
        .from('driver_expenses')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', currentTenant.id)
        .eq('approval_status', 'pending');
      return count || 0;
    },
    enabled: !!currentTenant,
  });

  // ── Maintenance ──
  const { data: openMaintenance = 0 } = useQuery({
    queryKey: ['ops_maintenance', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return 0;
      const { count } = await supabase
        .from('maintenance_orders')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', currentTenant.id)
        .not('status', 'in', '("closed","completed")');
      return count || 0;
    },
    enabled: !!currentTenant,
  });

  // ── Computed Stats ──
  const stats = useMemo(() => {
    const activeLoads = loads.filter((l: any) => !['delivered'].includes(l.status));
    const inTransit = loads.filter((l: any) => l.status === 'in_transit');
    const delivered = loads.filter((l: any) => l.status === 'delivered');
    const delayed = loads.filter((l: any) => {
      if (l.status === 'delivered') return false;
      const hoursSince = (Date.now() - new Date(l.updated_at).getTime()) / 3600000;
      return hoursSince > 24;
    });
    const totalWeightActive = activeLoads.reduce((s: number, l: any) => s + (Number(l.total_weight_kg) || 0), 0);
    const totalPalletsActive = activeLoads.reduce((s: number, l: any) => s + (Number(l.total_pallet_count) || 0), 0);

    const nfes = fiscalDocs.filter((d: any) => d.document_type === 'inbound');
    const ctes = fiscalDocs.filter((d: any) => d.document_type === 'outbound');
    const totalNfeValue = nfes.reduce((s: number, d: any) => s + (Number(d.value) || 0), 0);
    const totalCteValue = ctes.reduce((s: number, d: any) => s + (Number(d.value) || 0), 0);

    const activeVehicles = vehicles.filter((v: any) => v.active);
    const assignedVehicles = vehicles.filter((v: any) => v.current_driver_id);
    const activeDrivers = drivers.filter((d: any) => d.active);

    const openIncidents = incidents.filter((i: any) => !['closed', 'resolved'].includes(i.status));

    return {
      activeLoads: activeLoads.length,
      inTransit: inTransit.length,
      delivered: delivered.length,
      delayed: delayed.length,
      totalWeightActive,
      totalPalletsActive,
      nfeCount: nfes.length,
      cteCount: ctes.length,
      totalNfeValue,
      totalCteValue,
      activeVehicles: activeVehicles.length,
      assignedVehicles: assignedVehicles.length,
      activeDrivers: activeDrivers.length,
      openIncidents: openIncidents.length,
    };
  }, [loads, fiscalDocs, vehicles, drivers, incidents]);

  // ── Chart Data: loads by destination ──
  const destChart = useMemo(() => {
    const activeLoads = loads.filter((l: any) => !['delivered'].includes(l.status));
    const groups: Record<string, { pallets: number; weight: number; count: number }> = {};
    activeLoads.forEach((l: any) => {
      const dest = (l.destination || 'Sem destino').replace('MG-', '');
      if (!groups[dest]) groups[dest] = { pallets: 0, weight: 0, count: 0 };
      groups[dest].pallets += Number(l.total_pallet_count) || 0;
      groups[dest].weight += Number(l.total_weight_kg) || 0;
      groups[dest].count += 1;
    });
    return Object.entries(groups)
      .map(([dest, v]) => ({ dest, ...v }))
      .sort((a, b) => b.weight - a.weight);
  }, [loads]);

  // ── Chart Data: load status distribution ──
  const statusChart = useMemo(() => {
    const counts: Record<string, number> = {};
    loads.forEach((l: any) => {
      const s = l.status || 'unknown';
      counts[s] = (counts[s] || 0) + 1;
    });
    return Object.entries(counts).map(([status, value]) => ({
      name: STATUS_LABELS[status] || status,
      value,
    }));
  }, [loads]);

  // ── Chart Data: NF-e inflow by day ──
  const nfeByDay = useMemo(() => {
    const days: Record<string, number> = {};
    const nfes = fiscalDocs.filter((d: any) => d.document_type === 'inbound');
    nfes.forEach((d: any) => {
      const day = (d.issue_date || d.created_at?.slice(0, 10)) || '';
      if (day) days[day] = (days[day] || 0) + 1;
    });
    return Object.entries(days)
      .map(([day, qty]) => ({ day: format(new Date(day + 'T12:00:00'), 'dd/MM'), qty }))
      .slice(-14);
  }, [fiscalDocs]);

  const fmtCurrency = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const fmtWeight = (v: number) => `${(v / 1000).toFixed(1)}t`;

  return (
    <div className="animate-fade-in space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" /> Centro de Operações
          </h1>
          <p className="text-sm text-muted-foreground">
            Visão geral operacional em tempo real · Atualização a cada 30s
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/route-planning')}>
            <MapPin className="h-4 w-4 mr-1" /> Roteirizar
          </Button>
          <Button size="sm" onClick={() => navigate('/loads')}>
            <PackageCheck className="h-4 w-4 mr-1" /> Ver Cargas
          </Button>
        </div>
      </div>

      {/* ── Hero KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20 cursor-pointer hover:shadow-lg transition-all" onClick={() => navigate('/loads')}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <PackageCheck className="h-5 w-5 text-primary" />
              <Badge variant="secondary" className="text-[10px]">ativas</Badge>
            </div>
            <p className="text-3xl font-extrabold text-foreground">{stats.activeLoads}</p>
            <p className="text-xs text-muted-foreground mt-1">Cargas em operação</p>
            <div className="flex gap-3 mt-2 text-[10px] text-muted-foreground">
              <span>{fmtWeight(stats.totalWeightActive)}</span>
              <span>·</span>
              <span>{stats.totalPalletsActive} paletes</span>
            </div>
          </CardContent>
        </Card>

        <Card className={`cursor-pointer hover:shadow-lg transition-all ${stats.inTransit > 0 ? 'bg-gradient-to-br from-purple-500/10 to-purple-500/5 border-purple-500/20' : ''}`}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <Truck className="h-5 w-5 text-purple-600" />
              <Badge variant="secondary" className="text-[10px]">trânsito</Badge>
            </div>
            <p className="text-3xl font-extrabold text-foreground">{stats.inTransit}</p>
            <p className="text-xs text-muted-foreground mt-1">Em trânsito agora</p>
          </CardContent>
        </Card>

        <Card className={`cursor-pointer hover:shadow-lg transition-all ${stats.delayed > 0 ? 'bg-gradient-to-br from-destructive/10 to-destructive/5 border-destructive/30' : ''}`}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <Clock className="h-5 w-5 text-destructive" />
              {stats.delayed > 0 && <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive"></span></span>}
            </div>
            <p className="text-3xl font-extrabold text-foreground">{stats.delayed}</p>
            <p className="text-xs text-muted-foreground mt-1">Cargas atrasadas (&gt;24h)</p>
          </CardContent>
        </Card>

        <Card className={`cursor-pointer hover:shadow-lg transition-all ${stats.openIncidents > 0 ? 'bg-gradient-to-br from-warning/10 to-warning/5 border-warning/30' : ''}`} onClick={() => navigate('/incidents')}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <ShieldAlert className="h-5 w-5 text-warning" />
              {stats.openIncidents > 0 && <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75"></span><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-warning"></span></span>}
            </div>
            <p className="text-3xl font-extrabold text-foreground">{stats.openIncidents}</p>
            <p className="text-xs text-muted-foreground mt-1">Incidentes abertos</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Secondary KPIs ── */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="cursor-pointer hover:shadow transition-shadow" onClick={() => navigate('/fiscal-documents')}>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <FileText className="h-3.5 w-3.5 text-blue-500" />
              <span className="text-[10px] text-muted-foreground">NF-es</span>
            </div>
            <p className="text-lg font-bold">{stats.nfeCount}</p>
            <p className="text-[10px] text-muted-foreground truncate">{fmtCurrency(stats.totalNfeValue)}</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:shadow transition-shadow" onClick={() => navigate('/fiscal-documents')}>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Receipt className="h-3.5 w-3.5 text-emerald-500" />
              <span className="text-[10px] text-muted-foreground">CT-es</span>
            </div>
            <p className="text-lg font-bold">{stats.cteCount}</p>
            <p className="text-[10px] text-muted-foreground truncate">{stats.cteCount > 0 ? fmtCurrency(stats.totalCteValue) : 'Nenhum emitido'}</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:shadow transition-shadow" onClick={() => navigate('/vehicles')}>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Truck className="h-3.5 w-3.5 text-indigo-500" />
              <span className="text-[10px] text-muted-foreground">Frota</span>
            </div>
            <p className="text-lg font-bold">{stats.activeVehicles}</p>
            <p className="text-[10px] text-muted-foreground">{stats.assignedVehicles} com motorista</p>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:shadow transition-shadow" onClick={() => navigate('/drivers')}>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Users className="h-3.5 w-3.5 text-teal-500" />
              <span className="text-[10px] text-muted-foreground">Motoristas</span>
            </div>
            <p className="text-lg font-bold">{stats.activeDrivers}</p>
            <p className="text-[10px] text-muted-foreground">ativos</p>
          </CardContent>
        </Card>

        <Card className={`cursor-pointer hover:shadow transition-shadow ${openMaintenance > 0 ? 'border-warning/40' : ''}`} onClick={() => navigate('/maintenance')}>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Wrench className="h-3.5 w-3.5 text-orange-500" />
              <span className="text-[10px] text-muted-foreground">Manutenção</span>
            </div>
            <p className="text-lg font-bold">{openMaintenance}</p>
            <p className="text-[10px] text-muted-foreground">OS abertas</p>
          </CardContent>
        </Card>

        <Card className={`cursor-pointer hover:shadow transition-shadow ${pendingExpenses > 0 ? 'border-warning/40' : ''}`} onClick={() => navigate('/expense-approval')}>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Receipt className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-[10px] text-muted-foreground">Despesas</span>
            </div>
            <p className="text-lg font-bold">{pendingExpenses}</p>
            <p className="text-[10px] text-muted-foreground">pendentes</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Charts Row ── */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Carga por Destino */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" /> Carga por Destino
            </CardTitle>
          </CardHeader>
          <CardContent>
            {destChart.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={destChart} margin={{ left: -10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
                  <XAxis dataKey="dest" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid hsl(var(--border))' }}
                    formatter={(value: number, name: string) => [
                      name === 'weight' ? `${(value / 1000).toFixed(1)}t` : value,
                      name === 'weight' ? 'Peso' : 'Paletes',
                    ]}
                  />
                  <Bar dataKey="weight" fill="hsl(215, 80%, 48%)" radius={[4, 4, 0, 0]} name="Peso (kg)" />
                  <Bar dataKey="pallets" fill="hsl(142, 64%, 38%)" radius={[4, 4, 0, 0]} name="Paletes" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[220px] text-sm text-muted-foreground">
                Sem dados de destino disponíveis
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status Pie */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" /> Status das Cargas
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            {statusChart.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie
                      data={statusChart}
                      cx="50%" cy="50%"
                      innerRadius={40} outerRadius={65}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {statusChart.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center mt-1">
                  {statusChart.map((entry, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <div className="h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="text-[10px] text-muted-foreground">{entry.name} ({entry.value})</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-[180px] text-sm text-muted-foreground">
                Sem cargas
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── NF-e Flow Chart ── */}
      {nfeByDay.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" /> Fluxo de NF-es Recebidas
              </CardTitle>
              <Badge variant="secondary" className="text-[10px]">{stats.nfeCount} total</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={nfeByDay} margin={{ left: -10, right: 10 }}>
                <defs>
                  <linearGradient id="nfeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(215, 80%, 48%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(215, 80%, 48%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--muted))" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Area type="monotone" dataKey="qty" stroke="hsl(215, 80%, 48%)" fill="url(#nfeGrad)" strokeWidth={2} name="NF-es" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Bottom Section: Loads + Events ── */}
      <div className="grid lg:grid-cols-5 gap-4">
        {/* Recent Loads — wider */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <PackageCheck className="h-4 w-4" /> Cargas Recentes
              </CardTitle>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => navigate('/loads')}>
                Ver todas <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {loads.slice(0, 10).map((load: any) => {
                const vehicle = load.vehicles;
                const driver = load.drivers;
                return (
                  <div
                    key={load.id}
                    className="flex items-center justify-between py-2.5 px-4 cursor-pointer hover:bg-muted/40 transition-colors"
                    onClick={() => navigate(`/loads/${load.id}`)}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold">{load.load_number}</span>
                          {vehicle && (
                            <span className="text-[10px] text-muted-foreground">
                              <Truck className="inline h-2.5 w-2.5 mr-0.5" />{vehicle.plate}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {load.origin || '—'} → {load.destination || '—'}
                          {driver && <span className="ml-2">• {driver.name}</span>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right mr-2 hidden sm:block">
                        <p className="text-[10px] text-muted-foreground">{Number(load.total_weight_kg || 0).toFixed(0)} kg</p>
                        <p className="text-[10px] text-muted-foreground">{load.total_pallet_count || 0} pal</p>
                      </div>
                      <Badge className={`text-[10px] ${STATUS_COLORS[load.status] || ''}`} variant="secondary">
                        {STATUS_LABELS[load.status] || load.status}
                      </Badge>
                    </div>
                  </div>
                );
              })}
              {loads.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8">Nenhuma carga encontrada. Importe NF-es para começar.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Right Column: Events + Alerts */}
        <div className="lg:col-span-2 space-y-4">
          {/* Open Events */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" /> Ocorrências
                </CardTitle>
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => navigate('/events')}>
                  Ver todas <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {openEvents.slice(0, 5).map((evt: any) => (
                <div key={evt.id} className="flex items-center justify-between py-1.5 border-b last:border-0">
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{evt.event_type}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{evt.description || '—'}</p>
                  </div>
                  <Badge variant={evt.severity === 'high' ? 'destructive' : 'secondary'} className="text-[10px] shrink-0">
                    {evt.severity}
                  </Badge>
                </div>
              ))}
              {openEvents.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">Nenhuma ocorrência aberta ✓</p>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions / Alerts */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Ações Rápidas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" size="sm" className="w-full justify-start text-xs h-8" onClick={() => navigate('/ingestion')}>
                <FileText className="h-3.5 w-3.5 mr-2 text-blue-500" /> Importar NF-es
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start text-xs h-8" onClick={() => navigate('/route-planning')}>
                <MapPin className="h-3.5 w-3.5 mr-2 text-emerald-500" /> Planejar Rotas
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start text-xs h-8" onClick={() => navigate('/fiscal-documents')}>
                <Receipt className="h-3.5 w-3.5 mr-2 text-purple-500" /> Documentos Fiscais
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start text-xs h-8" onClick={() => navigate('/fleet-map')}>
                <Truck className="h-3.5 w-3.5 mr-2 text-indigo-500" /> Mapa da Frota
              </Button>
              {pendingExpenses > 0 && (
                <Button variant="outline" size="sm" className="w-full justify-start text-xs h-8 border-warning/40 text-warning" onClick={() => navigate('/expense-approval')}>
                  <Receipt className="h-3.5 w-3.5 mr-2" /> {pendingExpenses} despesa(s) pendente(s)
                </Button>
              )}
              {openMaintenance > 0 && (
                <Button variant="outline" size="sm" className="w-full justify-start text-xs h-8 border-orange-400/40 text-orange-600" onClick={() => navigate('/maintenance')}>
                  <Wrench className="h-3.5 w-3.5 mr-2" /> {openMaintenance} OS de manutenção
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
