import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {invalidateTripLoadQueries} from '@/lib/tripMutation';
import {tripCancellationBlockers} from '@/lib/controlTower/tripCancellation';
import {correctMaterializedTrip,previewTripMaterializedCorrection,tripMaterializedCorrectionCommandSchema,TripMaterializedCorrectionRejected,type TripMaterializedCorrectionCommand} from '@/lib/controlTower/tripMaterializedCorrection';
type Props={tenant:string;actor:string;trip:string;onClose:()=>void;onCorrected:()=>void};
export function TripMaterializedCorrectionDialog(props:Props){const {user}=useAuth(),{currentTenant}=useTenant();if(user?.id!==props.actor||currentTenant?.id!==props.tenant)return <p role="alert">Retorne à empresa e à sessão originais para corrigir esta viagem.</p>;return <TripMaterializedCorrectionWorkspace key={`${props.tenant}:${props.actor}:${props.trip}`} {...props}/>;}
export function TripMaterializedCorrectionWorkspace({tenant,actor,trip,onClose,onCorrected}:Props){
 const key=`trip-materialized-correction:${tenant}:${actor}:${trip}`,cache=useQueryClient(),sending=useRef(false),active=useRef(true);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const [saved]=useState(()=>{try{const raw=sessionStorage.getItem(key);if(!raw)return{pending:null,error:''};const pending=tripMaterializedCorrectionCommandSchema.parse(JSON.parse(raw));if(pending.tenant_id!==tenant||pending.trip_id!==trip)throw Error();return{pending,error:''};}catch{return{pending:null,error:'O pedido corretivo preservado não pôde ser lido. Confira a auditoria antes de tentar outro.'};}});
 const [pending,setPending]=useState<TripMaterializedCorrectionCommand|null>(saved.pending),[reason,setReason]=useState(''),[history,setHistory]=useState(false),[fiscal,setFiscal]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(saved.error);
 const query=useQuery({queryKey:['trip-materialized-correction',tenant,actor,trip],queryFn:()=>previewTripMaterializedCorrection(tenant,actor,trip),retry:false}),data=query.isFetching||query.isError?undefined:query.data;
 async function submit(){if(sending.current||saved.error)return;let command=pending;
  if(!command){if(!data?.can_execute||!history||!fiscal||reason.trim().length<10)return;command={version:1,tenant_id:tenant,trip_id:trip,request_id:crypto.randomUUID(),expected_revision:data.revision,reason:reason.trim(),preserve_history_confirmed:true,fiscal_financial_unchanged_confirmed:true};try{sessionStorage.setItem(key,JSON.stringify(command));}catch{setError('Não foi possível preservar o pedido. Nenhuma correção foi enviada.');return;}setPending(command);}
  sending.current=true;setBusy(true);setError('');try{await correctMaterializedTrip(command,actor);if(!active.current)return;try{sessionStorage.removeItem(key);}catch{/* Replay permanece idempotente. */}void invalidateTripLoadQueries(cache);for(const prefix of ['active-trips-live','trip-cancellation','trip-materialized-correction'])void cache.invalidateQueries({queryKey:[prefix,tenant]});onCorrected();}
  catch(cause){if(!active.current)return;setError(cause instanceof Error?cause.message:'Resposta sem confirmação. Retome o pedido preservado.');if(cause instanceof TripMaterializedCorrectionRejected){try{sessionStorage.removeItem(key);setPending(null);setHistory(false);setFiscal(false);void query.refetch();}catch{setError('A correção foi recusada, mas a recuperação local não pôde ser atualizada. Consulte a auditoria.');}}}finally{sending.current=false;setBusy(false);}}
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent onInteractOutside={e=>{if(busy)e.preventDefault();}}><DialogHeader><DialogTitle>Corrigir viagem já iniciada ou materializada</DialogTitle><DialogDescription>O encerramento corretivo remove a viagem das operações ativas, preserva cargas, paradas executadas, vínculos e documentos e registra uma auditoria imutável.</DialogDescription></DialogHeader>
  {query.isFetching&&<p role="status">Conferindo execução e vínculos preservados…</p>}{query.isError&&<p role="alert">Não foi possível conferir esta viagem. <Button onClick={()=>void query.refetch()}>Tentar novamente</Button></p>}
  {data&&<><p>Viagem: {trip} · estado atual: {data.status} · {data.pending_stop_count} parada(s) ainda pendente(s).</p>{data.completed_correction&&<p role="status">Esta correção já foi concluída. Responsável: {data.result?.actor_id||'Consulte a auditoria'}.</p>}{data.clean_planned_trip&&<p role="alert">Esta viagem ainda é um planejamento limpo. Use “Cancelar viagem incorreta”.</p>}{!data.completed_correction&&data.dependency_counts.length>0&&<><p>Vínculos que permanecerão históricos:</p><ul>{data.dependency_counts.map(item=><li key={item.code}>{tripCancellationBlockers[item.code]||item.code} ({item.count})</li>)}</ul></>}</>}
  {error&&<p role="alert">{error}</p>}{pending?<><p>Pedido corretivo preservado. A retomada usa a mesma referência e o motivo original.</p><p>{pending.reason}</p><Button disabled={busy||!!saved.error} onClick={()=>void submit()}>Retomar correção da viagem</Button></>:data?.can_execute&&<>
   <label>Motivo da correção<Textarea value={reason} maxLength={2000} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
   <label><input type="checkbox" checked={history} disabled={busy} onChange={e=>setHistory(e.target.checked)}/>Confirmo que cargas, paradas executadas e vínculos existentes devem permanecer no histórico.</label>
   <label><input type="checkbox" checked={fiscal} disabled={busy} onChange={e=>setFiscal(e.target.checked)}/>Confirmo que esta ação não cancela, altera nem emite documentos fiscais ou financeiros.</label>
   <Button variant="destructive" disabled={busy||!history||!fiscal||reason.trim().length<10||!!saved.error} onClick={()=>void submit()}>Encerrar viagem com correção auditada</Button>
  </>}<Button variant="outline" disabled={busy} onClick={onClose}>Fechar</Button>
 </DialogContent></Dialog>;
}
