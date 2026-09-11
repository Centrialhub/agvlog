import {reconciliationGuardError} from '@/lib/financial/reconciliationContract';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {FinanceRejectedError,reverseBankReconciliation} from '@/lib/financial/ledgerClient';
import {reconciliationReversalCommandSchema,type ReconciliationReversalCommand} from '@/lib/financial/reconciliationHistoryContract';
export function ReconciliationReversal({tenant,actor,group,reversed,onRecorded}:{tenant:string;actor:string;group:string;reversed:boolean;onRecorded:()=>void}){
 const key=`finance-reconciliation-reversal:${tenant}:${actor}:${group}`;
 const [restored]=useState(()=>{try{const raw=sessionStorage.getItem(key);if(!raw)return {command:null,error:''};
  const command=reconciliationReversalCommandSchema.parse(JSON.parse(raw));if(command.tenant_id!==tenant||command.group_id!==group)throw new Error('scope');return {command,error:''};
 }catch{return {command:null,error:'Não foi possível recuperar o pedido anterior. Não envie outra reversão nesta sessão.'};}});
 const [pending,setPending]=useState<ReconciliationReversalCommand|null>(restored.command),[preview,setPreview]=useState<ReconciliationReversalCommand|null>(null);
 const [open,setOpen]=useState(!!restored.command||!!restored.error),[reason,setReason]=useState(''),[error,setError]=useState(restored.error),[busy,setBusy]=useState(false);
 const live=useRef(true),sending=useRef(false);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 function prepare(){const result=reconciliationReversalCommandSchema.safeParse({version:1,tenant_id:tenant,request_id:crypto.randomUUID(),group_id:group,reason});
  if(!result.success){setError('Informe uma justificativa com pelo menos dez caracteres.');return;}setPreview(result.data);setError('');}
 async function submit(){
  const command=pending||preview;if(!command||sending.current||restored.error)return;const uncertain=!!pending;
  try{sessionStorage.setItem(key,JSON.stringify(command));}catch{setError('Não foi possível preservar o pedido. Nenhum envio foi iniciado.');return;}
  sending.current=true;setBusy(true);setPending(command);setPreview(null);setError('');
  try{await reverseBankReconciliation(command);sessionStorage.removeItem(key);if(live.current){setPending(null);setOpen(false);onRecorded();}}
  catch(cause){if(live.current){setError(cause instanceof FinanceRejectedError?(reconciliationGuardError(cause)||'A reversão foi recusada. Atualize o histórico e confira a conciliação.'):'Não foi possível confirmar a resposta. Retome a mesma reversão.');
   if(cause instanceof FinanceRejectedError&&!uncertain){try{sessionStorage.removeItem(key);setPending(null);onRecorded();}catch{/* Preserve identity if cleanup fails. */}}}}
  finally{sending.current=false;if(live.current)setBusy(false);}
 }
 if(reversed&&!pending&&!restored.error)return null;
 if(!open)return <Button size="sm" variant="outline" onClick={()=>setOpen(true)}>Desfazer esta conciliação</Button>;
 const frozen=pending||preview;
 return <section aria-label="Desfazer conciliação" className="space-y-2 rounded border p-3">
  <p>Os lançamentos e as linhas do extrato ficarão disponíveis para uma nova conciliação. O dinheiro registrado, as baixas dos títulos e a decisão original serão preservados.</p>
  {frozen?<><p>Justificativa: {frozen.reason}</p>{pending&&<p role="status">Pedido preservado para recuperação.</p>}
   <Button disabled={busy||!!restored.error} onClick={()=>void submit()}>{busy?'Confirmando…':pending?'Retomar mesma reversão':'Confirmar reversão da conciliação'}</Button>
   {!pending&&<Button variant="outline" disabled={busy} onClick={()=>setPreview(null)}>Voltar à edição</Button>}</>:<>
   <label className="block">Justificativa da reversão<Textarea value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)}/></label>
   <Button disabled={!!restored.error} onClick={prepare}>Revisar reversão</Button>
  </>}{error&&<p role="alert">{error}</p>}
 </section>;
}
