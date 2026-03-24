import { useState, useMemo } from 'react';
import { useLoads, useCreateLoad, useUpdateLoad, LOAD_STATUSES, LOAD_STATUS_LABELS, Load } from '@/hooks/useLoads';
import { useVehicles } from '@/hooks/useVehicles';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Search, Plus, PackageCheck, Edit, Eye, AlertTriangle, FileText, ArrowRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useGenerateCTe } from '@/hooks/useGenerateCTe';
import { getNextStatuses, LOAD_TRANSITIONS } from '@/lib/statusPipeline';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import LoadItemsPanel from '@/components/loads/LoadItemsPanel';

function LoadForm({ load, vehicles, drivers, onSave, onCancel }: { load?: Load; vehicles: any[]; drivers: any[]; onSave: (v: any) => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    load_number: load?.load_number || '',
    vehicle_id: load?.vehicle_id || '',
    driver_id: load?.driver_id || '',
    origin: load?.origin || '',
    destination: load?.destination || '',
    status: load?.status || 'planned',
    notes: load?.notes || '',
  });

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
      <div className="grid grid-cols-2 gap-4">
        <div><Label>Nº Carga *</Label><Input value={form.load_number} onChange={e => setForm(f => ({ ...f, load_number: e.target.value }))} /></div>
        <div>
          <Label>Status</Label>
          <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as typeof f.status }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {LOAD_STATUSES.map(s => <SelectItem key={s} value={s}>{LOAD_STATUS_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Veículo</Label>
          <Select value={form.vehicle_id} onValueChange={v => setForm(f => ({ ...f, vehicle_id: v }))}>
            <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
            <SelectContent>
              {vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.plate} {v.nickname ? `(${v.nickname})` : ''}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Motorista</Label>
          <Select value={form.driver_id} onValueChange={v => setForm(f => ({ ...f, driver_id: v }))}>
            <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
            <SelectContent>
              {drivers.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><Label>Origem</Label><Input value={form.origin} onChange={e => setForm(f => ({ ...f, origin: e.target.value }))} /></div>
        <div><Label>Destino</Label><Input value={form.destination} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))} /></div>
      </div>
      <div><Label>Observações</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button onClick={() => onSave({ ...form, vehicle_id: form.vehicle_id || null, driver_id: form.driver_id || null })} disabled={!form.load_number.trim()}>Salvar</Button>
      </div>
    </div>
  );
}

