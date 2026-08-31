import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { isRecord } from '@/lib/loads/operationDocumentOutcome';
import { useTransitionLoadStatus, LOAD_STATUS_LABELS, Load, type LoadStatus } from '@/hooks/useLoads';
import { useLoadItems } from '@/hooks/useLoadItems';
import { useVehicles } from '@/hooks/useVehicles';
import { useDispatchRoutePlan } from '@/hooks/route-planning/useDispatchRoutePlan';
import DispatchRecoveryPanel from '@/components/route-planning/DispatchRecoveryPanel';
import { useGenerateCTe } from '@/hooks/useGenerateCTe';
import { calculateFreight, type FreightResult } from '@/hooks/useFreightCalculator';
import FreightBreakdownPanel from '@/components/freight/FreightBreakdownPanel';
import { getNextStatuses } from '@/lib/statusPipeline';
import { useToast } from '@/hooks/use-toast';
import LoadRomaneioTabs, { type LoadRomaneioDocument } from '@/components/loads/LoadRomaneioTabs';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  ArrowLeft, ArrowRight, FileText, Truck, User,
  MapPin, Calendar, AlertTriangle, Send, Route as RouteIcon,
} from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';
import {
  isDriverTripStarted,
  resolveCanonicalTripLink,
  type CanonicalLoadTripLink,
} from '@/lib/driverTrip';
import { TRIP_ACTIVE_STATUSES } from '@/lib/status';

function useLoad(id: string | undefined) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['load', id, currentTenant?.id],
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
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  return useQuery({
    queryKey: ['load_documents', loadId, currentTenant?.id, user?.id, 'attempt-v1'],
    queryFn: async ({ signal }): Promise<LoadRomaneioDocument[]> => {
      if (!loadId || !currentTenant || !user) return [];
      const { data, error } = await supabase.rpc('get_load_operational_documents', {
        _tenant_id: currentTenant.id, _load_id: loadId,
      }).abortSignal(signal);
      if (error) throw error;
      if (!isRecord(data) || data.tenant_id !== currentTenant.id || data.actor_id !== user.id || data.load_id !== loadId
        || !Array.isArray(data.documents) || !data.documents.every(document => isRecord(document)
          && typeof document.id === 'string' && typeof document.status === 'string' && typeof document.is_historical === 'boolean')) {
        throw new Error('Não foi possível conferir as notas e tentativas desta carga.');
      }
      return data.documents as LoadRomaneioDocument[];
    },
    enabled: !!loadId && !!currentTenant?.id && !!user?.id,
  });
}

