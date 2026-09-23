import { ORDER_STATUS_LABELS, OrderStatus } from '@/hooks/useOrders';
import { useInventorySummary } from '@/hooks/useInventory';
import { SEVERITY_LABELS, INCIDENT_STATUS_LABELS } from '@/hooks/useIncidents';
import { MAINT_STATUS_LABELS } from '@/hooks/useMaintenanceOrders';
import { useOperationsDashboardSummary } from '@/hooks/useOperationsDashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import {
  ShoppingCart, PackageCheck, Truck, AlertTriangle,
  Package, Activity, AlertOctagon, CheckCircle,
  Users, Wrench, Boxes, DollarSign, RefreshCw,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const PIE_COLORS = ['hsl(var(--primary))', 'hsl(var(--destructive))', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#94a3b8', '#14b8a6'];

export default function OperationsDashboard() {
  const dashboardQuery=useOperationsDashboardSummary();
  const inventoryQuery = useInventorySummary();
  const dashboard=dashboardQuery.data;
  const { data: inventorySummary } = inventoryQuery;
  const navigate = useNavigate();
  const ordersByStatus=(dashboard?.orders_by_status??[]).map(item=>({name:ORDER_STATUS_LABELS[item.status as OrderStatus]||item.status,value:item.count}));
  const delayedOrders=dashboard?.delayed_order_rows??[],openIncidents=dashboard?.incident_rows??[],openMaintenance=dashboard?.maintenance_rows??[],vehicleOccupancy=dashboard?.vehicle_occupancy_rows??[];

  const totalPalletsInStock = inventorySummary?.totalPallets ?? 0;

  // Stock by client
  const stockByClient = inventorySummary?.stockByClient ?? [];

  const failedQueries = [
    { name: 'resumo operacional', query: dashboardQuery },
    { name: 'saldos de estoque', query: inventoryQuery },
  ].filter(({ query }) => query.isError);

  if (failedQueries.length > 0) {
    return (
      <div className="animate-fade-in space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" /> Painel Operacional
          </h1>
          <p className="text-sm text-muted-foreground">Visão consolidada de operações, frota, RH e manutenção</p>
        </div>
        <Card className="border-destructive/50" role="alert">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertTriangle className="h-7 w-7 text-destructive" />
            <div>
              <p className="font-medium text-destructive">Não foi possível montar o painel operacional</p>
              <p className="text-sm text-muted-foreground">
                Fontes indisponíveis: {failedQueries.map(({ name }) => name).join(', ')}. Nenhum indicador parcial será apresentado.
              </p>
            </div>
            <Button variant="outline" onClick={() => void Promise.all(failedQueries.map(({ query }) => query.refetch()))}>
              <RefreshCw className="mr-2 h-4 w-4" /> Tentar novamente
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

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
        <KPICard icon={<ShoppingCart className="h-3.5 w-3.5 text-primary" />} label="Pedidos Pendentes" value={dashboard?.pending_orders??'—'} onClick={() => navigate('/orders')} />
        <KPICard icon={<AlertTriangle className="h-3.5 w-3.5 text-destructive" />} label="Atrasados" value={dashboard?.delayed_orders??'—'} alert={(dashboard?.delayed_orders??0) > 0} onClick={() => navigate('/orders')} />
        <KPICard icon={<PackageCheck className="h-3.5 w-3.5 text-primary" />} label="Cargas Ativas" value={dashboard?.active_loads??'—'} onClick={() => navigate('/loads')} />
        <KPICard icon={<Truck className="h-3.5 w-3.5 text-info" />} label="Em Trânsito" value={dashboard?.in_transit_loads??'—'} onClick={() => navigate('/loads')} />
        <KPICard icon={<CheckCircle className="h-3.5 w-3.5 text-success" />} label="Sucesso Entrega" value={dashboard?.delivery_success_rate==null ? '—' : `${dashboard.delivery_success_rate}%`} />
        <KPICard icon={<Package className="h-3.5 w-3.5 text-primary" />} label="Paletes Estoque" value={totalPalletsInStock} onClick={() => navigate('/inventory')} />
      </div>

      {/* Secondary KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <KPICard icon={<AlertOctagon className="h-3.5 w-3.5 text-destructive" />} label="Ocorrências Abertas" value={dashboard?.open_incidents??'—'} alert={(dashboard?.critical_incidents??0) > 0} onClick={() => navigate('/incidents')} />
        <KPICard icon={<DollarSign className="h-3.5 w-3.5 text-warning" />} label="Custo Ocorrências" value={dashboard?`R$ ${(dashboard.incident_cost / 1000).toFixed(1)}k`:'—'} onClick={() => navigate('/incidents')} />
        <KPICard icon={<Wrench className="h-3.5 w-3.5 text-primary" />} label="OS Abertas" value={dashboard?.open_maintenance??'—'} onClick={() => navigate('/maintenance-orders')} />
        <KPICard icon={<DollarSign className="h-3.5 w-3.5 text-primary" />} label="Custo Manutenção" value={dashboard?`R$ ${(dashboard.maintenance_cost / 1000).toFixed(1)}k`:'—'} onClick={() => navigate('/maintenance-orders')} />
        <KPICard icon={<Users className="h-3.5 w-3.5 text-warning" />} label="Docs Vencendo" value={dashboard?.expiring_docs??'—'} alert={(dashboard?.expiring_docs??0) > 0} onClick={() => navigate('/employees')} />
        <KPICard icon={<Boxes className="h-3.5 w-3.5 text-warning" />} label="Estoque Baixo" value={dashboard?.low_stock??'—'} alert={(dashboard?.low_stock??0) > 0} onClick={() => navigate('/stock')} />
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
                ) : openIncidents.map(i => (
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
                ) : openMaintenance.map(o => (
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
                ) : delayedOrders.map(o => (
                  <TableRow key={o.id} className="cursor-pointer hover:bg-accent/50" onClick={() => navigate('/orders')}>
                    <TableCell className="font-medium">{o.order_number}</TableCell>
                    <TableCell className="text-sm">{o.clients?.company_name || '—'}</TableCell>
                    <TableCell className="text-sm text-destructive">{o.days_overdue===1?'há 1 dia':`há ${o.days_overdue} dias`}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{ORDER_STATUS_LABELS[o.status as OrderStatus] || o.status}</Badge></TableCell>
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
                ) : vehicleOccupancy.map(v => (
                  <TableRow key={v.plate}>
                    <TableCell className="font-medium">{v.plate}{v.nickname ? ` (${v.nickname})` : ''}</TableCell>
                    <TableCell>{v.loaded_pallets} pal</TableCell>
                    <TableCell className="text-muted-foreground">{v.max_pallets} pal</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress aria-label={`Ocupação do veículo ${v.plate}`} aria-valuetext={`${v.occupancy}%`} value={Math.min(100, v.occupancy)} className={`w-16 h-2 ${v.occupancy > 90 ? '[&>div]:bg-destructive' : v.occupancy > 60 ? '[&>div]:bg-warning' : ''}`} />
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
