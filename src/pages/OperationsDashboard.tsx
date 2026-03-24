import { useMemo } from 'react';
import { useOrders, ORDER_STATUS_LABELS, OrderStatus } from '@/hooks/useOrders';
import { useLoads, LOAD_STATUS_LABELS, LoadStatus } from '@/hooks/useLoads';
import { useInventoryBalances } from '@/hooks/useInventory';
import { useVehicles } from '@/hooks/useVehicles';
import { useClients } from '@/hooks/useClients';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import {
  ShoppingCart, PackageCheck, Warehouse, Truck, AlertTriangle,
  Clock, TrendingUp, Users, Package, Activity,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const PIE_COLORS = ['hsl(var(--primary))', 'hsl(var(--destructive))', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#94a3b8', '#14b8a6'];

export default function OperationsDashboard() {
  const { data: orders = [] } = useOrders();
  const { data: loads = [] } = useLoads();
  const { data: balances = [] } = useInventoryBalances();
  const { data: vehicles = [] } = useVehicles();
  const { data: clients = [] } = useClients();
  const navigate = useNavigate();

  // Orders metrics
  const pendingOrders = orders.filter(o => !['delivered', 'cancelled'].includes(o.status));
  const delayedOrders = orders.filter(o => {
    if (!o.promised_date || o.status === 'delivered' || o.status === 'cancelled') return false;
    return new Date(o.promised_date + 'T23:59:59') < new Date();
  });

  // Order status distribution
  const ordersByStatus = useMemo(() => {
    const counts: Record<string, number> = {};
    orders.forEach(o => { counts[o.status] = (counts[o.status] || 0) + 1; });
    return Object.entries(counts).map(([status, count]) => ({
      name: ORDER_STATUS_LABELS[status as OrderStatus] || status,
      value: count,
    }));
  }, [orders]);

  // Loads metrics
  const activeLoads = loads.filter(l => !['delivered', 'divergent'].includes(l.status));
  const assemblingLoads = loads.filter(l => l.status === 'planned' || l.status === 'assembling');
  const inTransitLoads = loads.filter(l => l.status === 'in_transit');

  // Vehicle occupancy
  const vehicleOccupancy = useMemo(() => {
    const vehiclesWithCapacity = vehicles.filter((v: any) => v.max_pallets && v.max_pallets > 0);
    return vehiclesWithCapacity.map((v: any) => {
      const vehicleLoads = loads.filter(l => l.vehicle_id === v.id && ['loaded', 'in_transit'].includes(l.status));
      const totalPallets = vehicleLoads.reduce((s, l) => s + (l.total_pallet_count || 0), 0);
      const occupancy = Math.min(100, Math.round((totalPallets / v.max_pallets) * 100));
      return {
        plate: v.plate,
        nickname: v.nickname,
        maxPallets: v.max_pallets,
        loadedPallets: totalPallets,
        occupancy,
        loadCount: vehicleLoads.length,
      };
    }).sort((a, b) => b.occupancy - a.occupancy);
  }, [vehicles, loads]);

  // Stock by client
  const stockByClient = useMemo(() => {
    const map: Record<string, { name: string; pallets: number; items: number }> = {};
    balances.forEach(b => {
      if (b.quantity <= 0) return;
      const key = b.client_id || 'sem_cliente';
      const name = b.clients?.company_name || 'Sem cliente';
      if (!map[key]) map[key] = { name, pallets: 0, items: 0 };
      map[key].pallets += b.pallet_count;
      map[key].items += 1;
    });
    return Object.values(map).sort((a, b) => b.pallets - a.pallets);
  }, [balances]);

  // Stagnant inventory
  const stagnantCount = balances.filter(b => {
    if (b.quantity <= 0) return false;
    if (!b.first_inbound_at) return false;
    return Date.now() - new Date(b.first_inbound_at).getTime() > 30 * 24 * 60 * 60 * 1000;
  }).length;

  // Total pallets
  const totalPalletsInStock = balances.reduce((s, b) => s + Math.max(0, b.pallet_count), 0);
  const totalPalletsInLoads = loads
    .filter(l => ['assembling', 'ready', 'loading', 'loaded', 'in_transit'].includes(l.status))
    .reduce((s, l) => s + (l.total_pallet_count || 0), 0);

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" /> Painel Operacional
        </h1>
        <p className="text-sm text-muted-foreground">Visão geral das operações logísticas</p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => navigate('/orders')}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <ShoppingCart className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Pedidos Pendentes</span>
            </div>
            <div className="text-2xl font-bold">{pendingOrders.length}</div>
          </CardContent>
        </Card>

        <Card className={`cursor-pointer hover:bg-accent/50 transition-colors ${delayedOrders.length > 0 ? 'border-destructive/50' : ''}`} onClick={() => navigate('/orders')}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className={`h-4 w-4 ${delayedOrders.length > 0 ? 'text-destructive' : 'text-muted-foreground'}`} />
              <span className="text-xs text-muted-foreground">Atrasados</span>
            </div>
            <div className={`text-2xl font-bold ${delayedOrders.length > 0 ? 'text-destructive' : ''}`}>{delayedOrders.length}</div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => navigate('/loads')}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <PackageCheck className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Cargas Ativas</span>
            </div>
            <div className="text-2xl font-bold">{activeLoads.length}</div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => navigate('/loads')}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Truck className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Em Trânsito</span>
            </div>
            <div className="text-2xl font-bold text-blue-500">{inTransitLoads.length}</div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => navigate('/inventory')}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Paletes Estoque</span>
            </div>
            <div className="text-2xl font-bold">{totalPalletsInStock}</div>
          </CardContent>
        </Card>

        <Card className={`cursor-pointer hover:bg-accent/50 transition-colors ${stagnantCount > 0 ? 'border-warning/50' : ''}`} onClick={() => navigate('/inventory')}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock className={`h-4 w-4 ${stagnantCount > 0 ? 'text-warning' : 'text-muted-foreground'}`} />
              <span className="text-xs text-muted-foreground">Parados +30d</span>
            </div>
            <div className={`text-2xl font-bold ${stagnantCount > 0 ? 'text-warning' : ''}`}>{stagnantCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Orders by status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pedidos por Status</CardTitle>
          </CardHeader>
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

        {/* Stock by client */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Estoque por Cliente (paletes)</CardTitle>
          </CardHeader>
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
        {/* Delayed orders */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" /> Pedidos Atrasados
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Prometido</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {delayedOrders.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4 text-sm">Nenhum pedido atrasado 🎉</TableCell></TableRow>
                ) : delayedOrders.slice(0, 10).map(o => (
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

        {/* Vehicle occupancy */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Truck className="h-4 w-4 text-primary" /> Ocupação de Veículos
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Veículo</TableHead>
                  <TableHead>Carregado</TableHead>
                  <TableHead>Capacidade</TableHead>
                  <TableHead>Ocupação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicleOccupancy.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4 text-sm">Configure a capacidade dos veículos primeiro</TableCell></TableRow>
                ) : vehicleOccupancy.slice(0, 10).map(v => (
                  <TableRow key={v.plate}>
                    <TableCell className="font-medium">{v.plate}{v.nickname ? ` (${v.nickname})` : ''}</TableCell>
                    <TableCell>{v.loadedPallets} pal</TableCell>
                    <TableCell className="text-muted-foreground">{v.maxPallets} pal</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full ${v.occupancy > 90 ? 'bg-destructive' : v.occupancy > 60 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${v.occupancy}%` }} />
                        </div>
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

      {/* Loads in assembly */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <PackageCheck className="h-4 w-4 text-warning" /> Cargas em Montagem ({assemblingLoads.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Carga</TableHead>
                <TableHead>Veículo</TableHead>
                <TableHead>Destino</TableHead>
                <TableHead>Paletes</TableHead>
                <TableHead>Peso</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assemblingLoads.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-4 text-sm">Nenhuma carga em montagem</TableCell></TableRow>
              ) : assemblingLoads.map(l => (
                <TableRow key={l.id} className="cursor-pointer hover:bg-accent/50" onClick={() => navigate('/loads')}>
                  <TableCell className="font-medium">{l.load_number}</TableCell>
                  <TableCell className="text-sm">{l.vehicles?.plate || 'Não alocado'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{l.destination || '—'}</TableCell>
                  <TableCell>{l.total_pallet_count}</TableCell>
                  <TableCell>{l.total_weight_kg ? `${l.total_weight_kg} kg` : '—'}</TableCell>
                  <TableCell><Badge variant="outline" className="bg-warning/10 text-warning">{LOAD_STATUS_LABELS[l.status] || l.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
