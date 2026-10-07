import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Truck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import DriverCargoCustodyFields from '@/components/driver/DriverCargoCustodyFields';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { removeSecureFiles, uploadSecureFile } from '@/lib/secureUpload';
import {
  buildTripCargoDivergenceCommand, getCompleteTripCargoControl, tripCargoStatusLabels, updateDriverTripCargo,
  type DriverTripCargoAction, type TripCargoAvailableSnapshot,
} from '@/lib/driver/tripCargoCustody';
import { driverOperationalSnapshotStore, type DriverOperationalSnapshot } from '@/lib/driver/driverOperationalOffline';
import { normalizeCargoWeightKg } from '@/lib/driver/cargoWeightKg';
import type { CargoTripIdentity } from '@/lib/driver/cargoTripIdentity';
import { useDriverCargoTripIdentity } from '@/hooks/useDriverCargoTripIdentity';
import { supabase } from '@/integrations/supabase/client';
import { invalidateTripLoadQueries, isConfirmedTripStart } from '@/lib/tripMutation';
import { parseTripCargoLoadDrafts, requireExactCargoDocuments, type TripCargoLoadDraft } from '@/lib/driver/tripCargoConfirmation';

type EvidenceDraft = { kind: 'loading' | 'tie_down' | 'damage' | 'shortage' | 'surplus' | 'seal' | 'other'; file: File | null; path: string | null };
type SealResolutionDraft = { status: 'removed' | 'broken' | 'missing'; reason: string; file: File | null; path: string | null };
type SealInstallationDraft = { file: File | null; path: string | null };

const parseSealNumbers = (value: string) => [...new Set(value.split(/[,;\n]/).map(item => item.trim()).filter(Boolean))];
const emptyEvidence = (): EvidenceDraft[] => [
  { kind: 'loading', file: null, path: null }, { kind: 'tie_down', file: null, path: null },
  { kind: 'other', file: null, path: null },
];

const initialCargoWeight = (value: number) => {
  try { return { ...normalizeCargoWeightKg(value), error: null }; }
  catch (error) {
    return { value: '', raw: String(value), rounded: false,
      error: error instanceof Error ? error.message : 'Peso inválido para conferência.' };
  }
};

export default function DriverCargoCustody() {
  const [params] = useSearchParams();
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const driver = useCurrentDriver();
  const activeTrip = useActiveTrip(driver.data?.id);
  const tripId = params.get('trip') || activeTrip.data?.id || null;
  return <DriverCargoCustodySession key={`${currentTenant?.id}:${user?.id}:${driver.data?.id}:${tripId}`}
    tripId={tripId} driver={driver} activeTrip={activeTrip} />;
}

