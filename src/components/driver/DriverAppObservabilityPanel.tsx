import {useMemo,type ReactNode} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Activity,AlertTriangle,RefreshCw,Smartphone} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {useTenant} from '@/hooks/useTenant';
import {supabase} from '@/integrations/supabase/client';
import {DRIVER_OUTBOX_KINDS,parseDriverAppObservability} from '@/lib/driver/driverAppObservability';

const kindLabels={delivery:'Entrega',expense:'Despesa',arrival:'Chegada',departure:'Saída',journey:'Jornada',checklist:'Checklist',occurrence:'Ocorrência',cargo:'Carga'} as const;
const dateTime=(value:string|null)=>value?new Date(value).toLocaleString('pt-BR'):'Nunca informada';

export function DriverAppObservabilityPanel(){
  const {currentTenant}=useTenant();
  const query=useQuery({
    queryKey:['driver-app-observability',currentTenant?.id],enabled:!!currentTenant,refetchInterval:60_000,
    queryFn:async()=>{
      const {data,error}=await supabase.rpc('get_driver_app_observability_v1' as never,{_tenant_id:currentTenant!.id} as never);
      if(error)throw error;return parseDriverAppObservability(data);
    },
  });
  const report=query.data;
  const totals=useMemo(()=>report?.devices.reduce((acc,device)=>({pending:acc.pending+device.outbox.total,
    attention:acc.attention+device.outbox.by_state.needs_attention,documents:acc.documents+device.documentConflicts,
    uploadFailures:acc.uploadFailures+device.uploadFailures.total}),
    {pending:0,attention:0,documents:0,uploadFailures:0})??{pending:0,attention:0,documents:0,uploadFailures:0},[report]);
  if(query.isLoading)return <p role="status">Carregando saúde dos aplicativos...</p>;
  if(query.error)return <Card><CardContent className="flex flex-wrap items-center justify-between gap-3 py-6" role="alert">
    <p className="text-sm text-destructive">Não foi possível consultar a saúde dos aplicativos dos motoristas.</p>
    <Button variant="outline" onClick={()=>void query.refetch()}><RefreshCw className="mr-2 h-4 w-4"/>Tentar novamente</Button>
  </CardContent></Card>;
  if(!report)return null;
  const serverErrors=report.geofenceErrors;
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
      <Metric label="Aparelhos em 24h" value={`${report.active24h}/${report.totalDevices}`} icon={<Smartphone className="h-4 w-4"/>}/>
      <Metric label="Itens nas outboxes" value={totals.pending} alert={totals.pending>0}/>
      <Metric label="Requerem atenção" value={totals.attention} alert={totals.attention>0}/>
      <Metric label="Conflitos documentais" value={totals.documents} alert={totals.documents>0}/>
      <Metric label="Falhas de upload" value={totals.uploadFailures} alert={totals.uploadFailures>0}/>
      <Metric label="Erros geofence/SSX (7d)" value={Object.values(serverErrors).reduce((sum,value)=>sum+value,0)}
        alert={Object.values(serverErrors).some(value=>value>0)} icon={<Activity className="h-4 w-4"/>}/>
    </div>
    <Card><CardHeader><CardTitle className="text-base">Erros que impedem a avaliação de geofence</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
        <Category label="Posição inválida" value={serverErrors.invalidPosition}/><Category label="Identidade do rastreador" value={serverErrors.trackerIdentity}/>
        <Category label="Horário ou vínculo" value={serverErrors.temporalBinding}/><Category label="Endereço sem resolução" value={serverErrors.addressResolution}/>
        <Category label="Processamento SSX" value={serverErrors.processing}/>
        <p className="col-span-full text-xs text-muted-foreground">Contagens agregadas; nenhum payload SSX, endereço ou coordenada é exposto aqui.</p>
      </CardContent>
    </Card>
    <Card><CardHeader><CardTitle className="text-base">Aparelhos que autorizaram diagnóstico</CardTitle></CardHeader><CardContent>
      {!report.devices.length?<p className="py-8 text-center text-sm text-muted-foreground">Nenhum motorista autorizou o compartilhamento neste aparelho.</p>:
      <Table><TableHeader><TableRow><TableHead>Aparelho</TableHead><TableHead>PWA</TableHead><TableHead>Último contato</TableHead>
        <TableHead>Última sincronização</TableHead><TableHead>Fila</TableHead><TableHead>Tipos pendentes</TableHead></TableRow></TableHeader>
        <TableBody>{report.devices.map(device=>{
          const types=DRIVER_OUTBOX_KINDS.filter(kind=>device.outbox.by_kind[kind]>0).map(kind=>`${kindLabels[kind]} ${device.outbox.by_kind[kind]}`);
          const localGeofence=Object.values(device.geofenceErrors).reduce((sum,value)=>sum+value,0);
          return <TableRow key={`${device.actorCode}:${device.installationCode}`}>
            <TableCell><p className="font-medium">{device.installationCode}</p><p className="text-xs text-muted-foreground">usuário {device.actorCode}</p></TableCell>
            <TableCell><p>{device.appVersion}</p><code className="text-xs">{device.buildHash}</code></TableCell>
            <TableCell>{dateTime(device.seenAt)}</TableCell><TableCell>{dateTime(device.lastSuccessfulSyncAt)}</TableCell>
            <TableCell><div className="flex flex-wrap gap-1"><Badge variant={device.outbox.total?'outline':'secondary'}>{device.outbox.total} total</Badge>
              {device.outbox.by_state.needs_attention?<Badge variant="destructive">{device.outbox.by_state.needs_attention} atenção</Badge>:null}
              {device.documentConflicts?<Badge variant="destructive">{device.documentConflicts} docs</Badge>:null}
              {device.uploadFailures.total?<Badge variant="destructive">{device.uploadFailures.total} upload</Badge>:null}
              {localGeofence?<Badge variant="destructive">{localGeofence} geofence</Badge>:null}</div></TableCell>
            <TableCell className="max-w-xs text-xs">{types.join(' · ')||'Nenhum'}</TableCell>
          </TableRow>})}</TableBody></Table>}
      <p className="mt-3 text-xs text-muted-foreground">Diagnóstico voluntário e resumido. Registros sem contato por mais de 30 dias não aparecem.</p>
    </CardContent></Card>
  </div>;
}

function Metric({label,value,alert=false,icon}:{label:string;value:number|string;alert?:boolean;icon?:ReactNode}){
  return <Card className={alert?'border-destructive/40 bg-destructive/5':''}><CardContent className="p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
    <p className={`mt-1 text-2xl font-bold ${alert?'text-destructive':''}`}>{value}</p></CardContent></Card>;
}
function Category({label,value}:{label:string;value:number}){
  return <div className={`rounded-md border p-3 ${value?'border-destructive/40':''}`}><div className="flex items-center gap-2">
    {value?<AlertTriangle className="h-4 w-4 text-destructive"/>:null}<strong>{value}</strong></div><p className="text-xs text-muted-foreground">{label}</p></div>;
}
