import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudUpload, FileImage, HardDrive, RefreshCw, WifiOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { useDriverExpenseSubmission } from '@/hooks/useDriverExpensesOperational';
import { useDriverOperationalOffline } from '@/hooks/useDriverOperationalOffline';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useTenant } from '@/hooks/useTenant';
import { useToast } from '@/hooks/use-toast';
import {supabase} from '@/integrations/supabase/client';
import {
  deliveryErrorMessage,
  discardResolvedDeliverySubmission,
  invalidateDeliveryQueries,
  listPendingDeliverySubmissions,
  replayPendingDeliverySubmissions,
} from '@/lib/driver/driverDeliverySubmission';
import { driverExpenseOfflineStore } from '@/lib/driver/driverExpenseOfflineStore';
import {
  DRIVER_OFFLINE_OUTBOX_CHANGED,
  driverOfflineOutbox,
  type DriverOfflineEnvelope,
  type DriverOfflineKind,
} from '@/lib/driver/driverOfflineOutbox';
import {
  createDriverAppHeartbeatPayload,
  DRIVER_GEOFENCE_ERROR_CATEGORIES,
  DRIVER_OUTBOX_KINDS,
  getDriverInstallationId,
  isDriverDiagnosticsSharingEnabled,
  readDriverBuildInfo,
  readDriverLastSuccessfulSync,
  recordDriverSuccessfulSync,
  setDriverDiagnosticsSharing,
  summarizeDriverOutbox,
  type DriverBuildInfo,
} from '@/lib/driver/driverAppObservability';

const kindLabels:Record<DriverOfflineKind,string>={
  delivery:'Entrega',expense:'Despesa',arrival:'Chegada',departure:'Saída',journey:'Jornada',
  checklist:'Checklist',occurrence:'Ocorrência',cargo:'Carga',
};
const stateLabels={queued:'Aguardando conexão',syncing:'Sincronizando',needs_attention:'Requer conferência'} as const;
const geofenceErrorLabels={permission_denied:'permissão negada',location_unavailable:'localização indisponível',
  low_accuracy:'baixa precisão',outside_geofence:'fora da geofence',server_rejection:'rejeição do servidor'} as const;

function formatBytes(bytes:number):string{
  if(bytes<1024*1024)return `${Math.max(1,Math.round(bytes/1024))} KB`;
  return `${(bytes/(1024*1024)).toFixed(1)} MB`;
}

function confirmedCount(value:unknown):number{
  if(!value||typeof value!=='object'||!('confirmed' in value))return 0;
  const confirmed=(value as {confirmed?:unknown}).confirmed;
  return typeof confirmed==='number'&&Number.isFinite(confirmed)?confirmed:0;
}

function rowDescription(row:DriverOfflineEnvelope):string{
  const payload=row.payload&&typeof row.payload==='object'&&!Array.isArray(row.payload)
    ?row.payload as Record<string,unknown>:{};
  const detail=row.kind==='delivery'&&typeof payload.eventKey==='string'?` · ${payload.eventKey.replace(/_/g,' ')}`:'';
  return `${kindLabels[row.kind]}${detail} · ${row.aggregateId.slice(0,8)}`;
}

