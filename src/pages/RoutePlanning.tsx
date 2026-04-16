import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
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
import { toast } from 'sonner';
import {
  Route, Plus, Wand2, Trash2,
  PackageCheck, Truck, ChevronDown, ChevronUp,
  FileText, Send, Download,
} from 'lucide-react';
import { format } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/* ────────────── types ────────────── */
interface LoadItem {
  id: string;
  load_id: string;
  item_description: string;
  pallet_count: number;
  weight_kg: number;
  volume_m3: number;
  fiscal_document_id: string | null;
  fiscal_documents?: {
    invoice_number: string | null;
    remitter: string | null;
    recipient: string | null;
    recipient_city: string | null;
    recipient_state: string | null;
    value: number | null;
    weight_kg: number | null;
    issue_date: string | null;
  } | null;
}

interface PendingLoad {
  id: string;
  load_number: string;
  destination: string | null;
  total_weight_kg: number | null;
  total_volume_m3: number | null;
  total_pallet_count: number | null;
  status: string;
  created_at: string;
  notes: string | null;
  items: LoadItem[];
}

interface RoutePlan {
  id: string;
  name: string;
  loads: PendingLoad[];
  vehicle_id?: string;
  notes?: string;
  collapsed?: boolean;
}

/* ────────────── main component ────────────── */
export default function RoutePlanning() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const { data: vehicles = [] } = useVehicles();
  const qc = useQueryClient();
  const navigate = useNavigate();

  // Cargas pendentes (planned, sem trip vinculada)
  const { data: pendingLoads = [], isLoading } = useQuery({
    queryKey: ['pending_loads_for_routing', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data: loads, error } = await supabase
        .from('loads')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .eq('status', 'planned')
        .is('trip_id', null)
        .order('destination', { ascending: true });
      if (error) throw error;
      if (!loads || loads.length === 0) return [];

      // Buscar items com NF-es para cada carga
      const loadIds = loads.map((l: any) => l.id);
      const { data: items, error: itemsErr } = await supabase
        .from('load_items')
        .select('*, fiscal_documents(invoice_number, remitter, recipient, recipient_city, recipient_state, value, weight_kg, issue_date)')
        .in('load_id', loadIds)
        .order('created_at', { ascending: true });
      if (itemsErr) throw itemsErr;

      const itemsByLoad: Record<string, LoadItem[]> = {};
      (items || []).forEach((item: any) => {
        if (!itemsByLoad[item.load_id]) itemsByLoad[item.load_id] = [];
        itemsByLoad[item.load_id].push(item);
      });

      return loads.map((l: any) => ({
        ...l,
        items: itemsByLoad[l.id] || [],
      })) as PendingLoad[];
    },
    enabled: !!currentTenant,
  });

  const [routes, setRoutes] = useState<RoutePlan[]>([]);
  const [selectedLoads, setSelectedLoads] = useState<Set<string>>(new Set());
  const [filterDest, setFilterDest] = useState('all');
  const [newRouteName, setNewRouteName] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const assignedLoadIds = useMemo(
    () => new Set(routes.flatMap(r => r.loads.map(l => l.id))),
    [routes]
  );

  const availableLoads = useMemo(() => {
    return pendingLoads.filter(l => !assignedLoadIds.has(l.id));
  }, [pendingLoads, assignedLoadIds]);

  const filteredLoads = useMemo(() => {
    if (filterDest === 'all') return availableLoads;
    return availableLoads.filter(l => (l.destination || '').toUpperCase().includes(filterDest));
  }, [availableLoads, filterDest]);

  const destinations = useMemo(() => {
    const set = new Set(availableLoads.map(l => (l.destination || 'Sem destino').trim().toUpperCase()));
    return Array.from(set).sort();
  }, [availableLoads]);

  /* ──── actions ──── */
  const toggleLoad = (id: string) => {
    setSelectedLoads(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedLoads.size === filteredLoads.length) {
      setSelectedLoads(new Set());
    } else {
      setSelectedLoads(new Set(filteredLoads.map(l => l.id)));
    }
  };

  const addToRoute = (routeId: string) => {
    const selected = availableLoads.filter(l => selectedLoads.has(l.id));
    if (selected.length === 0) return;
    setRoutes(prev => prev.map(r =>
      r.id === routeId ? { ...r, loads: [...r.loads, ...selected] } : r
    ));
    setSelectedLoads(new Set());
  };

  const createRouteFromSelected = () => {
    const selected = availableLoads.filter(l => selectedLoads.has(l.id));
    if (selected.length === 0) return;
    const dest = selected[0].destination || 'Rota';
    const name = newRouteName || `${dest} - ${format(new Date(), 'dd/MM')}`;
    setRoutes(prev => [...prev, {
      id: crypto.randomUUID(),
      name,
      loads: selected,
    }]);
    setSelectedLoads(new Set());
    setNewRouteName('');
    setDialogOpen(false);
  };

  const autoSuggest = () => {
    // Agrupar cargas por destino
    const groups: Record<string, PendingLoad[]> = {};
    availableLoads.forEach(l => {
      const key = (l.destination || 'Sem destino').trim().toUpperCase();
      if (!groups[key]) groups[key] = [];
      groups[key].push(l);
    });
    const suggested: RoutePlan[] = Object.entries(groups).map(([dest, loads]) => ({
      id: crypto.randomUUID(),
      name: `${dest} - ${format(new Date(), 'dd/MM')}`,
      loads,
    }));
    setRoutes(prev => [...prev, ...suggested]);
    setSelectedLoads(new Set());
    toast.success(`${suggested.length} rotas sugeridas criadas`);
  };

  const removeLoadFromRoute = (routeId: string, loadId: string) => {
    setRoutes(prev => prev.map(r =>
      r.id === routeId ? { ...r, loads: r.loads.filter(l => l.id !== loadId) } : r
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

  const moveLoad = (routeId: string, loadId: string, direction: 'up' | 'down') => {
    setRoutes(prev => prev.map(r => {
      if (r.id !== routeId) return r;
      const idx = r.loads.findIndex(l => l.id === loadId);
      if (idx < 0) return r;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= r.loads.length) return r;
      const loads = [...r.loads];
      [loads[idx], loads[newIdx]] = [loads[newIdx], loads[idx]];
      return { ...r, loads };
    }));
  };

  // Vincular veículo às cargas e criar dispatch_trip
  const dispatchRouteMutation = useMutation({
    mutationFn: async (route: RoutePlan) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      if (!route.vehicle_id) throw new Error('Selecione um veículo para despachar');

      // Atualizar cada carga com o veículo
      for (const load of route.loads) {
        const { error } = await supabase.from('loads').update({
          vehicle_id: route.vehicle_id,
          status: 'loading',
        } as any).eq('id', load.id);
        if (error) throw error;
      }

      // Criar dispatch_trip para a primeira carga (principal)
      const { data: trip, error: tripErr } = await supabase.from('dispatch_trips').insert({
        tenant_id: currentTenant.id,
        vehicle_id: route.vehicle_id,
        load_id: route.loads[0]?.id || null,
        status: 'planned',
        notes: `Rota: ${route.name} (${route.loads.length} cargas)`,
        created_by: user?.id,
      } as any).select().single();
      if (tripErr) throw tripErr;

      // Vincular trip_id nas cargas
      const loadIds = route.loads.map(l => l.id);
      await supabase.from('loads').update({ trip_id: trip.id } as any).in('id', loadIds);

      return trip;
    },
    onSuccess: (_, route) => {
      removeRoute(route.id);
      qc.invalidateQueries({ queryKey: ['loads'] });
      qc.invalidateQueries({ queryKey: ['pending_loads_for_routing'] });
      qc.invalidateQueries({ queryKey: ['dispatch_trips'] });
      toast.success('Rota despachada! Redirecionando para a carga...');
      // Redirecionar para o detalhe da primeira carga para faturamento/CT-e
      const firstLoadId = route.loads[0]?.id;
      if (firstLoadId) {
        navigate(`/loads/${firstLoadId}`);
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const routeTotals = (route: RoutePlan) => {
    const allItems = route.loads.flatMap(l => l.items);
    return {
      loads: route.loads.length,
      nfes: allItems.length,
      weight: route.loads.reduce((s, l) => s + (Number(l.total_weight_kg) || 0), 0),
      pallets: route.loads.reduce((s, l) => s + (Number(l.total_pallet_count) || 0), 0),
      value: allItems.reduce((s, i) => s + (Number(i.fiscal_documents?.value) || 0), 0),
    };
  };

  const exportRoutePdf = (route: RoutePlan) => {
    const totals = routeTotals(route);
    const vehicle = vehicles.find((v: any) => v.id === route.vehicle_id) as any;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    doc.setFontSize(16);
    doc.text('ROMANEIO DE TRANSPORTE', 148, 15, { align: 'center' });
    doc.setFontSize(10);
    doc.text(`Rota: ${route.name}`, 14, 25);
    doc.text(`Data: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 30);
    if (vehicle) doc.text(`Veículo: ${vehicle.plate} ${vehicle.nickname ? `(${vehicle.nickname})` : ''}`, 14, 35);
    doc.text(`Total: ${totals.loads} cargas | ${totals.nfes} NF-es | ${totals.weight.toFixed(0)} kg | ${totals.pallets} paletes`, 14, 40);

    let startY = 46;
    route.loads.forEach((load, loadIdx) => {
      if (loadIdx > 0) startY = (doc as any).lastAutoTable.finalY + 8;

      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(`${load.destination || 'Sem destino'} — ${load.load_number} (${load.items.length} NF-es)`, 14, startY);
      startY += 4;

      autoTable(doc, {
        startY,
        head: [['#', 'Nº NF', 'Remetente', 'Destinatário', 'Cidade', 'Peso (kg)', 'Vol.', 'Valor NF', 'Emissão']],
        body: load.items.map((item, i) => {
          const fd = item.fiscal_documents;
          return [
            i + 1,
            fd?.invoice_number || '—',
            fd?.remitter || '—',
            fd?.recipient || '—',
            fd?.recipient_city || '—',
            fd?.weight_kg ? Number(fd.weight_kg).toFixed(1) : '—',
            item.pallet_count || 0,
            fd?.value ? `R$ ${Number(fd.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—',
            fd?.issue_date ? format(new Date(fd.issue_date + 'T12:00:00'), 'dd/MM/yy') : '—',
          ];
        }),
        foot: [['', '', '', '', 'SUBTOTAL:',
          `${(Number(load.total_weight_kg) || 0).toFixed(0)}`,
          `${load.total_pallet_count || 0}`,
          `R$ ${load.items.reduce((s, i) => s + (Number(i.fiscal_documents?.value) || 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
          '']],
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [41, 65, 107], fontStyle: 'bold' },
        footStyles: { fillColor: [230, 230, 230], textColor: [0, 0, 0], fontStyle: 'bold' },
        theme: 'grid',
      });
    });

    const finalY = (doc as any).lastAutoTable.finalY + 15;
    doc.setFontSize(9);
    doc.line(14, finalY + 10, 80, finalY + 10);
    doc.text('Motorista', 47, finalY + 15, { align: 'center' });
    doc.line(100, finalY + 10, 166, finalY + 10);
    doc.text('Conferente', 133, finalY + 15, { align: 'center' });
    doc.line(186, finalY + 10, 272, finalY + 10);
    doc.text('Responsável', 229, finalY + 15, { align: 'center' });

    doc.save(`romaneio-${route.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
    toast.success('PDF gerado!');
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Route className="h-6 w-6 text-primary" /> Planejamento de Rotas
          </h1>
          <p className="text-sm text-muted-foreground">
            Monte romaneios agrupando cargas por destino. As cargas são criadas automaticamente pela ingestão de NF-es.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={autoSuggest} disabled={availableLoads.length === 0}>
            <Wand2 className="h-4 w-4 mr-2" /> Sugerir Rotas
          </Button>
          <Button onClick={() => { if (selectedLoads.size > 0) setDialogOpen(true); else toast.info('Selecione cargas primeiro'); }}>
            <Plus className="h-4 w-4 mr-2" /> Criar Rota Manual
          </Button>
        </div>
      </div>

      {/* ──── Cargas Disponíveis ──── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <PackageCheck className="h-4 w-4" /> Cargas Disponíveis
            <Badge variant="secondary" className="ml-2">{availableLoads.length}</Badge>
          </CardTitle>
          <div className="flex gap-2 flex-wrap pt-2">
            <Select value={filterDest} onValueChange={setFilterDest}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Destino" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os destinos</SelectItem>
                {destinations.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            {selectedLoads.size > 0 && routes.length > 0 && (
              <Select onValueChange={addToRoute}>
                <SelectTrigger className="w-56"><SelectValue placeholder={`Adicionar ${selectedLoads.size} a rota...`} /></SelectTrigger>
                <SelectContent>
                  {routes.map(r => <SelectItem key={r.id} value={r.id}>{r.name} ({r.loads.length})</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-center py-8 text-muted-foreground">Carregando...</p>
          ) : availableLoads.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">Nenhuma carga pendente para roteirização. Importe NF-es na tela de Ingestão.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={selectedLoads.size === filteredLoads.length && filteredLoads.length > 0} onCheckedChange={selectAll} />
                  </TableHead>
                  <TableHead>Carga</TableHead>
                  <TableHead>Destino</TableHead>
                  <TableHead className="text-right">NF-es</TableHead>
                  <TableHead className="text-right">Peso (kg)</TableHead>
                  <TableHead className="text-right">Volumes</TableHead>
                  <TableHead className="text-right">Valor Total</TableHead>
                  <TableHead>Criada em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLoads.map(l => {
                  const totalValue = l.items.reduce((s, i) => s + (Number(i.fiscal_documents?.value) || 0), 0);
                  return (
                    <TableRow key={l.id} className={selectedLoads.has(l.id) ? 'bg-primary/5' : ''}>
                      <TableCell><Checkbox checked={selectedLoads.has(l.id)} onCheckedChange={() => toggleLoad(l.id)} /></TableCell>
                      <TableCell className="font-medium text-sm">{l.load_number}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{l.destination || '—'}</Badge></TableCell>
                      <TableCell className="text-sm text-right">{l.items.length}</TableCell>
                      <TableCell className="text-sm text-right">{(Number(l.total_weight_kg) || 0).toFixed(0)}</TableCell>
                      <TableCell className="text-sm text-right">{l.total_pallet_count || 0}</TableCell>
                      <TableCell className="text-sm text-right font-medium">
                        {totalValue > 0 ? `R$ ${totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(l.created_at), 'dd/MM HH:mm')}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ──── Rotas Planejadas ──── */}
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
                      <Badge variant="secondary">{totals.loads} cargas</Badge>
                      <Badge variant="outline">{totals.nfes} NF-es</Badge>
                      <span className="text-xs text-muted-foreground">{totals.weight.toFixed(0)} kg • {totals.pallets} vol</span>
                      {totals.value > 0 && (
                        <span className="text-xs font-medium text-primary">R$ {totals.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
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
                      <Button size="sm" variant="outline" onClick={() => exportRoutePdf(route)}>
                        <Download className="h-3 w-3 mr-1" /> PDF
                      </Button>
                      <Button size="sm" variant="default" onClick={() => dispatchRouteMutation.mutate(route)} disabled={dispatchRouteMutation.isPending}>
                        <Send className="h-3 w-3 mr-1" /> Despachar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeRoute(route.id)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {!route.collapsed && (
                  <CardContent className="pt-0 space-y-3">
                    {route.loads.map((load, loadIdx) => (
                      <div key={load.id} className="border rounded-md overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 bg-muted/50">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-muted-foreground">{loadIdx + 1}</span>
                            <span className="font-medium text-sm">{load.destination || '—'}</span>
                            <Badge variant="secondary" className="text-xs">{load.items.length} NF-es</Badge>
                            <span className="text-xs text-muted-foreground">
                              {(Number(load.total_weight_kg) || 0).toFixed(0)} kg • {load.total_pallet_count || 0} vol
                            </span>
                          </div>
                          <div className="flex gap-0.5">
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveLoad(route.id, load.id, 'up')} disabled={loadIdx === 0}>
                              <ChevronUp className="h-3 w-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveLoad(route.id, load.id, 'down')} disabled={loadIdx === route.loads.length - 1}>
                              <ChevronDown className="h-3 w-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeLoadFromRoute(route.id, load.id)}>
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </div>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Nº NF</TableHead>
                              <TableHead className="text-xs">Remetente</TableHead>
                              <TableHead className="text-xs">Destinatário</TableHead>
                              <TableHead className="text-xs">Cidade</TableHead>
                              <TableHead className="text-xs text-right">Peso</TableHead>
                              <TableHead className="text-xs text-right">Vol.</TableHead>
                              <TableHead className="text-xs text-right">Valor</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {load.items.map(item => {
                              const fd = item.fiscal_documents;
                              return (
                                <TableRow key={item.id}>
                                  <TableCell className="text-xs font-medium">{fd?.invoice_number || '—'}</TableCell>
                                  <TableCell className="text-xs">{fd?.remitter || '—'}</TableCell>
                                  <TableCell className="text-xs">{fd?.recipient || '—'}</TableCell>
                                  <TableCell className="text-xs">{fd?.recipient_city || '—'}</TableCell>
                                  <TableCell className="text-xs text-right">{fd?.weight_kg ? Number(fd.weight_kg).toFixed(1) : '—'}</TableCell>
                                  <TableCell className="text-xs text-right">{item.pallet_count || 0}</TableCell>
                                  <TableCell className="text-xs text-right">{fd?.value ? `R$ ${Number(fd.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}</TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    ))}
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
              <Input value={newRouteName} onChange={e => setNewRouteName(e.target.value)} placeholder={`Ex: NORTE MG - ${format(new Date(), 'dd/MM')}`} />
            </div>
            <p className="text-sm text-muted-foreground">{selectedLoads.size} cargas selecionadas serão incluídas</p>
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
