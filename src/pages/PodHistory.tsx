import {useMemo} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Link,useParams} from 'react-router-dom';
import {format,parseISO} from 'date-fns';
import {ptBR} from 'date-fns/locale';
import {AlertCircle,ArrowLeft,CheckCircle2,Clock,FileCheck2,Hourglass,MapPin,PackageCheck,RefreshCw,Truck} from 'lucide-react';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card';
import {callOperatorEventRpc,operationalEventError,operationalEventReadError,parseOperatorPodHistory,type OperatorPodHistory} from '@/lib/operationalEvents/operatorEventCommands';

type TimelineItem={key:string;at:string;title:string;detail?:string;badge?:string;icon:'truck'|'pin'|'check'|'clock'|'alert';status:'success'|'warning'|'info'|'muted'};

const fmt=(value?:string|null)=>{if(!value)return '—';try{return format(parseISO(value),"dd/MM/yyyy HH:mm",{locale:ptBR});}catch{return '—';}};
const canonicalLabels:Record<string,string>={pending:'Pendente',pending_redelivery:'Aguardando reentrega',delivered:'Entregue',partial_delivery:'Entrega parcial',
 returned:'Retornada',refused:'Recusada',failed:'Falhou',not_delivered:'Não entregue'};
const outcomeLabels:Record<string,string>={delivered:'Entrega confirmada',partial_delivery:'Entrega parcial registrada',returned:'Retorno registrado',
 refused:'Recusa registrada',failed:'Falha registrada',not_delivered:'Não entrega registrada'};
const iconFor=(icon:TimelineItem['icon'])=>{
 if(icon==='truck')return <Truck className="h-4 w-4"/>;
 if(icon==='pin')return <MapPin className="h-4 w-4"/>;if(icon==='check')return <CheckCircle2 className="h-4 w-4"/>;
 if(icon==='alert')return <AlertCircle className="h-4 w-4"/>;return <Clock className="h-4 w-4"/>;
};
const statusClasses=(status:TimelineItem['status'])=>status==='success'?'bg-success/10 text-success border-success/20'
 :status==='warning'?'bg-warning/10 text-warning border-warning/20':status==='info'?'bg-info/10 text-info border-info/20':'bg-muted/40 text-muted-foreground border-border';

function buildTimeline(history:OperatorPodHistory):TimelineItem[]{
 const items:TimelineItem[]=[];const tripStarts=new Set<string>();
 for(const allocation of history.allocations){
  if(allocation.actual_start_at&&!tripStarts.has(allocation.trip_id)){tripStarts.add(allocation.trip_id);items.push({key:'trip:'+allocation.trip_id,at:allocation.actual_start_at,
   title:'Viagem iniciada',detail:`Viagem ${allocation.trip_id.slice(0,8)} · ${allocation.trip_status}`,icon:'truck',status:'info'});}
  if(allocation.actual_arrival_at)items.push({key:'arrival:'+allocation.id,at:allocation.actual_arrival_at,title:'Chegada registrada na parada',
   detail:allocation.destination||`Parada ${allocation.stop_id.slice(0,8)}`,badge:allocation.stop_status,icon:'pin',status:history.current_outcome?'success':'warning'});
  if(allocation.actual_departure_at)items.push({key:'departure:'+allocation.id,at:allocation.actual_departure_at,title:'Saída registrada da parada',
   detail:allocation.destination||undefined,badge:allocation.stop_status,icon:'pin',status:'info'});
 }
 for(const attempt of history.attempts)items.push({key:'attempt:'+attempt.id,at:attempt.recorded_at,title:attempt.is_current?'Tentativa atual criada':'Tentativa de entrega registrada',
  detail:attempt.reason,badge:attempt.is_current?'atual':'histórica',icon:'clock',status:attempt.is_current?'warning':'muted'});
 for(const outcome of history.outcomes)items.push({key:'outcome:'+outcome.id,at:outcome.occurred_at,title:outcomeLabels[outcome.outcome]||outcome.outcome.replace(/_/g,' '),
  detail:[outcome.reason,outcome.superseded_by?'Resultado corrigido posteriormente':null].filter(Boolean).join(' · ')||undefined,
  badge:outcome.is_current?'resultado atual':outcome.superseded_by?'corrigido':'histórico',icon:outcome.outcome==='delivered'?'check':'alert',
  status:outcome.is_current&&outcome.outcome==='delivered'?'success':outcome.is_current?'warning':'muted'});
 for(const proof of history.proofs){const at=proof.received_at||proof.created_at||proof.updated_at;if(!at)continue;items.push({key:'proof:'+proof.id,at,
  title:`Comprovante v${proof.version} ${proof.is_active?'atual':'histórico'}`,detail:[proof.receiver_name,proof.proof_type].filter(Boolean).join(' · ')||undefined,
  badge:proof.status,icon:'check',status:proof.is_active&&history.proof_available?'success':proof.is_active?'warning':'muted'});}
 for(const occurrence of history.occurrences){items.push({key:'occurrence:'+occurrence.id,at:occurrence.created_at,title:'Ocorrência vinculada',
  detail:occurrence.description||occurrence.event_type.replace(/_/g,' '),badge:occurrence.public_status||occurrence.severity,icon:'alert',status:occurrence.resolved_at?'muted':'warning'});
  if(occurrence.resolved_at)items.push({key:'occurrence-resolved:'+occurrence.id,at:occurrence.resolved_at,title:'Ocorrência resolvida',
   detail:occurrence.description||undefined,badge:'resolved',icon:'check',status:'success'});}
 return items.sort((a,b)=>a.at.localeCompare(b.at)||a.key.localeCompare(b.key));
}

