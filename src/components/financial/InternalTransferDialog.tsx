import {useEffect,useRef,useState} from 'react';
import {useBankAccounts} from '@/hooks/useFinancialPayments';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {FinanceRejectedError,recordInternalTransfer} from '@/lib/financial/ledgerClient';
import {internalTransferCommandSchema,type InternalTransferCommand} from '@/lib/financial/internalTransferContract';
import {financeError,formatFinanceCents,parseFinanceAmount} from '@/lib/financial/ledgerContract';
export function InternalTransferDialog({tenant,actor,onClose,onRecorded}:{tenant:string;actor:string;onClose:()=>void;onRecorded:()=>void}){
 const key=`finance-transfer:${tenant}:${actor}`,accounts=useBankAccounts();
 const [restored]=useState(()=>{try{const raw=sessionStorage.getItem(key);if(!raw)return {command:null,error:''};const saved=JSON.parse(raw),command=internalTransferCommandSchema.parse(saved.command);if(saved.actor!==actor||command.tenant_id!==tenant)throw new Error('scope');return {command,error:''};}catch{return {command:null,error:'Não foi possível recuperar o registro anterior. Não envie outro pedido nesta sessão.'};}});
 const [pending,setPending]=useState<InternalTransferCommand|null>(restored.command),[preview,setPreview]=useState<InternalTransferCommand|null>(null);
 const [form,setForm]=useState({source:'',destination:'',amount:'',debited:'',credited:'',sourceReference:'',destinationReference:'',reason:''});
 const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(restored.error);
 const live=useRef(true),sending=useRef(false);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const frozen=pending||preview;
 function prepare(){
  const parsed=internalTransferCommandSchema.safeParse({version:1,tenant_id:tenant,request_id:crypto.randomUUID(),source_account_id:form.source,destination_account_id:form.destination,amount_cents:parseFinanceAmount(form.amount),debited_on:form.debited,credited_on:form.credited,source_reference:form.sourceReference.trim(),destination_reference:form.destinationReference.trim(),reason:form.reason,both_recorded:confirmed});
  if(!parsed.success){setError('Informe duas contas distintas, valor, datas da saída e da entrada, motivo e confirme que ambas já ocorreram.');return;}setError('');setPreview(parsed.data);
 }
 async function submit(){if(!frozen||sending.current||restored.error)return;const command=frozen,uncertain=!!pending;
  try{sessionStorage.setItem(key,JSON.stringify({actor,command}));}catch{setError('Não foi possível preservar o pedido. Nenhum registro foi enviado.');return;}
  sending.current=true;setBusy(true);setPending(command);setPreview(null);setError('');
  try{await recordInternalTransfer(command);sessionStorage.removeItem(key);if(live.current)onRecorded();}
  catch(cause){if(live.current){setError(financeError(cause));if(cause instanceof FinanceRejectedError&&!uncertain){try{sessionStorage.removeItem(key);setPending(null);}catch{/* Preserve uncertain recovery. */}}}}
  finally{sending.current=false;if(live.current)setBusy(false);}
 }
 const input=(field:keyof typeof form,label:string,type='text')=><label className="block space-y-1">{label}<Input type={type} value={form[field]} onChange={e=>setForm({...form,[field]:e.target.value})} maxLength={field==='reason'?2000:300}/></label>;
 const accountName=(id:string)=>accounts.data?.find(a=>a.id===id)?.name||id;
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" onInteractOutside={e=>{if(busy)e.preventDefault();}}>
  <DialogHeader><DialogTitle>Registrar transferência entre contas</DialogTitle><DialogDescription>Registre uma transferência já realizada entre contas da empresa. O sistema não movimenta dinheiro. Tarifas devem ser registradas como despesa separada.</DialogDescription></DialogHeader>
  {frozen?<section className="space-y-3"><p className="font-semibold">{formatFinanceCents(frozen.amount_cents)}</p><p>Saída: {accountName(frozen.source_account_id)} · {frozen.debited_on.split('-').reverse().join('/')}</p><p>Entrada: {accountName(frozen.destination_account_id)} · {frozen.credited_on.split('-').reverse().join('/')}</p><p>{frozen.reason}</p><p>Os dois registros serão vinculados. Cada lado ainda precisa de conferência no extrato da sua conta.</p>
   {pending&&<p role="status">Pedido preservado. Retome o mesmo registro para confirmar o resultado.</p>}
   <Button disabled={busy||!!restored.error} onClick={()=>void submit()}>{busy?'Confirmando…':pending?'Retomar mesmo registro':'Confirmar registro dos dois lados'}</Button>
   {!pending&&<Button variant="outline" onClick={()=>setPreview(null)}>Voltar à edição</Button>}
  </section>:<div className="space-y-3">
   {accounts.error&&<p role="alert">Não foi possível consultar as contas.</p>}
   {(['source','destination'] as const).map(field=><label key={field} className="block">{field==='source'?'Conta de saída':'Conta de entrada'}<select className="block h-10 w-full rounded border bg-background px-3" value={form[field]} onChange={e=>setForm({...form,[field]:e.target.value})}><option value="">Selecione</option>{!accounts.error&&accounts.data?.filter(a=>a.active).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>)}
   {input('amount','Valor transferido')}{input('debited','Data da saída','date')}{input('credited','Data da entrada','date')}
   {input('sourceReference','Referência bancária da saída (opcional)')}{input('destinationReference','Referência bancária da entrada (opcional)')}{input('reason','Motivo')}
   <label className="block"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Confirmo que a saída e a entrada já ocorreram e ainda não foram registradas neste módulo.</label>
   <Button disabled={!!restored.error||accounts.isPending||!!accounts.error} onClick={prepare}>Revisar transferência</Button>
  </div>}
  {error&&<p role="alert">{error}</p>}
 </DialogContent></Dialog>;
}
