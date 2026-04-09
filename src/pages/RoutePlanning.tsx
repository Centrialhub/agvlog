import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useClients } from '@/hooks/useClients';
import { useVehicles } from '@/hooks/useVehicles';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  Route, Plus, Wand2, ArrowUpDown, Trash2, GripVertical,
  PackageCheck, MapPin, Truck, Calendar, ChevronDown, ChevronUp,
  FileText, Edit, Copy, Send, Download,
} from 'lucide-react';
import { format } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/* ────────────── types ────────────── */
interface PendingOrder {
  id: string;
  order_number: string;
  client_id: string | null;
  destination: string | null;
  origin: string | null;
  weight_kg: number | null;
  volume_m3: number | null;
  pallet_count: number;
  value: number | null;
  total_freight: number | null;
  status: string;
  issue_date: string | null;
  remitter: string | null;
  recipient: string | null;
  city: string | null;
  neighborhood: string | null;
  clients?: { company_name: string } | null;
}

interface RoutePlan {
  id: string;
  name: string;
  orders: PendingOrder[];
  vehicle_id?: string;
  notes?: string;
  collapsed?: boolean;
}

/* ────────────── helpers ────────────── */
const groupByDestination = (orders: PendingOrder[]): Record<string, PendingOrder[]> => {
  const groups: Record<string, PendingOrder[]> = {};
  orders.forEach(o => {
    const key = (o.destination || 'Sem destino').trim().toUpperCase();
    if (!groups[key]) groups[key] = [];
    groups[key].push(o);
  });
  return groups;
};

