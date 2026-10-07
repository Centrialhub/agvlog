import { useState, useRef, useMemo, useEffect } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Package } from 'lucide-react';
import { isStopTerminal } from '@/lib/status/stopStatus';
import { isDocumentTerminal } from '@/lib/status/documentStatus';
import { readDriverDeliveryItems, type DriverDeliveryItem } from '@/lib/driver/driverDeliveryItems';
import { createDeliverySubmission, deliveryOutcome, deliveryErrorMessage, invalidateDeliveryQueries, replayPendingDeliverySubmissions } from '@/lib/driver/driverDeliverySubmission';
import { getCurrentDriverLocation } from '@/lib/driverLocation';
import { DRIVER_TRIP_SELECT, normalizeDriverTrip, isDriverTripStarted } from '@/lib/driverTrip';
import { isReceiptScanAcceptable } from '@/lib/driver/receiptScan';
import { baselineReceiptScanQualityPolicy, resolveReceiptScanQualityPolicy } from '@/lib/driver/receiptQualityPolicy';
import { useDriverDeliveryEventDraft } from '@/hooks/useDriverDeliveryEventDraft';
import { DriverDeliveryEventCatalogSheet } from '@/components/driver/deliveries/DriverDeliveryEventCatalogSheet';
import { DriverDeliveryEventFormSheet } from '@/components/driver/deliveries/DriverDeliveryEventFormSheet';
import { DriverDeliveryDetailSheet } from '@/components/driver/deliveries/DriverDeliveryDetailSheet';
import { DriverDeliveryStopList } from '@/components/driver/deliveries/DriverDeliveryStopList';
import { useDriverDeliveryStopsView } from '@/hooks/useDriverDeliveryStopsView';
import { getDriverDeliveryEvent, type DeliveryEventSelection, type DriverStop, type StopProduct } from '@/components/driver/deliveries/driverDeliveryEvents';
import { driverOperationalSnapshotStore, type DriverOperationalSnapshot } from '@/lib/driver/driverOperationalOffline';
import { useDriverOperationalOffline } from '@/hooks/useDriverOperationalOffline';
import { useDriverDeliverySelection, useDriverDeliverySnapshotPersistence, stopFromSnapshot, tripFromSnapshot, type DeliveryTrip } from '@/hooks/useDriverDeliverySelection';
import { fiscalSnapshotAsJson, getDriverDeliveryFiscalSnapshot, type DriverDeliveryFiscalSnapshot } from '@/lib/driver/driverDeliveryFiscalSnapshot';
export default function DriverDeliveries() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const operationalCommands = useDriverOperationalOffline();
  const driverQuery = useCurrentDriver();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTripId = searchParams.get('trip');
  const [operationalSnapshot, setOperationalSnapshot] = useState<DriverOperationalSnapshot | null>(null);
  const [snapshotResolved, setSnapshotResolved] = useState(false);
  useEffect(() => {
    let active = true;
    setSnapshotResolved(false);
    if (!currentTenant?.id || !user?.id) { setOperationalSnapshot(null); setSnapshotResolved(true); return; }
    const read = selectedTripId
      ? driverOperationalSnapshotStore.read(currentTenant.id, user.id, selectedTripId)
      : driverOperationalSnapshotStore.readLatest(currentTenant.id, user.id);
    void read.then(snapshot => { if (active) setOperationalSnapshot(snapshot); })
      .catch(() => { if (active) setOperationalSnapshot(null); })
      .finally(() => { if (active) setSnapshotResolved(true); });
    return () => { active = false; };
  }, [currentTenant?.id, selectedTripId, user?.id]);
  const snapshotMatches = !!operationalSnapshot && operationalSnapshot.tenantId === currentTenant?.id
    && operationalSnapshot.actorId === user?.id && (!selectedTripId || operationalSnapshot.tripId === selectedTripId);
  const cachedDriver = snapshotMatches ? { id: operationalSnapshot.trip.driver.id,
    name: operationalSnapshot.trip.driver.name, tenant_id: operationalSnapshot.tenantId, active: true } : null;
  const driver = driverQuery.data ?? cachedDriver;
  const autoTripQuery = useActiveTrip(driver?.id);
  const specificTripQuery = useQuery({
    queryKey: ['driver_trip_specific',currentTenant?.id,driver?.id,selectedTripId],
    enabled: isOnline && !!selectedTripId && !!driver?.id && !!currentTenant?.id,
    queryFn: async () => {
      if (!selectedTripId || !driver || !currentTenant) return null;
      const {data,error} = await supabase.from('dispatch_trips').select(DRIVER_TRIP_SELECT)
        .eq('id',selectedTripId).eq('driver_id',driver.id).eq('tenant_id',currentTenant.id).maybeSingle();
      if (error) throw error;
      return data ? normalizeDriverTrip(data) : null;
    },
  });
  const tripQuery = selectedTripId ? specificTripQuery : autoTripQuery;
  const liveTrip = tripQuery.data as DeliveryTrip | null | undefined;
  const storedTrip = snapshotMatches ? tripFromSnapshot(operationalSnapshot) : null;
  const trip = isOnline && liveTrip === null && !tripQuery.error ? null : liveTrip ?? storedTrip;
  const snapshotForTrip = snapshotMatches && operationalSnapshot.tripId === trip?.id ? operationalSnapshot : null;
  const submissionRef = useRef<ReturnType<typeof createDeliverySubmission> | null>(null);
  const [submissionLocked, setSubmissionLocked] = useState(false);
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const [pendingStopIds,setPendingStopIds] = useState<Set<string>>(() => new Set());
  const outboxReplayQuery = useQuery({
    queryKey:['driver_delivery_outbox_replay',currentTenant?.id,user?.id],
    enabled:!!currentTenant?.id && !!user?.id,
    retry:false,
    staleTime:Infinity,
    queryFn:() => replayPendingDeliverySubmissions(currentTenant!.id,user!.id),
  });
  useEffect(() => {
    if (!outboxReplayQuery.data) { setPendingStopIds(new Set()); return; }
    setPendingStopIds(new Set(outboxReplayQuery.data.pendingStopIds));
    if (outboxReplayQuery.data.confirmed || outboxReplayQuery.data.cleaned) {
      toast({title:outboxReplayQuery.data.confirmed ? 'Envio pendente confirmado' : 'Anexos pendentes recuperados'});
      void invalidateDeliveryQueries(qc);
    }
  }, [outboxReplayQuery.data,qc,toast]);

  const stopsQuery = useQuery({
    queryKey: ['driver_delivery_stops', currentTenant?.id, driver?.id, trip?.id, user?.id],
    queryFn: async ({ signal }) => {
      if (!trip?.id) return [];
      const { data, error } = await supabase
        .from('dispatch_stops')
        .select('*, clients(company_name, phone, mobile, email), dispatch_stop_documents(fiscal_documents(invoice_number, reference_number))')
        .eq('dispatch_trip_id', trip.id).eq('tenant_id', currentTenant!.id)
        .order('stop_order', { ascending: true }).abortSignal(signal);
      if (error) throw error;
      return data || [];
    },
    enabled: isOnline && !!trip?.id && !!currentTenant?.id && !!driver?.id,
  });

  const cachedStops = useMemo<DriverStop[]>(() => snapshotMatches && operationalSnapshot.tripId === trip?.id
    ? operationalSnapshot.stops.map(stop => stopFromSnapshot(operationalSnapshot, stop)) : [],
  [operationalSnapshot, snapshotMatches, trip?.id]);
  const effectiveStops = useMemo<DriverStop[]>(() => {
    const stops = (stopsQuery.data ?? cachedStops).filter(stop =>
      stop.tenant_id === currentTenant?.id && stop.dispatch_trip_id === trip?.id);
    const queued = operationalCommands.commands.filter(command => command.aggregateId === trip?.id);
    return stops.map(stop => {
      const arrival = queued.find(command => command.kind === 'arrival'
        && typeof command.payload === 'object' && command.payload !== null && !Array.isArray(command.payload)
        && command.payload.stop_id === stop.id);
      const departure = queued.find(command => command.kind === 'departure'
        && typeof command.payload === 'object' && command.payload !== null && !Array.isArray(command.payload)
        && command.payload.stop_id === stop.id);
      return {...stop,
        status:arrival && ['pending','planned','arriving'].includes(stop.status)?'arrived':stop.status,
        actual_arrival_at:arrival&&!stop.actual_arrival_at?arrival.createdAt:stop.actual_arrival_at,
        actual_departure_at:departure&&!stop.actual_departure_at?departure.createdAt:stop.actual_departure_at};
    });
  }, [cachedStops, currentTenant?.id, operationalCommands.commands, stopsQuery.data, trip?.id]);
  const stopContextRefreshing = stopsQuery.isFetching || (isOnline && !!(tripQuery.isFetching || driverQuery.isFetching));
  const stopContextError = stopsQuery.isError || (isOnline && !!(tripQuery.error || driverQuery.error));
  const selection = useDriverDeliverySelection({
    scope: [currentTenant?.id, user?.id, driver?.id, trip?.id], stops: effectiveStops, pendingStopIds,
    refreshing: stopContextRefreshing, error: stopContextError,
    tripStarted: !!trip && isDriverTripStarted(trip.status, trip.actual_start_at),
    authoritative: stopsQuery.data !== undefined && !stopsQuery.isFetching && !stopsQuery.isError,
  });
  const { context: selectionContext, latestContext, detailStop, eventCatalogStop, eventForm, currentFormStop,
    pageHeading, openDetail, openCatalog, closeDetail, closeCatalog, closeForm, restoreFocus, assertCurrentStop } = selection;
  useEffect(() => {
    submissionRef.current = null; setSubmissionLocked(false); setLastEventId(null);
  }, [selectionContext]);
  const draft = useDriverDeliveryEventDraft();
  const eventDefinition = getDriverDeliveryEvent(eventForm?.eventKey ?? '');

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
    enabled: isOnline && !!eventForm?.stop?.id && !!currentTenant?.id && !!driver?.id && !!user?.id && !!trip?.id,
  });
  const receiptQualityPolicyQuery = useQuery({
    queryKey: ['driver_receipt_quality_policy', currentTenant?.id, eventForm?.stop.client_id, eventForm?.stop.id],
    enabled: isOnline && !!currentTenant?.id && !!eventForm?.stop.id && !!eventDefinition?.requiresReceipt,
    staleTime: 5 * 60 * 1_000,
    retry: false,
    queryFn: () => resolveReceiptScanQualityPolicy(currentTenant!.id, eventForm!.stop.client_id ?? null, eventForm!.stop.id),
  });

  const cachedStopProducts = eventForm?.stop.id && snapshotForTrip
    ? snapshotForTrip.deliveryItemsByStop?.[eventForm.stop.id] ?? [] : [];
  const allStopProducts = productsQuery.data ?? cachedStopProducts;
  const stopProducts = getDriverDeliveryEvent(eventForm?.eventKey ?? '')?.category === 'finalizador'
    ? allStopProducts.filter(item => !isDocumentTerminal(item.documentStatus)) : allStopProducts;

  const totalReturnValue = stopProducts.reduce((sum, p) => {
    const q = draft.returnedItems[p.id] || 0;
    return sum + q * p.price;
  }, 0);
  const deliveryItemsSnapshotQuery = useQuery<Record<string, DriverDeliveryItem[]>>({
    queryKey: ['driver_delivery_items_snapshot', currentTenant?.id, user?.id, trip?.id,
      (stopsQuery.data ?? []).map(stop => stop.id).join(',')],
    enabled: isOnline && !!currentTenant?.id && !!user?.id && !!trip?.id && !!stopsQuery.data?.length,
    retry: false,
    queryFn: async () => {
      const entries = await Promise.all(stopsQuery.data!.map(async stop => {
        const { data, error } = await supabase.rpc('get_driver_delivery_items', { _stop_id: stop.id });
        if (error) throw error;
        return [stop.id, readDriverDeliveryItems(data, { tenant: currentTenant!.id, actor: user!.id,
          trip: trip!.id, stop: stop.id })] as const;
      }));
      return Object.fromEntries(entries);
    },
  });
  const deliveryFiscalSnapshotQuery = useQuery<Record<string, DriverDeliveryFiscalSnapshot>>({
    queryKey: ['driver_delivery_fiscal_snapshots', currentTenant?.id, user?.id, trip?.id,
      (stopsQuery.data ?? []).map(stop => stop.id).join(',')],
    enabled: isOnline && !!currentTenant?.id && !!user?.id && !!trip?.id && !!stopsQuery.data?.length,
    retry: false,
    queryFn: async () => Object.fromEntries(await Promise.all(stopsQuery.data!.map(async stop => {
      const snapshot = await getDriverDeliveryFiscalSnapshot({ tenant: currentTenant!.id, actor: user!.id,
        trip: trip!.id, stop: stop.id });
      return [stop.id, snapshot] as const;
    }))),
  });

  useDriverDeliverySnapshotPersistence({
    tenantId: currentTenant?.id, actorId: user?.id, driver, trip: liveTrip, stops: stopsQuery.data,
    error: stopsQuery.isError, deliveryItems: deliveryItemsSnapshotQuery.data,
    fiscalSnapshots: deliveryFiscalSnapshotQuery.data, onSnapshot: setOperationalSnapshot,
  });
  const { tab, setTab, search, setSearch, filteredStops, completedStops, enRouteCount } = useDriverDeliveryStopsView(effectiveStops, pendingStopIds);
  useEffect(() => {
    if (!isOnline || !trip?.id) return;
    const channel = supabase.channel(`driver_deliveries_${trip.id}`).on('postgres_changes',
      {event:'*',schema:'public',table:'dispatch_stops',filter:`dispatch_trip_id=eq.${trip.id}`},
      () => { void invalidateDeliveryQueries(qc); }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [isOnline,trip?.id,qc]);

  const resetForm = () => {
    closeForm();
    draft.reset();
    submissionRef.current = null;
    setSubmissionLocked(false);
  };

  const selectEvent = (event: DeliveryEventSelection) => {
    if (!selection.selectEvent(event)) return;
    draft.reset(); submissionRef.current = null; setSubmissionLocked(false);
  };
  const submitEvent = useMutation({
    mutationFn: async (context: string) => {
      const assertCurrent = () => assertCurrentStop(context, eventForm?.stop.id, !!submissionRef.current);
      assertCurrent();
      if (!eventForm || !trip || !currentTenant) throw new Error('Sem viagem ou evento selecionado.');
      if (!submissionRef.current && (!currentFormStop || isStopTerminal(currentFormStop.status))) {
        throw new Error('A parada foi encerrada ou reatribuída. Atualize a viagem antes de enviar.');
      }
      if (eventForm.eventKey === 'chegada_no_cliente') {
        const location=await getCurrentDriverLocation();
        assertCurrent();
        const arrival=await operationalCommands.submit({kind:'arrival',aggregateId:trip.id,payload:{trip_id:trip.id,
          stop_id:eventForm.stop.id,latitude:location.latitude,longitude:location.longitude,accuracy_m:location.accuracyM}});
        return {arrival:true as const,queued:arrival.queued};
      }
      if (!submissionRef.current) {
        const def = getDriverDeliveryEvent(eventForm.eventKey);
        if (!def) throw new Error('Evento inválido.');
        const reason = [draft.notes.trim(),draft.returnReason.trim(),draft.discountReason.trim(),draft.boletoNote.trim()].filter(Boolean).join('\n');
        const positiveItems = Object.fromEntries(Object.entries(draft.returnedItems).filter(([,qty]) => qty>0));
        const fiscalDocumentLinks = allStopProducts.map(item => ({
          allocation_item_id: item.id,
          fiscal_document_id: item.fiscalDocumentId ?? item.sku,
          attempt_id: item.attemptId ?? null,
          document_status: item.documentStatus,
          allocated_quantity: item.qty,
        }));
        const fiscalSnapshot=deliveryFiscalSnapshotQuery.data?.[eventForm.stop.id]
          ?? (snapshotMatches && operationalSnapshot?.tripId===trip.id?operationalSnapshot.deliveryFiscalSnapshotsByStop?.[eventForm.stop.id]:undefined);
        if(def.category==='finalizador'&&!fiscalSnapshot)throw new Error('O snapshot fiscal desta parada não está disponível. Conecte-se antes de confirmar.');
        const deliveryLocation=def.requiresReceipt ? await getCurrentDriverLocation() : null;
        const stopAtSubmission = assertCurrent();
        submissionRef.current = createDeliverySubmission({tenantId:currentTenant.id,actorId:user!.id,tripId:trip.id,stopId:eventForm.stop.id,
          expectedStatus:stopAtSubmission!.status,eventKey:def.key,photos:draft.photos,receiptScan:draft.receiptScan,signatureDataUrl:draft.signatureDataUrl,details:{
            event_subtype:def.key,event_label:def.label,notes:reason,return_reason:draft.returnReason.trim() || null,
            receiver_name:draft.receiverName.trim() || null,receiver_document:draft.receiverDoc.trim() || null,
            latitude:deliveryLocation?.latitude ?? null,longitude:deliveryLocation?.longitude ?? null,
            accuracy_m:deliveryLocation?.accuracyM ?? null,
            ...(def.category==='finalizador'&&fiscalSnapshot?{
              fiscal_document_links:fiscalDocumentLinks,
              fiscal_snapshot:fiscalSnapshotAsJson(fiscalSnapshot),
            }:{}),
            returned_items:positiveItems,discount_amount:draft.discountAmount || null,discount_kind:draft.discountKind,
            discount_reason:draft.discountReason.trim() || null,boleto_due_date:draft.boletoDueDate || null,boleto_note:draft.boletoNote.trim() || null,
          }});
      }
      setSubmissionLocked(true);
      setSearchParams({trip:trip.id},{replace:true});
      const attempt = submissionRef.current;
      try { return await attempt.submit(); }
      catch (error) {
        if (context === latestContext.current && submissionRef.current === attempt && attempt.canRevise) {
          submissionRef.current=null; setSubmissionLocked(false);
          await invalidateDeliveryQueries(qc);
        }
        throw error;
      }
    },
    onSuccess: async (result, context) => {
      if (context !== latestContext.current) return;
      if(result&&'arrival' in result){
        toast({title:result.queued?'Chegada salva no aparelho':'Chegada registrada',description:result.queued?'A entrega já pode ser preenchida e a chegada será sincronizada primeiro.':undefined});
        if(!result.queued)await invalidateDeliveryQueries(qc);
        if (context !== latestContext.current) return;
        resetForm();closeCatalog();return;
      }
      if (result?.queued) {
        setPendingStopIds(previous => new Set(previous).add(result.stop_id));
        if (result.needs_attention) {
          toast({title:'Envio requer conferência',description:'Os documentos da parada mudaram. O registro e os anexos foram preservados, sem confirmar a entrega.',variant:'destructive'});
          return;
        }
        toast({title:'Registro salvo no aparelho',description:'Você pode prosseguir. A confirmação da operação permanece pendente até a conexão voltar.'});
        resetForm(); closeCatalog();
        return;
      }
      if (result) setLastEventId(result.operational_event_id);
      toast({title:result ? 'Evento registrado e enviado à operação' : 'Chegada registrada'});
      resetForm(); closeCatalog();
      await invalidateDeliveryQueries(qc);
    },
    onError: (error, context) => { if (context === latestContext.current) toast({title:'Envio não confirmado',description:deliveryErrorMessage(error),variant:'destructive'}); },
  });

  const hasCachedOperation = snapshotMatches;
  const pageError = outboxReplayQuery.error ?? (!hasCachedOperation ? driverQuery.error ?? tripQuery.error ?? stopsQuery.error : null);
  if (pageError) return <Card><CardContent className="py-8 space-y-3" role="alert">
    <p>{deliveryErrorMessage(pageError)}</p>
    <Button onClick={() => { void outboxReplayQuery.refetch(); void driverQuery.refetch(); void tripQuery.refetch(); if (trip?.id) void stopsQuery.refetch(); }}>Tentar novamente</Button>
  </CardContent></Card>;
  if (!snapshotResolved || outboxReplayQuery.isLoading || (!snapshotMatches && driverQuery.isLoading)
    || (!storedTrip && !!driver && tripQuery.isLoading) || (!hasCachedOperation && !!trip && stopsQuery.isLoading)) {
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

  const def = eventForm ? eventDefinition : null;
  const receiptQualityPolicy = receiptQualityPolicyQuery.data ?? baselineReceiptScanQualityPolicy(
    currentTenant?.id ?? '00000000-0000-4000-8000-000000000000',
    eventForm?.stop.client_id ?? null,
  );
  const totalReturnedQty = Object.values(draft.returnedItems).reduce((a, b) => a + (b || 0), 0);
  const totalProductQty = stopProducts.reduce((sum,item) => sum+item.qty,0);
  const mappedOutcome = def ? deliveryOutcome(def.key) : undefined;
  const reason = [draft.notes,draft.returnReason,draft.discountReason,draft.boletoNote].map(value => value.trim()).filter(Boolean).join('\n');
  const quantitiesValid = Object.entries(draft.returnedItems).every(([id,qty]) => Number.isFinite(qty) && qty>=0
    && stopProducts.some(item => item.id===id && qty<=item.qty));
  const hasDeliveryItemSnapshot = !eventForm?.stop.id || productsQuery.data !== undefined
    || !!snapshotForTrip && Object.prototype.hasOwnProperty.call(snapshotForTrip.deliveryItemsByStop ?? {}, eventForm.stop.id);
  const deliveryItemsError = productsQuery.error ?? (!isOnline && !hasDeliveryItemSnapshot
    ? new Error('Os documentos desta parada ainda não foram salvos no aparelho. Conecte-se antes de confirmar a entrega.') : null);
  const deliveryItemsLoading = productsQuery.isLoading && !hasDeliveryItemSnapshot;
  const requiresFiscalSnapshot = def?.category === 'finalizador';
  const hasFiscalSnapshot = !eventForm?.stop.id || !!deliveryFiscalSnapshotQuery.data?.[eventForm.stop.id]
    || !!snapshotForTrip?.deliveryFiscalSnapshotsByStop?.[eventForm.stop.id];
  const fiscalSnapshotError = deliveryFiscalSnapshotQuery.error ?? (!isOnline && !hasFiscalSnapshot
    ? new Error('O snapshot fiscal desta parada ainda não foi salvo no aparelho. Conecte-se antes de confirmar a entrega.') : null);
  const fiscalSnapshotLoading = deliveryFiscalSnapshotQuery.isLoading && !hasFiscalSnapshot;
  const canSubmit = !!def && isDriverTripStarted(trip.status,trip.actual_start_at)
    && !!currentFormStop && !isStopTerminal(currentFormStop.status) && !stopContextRefreshing && !stopContextError
    && (!mappedOutcome || !!currentFormStop.actual_arrival_at)
    && (!def.requiresReceiver || draft.receiverName.trim().length>=2)
    && (!def.requiresReceipt || (!isOnline || (!receiptQualityPolicyQuery.isPending && !receiptQualityPolicyQuery.error)))
    && (!def.requiresReceipt || isReceiptScanAcceptable(draft.receiptScan))
    && (!def.requiresPhoto || draft.photos.length>0) && (!def.requiresSignature || !!draft.signatureDataUrl)
    && (def.key==='entregue' || def.key==='chegada_no_cliente' || reason.length>=3)
    && (!requiresFiscalSnapshot || (hasDeliveryItemSnapshot && !deliveryItemsLoading && !deliveryItemsError
      && hasFiscalSnapshot && !fiscalSnapshotLoading && !fiscalSnapshotError))
    && (!def.showsItems || (!deliveryItemsLoading && !deliveryItemsError && quantitiesValid))
    && (mappedOutcome!=='partial_delivery' || (totalReturnedQty>0 && totalReturnedQty<totalProductQty))
    && (!['returned','refused'].includes(mappedOutcome ?? '') || (totalProductQty>0 && totalReturnedQty===totalProductQty))
    && (!def.showsDiscount || (Number(draft.discountAmount)>0 && draft.discountReason.trim().length>=3));

  return (
    <div className="space-y-4">
      <div>
        <h1 ref={pageHeading} tabIndex={-1} className="text-lg font-bold">Entregas e Coletas</h1>
        <p className="text-xs text-muted-foreground">
          Carga {trip?.loads?.load_number || '—'} · {completedStops.length}/{effectiveStops.length} concluídas
        </p>
      </div>


      {lastEventId && <Button variant="outline" onClick={() => navigate(`/driver/events/${lastEventId}`)}>Ver evento enviado à operação</Button>}
      {pendingStopIds.size > 0 && (
        <p role="status" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          {pendingStopIds.size} {pendingStopIds.size === 1 ? 'registro salvo' : 'registros salvos'} neste aparelho aguardando sincronização.
        </p>
      )}
      {!isDriverTripStarted(trip.status,trip.actual_start_at) && trip.status!=='completed' && (
        <p role="alert" className="text-sm text-destructive">A viagem precisa estar iniciada para registrar chegadas e entregas.</p>
      )}
      <DriverDeliveryStopList
        search={search}
        tab={tab}
        filteredStops={filteredStops}
        completedStops={completedStops}
        enRouteCount={enRouteCount}
        pendingStopIds={pendingStopIds}
        onSearchChange={setSearch}
        onTabChange={setTab}
        onOpenStop={openDetail}
      />

      <DriverDeliveryEventCatalogSheet
        stop={eventCatalogStop}
        loading={stopContextRefreshing}
        refreshError={stopContextError}
        onRefresh={stopsQuery.refetch}
        actionsDisabled={stopContextRefreshing || stopContextError || !!eventCatalogStop && pendingStopIds.has(eventCatalogStop.id)}
        onCloseAutoFocus={restoreFocus}
        onClose={() => closeCatalog()}
        onSelect={(selection) => {
          selectEvent(selection);
          closeCatalog();
        }}
      />

      <DriverDeliveryEventFormSheet
        selection={eventForm}
        stopsLoading={stopContextRefreshing}
        stopsError={stopContextError}
        refetchStops={stopsQuery.refetch}
        onCloseAutoFocus={restoreFocus}
        definition={def}
        draft={draft}
        currentStop={currentFormStop}
        allProducts={allStopProducts}
        products={stopProducts}
        productsLoading={deliveryItemsLoading}
        productsError={deliveryItemsError}
        refetchProducts={productsQuery.refetch}
        totalReturnValue={totalReturnValue}
        totalReturnedQuantity={totalReturnedQty}
        totalProductQuantity={totalProductQty}
        mappedOutcome={mappedOutcome}
        reason={reason}
        canSubmit={canSubmit}
        submissionLocked={submissionLocked}
        submitting={submitEvent.isPending}
        receiptQualityPolicy={receiptQualityPolicy}
        receiptQualityPolicyLoading={isOnline && receiptQualityPolicyQuery.isPending}
        receiptQualityPolicyError={isOnline ? receiptQualityPolicyQuery.error : null}
        refetchReceiptQualityPolicy={receiptQualityPolicyQuery.refetch}
        onClose={resetForm}
        onSubmit={() => submitEvent.mutate(selectionContext)}
        notify={toast}
      />

      <DriverDeliveryDetailSheet
        stop={detailStop}
        loading={stopContextRefreshing}
        refreshError={stopContextError}
        onRefresh={stopsQuery.refetch}
        actionsDisabled={stopContextRefreshing || stopContextError || !!detailStop && pendingStopIds.has(detailStop.id)}
        onCloseAutoFocus={restoreFocus}
        onClose={() => closeDetail()}
        onOpenCatalog={openCatalog}
        onSelectEvent={(selection) => {
          selectEvent(selection);
          closeDetail();
        }}
      />
    </div>
  );
}