export default function DriverSyncPending(){
  const {currentTenant}=useTenant();
  const {user}=useAuth();
  const {toast}=useToast();
  const isOnline=useOnlineStatus();
  const queryClient=useQueryClient();
  const expenseQueue=useDriverExpenseSubmission();
  const operationalQueue=useDriverOperationalOffline();
  const wasOnline=useRef(isOnline);
  const [build,setBuild]=useState<DriverBuildInfo|null>(null);
  const [sharing,setSharing]=useState(false);
  const [sharingReady,setSharingReady]=useState(false);
  const [lastSuccessfulSync,setLastSuccessfulSync]=useState<string|null>(null);
  const [heartbeatError,setHeartbeatError]=useState(false);
  const tenantId=currentTenant?.id,actorId=user?.id;
  const queryKey=['driver-unified-pending',tenantId,actorId] as const;
  const pendingQuery=useQuery({
    queryKey,enabled:!!tenantId&&!!actorId,networkMode:'always',
    queryFn:async()=>{
      await Promise.all([
        listPendingDeliverySubmissions(tenantId!,actorId!),
        driverExpenseOfflineStore.list(tenantId!,actorId!),
      ]);
      return driverOfflineOutbox.list(tenantId!,actorId!);
    },
  });
  const synchronize=useMutation({
    mutationFn:async()=>{
      const results=await Promise.allSettled([
        replayPendingDeliverySubmissions(tenantId!,actorId!),
        expenseQueue.replay.mutateAsync(),
        operationalQueue.recover(true),
      ]);
      const failures=results.filter(result=>result.status==='rejected');
      if(failures.length)throw new Error(`${failures.length} grupo(s) não puderam ser sincronizados. As evidências permanecem no aparelho.`);
      return results.reduce((total,result)=>total+(result.status==='fulfilled'?confirmedCount(result.value):0),0);
    },
    onSuccess:async confirmed=>{
      if(tenantId&&actorId)setLastSuccessfulSync(recordDriverSuccessfulSync(tenantId,actorId));
      if(confirmed)await invalidateDeliveryQueries(queryClient);
      toast({title:confirmed?'Sincronização concluída':'Nenhum envio confirmado',
        description:confirmed?`${confirmed} ${confirmed===1?'registro confirmado':'registros confirmados'} pelo servidor.`:undefined});
    },
    onError:error=>toast({title:'Ainda há pendências',description:deliveryErrorMessage(error),variant:'destructive'}),
    onSettled:async()=>{await queryClient.invalidateQueries({queryKey});},
  });
  const reviewFiscalConflict=useMutation({
    mutationFn:(requestId:string)=>discardResolvedDeliverySubmission(tenantId!,actorId!,requestId),
    onSuccess:async result=>{
      toast(result.discarded
        ?{title:'Tentativa descartada pela operação',description:'As provas ficaram preservadas no histórico. Abra a parada e faça um novo envio com os documentos atuais.'}
        :{title:'Aguardando revisão operacional',description:'A tentativa continua preservada e não confirmou a entrega.'});
      await queryClient.invalidateQueries({queryKey});
    },
    onError:error=>toast({title:'Não foi possível consultar a decisão',description:deliveryErrorMessage(error),variant:'destructive'}),
  });
  const triggerSynchronization=synchronize.mutate;
  const rows=useMemo(()=>pendingQuery.data??[],[pendingQuery.data]);
  const refetchPending=pendingQuery.refetch;
  const summary=useMemo(()=>summarizeDriverOutbox(rows),[rows]);
  const installationId=useMemo(()=>getDriverInstallationId(),[]);

  useEffect(()=>{void readDriverBuildInfo().then(setBuild);},[]);
  useEffect(()=>{
    setSharingReady(false);
    if(!tenantId||!actorId)return;
    setSharing(isDriverDiagnosticsSharingEnabled(tenantId,actorId));
    setLastSuccessfulSync(readDriverLastSuccessfulSync(tenantId,actorId));
    setSharingReady(true);
  },[actorId,tenantId]);
  useEffect(()=>{
    if(!sharingReady||!sharing||!isOnline||!tenantId||!actorId||!build)return;
    const payload=createDriverAppHeartbeatPayload({tenantId,installationId,build,lastSuccessfulSyncAt:lastSuccessfulSync,summary});
    void (async()=>{
      try{const {error}=await supabase.rpc('publish_driver_app_observability_v1' as never,{_payload:payload} as never);setHeartbeatError(!!error);}
      catch{setHeartbeatError(true);}
    })();
  },[actorId,build,installationId,isOnline,lastSuccessfulSync,sharing,sharingReady,summary,tenantId]);
  useEffect(()=>{
    if(!sharingReady||sharing||!isOnline||!tenantId||!actorId)return;
    void (async()=>{try{await supabase.rpc('disable_driver_app_observability_v1' as never,
      {_tenant_id:tenantId,_installation_id:installationId} as never);}catch{/* retry on the next page load or reconnect */}})();
  },[actorId,installationId,isOnline,sharing,sharingReady,tenantId]);

  const changeSharing=(enabled:boolean)=>{
    if(!tenantId||!actorId)return;
    setDriverDiagnosticsSharing(tenantId,actorId,enabled);setSharing(enabled);setHeartbeatError(false);
  };

  useEffect(()=>{
    const refresh=()=>{void refetchPending();};
    window.addEventListener(DRIVER_OFFLINE_OUTBOX_CHANGED,refresh);
    return()=>window.removeEventListener(DRIVER_OFFLINE_OUTBOX_CHANGED,refresh);
  },[refetchPending]);
  useEffect(()=>{
    if(isOnline&&!wasOnline.current&&tenantId&&actorId)triggerSynchronization();
    wasOnline.current=isOnline;
  },[actorId,isOnline,tenantId,triggerSynchronization]);

  if(pendingQuery.isLoading)return <p role="status">Lendo ações salvas no aparelho...</p>;
  if(pendingQuery.error)return <Card><CardContent className="space-y-3 py-8" role="alert">
    <p>{deliveryErrorMessage(pendingQuery.error)}</p>
    <Button variant="outline" onClick={()=>void pendingQuery.refetch()}>Tentar novamente</Button>
  </CardContent></Card>;

  const syncing=synchronize.isPending||expenseQueue.replay.isPending||operationalQueue.syncing;
  return <div className="space-y-4">
    <div><h1 className="text-lg font-bold">Sincronização pendente</h1>
      <p className="text-xs text-muted-foreground">Todas as ações e evidências offline desta sessão.</p></div>
    <Card><CardContent className="flex items-center gap-3 p-4">
      <div className="rounded-full bg-primary/10 p-2"><HardDrive aria-hidden="true" className="h-5 w-5 text-primary"/></div>
      <div className="min-w-0 flex-1"><p className="text-sm font-medium">{rows.length} {rows.length===1?'registro aguardando':'registros aguardando'}</p>
        <p className="text-xs text-muted-foreground">Só desaparecem após confirmação do servidor.</p></div>
      <Badge variant={isOnline?'secondary':'outline'}>{isOnline?'Online':'Offline'}</Badge>
    </CardContent></Card>
    {!isOnline?<p role="status" className="flex items-center gap-2 rounded-md bg-warning/10 p-3 text-xs"><WifiOff aria-hidden="true" className="h-4 w-4"/>A sincronização começará quando a conexão voltar.</p>:null}
    <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Saúde deste aplicativo</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div><p className="text-muted-foreground">Versão / hash</p><p className="font-medium">{build?.version??'indisponível'} · <code>{build?.buildHash??'—'}</code></p></div>
          <div><p className="text-muted-foreground">Última sincronização</p><p className="font-medium">{lastSuccessfulSync?new Date(lastSuccessfulSync).toLocaleString('pt-BR'):'Ainda não concluída'}</p></div>
          <div><p className="text-muted-foreground">Estados da fila</p><p className="font-medium">{summary.byState.queued} aguardando · {summary.byState.syncing} enviando · {summary.byState.needs_attention} atenção</p></div>
          <div><p className="text-muted-foreground">Conflitos documentais</p><p className={summary.documentConflicts?'font-medium text-destructive':'font-medium'}>{summary.documentConflicts}</p></div>
        </div>
        <div><p className="text-muted-foreground">Falhas de upload preservadas na fila</p>
          <p className={summary.uploadFailures.total?'font-medium text-destructive':'font-medium'}>{summary.uploadFailures.total} tentativa(s) em {summary.uploadFailures.affectedItems} registro(s)</p></div>
        <div className="flex flex-wrap gap-1">{DRIVER_OUTBOX_KINDS.filter(kind=>summary.byKind[kind]>0).map(kind=><Badge key={kind} variant="outline">{kindLabels[kind]} {summary.byKind[kind]}</Badge>)}
          {!summary.total?<span className="text-muted-foreground">Nenhum tipo pendente.</span>:null}</div>
        <div><p className="text-muted-foreground">Falhas locais de chegada por geofence</p><p>{DRIVER_GEOFENCE_ERROR_CATEGORIES
          .filter(category=>summary.geofenceErrors[category]>0).map(category=>`${geofenceErrorLabels[category]}: ${summary.geofenceErrors[category]}`).join(' · ')||'Nenhuma categorizada.'}</p></div>
        <label className="flex items-start gap-2 rounded-md border p-3"><input type="checkbox" className="mt-0.5" checked={sharing}
          onChange={event=>changeSharing(event.target.checked)}/><span><strong>Compartilhar diagnóstico resumido com o operacional</strong><br/>
          Envia somente versão, horários e contadores, incluindo falhas de upload. Não envia fotos, documentos, coordenadas nem mensagens de erro.</span></label>
        {sharing?<p role="status" className={heartbeatError?'text-destructive':'text-muted-foreground'}>{heartbeatError
          ?'O diagnóstico não pôde ser atualizado; isso não interfere na sincronização das entregas.'
          :'Diagnóstico autorizado neste aparelho.'}</p>:null}
      </CardContent>
    </Card>
    {rows.length?<div className="space-y-2">{rows.map(row=>{const payload=row.payload&&typeof row.payload==='object'&&!Array.isArray(row.payload)
      ?row.payload as Record<string,unknown>:{};const attention=payload.attention&&typeof payload.attention==='object'&&!Array.isArray(payload.attention)
        ?payload.attention as Record<string,unknown>:null;const fiscalConflict=row.kind==='delivery'&&row.state==='needs_attention'
          &&attention?.code==='delivery_fiscal_snapshot_changed';return <Card key={row.id}>
      <CardHeader className="p-4 pb-2"><CardTitle className="text-sm">{rowDescription(row)}</CardTitle></CardHeader>
      <CardContent className="space-y-2 px-4 pb-4 text-xs text-muted-foreground">
        <p>{new Date(row.createdAt).toLocaleString('pt-BR')} · tentativa {row.attempts}</p>
        <p className="flex items-center gap-1.5"><FileImage aria-hidden="true" className="h-4 w-4"/>{row.files.length} arquivo(s) · {formatBytes(row.files.reduce((total,file)=>total+file.blob.size,0))}</p>
        <Badge variant={row.state==='needs_attention'?'destructive':'outline'}>{stateLabels[row.state]}</Badge>
        {row.lastError?<p className="text-destructive">{row.lastError}</p>:null}
        {fiscalConflict?<Button variant="outline" size="sm" disabled={!isOnline||reviewFiscalConflict.isPending}
          onClick={()=>reviewFiscalConflict.mutate(row.id)}>Verificar decisão operacional</Button>:null}
      </CardContent>
    </Card>})}</div>:<Card><CardContent className="py-10 text-center"><CloudUpload aria-hidden="true" className="mx-auto mb-2 h-8 w-8 text-primary"/>
      <p className="text-sm font-medium">Tudo sincronizado</p><p className="text-xs text-muted-foreground">Não há ações aguardando neste aparelho.</p>
    </CardContent></Card>}
    <Button className="w-full" disabled={!isOnline||!rows.length||syncing} onClick={()=>synchronize.mutate()}>
      <RefreshCw aria-hidden="true" className={`mr-2 h-4 w-4 ${syncing?'animate-spin':''}`}/>{syncing?'Sincronizando...':'Sincronizar agora'}
    </Button>
  </div>;
}
