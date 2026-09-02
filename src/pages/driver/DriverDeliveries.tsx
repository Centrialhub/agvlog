import { useState, useRef, useMemo, useEffect } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Package, CheckCircle, AlertTriangle, Truck, Camera, X, ImageIcon,
  ChevronRight, Search, PenLine, FileSignature,
  Ban, AlertCircle, PackageX, MapPinned, UserX,
  Phone, MessageSquare, Percent, FileText
} from 'lucide-react';

import { cn } from '@/lib/utils';
import SignaturePad from '@/components/driver/SignaturePad';
import { isStopTerminal, stopStatusLabel } from '@/lib/status/stopStatus';
import { isDocumentTerminal } from '@/lib/status/documentStatus';
import { readDriverDeliveryItems } from '@/lib/driver/driverDeliveryItems';
import { validateUploadFile } from '@/lib/uploadPolicy';
import { createDeliverySubmission, deliveryOutcome, deliveryErrorMessage, invalidateDeliveryQueries, replayPendingDeliverySubmissions } from '@/lib/driver/driverDeliverySubmission';
import { DRIVER_TRIP_SELECT, normalizeDriverTrip, isDriverTripStarted } from '@/lib/driverTrip';
import { markDriverArrival } from '@/lib/driver/driverArrival';
import type { Tables } from '@/integrations/supabase/types';



// ====== Catálogo de eventos (inspirado no app de referência) ======
type EventCategory = 'finalizador' | 'informativo';

type EventDef = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  category: EventCategory;
  finalAction?: 'delivered' | 'partial' | 'refused';
  requiresReceiver?: boolean;
  requiresPhoto?: boolean;
  requiresSignature?: boolean;
  showsItems?: boolean;     // lista produtos para devolver
  showsDiscount?: boolean;  // pede desconto
  showsContact?: boolean;   // mostra contato do cliente
  needsOperatorReply?: boolean; // exige aprovação do operador
};

const EVENTS: EventDef[] = [
  { key: 'entregue',            label: 'ENTREGUE',            icon: CheckCircle, category: 'finalizador', finalAction: 'delivered', requiresReceiver: true, requiresPhoto: true, requiresSignature: true },
  { key: 'devolucao_parcial',   label: 'DEVOLUÇÃO PARCIAL',   icon: PackageX,    category: 'finalizador', finalAction: 'partial', requiresReceiver: true, requiresPhoto: true, requiresSignature: true, showsItems: true, needsOperatorReply: true },
  { key: 'devolucao_total',     label: 'DEVOLUÇÃO TOTAL',     icon: Ban,         category: 'finalizador', finalAction: 'refused', showsItems: true, needsOperatorReply: true },
  { key: 'chegada_no_cliente',  label: 'CHEGADA NO CLIENTE',  icon: MapPinned,   category: 'informativo' },
  { key: 'solicitar_desconto',  label: 'SOLICITAR DESCONTO',  icon: Percent,     category: 'informativo', showsDiscount: true, showsContact: true, needsOperatorReply: true },
  { key: 'atualizar_boleto',    label: 'ATUALIZAR BOLETO',    icon: FileText,    category: 'informativo', showsContact: true, needsOperatorReply: true },
  { key: 'avaria',              label: 'AVARIA',              icon: AlertCircle, category: 'informativo', requiresPhoto: true, showsItems: true },
  { key: 'cliente_recusou',     label: 'CLIENTE RECUSOU',     icon: PackageX,    category: 'informativo', showsItems: true },
  { key: 'coleta_realizada',    label: 'COLETA REALIZADA',    icon: Package,     category: 'informativo', requiresPhoto: true },
  { key: 'cliente_estava_fora', label: 'CLIENTE ESTAVA FORA', icon: UserX,       category: 'informativo' },
  { key: 'outros',              label: 'OUTROS',              icon: AlertTriangle, category: 'informativo' },
];

function getEventDef(key: string) {
  return EVENTS.find(e => e.key === key);
}

// ====== Helpers ======
type DriverStopClient = Pick<Tables<'clients'>, 'company_name' | 'phone' | 'mobile' | 'email'>;
type DriverStopDocument = {
  fiscal_documents: Pick<Tables<'fiscal_documents'>, 'invoice_number' | 'reference_number'> | null;
};
type DriverStop = Tables<'dispatch_stops'> & {
  clients: DriverStopClient | null;
  dispatch_stop_documents: DriverStopDocument[];
};
type StopProduct = {
  id: string;
  sku: string;
  name: string;
  qty: number;
  unit: string;
  price: number;
  documentStatus: string | null;
};

function getStopOrderNumber(stop: DriverStop): string | null {
  const fiscalDocument = stop.dispatch_stop_documents
    ?.map((link) => link.fiscal_documents)
    .find(Boolean);
  const candidates = [fiscalDocument?.invoice_number, fiscalDocument?.reference_number];
  for (const c of candidates) if (c) return String(c);
  // fallback: extrai dígitos do notes
  if (stop?.notes) {
    const m = String(stop.notes).match(/\d{4,}/);
    if (m) return m[0];
  }
  return null;
}