function useLoadTripState(loadId: string | undefined) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['load_trip_state', loadId, currentTenant?.id],
    queryFn: async (): Promise<CanonicalLoadTripLink[]> => {
      if (!loadId || !currentTenant) return [];
      const { data, error } = await supabase
        .from('dispatch_trip_loads')
        .select(`
          dispatch_trip_id,
          dispatch_trips!dispatch_trip_loads_dispatch_trip_id_fkey(status, actual_start_at)
        `)
        .eq('load_id', loadId)
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as CanonicalLoadTripLink[];
    },
    enabled: !!loadId && !!currentTenant?.id,
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
  const documentsQuery = useLoadDocuments(id);
  const documents = documentsQuery.data ?? [];
  const { data: loadTripLinks = [] } = useLoadTripState(id);
  const { data: vehicles = [] } = useVehicles();
  const transitionLoadStatus = useTransitionLoadStatus();
  const dispatchPlan=useDispatchRoutePlan();
  const generateCTe = useGenerateCTe();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<FreightResult | null>(null);

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
  const [dispatchStops, setDispatchStops] = useState<{ destination: string; client_id: string; fiscal_document_ids:string[] }[]>([]);
  const dispatchDocuments=useMemo(()=>Array.from(new Set(items.map(item=>item.fiscal_document_id)
    .filter((documentId):documentId is string=>Boolean(documentId)))),[items]);

  // Auto-populate stops from load items when dialog opens
  const populateStopsFromItems = () => {
    if (items.length === 0) {
      setDispatchStops([{ destination: load?.destination || '', client_id: '',fiscal_document_ids:[] }]);
      return;
    }
    // A carga expõe hoje um único destino consolidado, independentemente da
    // quantidade de itens. O operador pode refinar as paradas no planejamento.
    const stops: { destination: string; client_id: string; fiscal_document_ids:string[] }[] = [];
    const destination = load?.destination || '';
    if (destination) stops.push({ destination, client_id: '',fiscal_document_ids:dispatchDocuments });
    if (stops.length === 0) {
      stops.push({ destination: load?.destination || '', client_id: '',fiscal_document_ids:dispatchDocuments });
    }
    setDispatchStops(stops);
  };

  const addStop = () => setDispatchStops(s => [...s, { destination: '', client_id: '',fiscal_document_ids:[] }]);
  const removeStop = (idx: number) => setDispatchStops(s => s.filter((_, i) => i !== idx));
  const updateStop = (idx: number, field: string, value: string) =>
    setDispatchStops(s => s.map((stop, i) => i === idx ? { ...stop, [field]: value } : stop));

  const createTrip = useMutation({
    mutationFn: async () => {
      if (!load || !currentTenant) throw new Error('Dados insuficientes');
      // Usa exclusivamente a RPC oficial — garante dispatch_trip_loads
      // e dispatch_stop_documents consistentes com o contrato de dados.
      const validStops = dispatchStops;
      if (validStops.length === 0) throw new Error('Adicione pelo menos uma parada');
      if(items.some(item=>!item.fiscal_document_id))throw new Error('Esta carga contém itens manuais. O fluxo de baixa desses itens ainda precisa ser habilitado.');
      if(validStops.some(stop=>!stop.destination.trim() || stop.fiscal_document_ids.length===0))
        throw new Error('Informe o destino e distribua os documentos de cada parada.');
      const assigned=validStops.flatMap(stop=>stop.fiscal_document_ids);
      if(assigned.length!==dispatchDocuments.length || new Set(assigned).size!==dispatchDocuments.length
        || dispatchDocuments.some(document=>!assigned.includes(document)))throw new Error('Distribua cada documento exatamente uma vez.');
      const stopsPayload = validStops.map((s, idx) => ({
        id:`stop-${idx}`,recipient_name:s.destination,load_ids:[load.id],invoice_numbers:[],
        total_weight_kg:0,total_volume_m3:0,total_pallet_count:0,total_value:0,service_time_minutes:20,
        priority:0,risk_level:'normal' as const,manual_order:idx+1,notes:idx===0?dispatchForm.notes:undefined,
        destination: s.destination,
        client_id: s.client_id || null,
        fiscal_document_ids: s.fiscal_document_ids,
      }));
      const tripId = await dispatchPlan.dispatchRoute({
          attempt_scope:`load:${load.id}`,
          vehicle_id: dispatchForm.vehicle_id || load.vehicle_id || '',
          driver_id: dispatchForm.driver_id || load.driver_id || '',
          planned_start_at: new Date().toISOString(),
          route_name: `Carga ${load.load_number}`,
          load_ids: [load.id],
          stops: stopsPayload,
      });
      return { id: tripId };
    },
    onSuccess: () => {
      toast({ title: 'Viagem criada com sucesso' });
      setDispatchOpen(false);
      refetch();
      qc.invalidateQueries({ queryKey: ['loads'] });
    },
    onError: (error: Error) => toast({ title: 'Erro ao despachar', description: error.message, variant: 'destructive' }),
  });

  const vehicle = useMemo(() => {
    if (!load?.vehicle_id) return null;
    return vehicles.find(vehicle => vehicle.id === load.vehicle_id) ?? null;
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

  const tripLink = resolveCanonicalTripLink(loadTripLinks, TRIP_ACTIVE_STATUSES);
  const tripStarted = isDriverTripStarted(
    tripLink?.dispatch_trips?.status,
    tripLink?.dispatch_trips?.actual_start_at,
  );
  const rawNextStatuses = getNextStatuses(load.status, 'load');
  const nextStatuses = rawNextStatuses.filter(status => status !== 'in_transit' || tripStarted);
  const awaitingTripStart = rawNextStatuses.includes('in_transit') && !tripStarted;
  const palletCapacity = vehicle?.max_pallets;
  const weightCapacity = vehicle?.max_weight_kg;
  const palletPct = palletCapacity ? Math.round((computedTotals.pallets / palletCapacity) * 100) : null;
  const weightPct = weightCapacity ? Math.round((computedTotals.weight / weightCapacity) * 100) : null;

  const handleStatusChange = async (nextStatus: string) => {
    try {
      await transitionLoadStatus.mutateAsync({ id: load.id, status: nextStatus as LoadStatus });
      toast({ title: `Status → ${LOAD_STATUS_LABELS[nextStatus as keyof typeof LOAD_STATUS_LABELS] || nextStatus}` });

      if (nextStatus === 'loaded') {
        try {
          const result = await generateCTe.mutateAsync(load);
          const diag = result?._diagnostics;
          if (diag?.warnings?.length) {
            toast({
              title: 'CT-e gerado com alertas',
              description: diag.warnings.join(' • '),
              variant: 'destructive',
            });
          } else {
            toast({ title: 'CT-e gerado automaticamente' });
          }
        } catch (error: unknown) {
          const message = getErrorMessage(error);
          if (!message.includes('já existe')) {
            toast({ title: 'Erro CT-e', description: message, variant: 'destructive' });
          }
        }
      }
      refetch();
    } catch (error: unknown) {
      toast({ title: 'Erro', description: getErrorMessage(error), variant: 'destructive' });
    }
  };

  const handleGenerateCTe = async () => {
    try {
      const result = await generateCTe.mutateAsync(load);
      const diag = result?._diagnostics;
      if (diag?.warnings?.length) {
        toast({
          title: 'CT-e gerado com alertas',
          description: diag.warnings.join(' • '),
          variant: 'destructive',
        });
      } else {
        toast({ title: 'CT-e gerado com sucesso' });
      }
      setPreviewOpen(false);
      setPreviewResult(null);
    } catch (error: unknown) {
      toast({ title: 'Erro', description: getErrorMessage(error), variant: 'destructive' });
    }
  };

  const openCTePreview = async () => {
    if (!load || !currentTenant) return;
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewResult(null);
    try {
      // Gather NF context (client / payer / destination)
      const { data: nfeDocs } = await supabase
        .from('fiscal_documents')
        .select('value, client_id, recipient_state, recipient_city')
        .eq('load_id', load.id)
        .eq('tenant_id', currentTenant.id)
        .eq('document_type', 'inbound');

      const nfeTotalValue = (nfeDocs || []).reduce((sum, document) => sum + (Number(document.value) || 0), 0);
      const refDoc = (nfeDocs || []).find(document => document.client_id) ?? nfeDocs?.[0];
      const clientId = refDoc?.client_id ?? null;

      let payerGroup: string | null = null;
      if (clientId) {
        const { data: cli } = await supabase
          .from('clients')
          .select('payer_group')
          .eq('id', clientId)
          .maybeSingle();
        payerGroup = cli?.payer_group || null;
      }

      const totalPallets = items.reduce((sum, item) => sum + (item.pallet_count || 0), 0)
        || load.total_pallet_count || 0;
      const totalWeight = items.reduce((sum, item) => sum + (Number(item.weight_kg) || 0), 0)
        || load.total_weight_kg || 0;

      const r = await calculateFreight({
        tenantId: currentTenant.id,
        clientId,
        payerGroup,
        destination: load.destination || refDoc?.recipient_city || null,
        destinationState: refDoc?.recipient_state || null,
        destinationMunicipality: refDoc?.recipient_city || null,
        totalValue: nfeTotalValue,
        totalWeight,
        totalPallets,
      });
      setPreviewResult(r);
    } catch (error: unknown) {
      toast({ title: 'Erro na prévia', description: getErrorMessage(error), variant: 'destructive' });
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div className="animate-fade-in space-y-6 w-full">
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
            <Button key={ns} size="sm" variant={ns === 'in_transit' ? 'default' : 'outline'} onClick={() => handleStatusChange(ns)} disabled={transitionLoadStatus.isPending}>
              <ArrowRight className="h-3 w-3 mr-1" />
              {LOAD_STATUS_LABELS[ns as keyof typeof LOAD_STATUS_LABELS] || ns}
            </Button>
          ))}
          {awaitingTripStart ? (
            <p role="status" className="basis-full text-xs text-muted-foreground">
              {tripLink
                ? 'A saída será registrada pelo motorista ao iniciar a viagem.'
                : 'Crie uma viagem antes de colocar a carga em trânsito.'}
            </p>
          ) : null}
          {['loaded', 'in_transit', 'delivered'].includes(load.status) && (
            <Button size="sm" variant="outline" onClick={openCTePreview} disabled={generateCTe.isPending}>
              <FileText className="h-3 w-3 mr-1" /> CT-e
            </Button>
          )}
          {['ready', 'loaded', 'loading'].includes(load.status) && !load.trip_id && (
            <Dialog open={dispatchOpen} onOpenChange={(v) => { setDispatchOpen(v); if (v) populateStopsFromItems(); }}>
              <DialogTrigger asChild>
                <Button 
                  size="sm" 
                  disabled={createTrip.isPending || documentsQuery.isPending || !!documentsQuery.error}
                >
                  <Send className="h-3 w-3 mr-1" /> Despachar
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Despachar Carga {load.load_number}</DialogTitle>
                  <DialogDescription>Confirme motorista, veículo e distribua cada documento em uma única parada.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                  <div>
                    <Label htmlFor="dispatch-driver" className="text-xs">Motorista</Label>
                    <Select
                      value={dispatchForm.driver_id || load.driver_id || ''}
                      onValueChange={v => setDispatchForm(f => ({ ...f, driver_id: v }))}
                    >
                      <SelectTrigger id="dispatch-driver" className="h-9"><SelectValue placeholder="Selecionar motorista" /></SelectTrigger>
                      <SelectContent>
                        {drivers.map((driver) => (
                          <SelectItem key={driver.id} value={driver.id}>{driver.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="dispatch-vehicle" className="text-xs">Veículo</Label>
                    <Select
                      value={dispatchForm.vehicle_id || load.vehicle_id || ''}
                      onValueChange={v => setDispatchForm(f => ({ ...f, vehicle_id: v }))}
                    >
                      <SelectTrigger id="dispatch-vehicle" className="h-9"><SelectValue placeholder="Selecionar veículo" /></SelectTrigger>
                      <SelectContent>
                        {vehicles.map((vehicleOption) => (
                          <SelectItem key={vehicleOption.id} value={vehicleOption.id}>{vehicleOption.plate}{vehicleOption.nickname ? ` (${vehicleOption.nickname})` : ''}</SelectItem>
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
                            aria-label={`Destino parada ${idx+1}`}
                            value={stop.destination}
                            onChange={e => updateStop(idx, 'destination', e.target.value)}
                            placeholder={`Destino parada ${idx + 1}`}
                            className="h-8 text-xs"
                          />
                          {dispatchStops.length > 1 && (
                            <Button type="button" variant="ghost" size="sm" aria-label={`Remover parada ${idx+1}`} className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => removeStop(idx)}>
                              ×
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {dispatchDocuments.map((documentId,index)=><div key={documentId}>
                    <Label htmlFor={`dispatch-document-${index}`}>Documento {documents.find(document=>document.id===documentId)?.invoice_number || documentId.slice(0,8)}</Label>
                    <Select value={String(dispatchStops.findIndex(stop=>stop.fiscal_document_ids.includes(documentId)))} onValueChange={value=>
                      setDispatchStops(previous=>previous.map((stop,n)=>({...stop,fiscal_document_ids:n===Number(value)
                        ? [...stop.fiscal_document_ids.filter(id=>id!==documentId),documentId]
                        : stop.fiscal_document_ids.filter(id=>id!==documentId)})))}>
                      <SelectTrigger id={`dispatch-document-${index}`}><SelectValue placeholder="Escolha a parada"/></SelectTrigger>
                      <SelectContent><SelectItem value="-1">Sem parada</SelectItem>
                        {dispatchStops.map((stop,n)=><SelectItem key={n} value={String(n)}>Parada {n+1}: {stop.destination || 'Sem destino'}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>)}
                  <div>
                    <Label htmlFor="dispatch-notes" className="text-xs">Observações da primeira parada</Label>
                    <Textarea
                      id="dispatch-notes"
                      rows={2}
                      value={dispatchForm.notes}
                      onChange={e => setDispatchForm(f => ({ ...f, notes: e.target.value }))}
                      className="text-sm"
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => createTrip.mutate()}
                    disabled={createTrip.isPending || documentsQuery.isPending || !!documentsQuery.error || (load.status === 'loading' && !!load.trip_id)}
                  >
                    {createTrip.isPending ? 'Despachando...' : 
                     (load.status === 'loading' && !!load.trip_id) ? 'Carga já despachada' : 
                     `Criar Viagem com ${dispatchStops.filter(s => s.destination.trim()).length} Parada(s)`}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <DispatchRecoveryPanel loadId={load.id} onConfirmed={()=>{
        setDispatchOpen(false);void refetch();toast({title:'Despacho confirmado'});
      }}/>
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

      {/* Cabeçalho com abas (Romaneio de Expedição) */}
      {documentsQuery.error ? <div role="alert" className="rounded border p-4">
        {getErrorMessage(documentsQuery.error, 'Não foi possível carregar as notas desta carga.')}
        <Button variant="outline" onClick={() => void documentsQuery.refetch()}>Tentar novamente</Button>
      </div> : documentsQuery.isPending ? <p role="status">Carregando notas e tentativas da carga…</p> : <LoadRomaneioTabs
        load={load}
        documents={documents}
        items={items}
        onSaved={() => { refetch(); qc.invalidateQueries({ queryKey: ['load_documents', load.id] }); }}
      />}

      {/* CT-e Freight Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" /> Prévia do CT-e — Carga {load.load_number}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Confira a regra/tabela aplicada e o valor do frete calculado antes de gerar o CT-e.
            </p>
            {previewLoading ? (
              <div className="text-sm text-muted-foreground py-8 text-center">Calculando frete...</div>
            ) : previewResult ? (
              <FreightBreakdownPanel
                breakdown={previewResult.breakdown}
                finalValue={previewResult.value}
                success={previewResult.success}
                error={previewResult.error}
              />
            ) : null}
            <div className="flex gap-2 justify-end pt-2 border-t">
              <Button variant="ghost" onClick={() => setPreviewOpen(false)}>Cancelar</Button>
              <Button
                onClick={handleGenerateCTe}
                disabled={generateCTe.isPending || previewLoading}
              >
                <FileText className="h-4 w-4 mr-2" />
                {generateCTe.isPending ? 'Gerando...' : 'Confirmar e Gerar CT-e'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
