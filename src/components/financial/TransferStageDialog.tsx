import {useEffect,useRef,useState} from 'react';
import {useBankAccounts} from '@/hooks/useFinancialPayments';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {FinanceRejectedError,recordTransferStage} from '@/lib/financial/ledgerClient';
import {transferStageCommandSchema,type TransferStageCommand,type PendingTransfer} from '@/lib/financial/transferStageContract';
import {financeError,formatFinanceCents,parseFinanceAmount} from '@/lib/financial/ledgerContract';
export function TransferStageDialog({tenant,actor,mode,departure,onClose,onRecorded}:{tenant:string;actor:string;mode:'depart'|'arrive'|'recover';departure?:PendingTransfer;onClose:()=>void;onRecorded:()=>void}){
 const key=`finance-transfer-stage:${tenant}:${actor}`,accounts=useBankAccounts();
 const [restored]=useState(()=>{try{const raw=sessionStorage.getItem(key);if(!raw)return {command:null,error:''};const saved=JSON.parse(raw),command=transferStageCommandSchema.parse(saved.command);if(saved.actor!==actor||command.tenant_id!==tenant)throw new Error('scope');return {command,error:''};}catch{return {command:null,error:'Não foi possível recuperar a etapa anterior. Não envie outro pedido nesta sessão.'};}});
 const [pending,setPending]=useState<TransferStageCommand|null>(restored.command),[preview,setPreview]=useState<TransferStageCommand|null>(null);
 const [form,setForm]=useState({source:'',destination:'',amount:'',date:'',reference:'',reason:''});
 const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(restored.error);
 const live=useRef(true),sending=useRef(false);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const frozen=pending||preview;
 function prepare(){
  const parsed=transferStageCommandSchema.safeParse({version:1,tenant_id:tenant,request_id:crypto.randomUUID(),stage:mode,occurred_on:form.date,bank_reference:form.reference.trim(),reason:form.reason,occurred:confirmed,
   ...(mode==='depart'?{source_account_id:form.source,destination_account_id:form.destination,amount_cents:parseFinanceAmount(form.amount)}:{departure_id:departure?.id})});
  if(!parsed.success||(parsed.data.stage==='depart'&&parsed.data.source_account_id===parsed.data.destination_account_id)){setError('Confira contas distintas, valor, data e motivo. Confirme que esta etapa já ocorreu.');return;}setError('');setPreview(parsed.data);
 }
 async function submit(){if(!frozen||sending.current||restored.error)return;const command=frozen,uncertain=!!pending;
  try{sessionStorage.setItem(key,JSON.stringify({actor,command}));}catch{setError('Não foi possível preservar o pedido. Nenhum registro foi enviado.');return;}
  sending.current=true;setBusy(true);setPending(command);setPreview(null);setError('');
  try{await recordTransferStage(command);sessionStorage.removeItem(key);if(live.current)onRecorded();}
  catch(cause){if(live.current){setError(financeError(cause));if(cause instanceof FinanceRejectedError&&!uncertain){try{sessionStorage.removeItem(key);setPending(null);}catch{/* Preserve recovery if cleanup fails. */}}}}
  finally{sending.current=false;if(live.current)setBusy(false);}
 }
 const input=(field:keyof typeof form,label:string,type='text')=><label className="block">{label}<Input type={type} value={form[field]} maxLength={field==='reason'?2000:300} onChange={e=>setForm({...form,[field]:e.target.value})}/></label>;
 const accountName=(id:string)=>accounts.data?.find(a=>a.id===id)?.name||id;
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" onInteractOutside={e=>{if(busy)e.preventDefault();}}>
  <DialogHeader><DialogTitle>Registrar etapa da transferência</DialogTitle><DialogDescription>Registre somente o que já ocorreu. A conferência pelo extrato permanece separada.</DialogDescription></DialogHeader>
  {frozen?<section className="space-y-3">
   <p className="font-semibold">{frozen.stage==='depart'?'Registrar somente a saída':'Registrar chegada na conta de destino'}</p>
   {frozen.stage==='depart'?<><p>{formatFinanceCents(frozen.amount_cents)} · {accountName(frozen.source_account_id)} → {accountName(frozen.destination_account_id)}</p><p>A entrada ficará pendente. Nenhum crédito será antecipado.</p></>:<p className="break-all">Transferência de origem: {frozen.departure_id}. O valor e a conta de destino serão os da saída original.</p>}
   <p>Data: {frozen.occurred_on.split('-').reverse().join('/')}</p><p>{frozen.reason}</p>
   {pending&&<p role="status">Pedido preservado para recuperação. Não crie outro registro para esta etapa.</p>}
   <Button disabled={busy||!!restored.error} onClick={()=>void submit()}>{busy?'Confirmando…':pending?'Retomar mesma etapa':'Confirmar registro da etapa'}</Button>
   {!pending&&<Button variant="outline" onClick={()=>setPreview(null)}>Voltar à edição</Button>}
  </section>:mode==='recover'?<p>Nenhuma etapa pendente de recuperação nesta sessão.</p>:<div className="space-y-3">
   {mode==='depart'?<>
    {accounts.error&&<p role="alert">Não foi possível consultar as contas.</p>}
    {(['source','destination'] as const).map(field=><label key={field} className="block">{field==='source'?'Conta de saída':'Conta de destino esperado'}<select className="block h-10 w-full rounded border bg-background px-3" value={form[field]} onChange={e=>setForm({...form,[field]:e.target.value})}><option value="">Selecione</option>{!accounts.error&&accounts.data?.filter(a=>a.active).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>)}
    {input('amount','Valor da saída')}
   </>:<p>{departure?.source_name} → {departure?.destination_name} · {departure&&formatFinanceCents(departure.amount_cents)}. Confirme somente se o valor integral chegou a esta conta. Divergências precisam de revisão.</p>}
   {input('date',mode==='depart'?'Data da saída':'Data da chegada','date')}{input('reference','Referência bancária (opcional)')}{input('reason','Motivo')}
   <label className="block"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> {mode==='depart'?'Confirmo que o dinheiro já saiu e a saída ainda não foi registrada.':'Confirmo que o valor integral já chegou e a entrada ainda não foi registrada.'}</label>
   <Button disabled={!!restored.error||(mode==='depart'&&(accounts.isPending||!!accounts.error))} onClick={prepare}>Revisar etapa</Button>
  </div>}
  {error&&<p role="alert">{error}</p>}
 </DialogContent></Dialog>;
}