export default function PodHistory(){
 const {docId}=useParams<{docId:string}>();const {currentTenant}=useTenant();const {user}=useAuth();
 const tenant=currentTenant?.id,actor=user?.id;
 const query=useQuery({queryKey:['pod-history',tenant,actor,docId],enabled:!!tenant&&!!actor&&!!docId,retry:false,
  queryFn:async({signal})=>{const {data,error}=await callOperatorEventRpc('get_operator_pod_history_v1',{_tenant_id:tenant!,_document_id:docId!},signal);
   if(error)throw new Error(operationalEventReadError(error,'Não foi possível consultar o histórico canônico. Tente novamente.'));return parseOperatorPodHistory(data,tenant!,actor!,docId!);}});
 const timeline=useMemo(()=>query.data?buildTimeline(query.data):[],[query.data]);

 if(!tenant||!actor||!docId)return <StateCard title="Histórico indisponível" detail="Entre com uma sessão válida, selecione a empresa e abra novamente a NF."/>;
 if(query.isPending)return <StateCard title="Carregando histórico canônico…" detail="Consultando resultados, tentativas e comprovantes auditados." loading/>;
 if(query.isError)return <StateCard title="Histórico indisponível" detail={operationalEventError(query.error)} retry={()=>void query.refetch()} loading={query.isFetching}/>;
 const history=query.data;
 const current=history.current_outcome;const currentAllocation=history.allocations.find(row=>row.is_current)||history.allocations.at(-1);

 return <div className="space-y-4">
  <div className="flex flex-wrap items-start justify-between gap-3"><div>
   <Link to="/traceability" className="mb-1 inline-flex items-center text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-3 w-3"/>Voltar à rastreabilidade</Link>
   <h1 className="flex items-center gap-2 text-2xl font-semibold"><PackageCheck className="h-6 w-6 text-primary"/>Histórico do POD</h1>
   <p className="mt-1 text-sm text-muted-foreground">Histórico canônico da NF, sem inferir entrega pela chegada à parada.</p>
  </div><div className="flex flex-wrap items-center gap-2">
   <Badge variant="outline" className={history.delivered?'bg-success/10 text-success border-success/20':'bg-warning/10 text-warning border-warning/20'}>
    {history.delivered?<CheckCircle2 className="mr-1 h-3 w-3"/>:<Hourglass className="mr-1 h-3 w-3"/>}{canonicalLabels[history.canonical_state]||history.canonical_state.replace(/_/g,' ')}
   </Badge>
   {history.proof_available&&<Badge variant="outline" className="bg-success/10 text-success border-success/20"><FileCheck2 className="mr-1 h-3 w-3"/>Comprovante disponível</Badge>}
   {history.document.load_id&&<Link to={`/loads/${history.document.load_id}`}><Button variant="outline" size="sm">Abrir carga</Button></Link>}
  </div></div>

  {history.arrival_without_outcome&&<Card role="alert" className="border-warning/30 bg-warning/10"><CardContent className="flex gap-2 p-4 text-sm">
   <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning"/><div><p className="font-medium">Chegada sem resultado canônico</p><p className="text-muted-foreground">A parada possui chegada, mas a tentativa atual não possui resultado registrado. A NF permanece não entregue.</p></div>
  </CardContent></Card>}

  <Card><CardContent className="grid gap-3 p-4 text-sm md:grid-cols-2 lg:grid-cols-4">
   <Summary label="NF" value={history.document.invoice_number||history.document.id.slice(0,8)} detail={history.document.document_type||undefined}/>
   <Summary label="Estado canônico" value={canonicalLabels[history.canonical_state]||history.canonical_state} detail={current?`Registrado em ${fmt(current.occurred_at)}`:'Sem resultado para a tentativa atual'}/>
   <Summary label="Tentativas / resultados" value={`${history.attempts.length} / ${history.outcomes.length}`} detail={history.document.current_delivery_attempt_id?'Há tentativa atual':'Fluxo original'}/>
   <Summary label="Comprovantes" value={String(history.proofs.length)} detail={history.proof_available?'Arquivo confirmado':'Sem arquivo disponível'}/>
  </CardContent></Card>

  <Card><CardHeader className="pb-3"><CardTitle className="text-base">Linha do tempo canônica ({timeline.length})</CardTitle></CardHeader><CardContent>
   {timeline.length===0?<p className="py-6 text-center text-sm text-muted-foreground">Nenhum evento canônico registrado para esta NF.</p>
   :<ol className="relative ml-3 space-y-4 border-l border-border">{timeline.map(item=><li key={item.key} className="ml-4">
    <span className={`absolute -left-[10px] flex h-5 w-5 items-center justify-center rounded-full border ${statusClasses(item.status)}`}>{iconFor(item.icon)}</span>
    <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{item.title}</span>{item.badge&&<Badge variant="outline" className="font-mono text-[10px]">{item.badge}</Badge>}</div>
    <p className="text-xs text-muted-foreground">{fmt(item.at)}</p>{item.detail&&<p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>}
   </li>)}</ol>}
  </CardContent></Card>

  <div className="grid gap-4 lg:grid-cols-2">
   <Card><CardHeader className="pb-3"><CardTitle className="text-base">Resultados auditados</CardTitle></CardHeader><CardContent className="space-y-2">
    {history.outcomes.length===0?<p className="text-sm text-muted-foreground">Nenhum resultado registrado.</p>:history.outcomes.map(outcome=><div key={outcome.id} className="rounded border p-3 text-sm">
     <div className="flex items-center justify-between gap-2"><span className="font-medium">{outcomeLabels[outcome.outcome]||outcome.outcome}</span><Badge variant="outline">{outcome.is_current?'Atual':outcome.superseded_by?'Corrigido':'Histórico'}</Badge></div>
     <p className="text-xs text-muted-foreground">{fmt(outcome.occurred_at)}{outcome.reason?` · ${outcome.reason}`:''}</p>
    </div>)}
   </CardContent></Card>
   <Card><CardHeader className="pb-3"><CardTitle className="text-base">Alocação atual</CardTitle></CardHeader><CardContent>
    {!currentAllocation?<p className="text-sm text-muted-foreground">Nenhuma parada alocada.</p>:<div className="space-y-2 text-sm">
     <p><span className="text-muted-foreground">Destino:</span> {currentAllocation.destination||'—'}</p><p><span className="text-muted-foreground">Status da parada:</span> {currentAllocation.stop_status}</p>
     <p><span className="text-muted-foreground">Chegada:</span> {fmt(currentAllocation.actual_arrival_at)}</p><p><span className="text-muted-foreground">Saída:</span> {fmt(currentAllocation.actual_departure_at)}</p>
    </div>}
   </CardContent></Card>
  </div>
 </div>;
}

function Summary({label,value,detail}:{label:string;value:string;detail?:string}){return <div><p className="text-xs text-muted-foreground">{label}</p><p className="font-semibold">{value}</p>{detail&&<p className="text-xs text-muted-foreground">{detail}</p>}</div>}
function StateCard({title,detail,retry,loading=false}:{title:string;detail:string;retry?:()=>void;loading?:boolean}){return <div className="space-y-4">
 <Link to="/traceability" className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-3 w-3"/>Voltar à rastreabilidade</Link>
 <Card role={retry?'alert':undefined}><CardContent className="flex flex-col items-center gap-3 p-8 text-center"><AlertCircle className="h-6 w-6 text-muted-foreground"/>
  <div><p className="font-medium">{title}</p><p className="text-sm text-muted-foreground">{detail}</p></div>
  {retry&&<Button variant="outline" onClick={retry} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading?'animate-spin':''}`}/>Tentar novamente</Button>}
 </CardContent></Card></div>}