export default function Loads() {
  const { currentTenant } = useTenant();
  const { data: loads = [], isLoading } = useLoads();
  const { data: vehicles = [] } = useVehicles();
  const createLoad = useCreateLoad();
  const updateLoad = useUpdateLoad();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLoad, setEditingLoad] = useState<Load | undefined>();
  const [selectedLoad, setSelectedLoad] = useState<Load | null>(null);
  const { toast } = useToast();

  const { data: drivers = [] } = useQuery({
    queryKey: ['drivers', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase.from('drivers').select('id, name').eq('tenant_id', currentTenant.id).eq('active', true).order('name');
      return data || [];
    },
    enabled: !!currentTenant,
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return loads.filter(l => {
      if (q && !l.load_number.toLowerCase().includes(q) && !(l.vehicles?.plate || '').toLowerCase().includes(q)) return false;
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      return true;
    });
  }, [loads, search, statusFilter]);

  const handleSave = async (values: any) => {
    try {
      if (editingLoad) {
        await updateLoad.mutateAsync({ id: editingLoad.id, ...values });
        toast({ title: 'Carga atualizada' });
      } else {
        await createLoad.mutateAsync(values);
        toast({ title: 'Carga criada' });
      }
      setDialogOpen(false);
      setEditingLoad(undefined);
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };

  const statusColor = (s: string) => {
    if (s === 'delivered') return 'bg-success/10 text-success';
    if (s === 'in_transit' || s === 'loaded') return 'bg-blue-500/10 text-blue-500';
    if (s === 'divergent') return 'bg-destructive/10 text-destructive';
    if (s === 'ready' || s === 'loading') return 'bg-primary/10 text-primary';
    return 'bg-warning/10 text-warning';
  };

  // Get vehicle capacity for selected load
  const selectedVehicle = selectedLoad?.vehicle_id ? vehicles.find((v: any) => v.id === selectedLoad.vehicle_id) : null;

  // If viewing load detail
  if (selectedLoad) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => setSelectedLoad(null)}>← Voltar</Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <PackageCheck className="h-6 w-6 text-primary" /> Carga {selectedLoad.load_number}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className={statusColor(selectedLoad.status)}>{LOAD_STATUS_LABELS[selectedLoad.status] || selectedLoad.status}</Badge>
              {selectedLoad.vehicles && <span className="text-sm text-muted-foreground">🚛 {selectedLoad.vehicles.plate}</span>}
              {selectedLoad.drivers && <span className="text-sm text-muted-foreground">👤 {selectedLoad.drivers.name}</span>}
              {selectedLoad.destination && <span className="text-sm text-muted-foreground">→ {selectedLoad.destination}</span>}
            </div>
          </div>
          <div className="ml-auto">
            <Button variant="outline" onClick={() => { setEditingLoad(selectedLoad); setDialogOpen(true); }}>
              <Edit className="h-4 w-4 mr-2" /> Editar
            </Button>
          </div>
        </div>

        {/* Capacity summary */}
        {selectedVehicle && (selectedVehicle as any).max_pallets && (
          <Card>
            <CardContent className="py-3">
              <div className="grid grid-cols-3 gap-6">
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Paletes</span>
                  <div className="flex items-center gap-2">
                    <Progress value={Math.min(100, ((selectedLoad.total_pallet_count || 0) / (selectedVehicle as any).max_pallets) * 100)} />
                    <span className="text-sm font-medium whitespace-nowrap">{selectedLoad.total_pallet_count || 0} / {(selectedVehicle as any).max_pallets}</span>
                  </div>
                </div>
                {(selectedVehicle as any).max_weight_kg && (
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Peso</span>
                    <div className="flex items-center gap-2">
                      <Progress value={Math.min(100, ((selectedLoad.total_weight_kg || 0) / (selectedVehicle as any).max_weight_kg) * 100)} />
                      <span className="text-sm font-medium whitespace-nowrap">{selectedLoad.total_weight_kg || 0} / {(selectedVehicle as any).max_weight_kg} kg</span>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-muted-foreground">Veículo:</span>
                  <span className="font-medium">{(selectedVehicle as any).plate}</span>
                  {(selectedVehicle as any).body_type && <Badge variant="outline">{(selectedVehicle as any).body_type}</Badge>}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <LoadItemsPanel
          loadId={selectedLoad.id}
          vehicleMaxPallets={(selectedVehicle as any)?.max_pallets}
          vehicleMaxWeight={(selectedVehicle as any)?.max_weight_kg}
        />

        <Dialog open={dialogOpen} onOpenChange={v => { setDialogOpen(v); if (!v) setEditingLoad(undefined); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Editar Carga</DialogTitle></DialogHeader>
            <LoadForm load={editingLoad} vehicles={vehicles} drivers={drivers} onSave={handleSave} onCancel={() => { setDialogOpen(false); setEditingLoad(undefined); }} />
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <PackageCheck className="h-6 w-6 text-primary" /> Cargas
          </h1>
          <p className="text-sm text-muted-foreground">{loads.length} cargas</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={v => { setDialogOpen(v); if (!v) setEditingLoad(undefined); }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Nova Carga</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{editingLoad ? 'Editar Carga' : 'Nova Carga'}</DialogTitle></DialogHeader>
            <LoadForm load={editingLoad} vehicles={vehicles} drivers={drivers} onSave={handleSave} onCancel={() => { setDialogOpen(false); setEditingLoad(undefined); }} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-3 items-center">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar carga ou veículo..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {LOAD_STATUSES.map(s => <SelectItem key={s} value={s}>{LOAD_STATUS_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Carga</TableHead>
                <TableHead>Veículo</TableHead>
                <TableHead>Motorista</TableHead>
                <TableHead>Destino</TableHead>
                <TableHead>Paletes</TableHead>
                <TableHead>Ocupação</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[100px]">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Carregando...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Nenhuma carga encontrada</TableCell></TableRow>
              ) : filtered.map(l => {
                const vehicle = vehicles.find((v: any) => v.id === l.vehicle_id) as any;
                const maxP = vehicle?.max_pallets;
                const occ = maxP ? Math.round(((l.total_pallet_count || 0) / maxP) * 100) : null;
                const isOver = occ !== null && occ > 100;
                return (
                  <TableRow key={l.id} className="cursor-pointer" onClick={() => setSelectedLoad(l)}>
                    <TableCell className="font-medium">{l.load_number}</TableCell>
                    <TableCell className="text-sm">{l.vehicles ? `${l.vehicles.plate}${l.vehicles.nickname ? ` (${l.vehicles.nickname})` : ''}` : '—'}</TableCell>
                    <TableCell className="text-sm">{l.drivers?.name || '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{l.destination || '—'}</TableCell>
                    <TableCell>{l.total_pallet_count || 0}{maxP ? ` / ${maxP}` : ''}</TableCell>
                    <TableCell>
                      {occ !== null ? (
                        <div className="flex items-center gap-2">
                          <div className="w-12 h-2 rounded-full bg-muted overflow-hidden">
                            <div className={`h-full rounded-full ${isOver ? 'bg-destructive' : occ > 80 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${Math.min(occ, 100)}%` }} />
                          </div>
                          <span className={`text-xs font-medium ${isOver ? 'text-destructive' : ''}`}>{occ}%</span>
                          {isOver && <AlertTriangle className="h-3 w-3 text-destructive" />}
                        </div>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell><Badge variant="outline" className={statusColor(l.status)}>{LOAD_STATUS_LABELS[l.status] || l.status}</Badge></TableCell>
                    <TableCell>
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" onClick={() => setSelectedLoad(l)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => { setEditingLoad(l); setDialogOpen(true); }}>
                          <Edit className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
