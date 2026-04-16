import { useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useUpdateLoad, LOAD_STATUS_LABELS, Load } from '@/hooks/useLoads';
import { useLoadItems } from '@/hooks/useLoadItems';
import { useVehicles } from '@/hooks/useVehicles';
import { useGenerateCTe } from '@/hooks/useGenerateCTe';
import { getNextStatuses } from '@/lib/statusPipeline';
import { useToast } from '@/hooks/use-toast';
import LoadItemsPanel from '@/components/loads/LoadItemsPanel';
import CTeWorkbench from '@/components/loads/CTeWorkbench';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  PackageCheck, ArrowLeft, ArrowRight, FileText, Truck, User,
  MapPin, Calendar, AlertTriangle, CheckCircle, Clock, Send, Route as RouteIcon,
} from 'lucide-react';

function useLoad(id: string | undefined) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['load', id],
    queryFn: async () => {
      if (!id || !currentTenant) return null;
      const { data, error } = await supabase
        .from('loads')
        .select('*, vehicles(plate, nickname), drivers(name)')
        .eq('id', id)
        .eq('tenant_id', currentTenant.id)
        .maybeSingle();
      if (error) throw error;
      return data as Load | null;
    },
    enabled: !!id && !!currentTenant,
  });
}

function useLoadDocuments(loadId: string | undefined) {
  return useQuery({
    queryKey: ['load_documents', loadId],
    queryFn: async () => {
      if (!loadId) return [];
      const { data, error } = await supabase
        .from('fiscal_documents')
        .select('id, invoice_number, document_type, status, remitter, recipient, pallet_count, weight_kg, value, issue_date')
        .eq('load_id', loadId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!loadId,
  });
}

const STATUS_COLORS: Record<string, string> = {
  delivered: 'bg-success/10 text-success border-success/30',
  in_transit: 'bg-info/10 text-info border-info/30',
  loaded: 'bg-info/10 text-info border-info/30',
  divergent: 'bg-destructive/10 text-destructive border-destructive/30',
  ready: 'bg-primary/10 text-primary border-primary/30',
  loading: 'bg-primary/10 text-primary border-primary/30',
  planned: 'bg-muted text-muted-foreground',
  assembling: 'bg-warning/10 text-warning border-warning/30',
};

export default function LoadDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentTenant } = useTenant();
  const { data: load, isLoading, refetch } = useLoad(id);
  const { data: items = [] } = useLoadItems(id);
  const { data: documents = [] } = useLoadDocuments(id);
  const { data: vehicles = [] } = useVehicles();
  const updateLoad = useUpdateLoad();
  const generateCTe = useGenerateCTe();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dispatchOpen, setDispatchOpen] = useState(false);

  // Fetch drivers for dispatch
  const { data: drivers = [] } = useQuery({
    queryKey: ['drivers_for_dispatch', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('drivers')
        .select('id, name')
        .eq('tenant_id', currentTenant.id)
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant && dispatchOpen,
  });

  const [dispatchForm, setDispatchForm] = useState({
    driver_id: '',
    vehicle_id: '',
    notes: '',
  });
  const [dispatchStops, setDispatchStops] = useState<{ destination: string; client_id: string }[]>([]);

  // Auto-populate stops from load items when dialog opens
  const populateStopsFromItems = () => {
    if (items.length === 0) {
      setDispatchStops([{ destination: load?.destination || '', client_id: '' }]);
      return;
    }
    // Group items by destination (from orders) — deduplicate
    const seen = new Set<string>();
    const stops: { destination: string; client_id: string }[] = [];
    for (const item of items) {
      const key = (item as any).orders?.destination || load?.destination || '';
      if (key && !seen.has(key)) {
        seen.add(key);
        stops.push({ destination: key, client_id: '' });
      }
    }
    if (stops.length === 0) {
      stops.push({ destination: load?.destination || '', client_id: '' });
    }
    setDispatchStops(stops);
  };

  const addStop = () => setDispatchStops(s => [...s, { destination: '', client_id: '' }]);
  const removeStop = (idx: number) => setDispatchStops(s => s.filter((_, i) => i !== idx));
  const updateStop = (idx: number, field: string, value: string) =>
    setDispatchStops(s => s.map((stop, i) => i === idx ? { ...stop, [field]: value } : stop));

  const createTrip = useMutation({
    mutationFn: async () => {
      if (!load || !currentTenant) throw new Error('Dados insuficientes');
      const { data: trip, error: tripErr } = await supabase
        .from('dispatch_trips')
        .insert({
          tenant_id: currentTenant.id,
          load_id: load.id,
          driver_id: dispatchForm.driver_id || load.driver_id || null,
          vehicle_id: dispatchForm.vehicle_id || load.vehicle_id || null,
          status: 'planned',
          notes: dispatchForm.notes || null,
        } as any)
        .select()
        .single();
      if (tripErr) throw tripErr;

      // Create all stops in batch
      const validStops = dispatchStops.filter(s => s.destination.trim());
      if (validStops.length > 0 && trip) {
        const stopsToInsert = validStops.map((s, idx) => ({
          tenant_id: currentTenant.id,
          dispatch_trip_id: trip.id,
          destination: s.destination,
          client_id: s.client_id || null,
          stop_order: idx + 1,
          status: 'pending',
        }));
        const { error: stopErr } = await supabase.from('dispatch_stops').insert(stopsToInsert as any);
        if (stopErr) console.error('Stops creation error:', stopErr);
      }

      // Update load with driver/vehicle if changed
      const updates: any = {};
      if (dispatchForm.driver_id) updates.driver_id = dispatchForm.driver_id;
      if (dispatchForm.vehicle_id) updates.vehicle_id = dispatchForm.vehicle_id;
      if (Object.keys(updates).length > 0) {
        await supabase.from('loads').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', load.id);
      }

      return trip;
    },
    onSuccess: () => {
      toast({ title: 'Viagem criada com sucesso' });
      setDispatchOpen(false);
      refetch();
      qc.invalidateQueries({ queryKey: ['loads'] });
    },
    onError: (e: any) => toast({ title: 'Erro ao despachar', description: e.message, variant: 'destructive' }),
  });

  const vehicle = useMemo(() => {
    if (!load?.vehicle_id) return null;
    return vehicles.find((v: any) => v.id === load.vehicle_id) as any;
  }, [load?.vehicle_id, vehicles]);

  // Compute totals from items (source of truth)
  const computedTotals = useMemo(() => ({
    pallets: items.reduce((s, i) => s + i.pallet_count, 0),
    weight: items.reduce((s, i) => s + (i.weight_kg || 0), 0),
    volume: items.reduce((s, i) => s + (i.volume_m3 || 0), 0),
  }), [items]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Carregando carga...</div>;
  }

  if (!load) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground">Carga não encontrada</p>
        <Button variant="outline" onClick={() => navigate('/loads')}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Voltar para Cargas
        </Button>
      </div>
    );
  }

  const nextStatuses = getNextStatuses(load.status, 'load');
  const palletCapacity = vehicle?.max_pallets;
  const weightCapacity = vehicle?.max_weight_kg;
  const palletPct = palletCapacity ? Math.round((computedTotals.pallets / palletCapacity) * 100) : null;
  const weightPct = weightCapacity ? Math.round((computedTotals.weight / weightCapacity) * 100) : null;

  const handleStatusChange = async (nextStatus: string) => {
    try {
      await updateLoad.mutateAsync({ id: load.id, status: nextStatus } as any);
      toast({ title: `Status → ${LOAD_STATUS_LABELS[nextStatus as keyof typeof LOAD_STATUS_LABELS] || nextStatus}` });

      if (nextStatus === 'loaded') {
        try {
          await generateCTe.mutateAsync(load);
          toast({ title: 'CT-e gerado automaticamente' });
        } catch (e: any) {
          if (!e.message.includes('já existe')) {
            toast({ title: 'Erro CT-e', description: e.message, variant: 'destructive' });
          }
        }
      }
      refetch();
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };

  const handleGenerateCTe = async () => {
    try {
      await generateCTe.mutateAsync(load);
      toast({ title: 'CT-e gerado com sucesso' });
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <div className="animate-fade-in space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/loads')} className="mt-1">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-foreground">
              Carga {load.load_number}
            </h1>
            <Badge variant="outline" className={STATUS_COLORS[load.status] || 'bg-muted text-muted-foreground'}>
              {LOAD_STATUS_LABELS[load.status as keyof typeof LOAD_STATUS_LABELS] || load.status}
            </Badge>
          </div>
          <div className="flex items-center gap-4 mt-1.5 text-sm text-muted-foreground flex-wrap">
            {load.vehicles && (
              <span className="flex items-center gap-1"><Truck className="h-3.5 w-3.5" /> {load.vehicles.plate}</span>
            )}
            {load.drivers && (
              <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" /> {load.drivers.name}</span>
            )}
            {load.destination && (
              <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {load.origin ? `${load.origin} → ` : ''}{load.destination}</span>
            )}
            <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> {new Date(load.created_at).toLocaleDateString('pt-BR')}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 flex-wrap shrink-0">
          <Button size="sm" variant="ghost" onClick={() => navigate('/route-planning')} title="Voltar para reanalisar / reimprimir romaneio">
            <RouteIcon className="h-3.5 w-3.5 mr-1" /> Roteirização
          </Button>
          {nextStatuses.map(ns => (
            <Button key={ns} size="sm" variant="outline" onClick={() => handleStatusChange(ns)} disabled={updateLoad.isPending}>
              <ArrowRight className="h-3 w-3 mr-1" />
              {LOAD_STATUS_LABELS[ns as keyof typeof LOAD_STATUS_LABELS] || ns}
            </Button>
          ))}
          {['loaded', 'in_transit', 'delivered'].includes(load.status) && (
            <Button size="sm" variant="outline" onClick={handleGenerateCTe} disabled={generateCTe.isPending}>
              <FileText className="h-3 w-3 mr-1" /> CT-e
            </Button>
          )}
          {['ready', 'loaded', 'loading'].includes(load.status) && (
            <Dialog open={dispatchOpen} onOpenChange={(v) => { setDispatchOpen(v); if (v) populateStopsFromItems(); }}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Send className="h-3 w-3 mr-1" /> Despachar
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Despachar Carga {load.load_number}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                  <div>
                    <Label className="text-xs">Motorista</Label>
                    <Select
                      value={dispatchForm.driver_id || load.driver_id || ''}
                      onValueChange={v => setDispatchForm(f => ({ ...f, driver_id: v }))}
                    >
                      <SelectTrigger className="h-9"><SelectValue placeholder="Selecionar motorista" /></SelectTrigger>
                      <SelectContent>
                        {drivers.map((d: any) => (
                          <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Veículo</Label>
                    <Select
                      value={dispatchForm.vehicle_id || load.vehicle_id || ''}
                      onValueChange={v => setDispatchForm(f => ({ ...f, vehicle_id: v }))}
                    >
                      <SelectTrigger className="h-9"><SelectValue placeholder="Selecionar veículo" /></SelectTrigger>
                      <SelectContent>
                        {vehicles.map((v: any) => (
                          <SelectItem key={v.id} value={v.id}>{v.plate}{v.nickname ? ` (${v.nickname})` : ''}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Multi-stop section */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs">Paradas ({dispatchStops.length})</Label>
                      <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px]" onClick={addStop}>
                        + Parada
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {dispatchStops.map((stop, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-bold shrink-0">
                            {idx + 1}
                          </div>
                          <Input
                            value={stop.destination}
                            onChange={e => updateStop(idx, 'destination', e.target.value)}
                            placeholder={`Destino parada ${idx + 1}`}
                            className="h-8 text-xs"
                          />
                          {dispatchStops.length > 1 && (
                            <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => removeStop(idx)}>
                              ×
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs">Observações</Label>
                    <Textarea
                      rows={2}
                      value={dispatchForm.notes}
                      onChange={e => setDispatchForm(f => ({ ...f, notes: e.target.value }))}
                      className="text-sm"
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => createTrip.mutate()}
                    disabled={createTrip.isPending}
                  >
                    {createTrip.isPending ? 'Criando viagem...' : `Criar Viagem com ${dispatchStops.filter(s => s.destination.trim()).length} Parada(s)`}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Capacity summary */}
      {vehicle && (palletCapacity || weightCapacity) && (
        <Card>
          <CardContent className="py-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Paletes</span>
                <div className="text-lg font-bold">{computedTotals.pallets}{palletCapacity ? <span className="text-sm font-normal text-muted-foreground"> / {palletCapacity}</span> : ''}</div>
                {palletPct !== null && (
                  <div className="flex items-center gap-2 mt-1">
                    <Progress value={Math.min(palletPct, 100)} className={cn("h-1.5", palletPct > 100 && '[&>div]:bg-destructive')} />
                    <span className={cn("text-xs", palletPct > 100 ? 'text-destructive font-bold' : 'text-muted-foreground')}>{palletPct}%</span>
                    {palletPct > 100 && <AlertTriangle className="h-3 w-3 text-destructive" />}
                  </div>
                )}
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Peso</span>
                <div className="text-lg font-bold">{computedTotals.weight.toLocaleString('pt-BR')} <span className="text-sm font-normal text-muted-foreground">kg{weightCapacity ? ` / ${weightCapacity}` : ''}</span></div>
                {weightPct !== null && (
                  <div className="flex items-center gap-2 mt-1">
                    <Progress value={Math.min(weightPct, 100)} className={cn("h-1.5", weightPct > 100 && '[&>div]:bg-destructive')} />
                    <span className={cn("text-xs", weightPct > 100 ? 'text-destructive font-bold' : 'text-muted-foreground')}>{weightPct}%</span>
                  </div>
                )}
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Itens</span>
                <div className="text-lg font-bold">{items.length}</div>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Veículo</span>
                <div className="text-sm font-medium mt-0.5">{vehicle.plate}{vehicle.nickname ? ` (${vehicle.nickname})` : ''}</div>
                {vehicle.body_type && <Badge variant="outline" className="text-[10px] mt-1">{vehicle.body_type}</Badge>}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Items panel */}
      <LoadItemsPanel
        loadId={load.id}
        vehicleMaxPallets={vehicle?.max_pallets}
        vehicleMaxWeight={vehicle?.max_weight_kg}
      />

      {/* CT-e Workbench */}
      <CTeWorkbench
        loadId={load.id}
        loadNumber={load.load_number}
        destination={load.destination}
        documents={documents as any}
      />
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