export default function DriverDeliveries() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const driverQuery = useCurrentDriver();
  const driver = driverQuery.data;
  const autoTripQuery = useActiveTrip(driver?.id);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTripId = searchParams.get('trip');
  const specificTripQuery = useQuery({
    queryKey: ['driver_trip_specific',currentTenant?.id,driver?.id,selectedTripId],
    enabled: !!selectedTripId && !!driver?.id && !!currentTenant?.id,
    queryFn: async () => {
      if (!selectedTripId || !driver || !currentTenant) return null;
      const {data,error} = await supabase.from('dispatch_trips').select(DRIVER_TRIP_SELECT)
        .eq('id',selectedTripId).eq('driver_id',driver.id).eq('tenant_id',currentTenant.id).maybeSingle();
      if (error) throw error;
      return data ? normalizeDriverTrip(data) : null;
    },
  });
  const tripQuery = selectedTripId ? specificTripQuery : autoTripQuery;
  const trip = tripQuery.data;
  const submissionRef = useRef<ReturnType<typeof createDeliverySubmission> | null>(null);
  const [submissionLocked, setSubmissionLocked] = useState(false);
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const outboxReplayQuery = useQuery({
    queryKey:['driver_delivery_outbox_replay',currentTenant?.id,user?.id],
    enabled:!!currentTenant?.id && !!user?.id,
    retry:false,
    staleTime:Infinity,
    queryFn:() => replayPendingDeliverySubmissions(currentTenant!.id,user!.id),
  });
  useEffect(() => {
    if (!outboxReplayQuery.data || (!outboxReplayQuery.data.confirmed && !outboxReplayQuery.data.cleaned)) return;
    toast({title:outboxReplayQuery.data.confirmed ? 'Envio pendente confirmado' : 'Anexos pendentes recuperados'});
    void invalidateDeliveryQueries(qc);
  }, [outboxReplayQuery.data,qc,toast]);

  const [tab, setTab] = useState<'em_rota' | 'concluidas'>('em_rota');
  const [search, setSearch] = useState('');
  // Detalhe da entrega
  const [detailStop, setDetailStop] = useState<DriverStop | null>(null);

  // catálogo de eventos do stop selecionado
  const [eventCatalogStop, setEventCatalogStop] = useState<DriverStop | null>(null);
  // formulário "Dados do evento"
  const [eventForm, setEventForm] = useState<{ stop: DriverStop; eventKey: string } | null>(null);

  const [receiverName, setReceiverName] = useState('');
  const [receiverDoc, setReceiverDoc] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Itens selecionados para devolução: { [productId]: qtyDevolvida }
  const [returnedItems, setReturnedItems] = useState<Record<string, number>>({});
  const [returnReason, setReturnReason] = useState('');

  // Solicitação de desconto
  const [discountKind, setDiscountKind] = useState<'percent' | 'value'>('percent');
  const [discountAmount, setDiscountAmount] = useState('');
  const [discountReason, setDiscountReason] = useState('');

  // Boleto / contato
  const [boletoDueDate, setBoletoDueDate] = useState('');
  const [boletoNote, setBoletoNote] = useState('');

  // Comunicações são persistidas; nenhuma resposta da operação é simulada.

  // Read the exact allocation/attempt: one invoice may have items on several trips.
  const productsQuery = useQuery<StopProduct[]>({
    queryKey: ['driver_stop_products', currentTenant?.id, driver?.id, user?.id, trip?.id, eventForm?.stop?.id, 'attempt-v1'],
    queryFn: async ({ signal }) => {
      if (!eventForm || !currentTenant || !user || !trip?.id || eventForm.stop.dispatch_trip_id !== trip.id) {
        throw new Error('A parada não pertence à viagem selecionada.');
      }
      const { data, error } = await supabase.rpc('get_driver_delivery_items', { _stop_id: eventForm.stop.id }).abortSignal(signal);
      if (error) throw error;
      return readDriverDeliveryItems(data, { tenant: currentTenant.id, actor: user.id, trip: trip.id, stop: eventForm.stop.id });
    },
    enabled: !!eventForm?.stop?.id && !!currentTenant?.id && !!driver?.id && !!user?.id && !!trip?.id,
  });

  const allStopProducts = productsQuery.data ?? [];
  const stopProducts = getEventDef(eventForm?.eventKey ?? '')?.category === 'finalizador'
    ? allStopProducts.filter(item => !isDocumentTerminal(item.documentStatus)) : allStopProducts;

  const totalReturnValue = stopProducts.reduce((sum, p) => {
    const q = returnedItems[p.id] || 0;
    return sum + q * p.price;
  }, 0);

  const stopsQuery = useQuery({
    queryKey: ['driver_delivery_stops', currentTenant?.id, driver?.id, trip?.id],
    queryFn: async () => {
      if (!trip?.id) return [];
      const { data, error } = await supabase
        .from('dispatch_stops')
        .select('*, clients(company_name, phone, mobile, email), dispatch_stop_documents(fiscal_documents(invoice_number, reference_number))')
        .eq('dispatch_trip_id', trip.id).eq('tenant_id', currentTenant!.id)
        .order('stop_order', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!trip?.id && !!currentTenant?.id && !!driver?.id,
  });

  const effectiveStops = useMemo<DriverStop[]>(() => stopsQuery.data ?? [], [stopsQuery.data]);
  const currentFormStop = effectiveStops.find(stop => stop.id===eventForm?.stop.id);
  useEffect(() => {
    if (!trip?.id) return;
    const channel = supabase.channel(`driver_deliveries_${trip.id}`).on('postgres_changes',
      {event:'*',schema:'public',table:'dispatch_stops',filter:`dispatch_trip_id=eq.${trip.id}`},
      () => { void invalidateDeliveryQueries(qc); }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [trip?.id,qc]);

  const filteredStops = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = effectiveStops;
    if (tab === 'em_rota') {
      list = list.filter((s) => !isStopTerminal(s.status) && s.status !== 'completed');
    } else {
      list = list.filter((s) => isStopTerminal(s.status) || s.status === 'completed');
    }
    if (!q) return list;
    return list.filter((s) => {
      const name = (s.clients?.company_name || s.destination || '').toLowerCase();
      const order = (getStopOrderNumber(s) || '').toLowerCase();
      const notes = (s.notes || '').toLowerCase();
      return name.includes(q) || order.includes(q) || notes.includes(q);
    });
  }, [effectiveStops, search, tab]);

  // Considera todos os status terminais (delivered, refused, returned, partial_delivery, failed, etc.)
  const completedStops = effectiveStops.filter(
    (s) => isStopTerminal(s.status) || s.status === 'completed' || s.status === 'delivered',
  );

  const resetForm = () => {
    setEventForm(null);
    setReceiverName('');
    setReceiverDoc('');
    setNotes('');
    setPhotos([]);
    photoPreviews.forEach((u) => URL.revokeObjectURL(u));
    setPhotoPreviews([]);
    setSignatureDataUrl(null);
    setReturnedItems({});
    setReturnReason('');
    setDiscountKind('percent');
    setDiscountAmount('');
    setDiscountReason('');
    setBoletoDueDate('');
    setBoletoNote('');
    submissionRef.current = null;
    setSubmissionLocked(false);
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    try {
      files.forEach((file) => validateUploadFile(file, 'image'));
    } catch (error) {
      toast({
        title: 'Foto inválida',
        description: error instanceof Error ? error.message : 'Selecione imagens válidas.',
        variant: 'destructive',
      });
      e.target.value = '';
      return;
    }
    const next = [...photos, ...files].slice(0, 5);
    setPhotos(next);
    photoPreviews.forEach((u) => URL.revokeObjectURL(u));
    setPhotoPreviews(next.map((f) => URL.createObjectURL(f)));
    e.target.value = '';
  };

  const removePhoto = (idx: number) => {
    URL.revokeObjectURL(photoPreviews[idx]);
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  const submitEvent = useMutation({
    mutationFn: async () => {
      if (!eventForm || !trip || !currentTenant) throw new Error('Sem viagem ou evento selecionado.');
      if (!submissionRef.current && (!currentFormStop || isStopTerminal(currentFormStop.status))) {
        throw new Error('A parada foi encerrada ou reatribuída. Atualize a viagem antes de enviar.');
      }
      if (eventForm.eventKey === 'chegada_no_cliente') { await markDriverArrival(eventForm.stop.id); return null; }
      if (!submissionRef.current) {
        const def = getEventDef(eventForm.eventKey);
        if (!def) throw new Error('Evento inválido.');
        const reason = [notes.trim(),returnReason.trim(),discountReason.trim(),boletoNote.trim()].filter(Boolean).join('\n');
        const positiveItems = Object.fromEntries(Object.entries(returnedItems).filter(([,qty]) => qty>0));
        submissionRef.current = createDeliverySubmission({tenantId:currentTenant.id,actorId:user!.id,tripId:trip.id,stopId:eventForm.stop.id,
          expectedStatus:currentFormStop!.status,eventKey:def.key,photos,signatureDataUrl,details:{
            event_subtype:def.key,event_label:def.label,notes:reason,return_reason:returnReason.trim() || null,
            receiver_name:receiverName.trim() || null,receiver_document:receiverDoc.trim() || null,
            returned_items:positiveItems,discount_amount:discountAmount || null,discount_kind:discountKind,
            discount_reason:discountReason.trim() || null,boleto_due_date:boletoDueDate || null,boleto_note:boletoNote.trim() || null,
          }});
      }
      setSubmissionLocked(true);
      setSearchParams({trip:trip.id},{replace:true});
      try { return await submissionRef.current.submit(); }
      catch (error) {
        if (submissionRef.current.canRevise) {
          submissionRef.current=null; setSubmissionLocked(false);
          await invalidateDeliveryQueries(qc);
        }
        throw error;
      }
    },
    onSuccess: async result => {
      if (result) setLastEventId(result.operational_event_id);
      toast({title:result ? 'Evento registrado e enviado à operação' : 'Chegada registrada'});
      resetForm(); setEventCatalogStop(null);
      await invalidateDeliveryQueries(qc);
    },
    onError: error => toast({title:'Envio não confirmado',description:deliveryErrorMessage(error),variant:'destructive'}),
  });

  const pageError = outboxReplayQuery.error ?? driverQuery.error ?? tripQuery.error ?? stopsQuery.error;
  if (pageError) return <Card><CardContent className="py-8 space-y-3" role="alert">
    <p>{deliveryErrorMessage(pageError)}</p>
    <Button onClick={() => { void outboxReplayQuery.refetch(); void driverQuery.refetch(); void tripQuery.refetch(); if (trip?.id) void stopsQuery.refetch(); }}>Tentar novamente</Button>
  </CardContent></Card>;
  if (outboxReplayQuery.isLoading || driverQuery.isLoading || (!!driver && tripQuery.isLoading) || (!!trip && stopsQuery.isLoading)) {
    return <p role="status">Carregando entregas...</p>;
  }

  if (!trip?.id) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-4">
          <Package className="h-12 w-12 text-muted-foreground mx-auto opacity-20" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Nenhuma viagem ativa</p>
            <p className="text-xs text-muted-foreground">
              Aguarde o despacho da carga pela operação para ver suas entregas.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate('/driver')}>
            Voltar ao Início
          </Button>
        </CardContent>
      </Card>
    );
  }

  const def = eventForm ? getEventDef(eventForm.eventKey) : null;
  const totalReturnedQty = Object.values(returnedItems).reduce((a, b) => a + (b || 0), 0);
  const totalProductQty = stopProducts.reduce((sum,item) => sum+item.qty,0);
  const mappedOutcome = def ? deliveryOutcome(def.key) : undefined;
  const reason = [notes,returnReason,discountReason,boletoNote].map(value => value.trim()).filter(Boolean).join('\n');
  const quantitiesValid = Object.entries(returnedItems).every(([id,qty]) => Number.isFinite(qty) && qty>=0
    && stopProducts.some(item => item.id===id && qty<=item.qty));
  const canSubmit = !!def && isDriverTripStarted(trip.status,trip.actual_start_at)
    && !!currentFormStop && !isStopTerminal(currentFormStop.status) && !stopsQuery.isFetching
    && (!mappedOutcome || !!currentFormStop.actual_arrival_at)
    && (!def.requiresReceiver || receiverName.trim().length>=2)
    && (!def.requiresPhoto || photos.length>0) && (!def.requiresSignature || !!signatureDataUrl)
    && (def.key==='entregue' || def.key==='chegada_no_cliente' || reason.length>=3)
    && (!def.showsItems || (!productsQuery.isLoading && !productsQuery.error && quantitiesValid))
    && (mappedOutcome!=='partial_delivery' || (totalReturnedQty>0 && totalReturnedQty<totalProductQty))
    && (!['returned','refused'].includes(mappedOutcome ?? '') || totalReturnedQty===0 || totalReturnedQty===totalProductQty)
    && (!def.showsDiscount || (Number(discountAmount)>0 && discountReason.trim().length>=3));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Entregas e Coletas</h1>
        <p className="text-xs text-muted-foreground">
          Carga {trip?.loads?.load_number || '—'} · {completedStops.length}/{effectiveStops.length} concluídas
        </p>
      </div>


      {lastEventId && <Button variant="outline" onClick={() => navigate(`/driver/events/${lastEventId}`)}>Ver evento enviado à operação</Button>}
      {!isDriverTripStarted(trip.status,trip.actual_start_at) && trip.status!=='completed' && (
        <p role="alert" className="text-sm text-destructive">A viagem precisa estar iniciada para registrar chegadas e entregas.</p>
      )}
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar cliente ou número da nota" placeholder="Buscar cliente ou nº da nota"
          className="pl-9 h-10 text-sm"
        />
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(value) => {
        if (value === 'em_rota' || value === 'concluidas') setTab(value);
      }}>
        <TabsList className="grid grid-cols-2 w-full h-10">
          <TabsTrigger value="em_rota" className="text-xs">Em Rota ({filteredStops.length})</TabsTrigger>
          <TabsTrigger value="concluidas" className="text-xs">Concluídas ({completedStops.length})</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-3 space-y-2">
          {filteredStops.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Truck className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  {search ? 'Nenhum resultado para a busca.' : 'Nenhuma parada nesta aba.'}
                </p>
              </CardContent>
            </Card>
          ) : (
            filteredStops.map((stop, idx) => {
              const orderNum = getStopOrderNumber(stop);
              const isArrived = stop.status === 'arrived';
              return (
                <Card key={stop.id} className={cn(isArrived && 'border-primary')}>
                  <button
                    type="button"
                    onClick={() => setDetailStop(stop)}
                    className="w-full text-left"
                  >
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-md shrink-0 text-xs font-bold',
                        isArrived ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'
                      )}>
                        <span className="relative">
                          <Package className="h-4 w-4" />
                          <span className="absolute -top-2 -right-3 text-[9px] bg-warning text-warning-foreground rounded-full h-3.5 w-3.5 flex items-center justify-center font-bold">
                            {idx + 1}
                          </span>
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">
                          {stop.clients?.company_name || stop.destination || `Parada ${idx + 1}`}
                        </p>
                        {orderNum && (
                          <p className="text-[11px] text-muted-foreground">
                            Pedido: {orderNum}
                          </p>
                        )}
                      </div>
                      {isArrived && (
                        <Badge variant="secondary" className="bg-primary/10 text-primary text-[10px] mr-1">No local</Badge>
                      )}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </CardContent>
                  </button>
                </Card>
              );
            })
          )}

          {tab === 'em_rota' && completedStops.length > 0 && (
            <div className="pt-2 space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Concluídas</p>
              {completedStops.map((stop) => (
                <Card key={stop.id} className="opacity-70">
                  <CardContent className="p-3 flex items-center gap-3">
                    <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{stop.clients?.company_name || stop.destination || 'Parada'}</p>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">{stopStatusLabel(stop.status)}</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Sheet: Catálogo de eventos */}
      <Sheet open={!!eventCatalogStop} onOpenChange={(o) => !o && setEventCatalogStop(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">Listagem de eventos</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Finalizador</p>
              {EVENTS.filter((e) => e.category === 'finalizador').map((e) => {
                const Icon = e.icon;
                return (
                  <button
                    key={e.key}
                    onClick={() => {
                      if (!eventCatalogStop) return;
                      setEventForm({ stop: eventCatalogStop, eventKey: e.key });
                      setEventCatalogStop(null);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-md border border-border hover:bg-accent active:bg-accent/70 transition-colors"
                  >
                    <Icon className="h-4 w-4 text-foreground" />
                    <span className="text-sm font-medium flex-1 text-left">{e.label}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Informativo</p>
              {EVENTS.filter((e) => e.category === 'informativo').map((e) => {
                const Icon = e.icon;
                return (
                  <button
                    key={e.key}
                    onClick={() => {
                      if (!eventCatalogStop) return;
                      setEventForm({ stop: eventCatalogStop, eventKey: e.key });
                      setEventCatalogStop(null);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-md border border-border hover:bg-accent active:bg-accent/70 transition-colors"
                  >
                    <Icon className="h-4 w-4 text-foreground" />
                    <span className="text-sm font-medium flex-1 text-left">{e.label}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Sheet: Dados do evento */}
      <Sheet open={!!eventForm} onOpenChange={(o) => { if (!o && !submitEvent.isPending) resetForm(); }}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[92vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">Dados do evento</SheetTitle>
          </SheetHeader>
          {def && (
            <div className="space-y-4 mt-2">
              <div className="bg-primary/10 text-primary rounded-md px-3 py-2 text-sm font-medium flex items-center gap-2">
                <def.icon className="h-4 w-4" />
                Evento: <span className="font-bold">{def.label}</span>
              </div>

              <fieldset disabled={submitEvent.isPending || submissionLocked} className="space-y-4 disabled:opacity-70">
              {/* Cliente / parada resumo */}
              {eventForm?.stop && (
                <div className="rounded-md border border-border p-3 space-y-1 bg-muted/30">
                  <p className="text-sm font-semibold">{eventForm.stop.clients?.company_name || 'Cliente'}</p>
                  <p className="text-[11px] text-muted-foreground">{eventForm.stop.destination}</p>
                  {getStopOrderNumber(eventForm.stop) && (
                    <Badge variant="outline" className="text-[10px]">Pedido {getStopOrderNumber(eventForm.stop)}</Badge>
                  )}
                </div>
              )}

              {/* Contato do cliente (boleto / desconto) */}
              {def.showsContact && eventForm?.stop?.clients && (
                <div className="rounded-md border border-border p-3 space-y-2">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Contato do cliente</p>
                  {eventForm.stop.clients.phone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                      <a href={`tel:${eventForm.stop.clients.phone}`} className="text-primary">{eventForm.stop.clients.phone}</a>
                    </div>
                  )}
                  {eventForm.stop.clients.mobile && (
                    <div className="flex items-center gap-2 text-sm">
                      <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                      <a target="_blank" rel="noreferrer" href={`https://wa.me/${eventForm.stop.clients.mobile}`} className="text-primary">
                        WhatsApp
                      </a>
                    </div>
                  )}
                  {eventForm.stop.clients.email && (
                    <div className="text-[11px] text-muted-foreground">{eventForm.stop.clients.email}</div>
                  )}
                </div>
              )}

              {/* Bloco BOLETO */}
              {def.key === 'atualizar_boleto' && (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Atualização de boleto</p>
                  <div className="space-y-1.5">
                    <Label htmlFor="delivery-boleto-due-date" className="text-xs">Novo vencimento sugerido</Label>
                    <Input id="delivery-boleto-due-date" type="date" value={boletoDueDate} onChange={(e) => setBoletoDueDate(e.target.value)} className="h-10 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="delivery-boleto-note" className="text-xs">Detalhe / motivo</Label>
                    <Textarea id="delivery-boleto-note" rows={2} value={boletoNote} onChange={(e) => setBoletoNote(e.target.value)} placeholder="Ex.: cliente pediu prorrogar 3 dias úteis" className="text-sm" />
                  </div>
                </div>
              )}

              {/* Bloco DESCONTO */}
              {def.showsDiscount && (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Solicitar desconto</p>
                  <div role="group" aria-label="Tipo do desconto" className="grid grid-cols-3 gap-2">
                    <button type="button" aria-label="Desconto em porcentagem" aria-pressed={discountKind === 'percent'} onClick={() => setDiscountKind('percent')} className={cn('text-xs h-9 rounded-md border', discountKind === 'percent' ? 'border-primary bg-primary/10 text-primary' : 'border-border')}>%</button>
                    <button type="button" aria-label="Desconto em reais" aria-pressed={discountKind === 'value'} onClick={() => setDiscountKind('value')} className={cn('text-xs h-9 rounded-md border', discountKind === 'value' ? 'border-primary bg-primary/10 text-primary' : 'border-border')}>R$</button>
                    <Label htmlFor="delivery-discount-amount" className="sr-only">Valor do desconto</Label>
                    <Input
                      id="delivery-discount-amount"
                      value={discountAmount}
                      onChange={(e) => setDiscountAmount(e.target.value.replace(',', '.'))}
                      inputMode="decimal"
                      placeholder={discountKind === 'percent' ? '5' : '50,00'}
                      className="h-9 text-sm"
                    />
                  </div>
                  <Label htmlFor="delivery-discount-reason" className="sr-only">Justificativa do desconto</Label>
                  <Textarea
                    id="delivery-discount-reason"
                    rows={2}
                    value={discountReason}
                    onChange={(e) => setDiscountReason(e.target.value)}
                    placeholder="Justificativa (obrigatório)"
                    className="text-sm"
                  />
                </div>
              )}

              {/* Bloco PRODUTOS para devolução */}
              {def.showsItems && def.category === 'finalizador' && allStopProducts.length > stopProducts.length && (
                <p role="status" className="text-sm text-muted-foreground">Notas já concluídas foram preservadas. A devolução considera somente os itens restantes desta parada.</p>
              )}
              {def.showsItems && stopProducts.length > 0 && (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                      Produtos do cliente ({stopProducts.length})
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const all: Record<string, number> = {};
                        stopProducts.forEach((p) => { all[p.id] = p.qty; });
                        setReturnedItems(all);
                      }}
                      className="text-[10px] text-primary"
                    >
                      Marcar tudo
                    </button>
                  </div>
                  <div className="space-y-2">
                    {stopProducts.map((p) => {
                      const q = returnedItems[p.id] || 0;
                      const checked = q > 0;
                      return (
                        <div key={p.id} className={cn('rounded-md border p-2 space-y-1.5', checked ? 'border-primary bg-primary/5' : 'border-border')}>
                          <button
                            type="button"
                            onClick={() => setReturnedItems((prev) => {
                              const next = { ...prev };
                              if (next[p.id]) delete next[p.id];
                              else next[p.id] = p.qty;
                              return next;
                            })}
                            className="w-full flex items-start gap-2 text-left"
                          >
                            <div className={cn('mt-0.5 h-4 w-4 rounded border flex items-center justify-center shrink-0', checked ? 'bg-primary border-primary text-primary-foreground' : 'border-border')}>
                              {checked && <CheckCircle className="h-3 w-3" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium leading-tight">{p.name}</p>
                              <p className="text-[10px] text-muted-foreground">SKU {p.sku} · {p.qty} {p.unit} · R$ {p.price.toFixed(2)}</p>
                            </div>
                          </button>
                          {checked && (
                            <div className="flex items-center gap-2 pl-6">
                              <Label htmlFor={`delivery-return-quantity-${p.id}`} className="text-[10px] text-muted-foreground">Devolver:</Label>
                              <Input
                                id={`delivery-return-quantity-${p.id}`}
                                type="number"
                                aria-label={`Quantidade devolvida de ${p.name}`} min={0} step="any"
                                max={p.qty}
                                value={q}
                                onChange={(e) => {
                                  const v = Math.min(p.qty, Math.max(0, Number(e.target.value || '0')));
                                  setReturnedItems((prev) => ({ ...prev, [p.id]: v }));
                                }}
                                className="h-7 text-xs w-20"
                              />
                              <span className="text-[10px] text-muted-foreground">/ {p.qty} {p.unit}</span>
                              <span className="ml-auto text-[10px] font-semibold">R$ {(q * p.price).toFixed(2)}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {totalReturnedQty > 0 && (
                    <div className="flex items-center justify-between pt-1 border-t border-border text-xs">
                      <span className="text-muted-foreground">Total devolução</span>
                      <span className="font-semibold">R$ {totalReturnValue.toFixed(2)}</span>
                    </div>
                  )}
                  <Textarea
                    rows={2}
                    value={returnReason}
                    onChange={(e) => setReturnReason(e.target.value)}
                    aria-label="Motivo da devolução" placeholder="Motivo da devolução (avaria, validade, divergência...)"
                    className="text-sm"
                  />
                </div>
              )}

              {/* Recebedor */}
              <div className="space-y-1.5">
                <Label htmlFor="delivery-receiver" className="text-xs font-medium">
                  Recebedor {def.requiresReceiver && <span className="text-destructive">*</span>}
                </Label>
                <Input
                  id="delivery-receiver" placeholder="Digite o nome aqui"
                  value={receiverName}
                  onChange={(e) => setReceiverName(e.target.value)}
                  className="text-sm h-10"
                  maxLength={120}
                />
              </div>

              {/* Documento */}
              <div className="space-y-1.5">
                <Label htmlFor="delivery-document" className="text-xs font-medium">Número do documento</Label>
                <Input
                  id="delivery-document" placeholder="RG/CPF"
                  value={receiverDoc}
                  onChange={(e) => setReceiverDoc(e.target.value)}
                  className="text-sm h-10"
                  inputMode="numeric"
                  maxLength={20}
                />
              </div>

              {/* Observações */}
              <div className="space-y-1.5">
                <Label htmlFor="delivery-notes" className="text-xs font-medium">Observações</Label>
                <Textarea
                  id="delivery-notes" placeholder="Observações"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="text-sm"
                  maxLength={500}
                />
              </div>

              {/* Fotos preview */}
              {photoPreviews.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">
                    Fotos <span className="text-muted-foreground font-normal">({photos.length}/5)</span>
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {photoPreviews.map((url, i) => (
                      <div key={i} className="relative aspect-square rounded-md overflow-hidden border border-border">
                        <img src={url} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" />
                        <button
                          type="button"
                          aria-label={`Remover foto ${i+1}`} onClick={() => removePhoto(i)}
                          className="absolute top-1 right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Assinatura inline */}
              {def.requiresSignature && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium">
                    Assinatura <span className="text-destructive">*</span>
                  </p>
                  <SignaturePad onChange={setSignatureDataUrl} />
                </div>
              )}

              {/* Action grid: Assinatura | Câmera | Galeria */}
              <div className="grid grid-cols-3 gap-2">
                <ActionButton
                  icon={FileSignature}
                  label="Assinatura"
                  active={!!signatureDataUrl}
                  onClick={() => {
                    // se não estiver visível ainda, força requisitos
                    if (!def.requiresSignature) {
                      toast({ title: 'Assinatura opcional', description: 'Use o quadro abaixo para assinar.' });
                    }
                    document.getElementById('sig-anchor')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                />
                <ActionButton
                  icon={Camera}
                  label="Câmera"
                  active={photos.length > 0}
                  onClick={() => cameraInputRef.current?.click()}
                />
                <ActionButton
                  icon={ImageIcon}
                  label="Galeria"
                  active={photos.length > 0}
                  onClick={() => galleryInputRef.current?.click()}
                />
              </div>

              <input
                ref={cameraInputRef}
                aria-label="Capturar foto da entrega"
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={handlePhotoSelect}
              />
              <input
                ref={galleryInputRef}
                aria-label="Selecionar fotos da entrega"
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handlePhotoSelect}
              />

              <div id="sig-anchor" />

              {/* Fallback signature pad para finalizador requerido — já renderizado acima quando required */}

              </fieldset>
              {submissionLocked && <p role="status" className="text-sm">Os dados deste envio foram preservados. Tentar novamente usa os mesmos anexos e identificador.</p>}
              {def.showsItems && productsQuery.isLoading && <p role="status">Carregando itens desta tentativa…</p>}
              {productsQuery.error && <div role="alert" className="space-y-2 text-sm text-destructive">
                <p>{deliveryErrorMessage(productsQuery.error)}</p>
                <Button variant="outline" type="button" onClick={() => void productsQuery.refetch()}>Recarregar itens</Button>
              </div>}
              {!submissionLocked && (!currentFormStop || isStopTerminal(currentFormStop.status)) && <p role="alert" className="text-sm">A parada foi encerrada ou reatribuída. Os campos preenchidos foram preservados.</p>}
              {mappedOutcome && currentFormStop && !currentFormStop.actual_arrival_at && <p role="alert" className="text-sm">Registre a chegada antes do resultado da entrega.</p>}
              {mappedOutcome==='partial_delivery' && !(totalReturnedQty>0 && totalReturnedQty<totalProductQty) && (
                <p role="alert" className="text-sm">Na entrega parcial, devolva uma quantidade maior que zero e menor que o total.</p>
              )}
              {def.key!=='entregue' && def.key!=='chegada_no_cliente' && reason.length<3 && <p className="text-sm">Informe um motivo ou descrição com pelo menos três caracteres.</p>}
              {/* Validação */}
              {!canSubmit && (
                <div className="bg-muted/50 rounded-md px-3 py-2 space-y-0.5">
                  {def.requiresReceiver && receiverName.trim().length < 2 && (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-warning" /> Informe o nome do recebedor
                    </p>
                  )}
                  {def.requiresPhoto && photos.length === 0 && (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-warning" /> Adicione pelo menos 1 foto
                    </p>
                  )}
                  {def.requiresSignature && !signatureDataUrl && (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-warning" /> Capture a assinatura
                    </p>
                  )}
                </div>
              )}

              <Button
                size="lg"
                className="w-full"
                onClick={() => submitEvent.mutate()}
                disabled={(!canSubmit && !submissionLocked) || submitEvent.isPending}
              >
                {submitEvent.isPending ? 'Enviando...' : submissionLocked ? 'Tentar novamente o mesmo envio' : 'Lançar evento'}
              </Button>

              <p className="text-xs text-muted-foreground">Solicitações são registradas para análise da operação. O envio não representa aprovação.</p>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Sheet: Detalhe da entrega (espelho do app de referência) */}
      <Sheet open={!!detailStop} onOpenChange={(o) => !o && setDetailStop(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[92vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base text-center">Entrega</SheetTitle>
          </SheetHeader>
          {detailStop && (
            <div className="space-y-4 mt-2">
              {/* Badge nº pedido */}
              <div className="flex justify-center">
                <Badge variant="secondary" className="bg-primary/10 text-primary px-3 py-1 text-xs">
                  Outro: {getStopOrderNumber(detailStop) || '—'}
                </Badge>
              </div>

              {/* Card cliente */}
              <div className="rounded-lg border border-border overflow-hidden flex">
                <div className="w-1.5 bg-primary" />
                <div className="flex-1 p-3 flex items-start gap-3">
                  <div className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                    <Package className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm font-bold truncate">
                      {detailStop.clients?.company_name || 'Cliente'}
                    </p>
                    {detailStop.destination && (
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        {detailStop.destination}
                      </p>
                    )}
                    {detailStop.notes && (
                      <p className="text-[11px] text-muted-foreground">
                        {detailStop.notes}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Saída / Previsão */}
              <div className="space-y-2">
                <div>
                  <p className="text-xs font-semibold">Saída</p>
                  <p className="text-xs text-muted-foreground">
                    {detailStop.actual_departure_at
                      ? new Date(detailStop.actual_departure_at).toLocaleString('pt-BR', {
                          day: '2-digit', month: '2-digit', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })
                      : 'Saída não registrada'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold">Previsão</p>
                  <p className="text-xs text-muted-foreground">
                    {detailStop.planned_arrival_at ? new Date(detailStop.planned_arrival_at).toLocaleString('pt-BR') : 'Sem previsão cadastrada'}
                  </p>
                </div>
              </div>

              {/* Status atual */}
              <div className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2">
                <span className="text-[11px] text-muted-foreground">Status</span>
                <Badge variant="secondary" className={cn(
                  'text-[10px]',
                  detailStop.status === 'arrived' && 'bg-primary/10 text-primary',
                  detailStop.status === 'completed' && 'bg-green-100 text-green-700',
                )}>
                  {stopStatusLabel(detailStop.status)}
                </Badge>
              </div>

              {/* Ações principais */}
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  size="lg"
                  className="flex-1"
                  onClick={() => {
                    setEventCatalogStop(detailStop);
                    setDetailStop(null);
                  }}
                  disabled={isStopTerminal(detailStop.status)}
                >
                  <PenLine className="h-4 w-4 mr-1.5" /> Lançar evento
                </Button>
                <Button
                  size="lg"
                  className="flex-1"
                  onClick={() => {
                    setEventForm({ stop: detailStop, eventKey: 'entregue' });
                    setDetailStop(null);
                  }}
                  disabled={isStopTerminal(detailStop.status)}
                >
                  <CheckCircle className="h-4 w-4 mr-1.5" /> TudoEntregue
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ActionButton({
  icon: Icon, label, active, onClick,
}: { icon: React.ComponentType<{ className?: string }>; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 py-3 rounded-md border transition-colors min-h-16',
        active
          ? 'border-primary bg-primary/5 text-primary'
          : 'border-border hover:bg-accent active:bg-accent/70 text-foreground'
      )}
    >
      <Icon className="h-5 w-5" />
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  );
}
