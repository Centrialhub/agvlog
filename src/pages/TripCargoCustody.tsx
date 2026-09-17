import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileCheck2, PackageCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import {
  closeTripCargo, getTripCargoCollectionPage, getTripCargoControl, listTripCargoControls, reviewTripCargoDivergence,
  TripCargoListChangedError,
  tripCargoDocumentLabels, tripCargoSealStatusLabels, tripCargoStatusLabels, tripCargoStatuses, type TripCargoStatus,
} from '@/lib/driver/tripCargoCustody';

export default function TripCargoCustody() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<TripCargoStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [listNotice,setListNotice]=useState('');
  const pageSize = 50;
  const [tripId, setTripId] = useState<string | null>(null);
  const [collectionPages,setCollectionPages]=useState({loads:1,documents:1,seals:1,divergences:1});
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const tenantId = currentTenant?.id;
  useEffect(() => {
    setPage(1); setListNotice(''); setTripId(null); setCollectionPages({loads:1,documents:1,seals:1,divergences:1}); setReviewing(null); setReviewReason(''); setOverrideReason('');
  }, [tenantId]);
  const list = useQuery({ queryKey: ['trip-cargo-list', tenantId, status, page], enabled: !!tenantId, retry: false,
    queryFn: () => listTripCargoControls(tenantId!, status === 'all' ? null : status, page, pageSize) });
  useEffect(()=>{if(list.error instanceof TripCargoListChangedError){setListNotice(list.error.message);setPage(1);setTripId(null);}},[list.error]);
  const detail = useQuery({ queryKey: ['trip-cargo-control', tenantId, tripId], enabled: !!tenantId && !!tripId, retry: false,
    queryFn: () => getTripCargoControl(tenantId!, tripId!) });
  const available=detail.data?.available?detail.data:null;
  const loadsPage=useQuery({queryKey:['trip-cargo-collection',tenantId,tripId,'loads',collectionPages.loads,available?.collection_counts.loads],enabled:!!available&&collectionPages.loads>1,retry:false,
    queryFn:()=>getTripCargoCollectionPage(tenantId!,tripId!,'loads',collectionPages.loads,50,available!.collection_counts.loads)});
  const documentsPage=useQuery({queryKey:['trip-cargo-collection',tenantId,tripId,'documents',collectionPages.documents,available?.collection_counts.documents],enabled:!!available&&collectionPages.documents>1,retry:false,
    queryFn:()=>getTripCargoCollectionPage(tenantId!,tripId!,'documents',collectionPages.documents,50,available!.collection_counts.documents)});
  const sealsPage=useQuery({queryKey:['trip-cargo-collection',tenantId,tripId,'seals',collectionPages.seals,available?.collection_counts.seals],enabled:!!available&&collectionPages.seals>1,retry:false,
    queryFn:()=>getTripCargoCollectionPage(tenantId!,tripId!,'seals',collectionPages.seals,50,available!.collection_counts.seals)});
  const divergencesPage=useQuery({queryKey:['trip-cargo-collection',tenantId,tripId,'divergences',collectionPages.divergences,available?.collection_counts.divergences],enabled:!!available&&collectionPages.divergences>1,retry:false,
    queryFn:()=>getTripCargoCollectionPage(tenantId!,tripId!,'divergences',collectionPages.divergences,50,available!.collection_counts.divergences)});

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['trip-cargo-list'] }),
      qc.invalidateQueries({ queryKey: ['trip-cargo-control'] }),
    ]);
  };
  const review = useMutation({
    mutationFn: ({ id, next }: {
      id: string; next: 'approved' | 'rejected' | 'resolved';
    }) => reviewTripCargoDivergence({
      tenantId: tenantId!, actorId: user!.id, divergenceId: id, status: next, reason: reviewReason,
    }),
    onSuccess: async () => {
      setCollectionPages(current=>({...current,divergences:1})); setReviewing(null); setReviewReason(''); toast({ title: 'Divergência revisada' }); await refresh();
    },
    onError: (error: Error) => toast({ title: 'Revisão não concluída', description: error.message, variant: 'destructive' }),
  });
  const reviewCommand = (id: string, next: 'approved' | 'rejected' | 'resolved') => review.mutate({ id, next });
  const close = useMutation({
    mutationFn: () => closeTripCargo({ tenantId: tenantId!, tripId: tripId!, overrideReason: overrideReason.trim() || null }),
    onSuccess: async result => { toast({ title: result.override ? 'Custódia encerrada por exceção auditada' : 'Custódia encerrada' }); setOverrideReason(''); await refresh(); },
    onError: (error: Error) => toast({ title: 'Encerramento bloqueado', description: error.message, variant: 'destructive' }),
  });

  const snapshot = available;
  const loads=collectionPages.loads===1?snapshot?.loads:loadsPage.data?.items;
  const documents=collectionPages.documents===1?snapshot?.documents:documentsPage.data?.items;
  const seals=collectionPages.seals===1?snapshot?.seals:sealsPage.data?.items;
  const divergences=collectionPages.divergences===1?snapshot?.divergences:divergencesPage.data?.items;
  useEffect(() => {
    if (tripId && list.data && !list.data.items.some(item => item.trip_id === tripId)) {
      setTripId(null);
      setReviewing(null);
      setReviewReason('');
      setOverrideReason('');
    }
  }, [list.data, tripId]);

  const hasUnresolvedSeal = snapshot?.seals.some(row => row.status === 'installed'
    || !row.resolved_at || !row.resolved_by || (row.resolution_reason?.trim().length ?? 0) < 5
    || (!row.resolution_evidence_id && !row.evidence_waived_legacy)) ?? false;
  return <div className="space-y-5">
    <div><h1 className="text-2xl font-bold">Custódia de cargas e viagens</h1>
      <p className="text-sm text-muted-foreground">Conferência operacional, divergências, retorno e conciliação de canhotos físicos.</p></div>
    <div className="max-w-xs"><Label htmlFor="cargo-status">Situação</Label>
      <select id="cargo-status" className="w-full rounded-md border bg-background p-2" value={status} onChange={event => {
        setPage(1); setListNotice(''); setStatus(event.target.value as TripCargoStatus | 'all'); setTripId(null);
        setReviewing(null); setReviewReason(''); setOverrideReason('');
      }}>
        <option value="all">Todas</option>{tripCargoStatuses.map(value => <option key={value} value={value}>{tripCargoStatusLabels[value]}</option>)}
      </select></div>

    {listNotice&&<p role="status">{listNotice}</p>}
    {list.isError && !(list.error instanceof TripCargoListChangedError) && <Card role="alert"><CardContent className="py-6 space-y-2"><p>Não foi possível consultar as custódias.</p><Button variant="outline" onClick={() => void list.refetch()}>Tentar novamente</Button></CardContent></Card>}
    {list.isPending ? <p role="status">Carregando custódias…</p> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {list.data?.items.map(item => <Card key={item.id} className={tripId === item.trip_id ? 'border-primary' : ''}>
        <CardContent className="p-4 space-y-3">
          <div className="flex justify-between gap-2"><span className="font-medium">Viagem {item.trip_id.slice(0, 8)}</span><Badge>{tripCargoStatusLabels[item.status]}</Badge></div>
          <div className="text-xs text-muted-foreground space-y-1"><p>Divergências pendentes: {item.pending_divergences}</p><p>Canhotos físicos pendentes: {item.pending_physical_receipts}</p></div>
          <Button variant="outline" className="w-full" onClick={() => setTripId(item.trip_id)}>Abrir dossiê</Button>
        </CardContent>
      </Card>)}
      {list.data?.items.length === 0 && <Card className="md:col-span-2"><CardContent className="py-10 text-center">Nenhuma custódia encontrada.</CardContent></Card>}
    </div>}
    {list.data && <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
      <span>{list.data.total_count} dossiê(s)</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={list.isFetching || page <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}>Anterior</Button>
        <span>Página {page} de {Math.max(1, Math.ceil(list.data.total_count / list.data.page_size))}</span>
        <Button variant="outline" size="sm" disabled={list.isFetching || page * list.data.page_size >= list.data.total_count} onClick={() => setPage(current => current + 1)}>Próxima</Button>
      </div>
    </div>}

    {tripId && detail.isPending && <p role="status">Carregando dossiê…</p>}
    {tripId && detail.isError && <Card role="alert"><CardContent className="p-4"><p>Não foi possível abrir o dossiê selecionado.</p></CardContent></Card>}
    {snapshot && <div className="space-y-4">
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><PackageCheck className="h-4 w-4" />Dossiê {snapshot.trip_id.slice(0, 8)}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3 text-sm">
          <div><span className="text-muted-foreground">Situação</span><p>{tripCargoStatusLabels[snapshot.control.status]}</p></div>
          <div><span className="text-muted-foreground">Veículo</span><p>{snapshot.control.vehicle_id.slice(0, 8)}</p></div>
          <div><span className="text-muted-foreground">Motorista</span><p>{snapshot.control.driver_id.slice(0, 8)}</p></div>
        </CardContent></Card>

      <Card><CardHeader><CardTitle className="text-base">Conferência por carga</CardTitle></CardHeader><CardContent className="space-y-2">
        {(loads??[]).map(load => <div key={load.id} className="grid gap-2 rounded border p-3 text-xs sm:grid-cols-4">
          <strong>Carga {load.load_id.slice(0, 8)}</strong>
          <span>Volumes: {load.confirmed_volume_count ?? '—'} / {load.expected_volume_count ?? 0}</span>
          <span>Pallets: {load.confirmed_pallet_count ?? '—'} / {load.expected_pallet_count ?? 0}</span>
          <span>Peso: {load.confirmed_weight_kg ?? '—'} / {load.expected_weight_kg ?? 0} kg</span>
        </div>)}
        <CollectionPagination page={collectionPages.loads} total={snapshot.collection_counts.loads} busy={loadsPage.isFetching} onPage={next=>setCollectionPages(current=>({...current,loads:next}))}/>
      </CardContent></Card>

      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileCheck2 className="h-4 w-4" />Documentos conferidos</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">
        {(documents??[]).map(document => <p key={document.id}>{document.driver_confirmed ? '✓' : '○'} {tripCargoDocumentLabels[document.source_kind]} {document.reference_number}</p>)}
        <CollectionPagination page={collectionPages.documents} total={snapshot.collection_counts.documents} busy={documentsPage.isFetching} onPage={next=>setCollectionPages(current=>({...current,documents:next}))}/>
      </CardContent></Card>

      <Card><CardHeader><CardTitle className="text-base">Ciclo dos lacres</CardTitle></CardHeader><CardContent className="space-y-2">
        {(seals??[]).length === 0 && <p className="text-sm text-muted-foreground">Sem lacre nesta página.</p>}
        {(seals??[]).map(row => <div key={row.id} className="rounded border p-3 text-sm">
          <div className="flex items-center justify-between gap-2"><strong>{row.seal_number}</strong><Badge variant={row.status === 'broken' || row.status === 'missing' ? 'destructive' : 'secondary'}>{tripCargoSealStatusLabels[row.status]}</Badge></div>
          <p className="mt-1 text-xs text-muted-foreground">Instalado em {new Date(row.installed_at).toLocaleString('pt-BR')} · evidência {row.installed_evidence_id ? 'vinculada' : row.evidence_waived_legacy ? 'dispensada por migração' : 'pendente'}</p>
          {row.resolved_at && <p className="mt-1 text-xs">Conferido em {new Date(row.resolved_at).toLocaleString('pt-BR')} · {row.resolution_reason}</p>}
          {row.resolution_evidence_id && <p className="text-xs text-muted-foreground">Evidência final vinculada ao dossiê.</p>}
        </div>)}
        <CollectionPagination page={collectionPages.seals} total={snapshot.collection_counts.seals} busy={sealsPage.isFetching} onPage={next=>setCollectionPages(current=>({...current,seals:next}))}/>
      </CardContent></Card>

      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4" />Divergências</CardTitle></CardHeader><CardContent className="space-y-3">
        {(divergences??[]).length === 0 && <p className="text-sm text-muted-foreground">Nenhuma divergência nesta página.</p>}
        {(divergences??[]).map(row => {
          const canReview = row.status === 'pending' && !['departed', 'returned', 'closed'].includes(snapshot.control.status);
          return <div key={row.id} className="rounded border p-3 space-y-2 text-sm">
          <div className="flex justify-between gap-2"><p>{row.description}</p><Badge variant={row.status === 'pending' || row.status === 'rejected' ? 'destructive' : 'secondary'}>{row.status}</Badge></div>
          {(row.expected_value || row.observed_value) && <p className="text-xs text-muted-foreground">Esperado: {row.expected_value ?? '—'} · observado: {row.observed_value ?? '—'}</p>}
          {reviewing === row.id && canReview ? <div className="space-y-2"><Textarea value={reviewReason} onChange={event => setReviewReason(event.target.value)} placeholder="Justificativa operacional" maxLength={1000} />
            <div className="flex flex-wrap gap-2"><Button size="sm" disabled={reviewReason.trim().length < 5 || review.isPending} onClick={() => reviewCommand(row.id, 'approved')}>Aprovar saída</Button>
              <Button size="sm" variant="destructive" disabled={reviewReason.trim().length < 5 || review.isPending} onClick={() => reviewCommand(row.id, 'rejected')}>Rejeitar</Button>
              <Button size="sm" variant="outline" disabled={reviewReason.trim().length < 5 || review.isPending} onClick={() => reviewCommand(row.id, 'resolved')}>Marcar corrigida</Button></div></div>
            : canReview ? <Button size="sm" variant="outline" onClick={() => { setReviewing(row.id); setReviewReason(row.review_reason ?? ''); }}>Revisar</Button>
              : <p className="text-xs text-muted-foreground">Revisão encerrada para esta divergência.</p>}
        </div>;
        })}
        <CollectionPagination page={collectionPages.divergences} total={snapshot.collection_counts.divergences} busy={divergencesPage.isFetching} onPage={next=>setCollectionPages(current=>({...current,divergences:next}))}/>
      </CardContent></Card>

      {snapshot.control.status === 'returned' && <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4" />Encerramento da custódia</CardTitle></CardHeader><CardContent className="space-y-3">
        <p className="text-sm">Recebidos: {snapshot.physical_receipts.required_count - snapshot.physical_receipts.pending_count} / {snapshot.physical_receipts.required_count}. Ausentes: {snapshot.physical_receipts.missing_count}.</p>
        {hasUnresolvedSeal && <p className="text-xs text-destructive">O encerramento está bloqueado até todos os lacres terem situação final, conferência, motivo e evidência.</p>}
        {(snapshot.physical_receipts.pending_count > 0 || snapshot.physical_receipts.missing_count > 0) && <>
          <p className="text-xs text-amber-700">O encerramento normal está bloqueado. Somente owner/admin pode usar exceção, com justificativa auditada.</p>
          <div><Label htmlFor="cargo-override">Justificativa da exceção supervisora</Label><Input id="cargo-override" value={overrideReason} onChange={event => setOverrideReason(event.target.value)} /></div>
        </>}
        <Button disabled={close.isPending || hasUnresolvedSeal || ((snapshot.physical_receipts.pending_count > 0 || snapshot.physical_receipts.missing_count > 0) && overrideReason.trim().length < 10)} onClick={() => close.mutate()}>
          Encerrar custódia
        </Button>
      </CardContent></Card>}
    </div>}
  </div>;
}

function CollectionPagination({page,total,busy,onPage}:{page:number;total:number;busy:boolean;onPage:(page:number)=>void}){
  if(total<=50)return null;
  return <div className="flex items-center justify-between pt-2"><Button type="button" size="sm" variant="outline" disabled={busy||page===1} onClick={()=>onPage(page-1)}>Anterior</Button><span className="text-xs">Página {page} de {Math.ceil(total/50)}</span><Button type="button" size="sm" variant="outline" disabled={busy||page*50>=total} onClick={()=>onPage(page+1)}>Próxima</Button></div>;
}
