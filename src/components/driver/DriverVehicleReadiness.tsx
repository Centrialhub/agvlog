import {useEffect,useRef,useState} from 'react';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Card,CardContent} from '@/components/ui/card';
import {useToast} from '@/hooks/use-toast';
import {useDriverOperationalOffline} from '@/hooks/useDriverOperationalOffline';
import {driverErrorMessage} from '@/lib/driverChecklist';
import {preChecklistProgress,VEHICLE_READINESS_MODEL,VEHICLE_READINESS_QUESTIONS,vehicleReadinessAnswers} from '@/lib/driverVehicleReadiness';
type Props={tripId:string;savedId:string|null;boundaryId:string|null;payload:unknown;disabled:boolean;driverName?:string;onComplete?:()=>void};
export function DriverVehicleReadiness({tripId,savedId,boundaryId,payload,disabled,driverName,onComplete}:Props){
 const offline=useDriverOperationalOffline();const qc=useQueryClient();
 const {toast}=useToast();
 const active=useRef(true);useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const queued=[...offline.commands].reverse().find(command=>command.kind==='checklist'&&command.aggregateId===tripId
  &&command.payload&&typeof command.payload==='object'&&!Array.isArray(command.payload)&&command.payload.kind==='pre');
 const queuedPayload=queued?.payload&&typeof queued.payload==='object'&&!Array.isArray(queued.payload)?queued.payload.checklist_payload:null;
 const queuedBoundary=[...offline.commands].reverse().find(command=>command.kind==='journey'&&command.aggregateId===tripId
  &&command.payload&&typeof command.payload==='object'&&!Array.isArray(command.payload)&&command.payload.event_type==='end_shift');
 const [answers,setAnswers]=useState<Array<boolean|null>>(()=>vehicleReadinessAnswers(queuedPayload??payload)??Array(6).fill(null));
 const [index,setIndex]=useState(0);const [error,setError]=useState('');
 const revision=useRef({id:savedId,boundary:boundaryId,trip:tripId});
 const conflict=revision.current.id!==savedId||revision.current.boundary!==boundaryId||revision.current.trip!==tripId;
 const complete=preChecklistProgress(queuedPayload??payload).complete;
 const save=useMutation({networkMode:'always',mutationFn:async(next:boolean[])=>{
  if(disabled||conflict||queued)throw new Error('Atualize o checklist antes de continuar.');
  return offline.submit({kind:'checklist',aggregateId:tripId,payload:{trip_id:tripId,kind:'pre',checklist_payload:{
   schema_version:2,checklist_model:VEHICLE_READINESS_MODEL,answers:next,checked_items:[0,1,2,3,4,5],total_items:6,
   expected_checklist_id:revision.current.id,expected_boundary_id:revision.current.boundary,expected_boundary_request_id:queuedBoundary?.id??null}}});
 },onSuccess:async(result,next)=>{
  if(!active.current)return;
  if(result.state==='needs_attention') {setError(result.error||'A operação precisa revisar o checklist antes de sincronizar.');return;}
  if(!result.queued)await Promise.all(['checklist_status','driver_checklist_events'].map(key=>qc.invalidateQueries({queryKey:[key]})));
  if(active.current)toast({title:result.queued?'Checklist salvo no aparelho':'Checklist registrado',
    description:next.some(answer=>!answer)?`${next.filter(answer=>!answer).length} item(ns) precisa(m) de atenção. Respostas registradas; você pode continuar.`:undefined});
  if(active.current)onComplete?.();
 },onError:failure=>{if(active.current)setError(driverErrorMessage(failure,'Não foi possível salvar o checklist. Suas respostas continuam na tela.'));}});
 const answer=(value:boolean)=>{
  const next=[...answers];next[index]=value;setAnswers(next);setError('');
  if(next.every(item=>typeof item==='boolean'))save.mutate(next as boolean[]);
  else setIndex(next.findIndex(item=>item===null));
 };
 return <Card><CardContent className="space-y-4 p-4">
  <h1 className="text-xl font-bold">Bem-vindo{driverName?`, ${driverName}`:''}!</h1>
  <p>Vamos conferir o veículo antes de abrir sua carga.</p>
  <p className="text-sm text-muted-foreground">Se encontrar um problema, registre “Precisa de atenção”. A resposta ficará registrada e você poderá continuar.</p>
  {complete?<><p role="status">Checklist já respondido{queued?' · salvo no aparelho, aguardando sincronização':''}.</p>
   {onComplete?<Button className="w-full" disabled={disabled||queued?.state==='needs_attention'} onClick={onComplete}>Continuar para a carga</Button>:null}</>:<>
   <p className="text-sm">Pergunta {index+1} de 6</p><h2 className="text-lg font-semibold">{VEHICLE_READINESS_QUESTIONS[index]}</h2>
   <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <Button className="h-12" disabled={disabled||save.isPending||conflict||!!queued} onClick={()=>answer(true)}>Está OK</Button>
    <Button className="h-12" variant="outline" disabled={disabled||save.isPending||conflict||!!queued} onClick={()=>answer(false)}>Precisa de atenção</Button>
   </div>
   {index>0?<Button variant="ghost" disabled={save.isPending} onClick={()=>setIndex(index-1)}>Voltar à pergunta anterior</Button>:null}
  </>}
  {save.isPending?<p role="status">Salvando checklist e abrindo sua carga…</p>:null}
  {conflict?<p role="alert">O turno ou checklist mudou. Atualize antes de continuar.</p>:null}
  {queued&&!complete?<p role="alert">Há um checklist aguardando sincronização. Confira a fila antes de enviar outro.</p>:null}
  {queued?.state==='needs_attention'?<p role="alert">A sincronização deste checklist precisa de revisão. Confira a fila antes de continuar.</p>:null}
  {error?<div role="alert"><p>{error}</p>{!queued?<Button disabled={save.isPending||disabled||conflict} onClick={()=>save.mutate(answers as boolean[])}>Tentar salvar novamente</Button>:null}</div>:null}
 </CardContent></Card>;
}
