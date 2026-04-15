import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLoads, useCreateLoad, LOAD_STATUSES, LOAD_STATUS_LABELS, Load } from '@/hooks/useLoads';
import { useVehicles } from '@/hooks/useVehicles';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Plus, PackageCheck, AlertTriangle, Truck, MapPin, ArrowRight, FileStack } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import PendingDocsGrouping from '@/components/loads/PendingDocsGrouping';

function NewLoadDialog({ vehicles, drivers, onCreated }: { vehicles: any[]; drivers: any[]; onCreated: () => void }) {
  const createLoad = useCreateLoad();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ load_number: '', vehicle_id: '', driver_id: '', origin: '', destination: '', notes: '' });

  const handleSave = async () => {
    try {
      await createLoad.mutateAsync({
        ...form,
        vehicle_id: form.vehicle_id || null,
        driver_id: form.driver_id || null,
        status: 'planned',
      } as any);
      toast({ title: 'Carga criada' });
      setOpen(false);
      setForm({ load_number: '', vehicle_id: '', driver_id: '', origin: '', destination: '', notes: '' });
      onCreated();
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nova Carga</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Nova Carga</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Nº Carga *</Label><Input value={form.load_number} onChange={e => setForm(f => ({ ...f, load_number: e.target.value }))} placeholder="CG-001" /></div>
            <div>
              <Label className="text-xs">Veículo</Label>
              <Select value={form.vehicle_id || '__none__'} onValueChange={v => setForm(f => ({ ...f, vehicle_id: v === '__none__' ? '' : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum</SelectItem>
                  {vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.plate}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Motorista</Label>
              <Select value={form.driver_id || '__none__'} onValueChange={v => setForm(f => ({ ...f, driver_id: v === '__none__' ? '' : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum</SelectItem>
                  {drivers.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Destino</Label><Input value={form.destination} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))} /></div>
          </div>
          <div><Label className="text-xs">Observações</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} /></div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={!form.load_number.trim() || createLoad.isPending}>Criar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_COLORS: Record<string, string> = {
  delivered: 'bg-success/10 text-success',
  in_transit: 'bg-info/10 text-info',
  loaded: 'bg-info/10 text-info',
  divergent: 'bg-destructive/10 text-destructive',
  ready: 'bg-primary/10 text-primary',
  loading: 'bg-primary/10 text-primary',
  planned: 'bg-muted text-muted-foreground',
  assembling: 'bg-warning/10 text-warning',
};

export default function Loads() {
  const navigate = useNavigate();
  const { currentTenant } = useTenant();
  const { data: loads = [], isLoading, refetch } = useLoads();
  const { data: vehicles = [] } = useVehicles();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [groupingOpen, setGroupingOpen] = useState(false);

  // Count pending docs for badge
  const { data: pendingCount = 0 } = useQuery({
    queryKey: ['pending_docs_count', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return 0;
      const { count, error } = await supabase
        .from('fiscal_documents')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', currentTenant.id)
        .eq('status', 'confirmed')
        .eq('document_type', 'inbound')
        .is('load_id', null);
      if (error) return 0;
      return count || 0;
    },
    enabled: !!currentTenant,
  });

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
      if (q && !l.load_number.toLowerCase().includes(q) && !(l.vehicles?.plate || '').toLowerCase().includes(q) && !(l.destination || '').toLowerCase().includes(q)) return false;
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      return true;
    });
  }, [loads, search, statusFilter]);

  // Status summary cards
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    loads.forEach(l => { counts[l.status] = (counts[l.status] || 0) + 1; });
    return counts;
  }, [loads]);

  const activeStatuses = ['planned', 'assembling', 'ready', 'loading', 'loaded', 'in_transit'] as const;

  return (
    <div className="animate-fade-in space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <PackageCheck className="h-5 w-5 text-primary" /> Cargas
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{loads.length} cargas no total</p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <Button size="sm" variant="secondary" onClick={() => setGroupingOpen(true)}>
              <FileStack className="h-4 w-4 mr-1" /> Agrupar NF-es
              <Badge className="ml-1.5 bg-primary text-primary-foreground text-[10px] px-1.5">{pendingCount}</Badge>
            </Button>
          )}
          <NewLoadDialog vehicles={vehicles} drivers={drivers} onCreated={refetch} />
        </div>
      </div>

      {/* Status summary */}
      <div className="flex gap-2 flex-wrap">
        {activeStatuses.map(s => {
          const count = statusCounts[s] || 0;
          if (count === 0 && s !== 'planned') return null;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                statusFilter === s ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[s]?.split(' ')[0] || 'bg-muted'}`} />
              {LOAD_STATUS_LABELS[s]} <span className="font-bold">{count}</span>
            </button>
          );
        })}
        {(statusCounts['delivered'] || 0) > 0 && (
          <button
            onClick={() => setStatusFilter(statusFilter === 'delivered' ? 'all' : 'delivered')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
              statusFilter === 'delivered' ? 'border-success bg-success/10 text-success' : 'border-border bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-success" /> Entregues <span className="font-bold">{statusCounts['delivered']}</span>
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar carga, placa ou destino..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
      </div>

      {/* Load cards */}
      {isLoading ? (
        <div className="text-center text-muted-foreground py-12">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">Nenhuma carga encontrada</div>
      ) : (
        <div className="grid gap-3">
          {filtered.map(l => {
            const veh = vehicles.find((v: any) => v.id === l.vehicle_id) as any;
            const maxP = veh?.max_pallets;
            const occ = maxP ? Math.round(((l.total_pallet_count || 0) / maxP) * 100) : null;

            return (
              <Card
                key={l.id}
                className="cursor-pointer hover:shadow-md transition-shadow border-l-4"
                style={{ borderLeftColor: l.status === 'divergent' ? 'hsl(var(--destructive))' : l.status === 'delivered' ? 'hsl(var(--success))' : ['in_transit', 'loaded'].includes(l.status) ? 'hsl(var(--info))' : 'hsl(var(--border))' }}
                onClick={() => navigate(`/loads/${l.id}`)}
              >
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{l.load_number}</span>
                        <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[l.status] || ''}`}>
                          {LOAD_STATUS_LABELS[l.status] || l.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        {l.vehicles && <span className="flex items-center gap-1"><Truck className="h-3 w-3" /> {l.vehicles.plate}</span>}
                        {l.drivers && <span>{l.drivers.name}</span>}
                        {l.destination && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {l.destination}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Paletes</div>
                        <div className="text-sm font-medium">{l.total_pallet_count || 0}{maxP ? <span className="text-muted-foreground font-normal">/{maxP}</span> : ''}</div>
                      </div>
                      {occ !== null && (
                        <div className="w-16">
                          <div className={`h-2 rounded-full bg-muted overflow-hidden`}>
                            <div
                              className={`h-full rounded-full transition-all ${occ > 100 ? 'bg-destructive' : occ > 80 ? 'bg-warning' : 'bg-success'}`}
                              style={{ width: `${Math.min(occ, 100)}%` }}
                            />
                          </div>
                          <div className={`text-[10px] text-center mt-0.5 ${occ > 100 ? 'text-destructive font-bold' : 'text-muted-foreground'}`}>
                            {occ}%
                          </div>
                        </div>
                      )}
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
