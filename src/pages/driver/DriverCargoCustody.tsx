import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ClipboardCheck, PackageCheck, Truck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { uploadSecureFile } from '@/lib/secureUpload';
import {
  buildTripCargoDivergenceCommand, getTripCargoControl, tripCargoDocumentLabels, tripCargoStatusLabels, updateDriverTripCargo,
  tripCargoSealStatusLabels, type DriverTripCargoAction, type TripCargoAvailableSnapshot,
} from '@/lib/driver/tripCargoCustody';
import { driverOperationalSnapshotStore } from '@/lib/driver/driverOperationalOffline';
import { supabase } from '@/integrations/supabase/client';
import { invalidateTripLoadQueries, isConfirmedTripStart } from '@/lib/tripMutation';

type LoadDraft = { load_id: string; volume_count: string; pallet_count: string; weight_kg: string };
type EvidenceDraft = { kind: 'loading' | 'tie_down' | 'damage' | 'shortage' | 'surplus' | 'seal' | 'other'; file: File | null; path: string | null };
type SealResolutionDraft = { status: 'removed' | 'broken' | 'missing'; reason: string; file: File | null; path: string | null };
type SealInstallationDraft = { file: File | null; path: string | null };

const parseSealNumbers = (value: string) => [...new Set(value.split(/[,;\n]/).map(item => item.trim()).filter(Boolean))];

