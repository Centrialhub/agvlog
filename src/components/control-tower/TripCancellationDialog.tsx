import {invalidateTripLoadQueries} from '@/lib/tripMutation';
import {useEffect,useRef,useState} from 'react';

import {useQuery,useQueryClient} from '@tanstack/react-query';

import {useAuth} from '@/hooks/useAuth';

import {useTenant} from '@/hooks/useTenant';

import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';

import {Button} from '@/components/ui/button';

import {Textarea} from '@/components/ui/textarea';

import {cancelTrip,previewTripCancellation,tripCancellationCommandSchema,tripCancellationBlockers,TripCancellationRejected,type TripCancellationCommand} from '@/lib/controlTower/tripCancellation';

type Props={tenant:string;actor:string;trip:string;onClose:()=>void;onCancelled:()=>void};

export function TripCancellationDialog(props:Props){

 const {user}=useAuth(),{currentTenant}=useTenant();

 if(user?.id!==props.actor||currentTenant?.id!==props.tenant)return <p role="alert">Retorne à empresa e à sessão originais para conferir esta viagem.</p>;

 return <TripCancellationWorkspace key={`${props.tenant}:${props.actor}:${props.trip}`} {...props}/>;

}

export function TripCancellationWorkspace({tenant,actor,trip,onClose,onCancelled}:Props){

 const key=`trip-cancellation:${tenant}:${actor}:${trip}`,cache=useQueryClient(),sending=useRef(false),active=useRef(true);

 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);

 const [saved]=useState(()=>{try{const raw=sessionStorage.getItem(key);if(!raw)return{pending:null,error:''};const pending=tripCancellationCommandSchema.parse(JSON.parse(raw));if(pending.tenant_id!==tenant||pending.trip_id!==trip)throw Error();return{pending,error:''};}catch{return{pending:null,error:'O pedido preservado não pôde ser lido. Confira o histórico antes de tentar outro cancelamento.'};}});

 const [pending,setPending]=useState<TripCancellationCommand|null>(saved.pending),[reason,setReason]=useState(''),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(saved.error);

 const query=useQuery({queryKey:['trip-cancellation',tenant,actor,trip],queryFn:()=>previewTripCancellation(tenant,actor,trip),retry:false});

 const data=query.isFetching||query.isError?undefined:query.data;

 async function submit(){

  if(sending.current||saved.error)return;

  let command=pending;

  if(!command){if(!data?.can_execute||data.blockers.length||!accepted||reason.trim().length<10)return;command={version:1,tenant_id:tenant,trip_id:trip,request_id:crypto.randomUUID(),expected_revision:data.revision,reason:reason.trim()};

   try{sessionStorage.setItem(key,JSON.stringify(command));}catch{setError('Não foi possível preservar o pedido. Nenhum cancelamento foi enviado.');return;}setPending(command);}

  sending.current=true;setBusy(true);setError('');

  try{await cancelTrip(command,actor);if(!active.current)return;try{sessionStorage.removeItem(key);}catch{/* The confirmed request may be replayed safely. */}

   void invalidateTripLoadQueries(cache);
   for(const prefix of ['active-trips-live','trip-cancellation'])void cache.invalidateQueries({queryKey:[prefix,tenant]});onCancelled();

  }catch(cause){if(!active.current)return;setError(cause instanceof Error?cause.message:'Resposta sem confirmação. Retome o pedido preservado.');if(cause instanceof TripCancellationRejected&&!pending){try{sessionStorage.removeItem(key);setPending(null);setAccepted(false);void query.refetch();}catch{setError('O pedido foi recusado, mas sua recuperação local não pôde ser atualizada. Confira o histórico.');}}}

  finally{sending.current=false;setBusy(false);}

 }

 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent onInteractOutside={e=>{if(busy)e.preventDefault();}}>

  <DialogHeader><DialogTitle>Cancelar viagem criada incorretamente</DialogTitle><DialogDescription>O cancelamento retira o planejamento ativo e preserva o histórico. Só é permitido antes da execução e sem vínculos que precisem de correção.</DialogDescription></DialogHeader>

  {query.isFetching&&<p role="status">Conferindo viagem, cargas e registros relacionados…</p>}

  {query.isError&&<p role="alert">Não foi possível conferir esta viagem.<Button onClick={()=>void query.refetch()}>Tentar novamente</Button></p>}

  {data&&<><p>Viagem: {trip} · {data.load_ids.length} carga(s) · {data.stop_ids.length} parada(s).</p>{data.completed_cancellation&&<p role="status">Esta viagem já foi cancelada. Responsável: {data.result?.actor_id||'Consulte a auditoria'}.</p>}{!data.completed_cancellation&&data.blockers.length>0&&<ul>{data.blockers.map(b=><li key={b.code}>{tripCancellationBlockers[b.code]||'Há um vínculo que exige revisão.'} ({b.count})</li>)}</ul>}</>}

  {error&&<p role="alert">{error}</p>}

  {pending?<><p>Pedido preservado. A nova tentativa usa a mesma referência e o motivo original.</p><p>{pending.reason}</p><Button disabled={busy||!!saved.error} onClick={()=>void submit()}>Retomar cancelamento</Button></>:data?.can_execute&&!data.blockers.length&&<>

   <label>Motivo do cancelamento<Textarea value={reason} maxLength={2000} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>

   <label><input type="checkbox" checked={accepted} disabled={busy} onChange={e=>setAccepted(e.target.checked)}/>Conferi a viagem e entendo que seu histórico será preservado.</label>

   <Button variant="destructive" disabled={busy||!accepted||reason.trim().length<10||!!saved.error} onClick={()=>void submit()}>Confirmar cancelamento da viagem</Button>

  </>}

  <Button variant="outline" disabled={busy} onClick={onClose}>Fechar</Button>

 </DialogContent></Dialog>;

}