function DriverCargoCustodySession({ tripId, driver, activeTrip }: {
  tripId: string | null; driver: ReturnType<typeof useCurrentDriver>; activeTrip: ReturnType<typeof useActiveTrip>;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const isOnline = useOnlineStatus();
  const tripIdentity = useDriverCargoTripIdentity(driver.data?.id, tripId);
  const sessionActive = useRef(true);
  useEffect(() => {
    sessionActive.current = true;
    return () => { sessionActive.current = false; };
  }, []);
  const [loads, setLoads] = useState<TripCargoLoadDraft[]>([]);
  const [documents, setDocuments] = useState<string[]>([]);
  const [vehicleChecked, setVehicleChecked] = useState(false);
  const [tieDown, setTieDown] = useState(false);
  const [seal, setSeal] = useState('');
  const [sealReason, setSealReason] = useState('');
  const [sealInstallationEvidence, setSealInstallationEvidence] = useState<Record<string, SealInstallationDraft>>({});
  const [sealResolutions, setSealResolutions] = useState<Record<string, SealResolutionDraft>>({});
  const [divergenceKind, setDivergenceKind] = useState('');
  const [divergence, setDivergence] = useState('');
  const [divergenceLoadId, setDivergenceLoadId] = useState('');
  const [divergenceDocumentId, setDivergenceDocumentId] = useState('');
  const [evidence, setEvidence] = useState<EvidenceDraft[]>(emptyEvidence);
  const hydratedControl = useRef<string | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const [cachedCargo, setCachedCargo] = useState<Awaited<ReturnType<typeof getCompleteTripCargoControl>> | null>(null);
  const [cachedOperational, setCachedOperational] = useState<DriverOperationalSnapshot | null>(null);

  const cargo = useQuery({
    queryKey: ['trip-cargo-control', currentTenant?.id, user?.id, driver.data?.id, tripId],
    enabled: !!currentTenant?.id && !!user?.id && !!driver.data?.id && !!tripId,
    retry: false,
    queryFn: () => getCompleteTripCargoControl(currentTenant!.id, tripId!),
  });
  useEffect(() => {
    hydratedControl.current = null;
    requestIds.current.clear();
    setCachedCargo(null);
    setCachedOperational(null);
    setLoads([]); setDocuments([]); setVehicleChecked(false); setTieDown(false);
    setSeal(''); setSealReason(''); setSealInstallationEvidence({}); setSealResolutions({});
    setDivergenceKind(''); setDivergence(''); setDivergenceLoadId(''); setDivergenceDocumentId('');
    setEvidence(emptyEvidence());
  }, [currentTenant?.id, user?.id, driver.data?.id, tripId]);
  useEffect(() => {
    if (!currentTenant?.id || !user?.id || !tripId) { setCachedCargo(null); return; }
    let cancelled = false;
    setCachedCargo(null);
    void driverOperationalSnapshotStore.read(currentTenant.id, user.id, tripId)
      .then(snapshot => {
        if (cancelled) return;
        const matchesDriver = !snapshot || !driver.data?.id || snapshot.trip.driver.id === driver.data.id;
        setCachedCargo(matchesDriver ? snapshot?.cargo ?? null : null);
        setCachedOperational(matchesDriver ? snapshot : null);
      })
      .catch(() => { if (!cancelled) setCachedCargo(null); });
    return () => { cancelled = true; };
  }, [currentTenant?.id, tripId, user?.id, driver.data?.id]);

  useEffect(() => {
    if (!cargo.data || !currentTenant?.id || !user?.id || !tripId || !driver.data) return;
    if (isOnline && (!tripIdentity.data || tripIdentity.isError || tripIdentity.isFetching)) return;
    let cancelled = false;
    const currentDriver = driver.data;
    void (async () => {
      const existing = await driverOperationalSnapshotStore.read(currentTenant.id, user.id, tripId);
      const active = activeTrip.data?.id === tripId ? activeTrip.data : null;
      if (cancelled) return;
      const liveIdentity = tripIdentity.data;
      const sameVehicle = liveIdentity?.vehicleId === (cargo.data.available ? cargo.data.control.vehicle_id : cargo.data.vehicle_id);
      if (isOnline && !sameVehicle) return;
      const next: DriverOperationalSnapshot = {
        ...existing,
        version: 1, tenantId: currentTenant.id, actorId: user.id, tripId, cachedAt: new Date().toISOString(),
        trip: { id: tripId, status: active?.status ?? cargo.data.trip_status,
          actualStartAt: active?.actual_start_at ?? existing?.trip.actualStartAt ?? null,
          actualEndAt: active?.actual_end_at ?? existing?.trip.actualEndAt ?? null,
          driver: { id: currentDriver.id, name: currentDriver.name },
          vehicle: liveIdentity && sameVehicle && liveIdentity.vehicleId
            ? { id: liveIdentity.vehicleId, plate: liveIdentity.plate ?? '', nickname: null }
            : !isOnline && existing?.trip.driver.id === currentDriver.id ? existing.trip.vehicle : null },
        loads: cargo.data.available ? cargo.data.loads.map(row => ({ id: row.load_id,
          loadNumber: liveIdentity?.loads.find(item => item.id === row.load_id)?.loadNumber
            ?? (!isOnline ? existing?.loads.find(item => item.id === row.load_id)?.loadNumber : '') ?? '',
          status: liveIdentity?.loads.find(item => item.id === row.load_id)?.status ?? '',
          origin: liveIdentity?.loads.find(item => item.id === row.load_id)?.origin ?? null,
          destination: liveIdentity?.loads.find(item => item.id === row.load_id)?.destination ?? null,
          volumeCount: row.confirmed_volume_count ?? row.expected_volume_count,
          palletCount: row.confirmed_pallet_count ?? row.expected_pallet_count,
          weightKg: row.confirmed_weight_kg ?? row.expected_weight_kg })) : existing?.loads ?? [],
        stops: existing?.stops ?? [],
        documents: cargo.data.available ? cargo.data.documents.map(document => ({ id: document.id, loadId: document.load_id,
          kind: document.source_kind, referenceNumber: document.reference_number })) : existing?.documents ?? [],
        deliveryItemsByStop: existing?.deliveryItemsByStop,
        instructions: existing?.instructions ?? [],
        checklist: existing?.checklist ?? { pre: { id: null, boundaryId: null, checkedItems: [] }, post: { id: null, boundaryId: null, checkedItems: [] } },
        journey: existing?.journey ?? { events: [], lastStartId: null, lastEndId: null },
        occurrences: existing?.occurrences ?? [],
        cargo: cargo.data,
      };
      await driverOperationalSnapshotStore.put(next);
      if (cancelled) return;
      setCachedCargo(cargo.data);
      setCachedOperational(next);
    })().catch(() => { /* Live data remains authoritative if durable cache is unavailable. */ });
    return () => { cancelled = true; };
  }, [activeTrip.data, cargo.data, currentTenant?.id, driver.data, tripId, user?.id,
    tripIdentity.data, tripIdentity.isError, tripIdentity.isFetching, isOnline]);

  const effectiveCargo = cargo.data ?? cachedCargo;
  const usingCachedCargo = !cargo.data && !!cachedCargo;
  const available = effectiveCargo?.available ? effectiveCargo : null;
  const cargoVehicleId = effectiveCargo?.available ? effectiveCargo.control.vehicle_id : effectiveCargo?.vehicle_id;
  const liveIdentity = !tripIdentity.isError && !tripIdentity.isFetching && tripIdentity.data?.vehicleId === cargoVehicleId
    ? tripIdentity.data : null;
  const savedIdentity: CargoTripIdentity | null = !isOnline && cachedOperational && cachedOperational.trip.vehicle?.id === cargoVehicleId
    ? { tripId: cachedOperational.tripId, tenantId: cachedOperational.tenantId,
      driverId: cachedOperational.trip.driver.id, vehicleId: cargoVehicleId ?? null,
      plate: cachedOperational.trip.vehicle?.plate || null,
      loads: cachedOperational.loads.map(item => ({ id: item.id,
        loadNumber: item.loadNumber === item.id.slice(0, 8) ? '' : item.loadNumber,
        origin: item.origin, destination: item.destination, status: item.status })) } : null;
  const identity = liveIdentity ?? savedIdentity;
  const loadLabel = (loadId: string) => identity?.loads.find(item => item.id === loadId)?.loadNumber || 'Número indisponível';
  const identifiedLoads = identity?.loads.filter(item => item.loadNumber) ?? [];
  const identitySummary = `Carga${identifiedLoads.length > 1 ? 's' : ''} ${identifiedLoads.map(item => item.loadNumber).join(', ') || 'indisponível'} · placa ${identity?.plate || 'indisponível'}`;
  const canAcceptIdentity = !!liveIdentity?.plate && liveIdentity.loads.length > 0 && liveIdentity.loads.every(item => !!item.loadNumber);

  useEffect(() => {
    if (!available || hydratedControl.current === available.control.id) return;
    hydratedControl.current = available.control.id;
    setLoads(available.loads.map(row => ({
      load_id: row.load_id,
      volume_count: String(row.confirmed_volume_count ?? row.expected_volume_count ?? 0),
      pallet_count: String(row.confirmed_pallet_count ?? row.expected_pallet_count ?? 0),
      weight_kg: initialCargoWeight(row.confirmed_weight_kg ?? row.expected_weight_kg ?? 0).value,
    })));
    setDocuments(available.documents.filter(row => row.driver_confirmed).map(row => row.id));
    setVehicleChecked(available.control.vehicle_checked);
    setTieDown(available.control.tie_down_confirmed);
    setSealReason(available.control.seal_not_applicable_reason ?? '');
    setSeal(available.seals.filter(row => row.status === 'installed').map(row => row.seal_number).join(', '));
  }, [available]);

  useEffect(() => {
    if (!available) return;
    setSealResolutions(current => Object.fromEntries(available.seals.filter(row => row.status === 'installed').map(row => [
      row.id, current[row.id] ?? { status: 'removed', reason: '', file: null, path: null },
    ])));
  }, [available]);

  const execute = useMutation({
    mutationFn: async ({ action, payload }: { action: DriverTripCargoAction; payload?: Record<string, unknown> }) => {
      if (!sessionActive.current) throw new Error('O contexto da viagem mudou. Atualize antes de continuar.');
      if (!currentTenant?.id || !tripId) throw new Error('Viagem ou empresa indisponível.');
      const identity = `${tripId}:${action}:${JSON.stringify(payload ?? {})}`;
      const requestId = requestIds.current.get(identity) ?? crypto.randomUUID();
      requestIds.current.set(identity, requestId);
      const result = await updateDriverTripCargo({ tenantId: currentTenant.id, tripId, requestId, action, payload });
      requestIds.current.delete(identity);
      return { action, result };
    },
    onSuccess: async ({ action }) => {
      await qc.invalidateQueries({ queryKey: ['trip-cargo-control'] });
      await qc.invalidateQueries({ queryKey: ['driver_active_trip'] });
      toast({ title: action === 'accept' ? 'Viagem e veículo aceitos' : action === 'mark_returned' ? 'Retorno registrado' : 'Custódia de carga atualizada' });
    },
    onError: (error: Error) => toast({ title: 'Não foi possível atualizar a carga', description: error.message, variant: 'destructive' }),
  });

  const confirmCargo = async (snapshot: TripCargoAvailableSnapshot) => {
    if (!currentTenant?.id || !tripId) return;
    const uploadedPaths: string[] = [];
    try {
      const divergenceCommand = buildTripCargoDivergenceCommand({
        kind: divergenceKind,
        description: divergence,
        loadId: divergenceLoadId,
        documentCheckId: divergenceDocumentId,
        loads: snapshot.loads,
        documents: snapshot.documents,
      });
      const parsedLoads = parseTripCargoLoadDrafts(loads, snapshot.loads.map(row => row.load_id));
      requireExactCargoDocuments(documents, snapshot.documents.map(row => row.id));
      if (!vehicleChecked || !tieDown) throw new Error('Confirme o veículo e a amarração da carga.');
      const sealNumbers = parseSealNumbers(seal);
      if (sealNumbers.some(number => number.length < 2)) throw new Error('Informe números de lacre válidos.');
      if (!sealNumbers.length && sealReason.trim().length < 5) throw new Error('Justifique a ausência de lacre com pelo menos 5 caracteres.');
      const hasStoredLoading = snapshot.evidence.some(item => item.evidence_kind === 'loading');
      const hasStoredTieDown = snapshot.evidence.some(item => item.evidence_kind === 'tie_down');
      if ((!evidence[0]?.file && !evidence[0]?.path && !hasStoredLoading)
        || (!evidence[1]?.file && !evidence[1]?.path && !hasStoredTieDown)) {
        throw new Error('Anexe as fotos da carga e da amarração.');
      }
      if (['damage', 'shortage', 'surplus'].includes(divergenceKind) && !evidence[2]?.file && !evidence[2]?.path) {
        throw new Error('Anexe uma foto da avaria, falta ou sobra informada.');
      }
      for (const sealNumber of sealNumbers) {
        const draft = sealInstallationEvidence[sealNumber];
        if (!draft?.file && !draft?.path) throw new Error(`Anexe uma foto do lacre ${sealNumber} instalado.`);
      }
      const activeEvidence = divergenceKind ? evidence : evidence.slice(0, 2);
      const nextEvidence = await Promise.all(activeEvidence.map(async item => {
        if (item.path || !item.file) return item;
        const path = await uploadSecureFile({ tenantId: currentTenant.id, bucket: 'receipts',
          folder: `trip-cargo/${tripId}`, file: item.file, kind: 'image' });
        uploadedPaths.push(path);
        return { ...item, path };
      }));
      const nextSealEvidence = Object.fromEntries(await Promise.all(sealNumbers.map(async sealNumber => {
        const draft = sealInstallationEvidence[sealNumber] ?? { file: null, path: null };
        let path = draft.path;
        if (!path && draft.file) {
          path = await uploadSecureFile({ tenantId: currentTenant.id, bucket: 'receipts',
            folder: `trip-cargo/${tripId}/seals/installation`, file: draft.file, kind: 'image' });
          uploadedPaths.push(path);
        }
        if (!path) throw new Error(`Anexe uma foto do lacre ${sealNumber} instalado.`);
        return [sealNumber, { ...draft, path }] as const;
      })));
      const payload = {
        vehicle_checked: vehicleChecked,
        tie_down_confirmed: tieDown,
        seal_not_applicable_reason: seal.trim() ? null : sealReason.trim(),
        seals: sealNumbers,
        documents,
        loads: parsedLoads,
        evidence: [
          ...nextEvidence.filter(item => item.path).map(item => ({ kind: item.kind, path: item.path })),
          ...sealNumbers.map(sealNumber => ({ kind: 'seal', path: nextSealEvidence[sealNumber].path })),
        ],
        seal_evidence: sealNumbers.map(sealNumber => ({ seal_number: sealNumber, path: nextSealEvidence[sealNumber].path })),
        divergences: divergenceCommand ? [divergenceCommand] : [],
      };
      await execute.mutateAsync({ action: 'confirm_cargo', payload });
      setEvidence(current => current.map((item, index) => nextEvidence[index] ?? item));
      setSealInstallationEvidence(nextSealEvidence);
    } catch (error) {
      if (uploadedPaths.length) await removeSecureFiles(currentTenant.id, 'receipts', uploadedPaths).catch(() => undefined);
      toast({ title: 'Conferência incompleta', description: error instanceof Error ? error.message : 'Revise os dados informados.', variant: 'destructive' });
    }
  };

  const resolveInstalledSeals = async (snapshot: TripCargoAvailableSnapshot) => {
    if (!currentTenant?.id || !tripId) return;
    const installed = snapshot.seals.filter(row => row.status === 'installed');
    const uploadedPaths: string[] = [];
    try {
      for (const row of installed) {
        const draft = sealResolutions[row.id];
        if (!draft || draft.reason.trim().length < 5) throw new Error(`Informe o motivo da situação do lacre ${row.seal_number}.`);
        if (!draft.path && !draft.file) throw new Error(`Anexe a foto de retorno do lacre ${row.seal_number}.`);
      }
      const items = await Promise.all(installed.map(async row => {
        const draft = sealResolutions[row.id]!;
        let path = draft.path;
        if (!path && draft.file) {
          path = await uploadSecureFile({ tenantId: currentTenant.id, bucket: 'receipts',
            folder: `trip-cargo/${tripId}/seals/${row.id}`, file: draft.file, kind: 'image' });
          uploadedPaths.push(path);
        }
        if (!path) throw new Error(`Anexe a foto de retorno do lacre ${row.seal_number}.`);
        return { seal_id: row.id, status: draft.status, reason: draft.reason.trim(), evidence_path: path };
      }));
      await execute.mutateAsync({ action: 'resolve_seals', payload: { seals: items } });
      const confirmedDrafts = Object.fromEntries(items.map(item => [item.seal_id, {
        ...sealResolutions[item.seal_id]!, path: item.evidence_path,
      }]));
      setSealResolutions(current => ({ ...current, ...confirmedDrafts }));
    } catch (error) {
      if (uploadedPaths.length) await removeSecureFiles(currentTenant.id, 'receipts', uploadedPaths).catch(() => undefined);
      toast({ title: 'Situação dos lacres incompleta', description: error instanceof Error ? error.message : 'Revise os lacres.', variant: 'destructive' });
    }
  };

  const departAndStart = async () => {
    if (!tripId) return;
    try {
      await execute.mutateAsync({ action: 'mark_departed' });
      const { data, error } = await supabase.rpc('driver_start_trip', { _trip_id: tripId });
      if (error) throw error;
      if (!isConfirmedTripStart(data, tripId)) throw new Error('A saída foi registrada, mas o início da viagem não foi confirmado. Atualize antes de tentar novamente.');
      await invalidateTripLoadQueries(qc);
      navigate(`/driver/stops?trip=${encodeURIComponent(tripId)}`);
    } catch (error) {
      toast({ title: 'Saída não concluída', description: error instanceof Error ? error.message : 'Atualize e tente novamente.', variant: 'destructive' });
    }
  };

  if (!tripId) return <Card><CardContent className="py-10 text-center">Nenhuma viagem disponível para conferência.</CardContent></Card>;
  if (!effectiveCargo && (cargo.isPending || driver.isPending || activeTrip.isPending)) return <p role="status">Carregando custódia da viagem…</p>;
  if (!effectiveCargo) return <Card role="alert"><CardContent className="py-8 space-y-3">
    <p>Não foi possível carregar o dossiê de carga. Nenhuma saída foi liberada.</p>
    <Button variant="outline" onClick={() => void cargo.refetch()}>Tentar novamente</Button>
  </CardContent></Card>;

  if (!effectiveCargo.available) {
    const vehicleId = effectiveCargo.vehicle_id;
    return <div className="space-y-4">
    <h1 className="text-lg font-bold">Aceite da viagem</h1>
    <Card><CardContent className="p-4 space-y-3">
      <p className="text-sm">Confirme que esta é sua viagem e que o veículo apresentado é o correto antes de assumir a carga.</p>
      <p className="text-sm" aria-label="Identificação da viagem">{identitySummary}</p>
      {!canAcceptIdentity && <div role="status" className="text-xs space-y-2">
        <p>{tripIdentity.isFetching ? 'Carregando identificação da viagem…' : 'Identificação da carga ou placa indisponível. Atualize antes de aceitar.'}</p>
        <Button variant="outline" onClick={() => void tripIdentity.refetch()}>Atualizar identificação</Button>
      </div>}
      {usingCachedCargo && <p className="text-xs text-amber-700">Dados salvos no aparelho; conecte-se para aceitar a viagem.</p>}
      <Button className="w-full" disabled={!vehicleId || !canAcceptIdentity || execute.isPending || usingCachedCargo || !isOnline}
        onClick={() => execute.mutate({ action: 'accept', payload: { vehicle_id: vehicleId } })}>
        <Truck className="h-4 w-4 mr-2" />Aceitar viagem e veículo
      </Button>
    </CardContent></Card>
    </div>;
  }

  const snapshot = effectiveCargo;
  const status = snapshot.control.status;
  const pendingDivergences = snapshot.divergences.filter(item => item.status === 'pending' || item.status === 'rejected');
  const installedSeals = snapshot.seals.filter(item => item.status === 'installed');
  const canEdit = status === 'accepted' || status === 'loading';
  const divergenceDocuments = divergenceLoadId
    ? snapshot.documents.filter(document => !document.load_id || document.load_id === divergenceLoadId)
    : snapshot.documents;
  const evidenceComplete = (!!evidence[0]?.path || !!evidence[0]?.file || snapshot.evidence.some(item => item.evidence_kind === 'loading'))
    && (!!evidence[1]?.path || !!evidence[1]?.file || snapshot.evidence.some(item => item.evidence_kind === 'tie_down'));

  const onLoadChange = (index: number, field: keyof Omit<TripCargoLoadDraft, 'load_id'>, value: string) =>
    setLoads(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item));
  const onDocumentChange = (id: string, checked: boolean | 'indeterminate') => setDocuments(current => checked
    ? [...new Set([...current, id])] : current.filter(documentId => documentId !== id));
  const onSealInstallationChange = (sealNumber: string, file: File | null) => setSealInstallationEvidence(current => ({
    ...current, [sealNumber]: { file, path: null },
  }));
  const onEvidenceChange = (index: number, file: File | null) => setEvidence(current => current.map((entry, entryIndex) =>
    entryIndex === index ? { ...entry, file, path: null } : entry));
  const onDivergenceKindChange = (kind: string) => {
    setDivergenceKind(kind);
    setDivergenceLoadId('');
    setDivergenceDocumentId('');
    setEvidence(current => current.map((entry, index) => index === 2
      ? { ...entry, kind: (['damage', 'shortage', 'surplus', 'seal'].includes(kind) ? kind : 'other') as EvidenceDraft['kind'], file: null, path: null }
      : entry));
  };
  const onDivergenceLoadChange = (loadId: string) => {
    setDivergenceLoadId(loadId);
    setDivergenceDocumentId(current => {
      const document = snapshot.documents.find(item => item.id === current);
      return document?.load_id && document.load_id !== loadId ? '' : current;
    });
  };
  const onDivergenceDocumentChange = (documentId: string) => {
    const document = snapshot.documents.find(item => item.id === documentId);
    setDivergenceDocumentId(documentId);
    if (document?.load_id) setDivergenceLoadId(document.load_id);
  };
  const onSealResolutionChange = (id: string, draft: SealResolutionDraft, patch: Partial<SealResolutionDraft>) =>
    setSealResolutions(current => ({ ...current, [id]: { ...draft, ...patch } }));

  return <div className="space-y-4 pb-24">
    <div className="flex items-start justify-between gap-3">
      <div><h1 className="text-lg font-bold">Carga e custódia</h1><p className="text-xs text-muted-foreground" aria-label="Identificação da viagem">{identitySummary}</p></div>
      <Badge>{tripCargoStatusLabels[status]}</Badge>
    </div>
    <DriverCargoCustodyFields
      snapshot={snapshot}
      status={status}
      usingCachedCargo={usingCachedCargo}
      isOnline={isOnline}
      executePending={execute.isPending}
      canEdit={canEdit}
      pendingDivergences={pendingDivergences}
      installedSeals={installedSeals}
      loads={loads}
      documents={documents}
      vehicleChecked={vehicleChecked}
      tieDown={tieDown}
      seal={seal}
      sealReason={sealReason}
      evidence={evidence}
      sealResolutions={sealResolutions}
      divergenceKind={divergenceKind}
      divergence={divergence}
      divergenceLoadId={divergenceLoadId}
      divergenceDocumentId={divergenceDocumentId}
      divergenceDocuments={divergenceDocuments}
      evidenceComplete={evidenceComplete}
      loadLabel={loadLabel}
      parseSealNumbers={parseSealNumbers}
      initialCargoWeight={initialCargoWeight}
      onLoadChange={onLoadChange}
      onDocumentChange={onDocumentChange}
      onVehicleChecked={value => setVehicleChecked(value === true)}
      onTieDownChecked={value => setTieDown(value === true)}
      onSealChange={setSeal}
      onSealReasonChange={setSealReason}
      onSealInstallationChange={onSealInstallationChange}
      onEvidenceChange={onEvidenceChange}
      onDivergenceKindChange={onDivergenceKindChange}
      onDivergenceLoadChange={onDivergenceLoadChange}
      onDivergenceDocumentChange={onDivergenceDocumentChange}
      onDivergenceChange={setDivergence}
      onSealResolutionChange={onSealResolutionChange}
      onStartLoading={() => execute.mutate({ action: 'start_loading' })}
      onConfirm={() => void confirmCargo(snapshot)}
      onChecklist={() => navigate(`/driver/checklist?trip=${tripId}`)}
      onDepart={() => void departAndStart()}
      onResolveInstalledSeals={() => void resolveInstalledSeals(snapshot)}
      onReturn={() => execute.mutate({ action: 'mark_returned' })}
    />
  </div>;
}