export default function DriverCargoCustody() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const isOnline = useOnlineStatus();
  const driver = useCurrentDriver();
  const activeTrip = useActiveTrip(driver.data?.id);
  const tripId = params.get('trip') || activeTrip.data?.id || null;
  const [loads, setLoads] = useState<LoadDraft[]>([]);
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
  const [evidence, setEvidence] = useState<EvidenceDraft[]>([
    { kind: 'loading', file: null, path: null }, { kind: 'tie_down', file: null, path: null },
    { kind: 'other', file: null, path: null },
  ]);
  const hydratedControl = useRef<string | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const [cachedCargo, setCachedCargo] = useState<Awaited<ReturnType<typeof getTripCargoControl>> | null>(null);

  const cargo = useQuery({
    queryKey: ['trip-cargo-control', currentTenant?.id, tripId],
    enabled: !!currentTenant?.id && !!tripId,
    retry: false,
    queryFn: () => getTripCargoControl(currentTenant!.id, tripId!),
  });
  useEffect(() => {
    if (!currentTenant?.id || !user?.id || !tripId) { setCachedCargo(null); return; }
    void driverOperationalSnapshotStore.read(currentTenant.id, user.id, tripId)
      .then(snapshot => setCachedCargo(snapshot?.cargo ?? null))
      .catch(() => setCachedCargo(null));
  }, [currentTenant?.id, tripId, user?.id]);

  useEffect(() => {
    if (!cargo.data || !currentTenant?.id || !user?.id || !tripId || !driver.data) return;
    const currentDriver = driver.data;
    void (async () => {
      const existing = await driverOperationalSnapshotStore.read(currentTenant.id, user.id, tripId);
      const active = activeTrip.data?.id === tripId ? activeTrip.data : null;
      await driverOperationalSnapshotStore.put({
        version: 1, tenantId: currentTenant.id, actorId: user.id, tripId, cachedAt: new Date().toISOString(),
        trip: existing?.trip ?? { id: tripId, status: active?.status ?? cargo.data.trip_status,
          actualStartAt: active?.actual_start_at ?? null, actualEndAt: active?.actual_end_at ?? null,
          driver: { id: currentDriver.id, name: currentDriver.name },
          vehicle: active?.vehicle_id ? { id: active.vehicle_id, plate: active.vehicles?.plate ?? '', nickname: active.vehicles?.nickname ?? null } : null },
        loads: cargo.data.available ? cargo.data.loads.map(row => ({ id: row.load_id,
          loadNumber: active?.loads?.id === row.load_id ? active.loads.load_number : row.load_id.slice(0, 8),
          status: active?.loads?.id === row.load_id ? active.loads.status : '', origin: active?.loads?.id === row.load_id ? active.loads.origin : null,
          destination: active?.loads?.id === row.load_id ? active.loads.destination : null,
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
      });
      setCachedCargo(cargo.data);
    })().catch(() => { /* Live data remains authoritative if durable cache is unavailable. */ });
  }, [activeTrip.data, cargo.data, currentTenant?.id, driver.data, tripId, user?.id]);

  const effectiveCargo = cargo.data ?? cachedCargo;
  const usingCachedCargo = !cargo.data && !!cachedCargo;
  const available = effectiveCargo?.available ? effectiveCargo : null;

  useEffect(() => {
    if (!available || hydratedControl.current === available.control.id) return;
    hydratedControl.current = available.control.id;
    setLoads(available.loads.map(row => ({
      load_id: row.load_id,
      volume_count: String(row.confirmed_volume_count ?? row.expected_volume_count ?? 0),
      pallet_count: String(row.confirmed_pallet_count ?? row.expected_pallet_count ?? 0),
      weight_kg: String(row.confirmed_weight_kg ?? row.expected_weight_kg ?? 0),
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
      if (!currentTenant?.id || !tripId) throw new Error('Viagem ou empresa indisponível.');
      const identity = `${action}:${JSON.stringify(payload ?? {})}`;
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
    try {
      const divergenceCommand = buildTripCargoDivergenceCommand({
        kind: divergenceKind,
        description: divergence,
        loadId: divergenceLoadId,
        documentCheckId: divergenceDocumentId,
        loads: snapshot.loads,
        documents: snapshot.documents,
      });
      const nextEvidence = await Promise.all(evidence.map(async item => item.path || !item.file ? item : ({ ...item,
        path: await uploadSecureFile({ tenantId: currentTenant.id, bucket: 'receipts',
          folder: `trip-cargo/${tripId}`, file: item.file, kind: 'image' }),
      })));
      const sealNumbers = parseSealNumbers(seal);
      const nextSealEvidence = Object.fromEntries(await Promise.all(sealNumbers.map(async sealNumber => {
        const draft = sealInstallationEvidence[sealNumber] ?? { file: null, path: null };
        const path = draft.path ?? (draft.file ? await uploadSecureFile({ tenantId: currentTenant.id, bucket: 'receipts',
          folder: `trip-cargo/${tripId}/seals/installation`, file: draft.file, kind: 'image' }) : null);
        if (!path) throw new Error(`Anexe uma foto do lacre ${sealNumber} instalado.`);
        return [sealNumber, { ...draft, path }] as const;
      })));
      setEvidence(nextEvidence);
      setSealInstallationEvidence(nextSealEvidence);
      const payload = {
        vehicle_checked: vehicleChecked,
        tie_down_confirmed: tieDown,
        seal_not_applicable_reason: seal.trim() ? null : sealReason.trim(),
        seals: sealNumbers,
        documents,
        loads: loads.map(row => ({ load_id: row.load_id, volume_count: Number(row.volume_count),
          pallet_count: Number(row.pallet_count), weight_kg: Number(row.weight_kg) })),
        evidence: [
          ...nextEvidence.filter(item => item.path).map(item => ({ kind: item.kind, path: item.path })),
          ...sealNumbers.map(sealNumber => ({ kind: 'seal', path: nextSealEvidence[sealNumber].path })),
        ],
        seal_evidence: sealNumbers.map(sealNumber => ({ seal_number: sealNumber, path: nextSealEvidence[sealNumber].path })),
        divergences: divergenceCommand ? [divergenceCommand] : [],
      };
      if (documents.length !== snapshot.documents.length) throw new Error('Confirme todos os documentos e referências antes de liberar a carga.');
      if (['damage', 'shortage', 'surplus'].includes(divergenceKind) && !nextEvidence[2]?.path) {
        throw new Error('Anexe uma foto da avaria, falta ou sobra informada.');
      }
      await execute.mutateAsync({ action: 'confirm_cargo', payload });
    } catch (error) {
      toast({ title: 'Conferência incompleta', description: error instanceof Error ? error.message : 'Revise os dados informados.', variant: 'destructive' });
    }
  };

  const resolveInstalledSeals = async (snapshot: TripCargoAvailableSnapshot) => {
    if (!currentTenant?.id || !tripId) return;
    const installed = snapshot.seals.filter(row => row.status === 'installed');
    try {
      const items = await Promise.all(installed.map(async row => {
        const draft = sealResolutions[row.id];
        if (!draft || draft.reason.trim().length < 5) throw new Error(`Informe o motivo da situação do lacre ${row.seal_number}.`);
        const path = draft.path ?? (draft.file ? await uploadSecureFile({ tenantId: currentTenant.id, bucket: 'receipts',
          folder: `trip-cargo/${tripId}/seals/${row.id}`, file: draft.file, kind: 'image' }) : null);
        if (!path) throw new Error(`Anexe a foto de retorno do lacre ${row.seal_number}.`);
        setSealResolutions(current => ({ ...current, [row.id]: { ...draft, path } }));
        return { seal_id: row.id, status: draft.status, reason: draft.reason.trim(), evidence_path: path };
      }));
      await execute.mutateAsync({ action: 'resolve_seals', payload: { seals: items } });
    } catch (error) {
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
      <p className="text-xs text-muted-foreground">Viagem {tripId.slice(0, 8)} · veículo {vehicleId?.slice(0, 8) ?? 'não atribuído'}</p>
      {usingCachedCargo && <p className="text-xs text-amber-700">Dados salvos no aparelho; conecte-se para aceitar a viagem.</p>}
      <Button className="w-full" disabled={!vehicleId || execute.isPending || usingCachedCargo || !isOnline}
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
  const evidenceComplete = evidence.slice(0, 2).every(item => !!item.path || !!item.file)
    || snapshot.evidence.some(item => item.evidence_kind === 'loading') && snapshot.evidence.some(item => item.evidence_kind === 'tie_down');

  return <div className="space-y-4 pb-24">
    <div className="flex items-start justify-between gap-3">
      <div><h1 className="text-lg font-bold">Carga e custódia</h1><p className="text-xs text-muted-foreground">Viagem {tripId.slice(0, 8)}</p></div>
      <Badge>{tripCargoStatusLabels[status]}</Badge>
    </div>
    {usingCachedCargo && <Card className="border-amber-300"><CardContent className="p-3 text-xs" role="status">
      Exibindo carga, documentos e referências salvos no aparelho. As alterações exigem conexão.
    </CardContent></Card>}

    {status === 'accepted' && <Button className="w-full" disabled={execute.isPending || usingCachedCargo || !isOnline}
      onClick={() => execute.mutate({ action: 'start_loading' })}><PackageCheck className="h-4 w-4 mr-2" />Iniciar carregamento</Button>}

    {canEdit && <>
      <Card><CardHeader><CardTitle className="text-sm">Volumes, pallets e peso</CardTitle></CardHeader><CardContent className="space-y-3">
        {loads.map((row, index) => <div key={row.load_id} className="rounded-md border p-3 space-y-2">
          <p className="text-xs font-medium">Carga {row.load_id.slice(0, 8)}</p>
          <div className="grid grid-cols-3 gap-2">
            {([['volume_count', 'Volumes'], ['pallet_count', 'Pallets'], ['weight_kg', 'Peso kg']] as const).map(([field, label]) => <div key={field}>
              <Label htmlFor={`${field}-${row.load_id}`} className="text-[11px]">{label}</Label>
              <Input id={`${field}-${row.load_id}`} type="number" min="0" step={field === 'pallet_count' ? '1' : '0.01'} value={row[field]}
                onChange={event => setLoads(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: event.target.value } : item))} />
            </div>)}
          </div>
        </div>)}
      </CardContent></Card>

      <Card><CardHeader><CardTitle className="text-sm">Documentos e referências</CardTitle></CardHeader><CardContent className="space-y-2">
        {snapshot.documents.length === 0 ? <p className="text-xs text-muted-foreground">Nenhum documento fiscal ou referência cadastrada.</p>
          : snapshot.documents.map(document => <label key={document.id} className="flex items-start gap-2 rounded border p-2 text-xs">
            <Checkbox checked={documents.includes(document.id)} onCheckedChange={checked => setDocuments(current => checked
              ? [...new Set([...current, document.id])] : current.filter(id => id !== document.id))} />
            <span>{tripCargoDocumentLabels[document.source_kind]} {document.reference_number}</span>
          </label>)}
      </CardContent></Card>

      <Card><CardHeader><CardTitle className="text-sm">Segurança, lacre e fotos</CardTitle></CardHeader><CardContent className="space-y-3">
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={vehicleChecked} onCheckedChange={value => setVehicleChecked(value === true)} />Veículo conferido</label>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={tieDown} onCheckedChange={value => setTieDown(value === true)} />Carga amarrada e estabilizada</label>
        <div><Label htmlFor="cargo-seals">Lacres</Label><Input id="cargo-seals" value={seal} onChange={event => setSeal(event.target.value)} placeholder="Separe múltiplos lacres por vírgula" /></div>
        {!seal.trim() && <div><Label htmlFor="seal-na">Motivo sem lacre</Label><Input id="seal-na" value={sealReason} onChange={event => setSealReason(event.target.value)} placeholder="Ex.: veículo baú sem ponto de lacre" /></div>}
        {parseSealNumbers(seal).map(sealNumber => <div key={sealNumber}><Label htmlFor={`cargo-photo-seal-${sealNumber}`}>Foto do lacre {sealNumber} instalado</Label>
          <Input id={`cargo-photo-seal-${sealNumber}`} type="file" accept="image/*" capture="environment"
            onChange={event => setSealInstallationEvidence(current => ({ ...current,
              [sealNumber]: { file: event.target.files?.[0] ?? null, path: null },
            }))} />
        </div>)}
        {evidence.slice(0, 2).map((item, index) => <div key={item.kind}>
          <Label htmlFor={`cargo-photo-${item.kind}`}>{item.kind === 'loading' ? 'Foto da carga' : 'Foto da amarração'}</Label>
          <Input id={`cargo-photo-${item.kind}`} type="file" accept="image/*" capture="environment"
            onChange={event => setEvidence(current => current.map((entry, entryIndex) => entryIndex === index
              ? { ...entry, file: event.target.files?.[0] ?? null, path: null } : entry))} />
        </div>)}
      </CardContent></Card>

      <Card><CardHeader><CardTitle className="text-sm">Avaria, falta ou sobra</CardTitle></CardHeader><CardContent className="space-y-2">
        <select aria-label="Tipo de divergência" className="w-full rounded-md border bg-background p-2 text-sm" value={divergenceKind} onChange={event => {
          const kind = event.target.value;
          setDivergenceKind(kind);
          setDivergenceLoadId('');
          setDivergenceDocumentId('');
          setEvidence(current => current.map((entry, index) => index === 2
            ? { ...entry, kind: (['damage', 'shortage', 'surplus', 'seal'].includes(kind) ? kind : 'other') as EvidenceDraft['kind'], path: null }
            : entry));
        }}>
          <option value="">Sem divergência adicional</option><option value="damage">Avaria</option><option value="shortage">Falta</option>
          <option value="surplus">Sobra</option><option value="document">Documento</option><option value="seal">Lacre</option><option value="other">Outra</option>
        </select>
        {divergenceKind && divergenceKind !== 'seal' && snapshot.loads.length > 1 && <div>
          <Label htmlFor="cargo-divergence-load">Carga afetada</Label>
          <select id="cargo-divergence-load" aria-label="Carga afetada" className="w-full rounded-md border bg-background p-2 text-sm"
            value={divergenceLoadId} onChange={event => {
              const loadId = event.target.value;
              setDivergenceLoadId(loadId);
              setDivergenceDocumentId(current => {
                const document = snapshot.documents.find(item => item.id === current);
                return document?.load_id && document.load_id !== loadId ? '' : current;
              });
            }}>
            <option value="">{['damage', 'shortage', 'surplus', 'volume', 'pallet', 'weight'].includes(divergenceKind)
              ? 'Selecione a carga' : 'Toda a viagem / não se aplica'}</option>
            {snapshot.loads.map(load => <option key={load.load_id} value={load.load_id}>Carga {load.load_id.slice(0, 8)}</option>)}
          </select>
        </div>}
        {divergenceKind === 'document' && <div>
          <Label htmlFor="cargo-divergence-document">Documento afetado</Label>
          <select id="cargo-divergence-document" aria-label="Documento afetado" className="w-full rounded-md border bg-background p-2 text-sm"
            value={divergenceDocumentId} onChange={event => {
              const documentId = event.target.value;
              const document = snapshot.documents.find(item => item.id === documentId);
              setDivergenceDocumentId(documentId);
              if (document?.load_id) setDivergenceLoadId(document.load_id);
            }}>
            <option value="">Selecione o documento</option>
            {divergenceDocuments.map(document => <option key={document.id} value={document.id}>
              {tripCargoDocumentLabels[document.source_kind]} {document.reference_number}
            </option>)}
          </select>
        </div>}
        {divergenceKind && <Textarea value={divergence} onChange={event => setDivergence(event.target.value)} placeholder="Descreva o que foi encontrado" maxLength={2000} />}
        {divergenceKind && <div><Label htmlFor="cargo-photo-divergence">Foto da divergência {['damage', 'shortage', 'surplus'].includes(divergenceKind) ? '(obrigatória)' : '(opcional)'}</Label>
          <Input id="cargo-photo-divergence" type="file" accept="image/*" capture="environment"
            onChange={event => setEvidence(current => current.map((entry, index) => index === 2 ? { ...entry, file: event.target.files?.[0] ?? null, path: null } : entry))} />
        </div>}
      </CardContent></Card>

      <Button className="w-full" disabled={execute.isPending || usingCachedCargo || !isOnline || !vehicleChecked || !tieDown || !evidenceComplete}
        onClick={() => void confirmCargo(snapshot)}><CheckCircle2 className="h-4 w-4 mr-2" />Confirmar conferência da carga</Button>
    </>}

    {pendingDivergences.length > 0 && <Card role="alert" className="border-amber-400"><CardContent className="p-4 space-y-2">
      <p className="flex items-center gap-2 font-medium text-sm"><AlertTriangle className="h-4 w-4" />Aguardando decisão operacional</p>
      {pendingDivergences.map(item => <p key={item.id} className="text-xs">{item.description} · {item.status === 'rejected' ? 'rejeitada' : 'pendente'}</p>)}
    </CardContent></Card>}

    {status === 'ready_to_depart' && <Card><CardContent className="p-4 space-y-3">
      <p className="text-sm">A carga está conferida. O checklist pré-viagem precisa estar completo para registrar a saída.</p>
      <Button variant="outline" className="w-full" onClick={() => navigate(`/driver/checklist?trip=${tripId}`)}><ClipboardCheck className="h-4 w-4 mr-2" />Abrir checklist pré-viagem</Button>
      <Button className="w-full" disabled={execute.isPending} onClick={() => void departAndStart()}><Truck className="h-4 w-4 mr-2" />Registrar saída e iniciar viagem</Button>
    </CardContent></Card>}

    {status === 'departed' && <Card><CardContent className="p-4 space-y-3">
      {snapshot.trip_status === 'in_transit' || snapshot.trip_status === 'in_progress' || snapshot.trip_status === 'completed' ? <>
        <p className="text-sm">Após concluir todas as paradas, preencha o checklist pós-viagem e registre o retorno físico.</p>
        <Button variant="outline" className="w-full" onClick={() => navigate(`/driver/checklist?trip=${tripId}`)}>Abrir checklist pós-viagem</Button>
        {installedSeals.length > 0 && <div className="space-y-3 rounded-md border border-amber-300 p-3">
          <p className="text-sm font-medium">Conferência dos lacres no retorno</p>
          <p className="text-xs text-muted-foreground">Cada lacre exige situação, motivo e foto. Lacre rompido ou ausente abre divergência operacional.</p>
          {installedSeals.map(row => {
            const draft = sealResolutions[row.id] ?? { status: 'removed' as const, reason: '', file: null, path: null };
            return <div key={row.id} className="space-y-2 rounded border p-2">
              <p className="text-xs font-medium">Lacre {row.seal_number}</p>
              <select aria-label={`Situação do lacre ${row.seal_number}`} className="w-full rounded-md border bg-background p-2 text-sm" value={draft.status}
                onChange={event => setSealResolutions(current => ({ ...current, [row.id]: { ...draft, status: event.target.value as SealResolutionDraft['status'] } }))}>
                <option value="removed">Removido íntegro</option><option value="broken">Rompido</option><option value="missing">Ausente</option>
              </select>
              <Input aria-label={`Motivo do lacre ${row.seal_number}`} value={draft.reason} placeholder="Descreva a conferência física"
                onChange={event => setSealResolutions(current => ({ ...current, [row.id]: { ...draft, reason: event.target.value } }))} />
              <Input aria-label={`Foto do lacre ${row.seal_number}`} type="file" accept="image/*" capture="environment"
                onChange={event => setSealResolutions(current => ({ ...current, [row.id]: { ...draft, file: event.target.files?.[0] ?? null, path: null } }))} />
            </div>;
          })}
          <Button variant="outline" className="w-full" disabled={execute.isPending || !isOnline || usingCachedCargo}
            onClick={() => void resolveInstalledSeals(snapshot)}>Salvar conferência dos lacres</Button>
        </div>}
        <Button className="w-full" disabled={execute.isPending || snapshot.trip_status !== 'completed' || installedSeals.length > 0}
          onClick={() => execute.mutate({ action: 'mark_returned' })}>Registrar retorno à base</Button>
      </> : <>
        <p className="text-sm">A custódia foi assumida, mas o início operacional da viagem ainda não foi confirmado.</p>
        <Button className="w-full" disabled={execute.isPending} onClick={() => void departAndStart()}>Tentar confirmar início da viagem</Button>
      </>}
    </CardContent></Card>}

    {status === 'returned' && <Card><CardContent className="p-4 space-y-2">
      <p className="font-medium text-sm">Carga retornada; custódia aguardando encerramento operacional.</p>
      <p className="text-xs text-muted-foreground">Canhotos físicos pendentes: {snapshot.physical_receipts.pending_count} · canhotos ausentes: {snapshot.physical_receipts.missing_count}</p>
      {snapshot.seals.map(row => <p key={row.id} className="text-xs">Lacre {row.seal_number}: {tripCargoSealStatusLabels[row.status]}{row.resolution_reason ? ` · ${row.resolution_reason}` : ''}</p>)}
    </CardContent></Card>}
    {status === 'closed' && <Card><CardContent className="p-4 text-sm">Custódia encerrada pela operação.</CardContent></Card>}
  </div>;
}
