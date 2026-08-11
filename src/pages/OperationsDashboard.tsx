import { useMemo } from 'react';
import { useOrders, ORDER_STATUS_LABELS, OrderStatus } from '@/hooks/useOrders';
import { useLoads, LOAD_STATUS_LABELS, LoadStatus } from '@/hooks/useLoads';
import { useInventoryBalances } from '@/hooks/useInventory';
import { useVehicles } from '@/hooks/useVehicles';
import { useIncidents, SEVERITY_LABELS, INCIDENT_STATUS_LABELS } from '@/hooks/useIncidents';
import { useEmployees } from '@/hooks/useEmployees';
import { useMaintenanceOrders, MAINT_STATUS_LABELS } from '@/hooks/useMaintenanceOrders';
import { useStockItems } from '@/hooks/useStock';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import {
  ShoppingCart, PackageCheck, Warehouse, Truck, AlertTriangle,
  Clock, Package, Activity, AlertOctagon, CheckCircle, TrendingDown,
  Users, Wrench, Boxes, DollarSign,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, differenceInDays, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const PIE_COLORS = ['hsl(var(--primary))', 'hsl(var(--destructive))', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#94a3b8', '#14b8a6'];

export default function OperationsDashboard() {
  const { data: orders = [] } = useOrders();
  const { data: loads = [] } = useLoads();
  const { data: balances = [] } = useInventoryBalances();
  const { data: vehicles = [] } = useVehicles();
  const { data: incidents = [] } = useIncidents();
  const { data: employees = [] } = useEmployees();
  const { data: maintenanceOrders = [] } = useMaintenanceOrders();
  const { data: stockItems = [] } = useStockItems();
  const navigate = useNavigate();

  const pendingOrders = orders.filter(o => !['delivered', 'cancelled', 'returned', 'refused'].includes(o.status));
  const delayedOrders = orders.filter(o => {
    if (!o.promised_date || ['delivered', 'cancelled', 'returned', 'refused'].includes(o.status)) return false;
    return new Date(o.promised_date + 'T23:59:59') < new Date();
  });

  const ordersByStatus = useMemo(() => {
    const counts: Record<string, number> = {};
    orders.forEach(o => { counts[o.status] = (counts[o.status] || 0) + 1; });
    return Object.entries(counts).map(([status, count]) => ({
      name: ORDER_STATUS_LABELS[status as OrderStatus] || status, value: count,
    }));
  }, [orders]);

  // Cargas ativas: exclui concluídas e canceladas
  const activeLoads = loads.filter(l => !['delivered', 'divergent', 'cancelled'].includes(l.status));
  const inTransitLoads = loads.filter(l => l.status === 'in_transit');
  const divergentLoads = loads.filter(l => l.status === 'divergent');
  const deliveredLoads = loads.filter(l => l.status === 'delivered').length;
  // Taxa de sucesso considera o que foi FINALIZADO (entregue vs divergente/devolvido)
  const completedLoads = deliveredLoads + divergentLoads.length;
  const deliverySuccessRate = completedLoads > 0 ? Math.round((deliveredLoads / completedLoads) * 100) : 100;

  // Incidents KPIs: exclui cancelados e resolvidos
  const openIncidents = incidents.filter(i => !['closed', 'cancelled', 'resolved'].includes(i.status));
  const criticalIncidents = incidents.filter(i => (i.severity === 'critical' || i.severity === 'high') && !['closed', 'cancelled', 'resolved'].includes(i.status));
  const incidentCost = incidents.reduce((s, i) => s + (i.actual_cost || i.estimated_cost || 0), 0);

  // Maintenance KPIs
  const openMaintenance = maintenanceOrders.filter(o => !['completed', 'closed', 'cancelled'].includes(o.status));
  const maintenanceCost = maintenanceOrders.reduce((s, o) => s + (o.total_cost || 0), 0);

  // Employee KPIs
  const expiringDocs = employees.filter(e => {
    const now = new Date();
    if (e.cnh_expiry && differenceInDays(parseISO(e.cnh_expiry), now) < 30) return true;
    if (e.medical_exam_expiry && differenceInDays(parseISO(e.medical_exam_expiry), now) < 30) return true;
    return false;
  });

  // Stock KPIs
  const lowStockItems = stockItems.filter(i => i.current_quantity <= i.min_quantity && i.min_quantity > 0);

  const totalPalletsInStock = balances.reduce((s, b) => s + Math.max(0, b.pallet_count), 0);

  // Vehicle occupancy
  const vehicleOccupancy = useMemo(() => {
    const vehiclesWithCapacity = vehicles.filter((v: any) => v.max_pallets && v.max_pallets > 0);
    return vehiclesWithCapacity.map((v: any) => {
      const vehicleLoads = loads.filter(l => l.vehicle_id === v.id && ['loaded', 'in_transit'].includes(l.status));
      const totalPallets = vehicleLoads.reduce((s, l) => s + (l.total_pallet_count || 0), 0);
      const occupancy = Math.min(100, Math.round((totalPallets / v.max_pallets) * 100));
      return { plate: v.plate, nickname: v.nickname, maxPallets: v.max_pallets, loadedPallets: totalPallets, occupancy };
    }).sort((a, b) => b.occupancy - a.occupancy);
  }, [vehicles, loads]);

  // Stock by client
  const stockByClient = useMemo(() => {
    const map: Record<string, { name: string; pallets: number }> = {};
    balances.forEach(b => {
      if (b.quantity <= 0) return;
      const key = b.client_id || 'sem_cliente';
      const name = b.clients?.company_name || 'Sem cliente';
      if (!map[key]) map[key] = { name, pallets: 0 };
      map[key].pallets += b.pallet_count;
    });
    return Object.values(map).sort((a, b) => b.pallets - a.pallets);
  }, [balances]);

  // Incidents by type chart
  const incidentsByType = useMemo(() => {
    const counts: Record<string, number> = {};
    incidents.forEach(i => { counts[i.incident_type] = (counts[i.incident_type] || 0) + 1; });
    return Object.entries(counts).map(([type, count]) => ({ name: type, value: count }));
  }, [incidents]);

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" /> Painel Operacional
        </h1>
        <p className="text-sm text-muted-foreground">Visão consolidada de operações, frota, RH e manutenção</p>
      </div>

      {/* Main KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <KPICard icon={<ShoppingCart className="h-3.5 w-3.5 text-primary" />} label="Pedidos Pendentes" value={pendingOrders.length} onClick={() => navigate('/orders')} />
        <KPICard icon={<AlertTriangle className="h-3.5 w-3.5 text-destructive" />} label="Atrasados" value={delayedOrders.length} alert={delayedOrders.length > 0} onClick={() => navigate('/orders')} />
        <KPICard icon={<PackageCheck className="h-3.5 w-3.5 text-primary" />} label="Cargas Ativas" value={activeLoads.length} onClick={() => navigate('/loads')} />
        <KPICard icon={<Truck className="h-3.5 w-3.5 text-info" />} label="Em Trânsito" value={inTransitLoads.length} onClick={() => navigate('/loads')} />
        <KPICard icon={<CheckCircle className="h-3.5 w-3.5 text-success" />} label="Sucesso Entrega" value={`${deliverySuccessRate}%`} />
        <KPICard icon={<Package className="h-3.5 w-3.5 text-primary" />} label="Paletes Estoque" value={totalPalletsInStock} onClick={() => navigate('/inventory')} />
      </div>

      {/* Secondary KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <KPICard icon={<AlertOctagon className="h-3.5 w-3.5 text-destructive" />} label="Ocorrências Abertas" value={openIncidents.length} alert={criticalIncidents.length > 0} onClick={() => navigate('/incidents')} />
        <KPICard icon={<DollarSign className="h-3.5 w-3.5 text-warning" />} label="Custo Ocorrências" value={`R$ ${(incidentCost / 1000).toFixed(1)}k`} onClick={() => navigate('/incidents')} />
        <KPICard icon={<Wrench className="h-3.5 w-3.5 text-primary" />} label="OS Abertas" value={openMaintenance.length} onClick={() => navigate('/maintenance-orders')} />
        <KPICard icon={<DollarSign className="h-3.5 w-3.5 text-primary" />} label="Custo Manutenção" value={`R$ ${(maintenanceCost / 1000).toFixed(1)}k`} onClick={() => navigate('/maintenance-orders')} />
        <KPICard icon={<Users className="h-3.5 w-3.5 text-warning" />} label="Docs Vencendo" value={expiringDocs.length} alert={expiringDocs.length > 0} onClick={() => navigate('/employees')} />
        <KPICard icon={<Boxes className="h-3.5 w-3.5 text-warning" />} label="Estoque Baixo" value={lowStockItems.length} alert={lowStockItems.length > 0} onClick={() => navigate('/stock')} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Pedidos por Status</CardTitle></CardHeader>
          <CardContent>
            {ordersByStatus.length === 0 ? (
              <p className="text-center text-muted-foreground py-8 text-sm">Sem pedidos</p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={ordersByStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`}>
                    {ordersByStatus.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Estoque por Cliente (paletes)</CardTitle></CardHeader>
          <CardContent>
            {stockByClient.length === 0 ? (
              <p className="text-center text-muted-foreground py-8 text-sm">Sem estoque</p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={stockByClient.slice(0, 10)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="pallets" fill="hsl(var(--primary))" name="Paletes" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tables row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Critical incidents */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertOctagon className="h-4 w-4 text-destructive" /> Ocorrências Críticas / Abertas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Nº</TableHead><TableHead>Título</TableHead><TableHead>Gravidade</TableHead><TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {openIncidents.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4 text-sm">Nenhuma ocorrência aberta 🎉</TableCell></TableRow>
                ) : openIncidents.slice(0, 8).map(i => (
                  <TableRow key={i.id} className="cursor-pointer hover:bg-accent/50" onClick={() => navigate('/incidents')}>
                    <TableCell className="font-mono text-xs">{i.incident_number}</TableCell>
                    <TableCell className="text-sm max-w-[180px] truncate">{i.title}</TableCell>
                    <TableCell><Badge variant="outline" className={`text-[10px] ${i.severity === 'critical' ? 'bg-destructive/10 text-destructive' : i.severity === 'high' ? 'bg-orange-500/10 text-orange-600' : ''}`}>{SEVERITY_LABELS[i.severity]}</Badge></TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{INCIDENT_STATUS_LABELS[i.status]}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Maintenance open */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Wrench className="h-4 w-4 text-primary" /> Manutenções em Aberto
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>OS</TableHead><TableHead>Veículo</TableHead><TableHead>Custo</TableHead><TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {openMaintenance.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4 text-sm">Nenhuma OS aberta</TableCell></TableRow>
                ) : openMaintenance.slice(0, 8).map(o => (
                  <TableRow key={o.id} className="cursor-pointer hover:bg-accent/50" onClick={() => navigate('/maintenance-orders')}>
                    <TableCell className="font-mono text-xs">{o.order_number}</TableCell>
                    <TableCell className="text-sm">{o.vehicles?.plate || '—'}</TableCell>
                    <TableCell className="text-sm">R$ {(o.total_cost || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{MAINT_STATUS_LABELS[o.status]}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Vehicle occupancy + Delayed orders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" /> Pedidos Atrasados
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Pedido</TableHead><TableHead>Cliente</TableHead><TableHead>Prometido</TableHead><TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {delayedOrders.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4 text-sm">Nenhum pedido atrasado 🎉</TableCell></TableRow>
                ) : delayedOrders.slice(0, 8).map(o => (
                  <TableRow key={o.id} className="cursor-pointer hover:bg-accent/50" onClick={() => navigate('/orders')}>
                    <TableCell className="font-medium">{o.order_number}</TableCell>
                    <TableCell className="text-sm">{o.clients?.company_name || '—'}</TableCell>
                    <TableCell className="text-sm text-destructive">{o.promised_date ? formatDistanceToNow(new Date(o.promised_date + 'T23:59:59'), { addSuffix: true, locale: ptBR }) : '—'}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{ORDER_STATUS_LABELS[o.status] || o.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Truck className="h-4 w-4 text-primary" /> Ocupação de Veículos
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Veículo</TableHead><TableHead>Carregado</TableHead><TableHead>Capacidade</TableHead><TableHead>Ocupação</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {vehicleOccupancy.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4 text-sm">Configure a capacidade dos veículos</TableCell></TableRow>
                ) : vehicleOccupancy.slice(0, 8).map(v => (
                  <TableRow key={v.plate}>
                    <TableCell className="font-medium">{v.plate}{v.nickname ? ` (${v.nickname})` : ''}</TableCell>
                    <TableCell>{v.loadedPallets} pal</TableCell>
                    <TableCell className="text-muted-foreground">{v.maxPallets} pal</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={v.occupancy} className={`w-16 h-2 ${v.occupancy > 90 ? '[&>div]:bg-destructive' : v.occupancy > 60 ? '[&>div]:bg-warning' : ''}`} />
                        <span className="text-xs font-medium">{v.occupancy}%</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KPICard({ icon, label, value, alert, onClick }: { icon: React.ReactNode; label: string; value: string | number; alert?: boolean; onClick?: () => void }) {
  return (
    <Card className={`${onClick ? 'cursor-pointer hover:bg-accent/50' : ''} transition-colors ${alert ? 'border-destructive/50' : ''}`} onClick={onClick}>
      <CardContent className="pt-3 pb-2">
        <div className="flex items-center gap-1 mb-1">
          {icon}
          <span className="text-[10px] text-muted-foreground">{label}</span>
        </div>
        <div className={`text-xl font-bold ${alert ? 'text-destructive' : ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
