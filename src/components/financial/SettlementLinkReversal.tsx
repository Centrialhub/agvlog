import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {settlementReversalCommandSchema,type SettlementReversalCommand} from '@/lib/financial/settlementMovementContract';
import {reverseSettlementMovement,SettlementMovementRejectedError} from '@/lib/financial/settlementMovementClient';
export function SettlementLinkReversal({tenant,actor,payment,activeLink,disabled,onPendingChange,onConfirmed}:{tenant:string;actor:string;payment:string;activeLink:string|null;disabled:boolean;onPendingChange:(pending:boolean)=>void;onConfirmed:()=>void}){
 const key=`finance-settlement-reversal:${tenant}:${actor}:${payment}`;
 const [restored]=useState(()=>{try{const raw=sessionStorage.getItem(key);if(!raw)return {};
  const saved=JSON.parse(raw),command=settlementReversalCommandSchema.parse(saved.command);
  if(saved.actor!==actor||saved.payment!==payment||command.tenant_id!==tenant)throw new Error();return {command};
 }catch{return {error:'Não foi possível recuperar a correção pendente. Verifique o histórico antes de enviar outro pedido.'};}});
 const [command,setCommand]=useState<SettlementReversalCommand|undefined>(restored.command),[reason,setReason]=useState(''),[editing,setEditing]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(restored.error||''),[success,setSuccess]=useState(false);
 const [completedLink,setCompletedLink]=useState<string>();
 const mounted=useRef(true),sending=useRef(false),cache=useQueryClient();
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{onPendingChange(!!command||!!restored.error||busy);},[command,restored.error,busy,onPendingChange]);
 async function submit(){
  if(sending.current||disabled||restored.error)return;
  let original=command;
  if(!original){
   const parsed=settlementReversalCommandSchema.safeParse({version:1,tenant_id:tenant,request_id:crypto.randomUUID(),link_id:activeLink,reason});
   if(!parsed.success){setError('Informe uma justificativa com pelo menos 10 caracteres.');return;}
   original=parsed.data;
   try{sessionStorage.setItem(key,JSON.stringify({actor,payment,command:original}));}catch{setError('Não foi possível preservar a correção. Nenhum pedido foi enviado.');return;}
   setCommand(original);
  }
  sending.current=true;setBusy(true);setError('');
  try{
   await reverseSettlementMovement(original);sessionStorage.removeItem(key);
   for(const prefix of ['finance-settlement-movements','finance-movements','finance-audit','finance-legacy-inventory','finance-payable-options','finance-options','finance-manual-expense-options','finance-payroll'])void cache.invalidateQueries({queryKey:[prefix]});
   if(mounted.current){setCommand(undefined);setEditing(false);setSuccess(true);setCompletedLink(original.link_id);onConfirmed();}
  }catch(e){
   if(e instanceof SettlementMovementRejectedError&&!command){
    try{sessionStorage.removeItem(key);if(mounted.current){setCommand(undefined);setError(`Correção recusada: ${e.message}. Revise o vínculo antes de tentar novamente.`);}void cache.invalidateQueries({queryKey:['finance-settlement-movements',tenant,actor,payment]});}
    catch{if(mounted.current)setError('Correção recusada, mas a recuperação local não pôde ser atualizada. Verifique o histórico.');}
   }else if(mounted.current)setError(`${e instanceof Error?e.message:'Resposta não confirmada.'} A correção original foi preservada para retomada.`);
  }finally{sending.current=false;if(mounted.current)setBusy(false);}
 }
 return <section aria-label="Correção do vínculo" className="space-y-2">
 {error&&<p role="alert">{error}</p>}{success&&<p role="status">Vínculo desfeito com histórico preservado. O pagamento e o dinheiro permanecem registrados.</p>}
 {command?<><p>Correção pendente do vínculo: {command.link_id}</p><p>Motivo preservado: {command.reason}</p><Button disabled={busy||disabled||!!restored.error} onClick={()=>void submit()}>{busy?'Confirmando correção…':'Retomar correção original'}</Button></>:activeLink&&activeLink!==completedLink&&<>
 {!editing?<Button variant="outline" disabled={disabled||!!restored.error} onClick={()=>setEditing(true)}>Corrigir vínculo incorreto</Button>:<><p>Esta ação desfaz somente a associação. Não é devolução de dinheiro e não exclui o pagamento. Seu nome, motivo e horário permanecerão no histórico.</p><label>Motivo da correção<Textarea maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/></label><Button disabled={busy||disabled||reason.trim().length<10||!!restored.error} onClick={()=>void submit()}>Confirmar correção do vínculo</Button><Button variant="outline" disabled={busy} onClick={()=>setEditing(false)}>Cancelar correção</Button></>}
 </>}
 </section>;
}
