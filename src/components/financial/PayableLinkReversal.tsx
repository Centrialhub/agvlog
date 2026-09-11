import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {FinanceRejectedError,reversePayableLink} from '@/lib/financial/ledgerClient';
import {payableReversalCommandSchema,type PayableReversalCommand} from '@/lib/financial/payableMovementContract';
export function PayableLinkReversal({tenant,actor,link,reversed,onRecorded}:{tenant:string;actor:string;link:string;reversed:boolean;onRecorded:()=>void}){
 const key=`finance-payable-reversal:${tenant}:${actor}:${link}`;
 const [restored]=useState(()=>{try{const raw=sessionStorage.getItem(key);if(!raw)return {command:null,error:''};
  const command=payableReversalCommandSchema.parse(JSON.parse(raw));if(command.tenant_id!==tenant||command.link_id!==link)throw new Error('scope');return {command,error:''};
 }catch{return {command:null,error:'Não foi possível recuperar a correção anterior. Não envie outro pedido nesta sessão.'};}});
 const [pending,setPending]=useState<PayableReversalCommand|null>(restored.command),[preview,setPreview]=useState<PayableReversalCommand|null>(null);
 const [open,setOpen]=useState(!!restored.command||!!restored.error),[reason,setReason]=useState(''),[error,setError]=useState(restored.error),[busy,setBusy]=useState(false);
 const active=useRef(true),sending=useRef(false);useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 function prepare(){const parsed=payableReversalCommandSchema.safeParse({version:1,tenant_id:tenant,request_id:crypto.randomUUID(),link_id:link,reason});
  if(!parsed.success){setError('Informe o motivo com pelo menos dez caracteres.');return;}setPreview(parsed.data);setError('');}
 async function submit(){
  if(sending.current||restored.error)return;const command=pending||preview;if(!command)return;const uncertain=!!pending;
  try{sessionStorage.setItem(key,JSON.stringify(command));}catch{setError('Não foi possível preservar o pedido. Nenhum envio foi iniciado.');return;}
  sending.current=true;setBusy(true);setPending(command);setPreview(null);setError('');
  try{await reversePayableLink(command);sessionStorage.removeItem(key);if(active.current){setPending(null);setOpen(false);onRecorded();}}
  catch(cause){if(active.current){setError(cause instanceof Error&&cause.message.includes('finance_payroll_closed_requires_reopening')?'Esta baixa pertence a uma folha fechada. A folha precisa ser reaberta antes da correção.':cause instanceof FinanceRejectedError?'A correção foi recusada. Atualize o histórico e confira o vínculo.':'Não foi possível confirmar a resposta. Retome o mesmo pedido.');
   if(cause instanceof FinanceRejectedError&&!uncertain){try{sessionStorage.removeItem(key);setPending(null);}catch{/* Keep the frozen request if cleanup fails. */}}}}
  finally{sending.current=false;if(active.current)setBusy(false);}
 }
 if(reversed&&!pending&&!restored.error)return null;
 if(!open)return <Button variant="outline" size="sm" onClick={()=>setOpen(true)}>Corrigir vínculo desta baixa</Button>;
 const frozen=pending||preview;
 return <section aria-label="Correção do vínculo da baixa" className="border rounded p-3 space-y-2">
  <p>Desvincular esta baixa reabre o saldo do título e libera o valor do envio. O dinheiro registrado e o histórico permanecem; isso não registra devolução bancária.</p>
  {frozen?<><p>Motivo: {frozen.reason}</p>{pending&&<p role="status">Pedido preservado para retomada.</p>}
   <Button disabled={busy||!!restored.error} onClick={()=>void submit()}>{busy?'Confirmando…':pending?'Retomar mesma correção':'Confirmar desvinculação'}</Button>
   {!pending&&<Button variant="outline" onClick={()=>setPreview(null)}>Voltar à edição</Button>}</>:<>
   <label>Motivo da correção<Input maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <Button disabled={!!restored.error} onClick={prepare}>Revisar correção</Button>
  </>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
