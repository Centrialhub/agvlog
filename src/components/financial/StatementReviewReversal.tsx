import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {FinanceRejectedError,reverseFinanceIdentityReview} from '@/lib/financial/ledgerClient';
import {reviewReversalCommandSchema,statementReviewError,type ReviewReversalCommand} from '@/lib/financial/statementReviewContract';
export function StatementReviewReversal({tenant,actor,reviewId,onRecorded}:{tenant:string;actor:string;reviewId:string;onRecorded:()=>void}){
  const key=`finance-review-reversal:${tenant}:${actor}:${reviewId}`;
  const [restored]=useState(()=>{try{const raw=sessionStorage.getItem(key);if(!raw)return {command:null,error:''};
    const command=reviewReversalCommandSchema.parse(JSON.parse(raw));if(command.tenant_id!==tenant||command.review_id!==reviewId)throw new Error('scope');return {command,error:''};
  }catch{return {command:null,error:'Não foi possível recuperar o pedido de reversão. Não envie outro pedido nesta sessão.'};}});
  const [pending,setPending]=useState<ReviewReversalCommand|null>(restored.command),[preview,setPreview]=useState<ReviewReversalCommand|null>(null);
  const [open,setOpen]=useState(!!restored.command||!!restored.error),[reason,setReason]=useState(''),[error,setError]=useState(restored.error),[busy,setBusy]=useState(false);
  const active=useRef(true),sending=useRef(false);useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  function prepare(){const parsed=reviewReversalCommandSchema.safeParse({version:1,tenant_id:tenant,request_id:crypto.randomUUID(),review_id:reviewId,reason});
    if(!parsed.success){setError('Informe o motivo da reversão com pelo menos 10 caracteres.');return;}setError('');setPreview(parsed.data);}
  async function submit(){
    if(sending.current||restored.error)return;const command=pending||preview;if(!command)return;const wasUncertain=!!pending;
    try{sessionStorage.setItem(key,JSON.stringify(command));}catch{setError('Não foi possível preservar o pedido. Nenhum envio foi iniciado.');return;}
    sending.current=true;setPending(command);setPreview(null);setBusy(true);setError('');
    try{await reverseFinanceIdentityReview(command);sessionStorage.removeItem(key);if(active.current){setPending(null);setOpen(false);onRecorded();}}
    catch(cause){if(active.current){setError(statementReviewError(cause));if(cause instanceof FinanceRejectedError&&!wasUncertain){try{sessionStorage.removeItem(key);setPending(null);}catch{/* Retain frozen request when cleanup fails. */}}}}
    finally{sending.current=false;if(active.current)setBusy(false);}
  }
  if(!open)return <Button variant="outline" onClick={()=>setOpen(true)}>Reverter esta decisão</Button>;
  const frozen=pending||preview;
  return <section aria-label="Reverter revisão manual" className="space-y-3 rounded border border-amber-600 p-3">
    <p className="font-medium">Reverter a decisão e devolver a linha para revisão</p><p className="text-sm">A decisão original e seu responsável continuarão no histórico. A reversão também registrará seu nome, horário e motivo.</p>
    {frozen?<><p>Motivo: {frozen.reason}</p>{pending&&<p role="status">Pedido preservado. Retome a confirmação com os mesmos dados.</p>}
      <Button disabled={busy||!!restored.error} onClick={()=>void submit()}>{busy?'Confirmando…':pending?'Retomar mesma reversão':'Confirmar reversão'}</Button>
      {!pending&&<Button variant="outline" onClick={()=>setPreview(null)}>Voltar à edição</Button>}</>:<>
      <label className="block text-sm">Motivo da reversão<Input maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <Button disabled={!!restored.error} onClick={prepare}>Revisar reversão antes de registrar</Button></>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