/* ────────────── main component ────────────── */
export default function RoutePlanning() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const { data: clients = [] } = useClients();
  const { data: vehicles = [] } = useVehicles();
  const qc = useQueryClient();

  // Pending orders (not yet assigned to a load or still in early statuses)
  const { data: pendingOrders = [], isLoading } = useQuery({
    queryKey: ['pending_orders_for_routing', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('orders')
        .select('*, clients(company_name)')
        .eq('tenant_id', currentTenant.id)
        .in('status', ['received', 'waiting_stock', 'picking', 'ready_for_loading'])
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as PendingOrder[];
    },
    enabled: !!currentTenant,
  });

  const [routes, setRoutes] = useState<RoutePlan[]>([]);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [filterDest, setFilterDest] = useState('all');
  const [filterClient, setFilterClient] = useState('all');
  const [newRouteName, setNewRouteName] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  // Which orders are already in a route plan
  const assignedOrderIds = useMemo(
    () => new Set(routes.flatMap(r => r.orders.map(o => o.id))),
    [routes]
  );

  const availableOrders = useMemo(() => {
    return pendingOrders.filter(o => !assignedOrderIds.has(o.id));
  }, [pendingOrders, assignedOrderIds]);

  const filteredOrders = useMemo(() => {
    let result = availableOrders;
    if (filterDest !== 'all') result = result.filter(o => (o.destination || '').toUpperCase().includes(filterDest));
    if (filterClient !== 'all') result = result.filter(o => o.client_id === filterClient);
    return result;
  }, [availableOrders, filterDest, filterClient]);

  const destinations = useMemo(() => {
    const set = new Set(availableOrders.map(o => (o.destination || 'Sem destino').trim().toUpperCase()));
    return Array.from(set).sort();
  }, [availableOrders]);

  /* ──── actions ──── */
  const toggleOrder = (id: string) => {
    setSelectedOrders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedOrders.size === filteredOrders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(filteredOrders.map(o => o.id)));
    }
  };

  const addToRoute = (routeId: string) => {
    const selected = availableOrders.filter(o => selectedOrders.has(o.id));
    if (selected.length === 0) return;
    setRoutes(prev => prev.map(r =>
      r.id === routeId ? { ...r, orders: [...r.orders, ...selected] } : r
    ));
    setSelectedOrders(new Set());
  };

  const createRouteFromSelected = () => {
    const selected = availableOrders.filter(o => selectedOrders.has(o.id));
    if (selected.length === 0) return;
    const dest = selected[0].destination || 'Rota';
    const name = newRouteName || `${dest} - ${format(new Date(), 'dd/MM')}`;
    setRoutes(prev => [...prev, {
      id: crypto.randomUUID(),
      name,
      orders: selected,
    }]);
    setSelectedOrders(new Set());
    setNewRouteName('');
    setDialogOpen(false);
  };

  const autoSuggest = () => {
    const groups = groupByDestination(availableOrders);
    const suggested: RoutePlan[] = Object.entries(groups).map(([dest, orders]) => ({
      id: crypto.randomUUID(),
      name: `${dest} - ${format(new Date(), 'dd/MM')}`,
      orders,
    }));
    setRoutes(prev => [...prev, ...suggested]);
    setSelectedOrders(new Set());
    toast.success(`${suggested.length} rotas sugeridas criadas`);
  };

  const removeOrderFromRoute = (routeId: string, orderId: string) => {
    setRoutes(prev => prev.map(r =>
      r.id === routeId ? { ...r, orders: r.orders.filter(o => o.id !== orderId) } : r
    ));
  };

  const removeRoute = (routeId: string) => {
    setRoutes(prev => prev.filter(r => r.id !== routeId));
  };

  const toggleRouteCollapse = (routeId: string) => {
    setRoutes(prev => prev.map(r =>
      r.id === routeId ? { ...r, collapsed: !r.collapsed } : r
    ));
  };

  const moveOrder = (routeId: string, orderId: string, direction: 'up' | 'down') => {
    setRoutes(prev => prev.map(r => {
      if (r.id !== routeId) return r;
      const idx = r.orders.findIndex(o => o.id === orderId);
      if (idx < 0) return r;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= r.orders.length) return r;
      const orders = [...r.orders];
      [orders[idx], orders[newIdx]] = [orders[newIdx], orders[idx]];
      return { ...r, orders };
    }));
  };

  // Convert route plan to load
  const createLoadMutation = useMutation({
    mutationFn: async (route: RoutePlan) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const loadNumber = `ROM-${format(new Date(), 'ddMMyy')}-${Math.floor(Math.random() * 9000 + 1000)}`;
      const totalWeight = route.orders.reduce((s, o) => s + (Number(o.weight_kg) || 0), 0);
      const totalVolume = route.orders.reduce((s, o) => s + (Number(o.volume_m3) || 0), 0);
      const totalPallets = route.orders.reduce((s, o) => s + (o.pallet_count || 0), 0);
      const destinations = [...new Set(route.orders.map(o => o.destination).filter(Boolean))];

      const { data: load, error } = await supabase.from('loads').insert({
        tenant_id: currentTenant.id,
        load_number: loadNumber,
        status: 'planned',
        origin: route.orders[0]?.origin || null,
        destination: destinations.join(' / ') || null,
        vehicle_id: route.vehicle_id || null,
        total_weight_kg: totalWeight,
        total_volume_m3: totalVolume,
        total_pallet_count: totalPallets,
        notes: route.notes || `Romaneio: ${route.name}`,
        created_by: user?.id,
      } as any).select().single();
      if (error) throw error;

      // Create load_items for each order
      const items = route.orders.map((o, i) => ({
        tenant_id: currentTenant.id,
        load_id: load.id,
        order_id: o.id,
        item_description: `${o.order_number} - ${o.recipient || o.clients?.company_name || 'Pedido'}`,
        quantity: 1,
        pallet_count: o.pallet_count || 0,
        weight_kg: Number(o.weight_kg) || 0,
        volume_m3: Number(o.volume_m3) || 0,
        status: 'pending',
      }));
      if (items.length > 0) {
        const { error: itemsErr } = await supabase.from('load_items').insert(items as any);
        if (itemsErr) throw itemsErr;
      }

      // Link orders to load
      const loadOrders = route.orders.map(o => ({
        tenant_id: currentTenant.id,
        load_id: load.id,
        order_id: o.id,
      }));
      if (loadOrders.length > 0) {
        const { error: loErr } = await supabase.from('load_orders').insert(loadOrders as any);
        if (loErr) throw loErr;
      }

      // Update order statuses
      await supabase.from('orders').update({ status: 'loading' } as any)
        .in('id', route.orders.map(o => o.id));

      return load;
    },
    onSuccess: (_, route) => {
      removeRoute(route.id);
      qc.invalidateQueries({ queryKey: ['loads'] });
      qc.invalidateQueries({ queryKey: ['pending_orders_for_routing'] });
      toast.success('Carga/Romaneio criado com sucesso!');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const routeTotals = (route: RoutePlan) => ({
    orders: route.orders.length,
    weight: route.orders.reduce((s, o) => s + (Number(o.weight_kg) || 0), 0),
    pallets: route.orders.reduce((s, o) => s + (o.pallet_count || 0), 0),
    freight: route.orders.reduce((s, o) => s + (Number(o.total_freight) || 0), 0),
    value: route.orders.reduce((s, o) => s + (Number(o.value) || 0), 0),
  });

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Route className="h-6 w-6 text-primary" /> Planejamento de Rotas
          </h1>
          <p className="text-sm text-muted-foreground">
            Monte romaneios agrupando pedidos por destino. O sistema sugere, você ajusta.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={autoSuggest} disabled={availableOrders.length === 0}>
            <Wand2 className="h-4 w-4 mr-2" /> Sugerir Rotas
          </Button>
          <Button onClick={() => { if (selectedOrders.size > 0) setDialogOpen(true); else toast.info('Selecione pedidos primeiro'); }}>
            <Plus className="h-4 w-4 mr-2" /> Criar Rota Manual
          </Button>
        </div>
      </div>

      {/* ──── Available Orders ──── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Pedidos Disponíveis
            <Badge variant="secondary" className="ml-2">{availableOrders.length}</Badge>
          </CardTitle>
          <div className="flex gap-2 flex-wrap pt-2">
            <Select value={filterDest} onValueChange={setFilterDest}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Destino" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os destinos</SelectItem>
                {destinations.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterClient} onValueChange={setFilterClient}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Cliente" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os clientes</SelectItem>
                {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
              </SelectContent>
            </Select>
            {selectedOrders.size > 0 && routes.length > 0 && (
              <Select onValueChange={addToRoute}>
                <SelectTrigger className="w-56"><SelectValue placeholder={`Adicionar ${selectedOrders.size} a rota...`} /></SelectTrigger>
                <SelectContent>
                  {routes.map(r => <SelectItem key={r.id} value={r.id}>{r.name} ({r.orders.length})</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-center py-8 text-muted-foreground">Carregando...</p>
          ) : availableOrders.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">Nenhum pedido pendente para roteirização</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={selectedOrders.size === filteredOrders.length && filteredOrders.length > 0} onCheckedChange={selectAll} />
                  </TableHead>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Destinatário</TableHead>
                  <TableHead>Destino</TableHead>
                  <TableHead className="text-right">Peso</TableHead>
                  <TableHead className="text-right">Paletes</TableHead>
                  <TableHead className="text-right">Frete</TableHead>
                  <TableHead>Emissão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map(o => (
                  <TableRow key={o.id} className={selectedOrders.has(o.id) ? 'bg-primary/5' : ''}>
                    <TableCell><Checkbox checked={selectedOrders.has(o.id)} onCheckedChange={() => toggleOrder(o.id)} /></TableCell>
                    <TableCell className="font-medium text-sm">{o.order_number}</TableCell>
                    <TableCell className="text-sm">{o.clients?.company_name || '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{o.recipient || '—'}</TableCell>
                    <TableCell className="text-sm"><Badge variant="outline" className="text-xs">{o.destination || '—'}</Badge></TableCell>
                    <TableCell className="text-sm text-right">{o.weight_kg ? `${o.weight_kg} kg` : '—'}</TableCell>
                    <TableCell className="text-sm text-right">{o.pallet_count || 0}</TableCell>
                    <TableCell className="text-sm text-right font-medium">{o.total_freight ? `R$ ${Number(o.total_freight).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{o.issue_date ? format(new Date(o.issue_date + 'T12:00:00'), 'dd/MM') : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ──── Route Plans ──── */}
      {routes.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Rotas Planejadas ({routes.length})</h2>
          {routes.map(route => {
            const totals = routeTotals(route);
            return (
              <Card key={route.id} className="border-primary/20">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 cursor-pointer" onClick={() => toggleRouteCollapse(route.id)}>
                      {route.collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                      <CardTitle className="text-base">{route.name}</CardTitle>
                      <Badge variant="secondary">{totals.orders} pedidos</Badge>
                      <span className="text-xs text-muted-foreground">{totals.weight.toFixed(0)} kg • {totals.pallets} pal</span>
                      {totals.freight > 0 && (
                        <span className="text-xs font-medium text-primary">R$ {totals.freight.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Select value={route.vehicle_id || ''} onValueChange={v => setRoutes(prev => prev.map(r => r.id === route.id ? { ...r, vehicle_id: v } : r))}>
                        <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="Veículo" /></SelectTrigger>
                        <SelectContent>
                          {vehicles.filter((v: any) => v.active).map((v: any) => (
                            <SelectItem key={v.id} value={v.id}>{v.plate} {v.nickname ? `(${v.nickname})` : ''}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" variant="default" onClick={() => createLoadMutation.mutate(route)} disabled={createLoadMutation.isPending}>
                        <Send className="h-3 w-3 mr-1" /> Gerar Carga
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeRoute(route.id)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {!route.collapsed && (
                  <CardContent className="pt-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">#</TableHead>
                          <TableHead>Pedido</TableHead>
                          <TableHead>Destinatário</TableHead>
                          <TableHead>Destino</TableHead>
                          <TableHead className="text-right">Peso</TableHead>
                          <TableHead className="text-right">Paletes</TableHead>
                          <TableHead className="text-right">Frete</TableHead>
                          <TableHead className="w-24">Ordem</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {route.orders.map((o, idx) => (
                          <TableRow key={o.id}>
                            <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                            <TableCell className="font-medium text-sm">{o.order_number}</TableCell>
                            <TableCell className="text-sm">{o.recipient || o.clients?.company_name || '—'}</TableCell>
                            <TableCell className="text-sm">{o.destination || '—'}</TableCell>
                            <TableCell className="text-sm text-right">{o.weight_kg ? `${o.weight_kg} kg` : '—'}</TableCell>
                            <TableCell className="text-sm text-right">{o.pallet_count || 0}</TableCell>
                            <TableCell className="text-sm text-right">{o.total_freight ? `R$ ${Number(o.total_freight).toFixed(2)}` : '—'}</TableCell>
                            <TableCell>
                              <div className="flex gap-0.5">
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveOrder(route.id, o.id, 'up')} disabled={idx === 0}>
                                  <ChevronUp className="h-3 w-3" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveOrder(route.id, o.id, 'down')} disabled={idx === route.orders.length - 1}>
                                  <ChevronDown className="h-3 w-3" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeOrderFromRoute(route.id, o.id)}>
                                  <Trash2 className="h-3 w-3 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* ──── Create Route Dialog ──── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova Rota</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome da Rota</Label>
              <Input value={newRouteName} onChange={e => setNewRouteName(e.target.value)} placeholder={`Ex: MONTES CLAROS - ${format(new Date(), 'dd/MM')}`} />
            </div>
            <p className="text-sm text-muted-foreground">{selectedOrders.size} pedidos selecionados serão incluídos</p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={createRouteFromSelected}>Criar Rota</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
