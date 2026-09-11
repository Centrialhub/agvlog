import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {FinanceRejectedError,correctReceiptAllocation} from '@/lib/financial/ledgerClient';
import {receiptCorrectionCommandSchema,type ReceiptCorrectionCommand} from '@/lib/financial/receiptCorrectionContract';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
export function ReceiptAllocationCorrection({tenant,actor,payment,amount,revision,eligible,disabled}:{tenant:string;actor:string;payment:string;amount:number;revision:string;eligible:boolean;disabled:boolean}){
 const key=`finance-receipt-correction:${tenant}:${actor}:${payment}`,qc=useQueryClient();
 const [restored]=useState(()=>{try{const raw=sessionStorage.getItem(key);if(!raw)return {command:null,error:''};const saved=JSON.parse(raw);
  const command=receiptCorrectionCommandSchema.parse(saved.command);if(saved.actor!==actor||command.tenant_id!==tenant||command.payment_id!==payment)throw new Error('scope');return {command,error:''};
 }catch{return {command:null,error:'Não foi possível recuperar a correção anterior. Não inicie outro pedido nesta sessão.'};}});
 const [pending,setPending]=useState<ReceiptCorrectionCommand|null>(restored.command),[preview,setPreview]=useState<ReceiptCorrectionCommand|null>(null);
 const [open,setOpen]=useState(!!restored.command||!!restored.error),[reason,setReason]=useState(''),[error,setError]=useState(restored.error),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
 const live=useRef(true),sending=useRef(false);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const refresh=()=>{for(const prefix of ['receivable-financial-context','receivables','finance-receivable-portfolio','finance-receivable-payments','client_invoices','closing-reports','closing-report','finance-receipt-movement-options','finance-account-period','finance-movement-receipts','finance-audit'])void qc.invalidateQueries({queryKey:[prefix]});};
 function prepare(){const parsed=receiptCorrectionCommandSchema.safeParse({version:1,tenant_id:tenant,request_id:crypto.randomUUID(),payment_id:payment,expected_revision:revision,reason});
  if(!parsed.success){setError('Informe um motivo com pelo menos dez caracteres.');return;}setPreview(parsed.data);setError('');}
 async function submit(){const command=pending||preview;if(!command||sending.current||disabled||restored.error)return;const uncertain=!!pending;
  try{sessionStorage.setItem(key,JSON.stringify({actor,command}));}catch{setError('Não foi possível preservar o pedido. Nenhuma correção foi enviada.');return;}
  sending.current=true;setBusy(true);setPending(command);setPreview(null);setError('');
  try{await correctReceiptAllocation(command);sessionStorage.removeItem(key);if(live.current){setPending(null);setDone(true);refresh();}}
  catch(cause){if(live.current){setError(cause instanceof FinanceRejectedError?'A correção foi recusada. Atualize o título e confira o recebimento.':'Resposta não confirmada. Retome a mesma correção.');
   if(cause instanceof FinanceRejectedError&&!uncertain){try{sessionStorage.removeItem(key);setPending(null);refresh();}catch{/* Preserve the request when cleanup fails. */}}}}
  finally{sending.current=false;if(live.current)setBusy(false);}
 }
 if(done)return <p role="status">Vínculo corrigido. O dinheiro registrado foi preservado.</p>;
 if(!eligible&&!pending&&!restored.error)return null;
 if(!open)return <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={()=>setOpen(true)}>Corrigir vínculo desta baixa</Button>;
 const frozen=pending||preview;
 return <section aria-label="Correção do vínculo da baixa" className="space-y-2 rounded border border-amber-600 p-3">
  <p>Esta correção retira {formatFinanceCents(String(amount))} da baixa deste título. O valor ficará disponível na entrada original para outra associação. Nenhuma saída de dinheiro será registrada.</p>
  {frozen?<><p>Motivo: {frozen.reason}</p>{pending&&<p role="status">Pedido preservado para recuperação.</p>}
   <Button type="button" disabled={busy||disabled||!!restored.error} onClick={()=>void submit()}>{busy?'Confirmando…':pending?'Retomar mesma correção':'Confirmar correção do vínculo'}</Button>
   {!pending&&<Button type="button" variant="outline" disabled={busy} onClick={()=>setPreview(null)}>Voltar à edição</Button>}</>:<>
   <label>Motivo da correção<Textarea maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <Button type="button" disabled={disabled||!!restored.error} onClick={prepare}>Revisar correção do vínculo</Button></>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
