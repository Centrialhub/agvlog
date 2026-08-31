import {useEffect,useState} from 'react';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {useOperationDocumentContext,useOperationDocumentOutcomes} from '@/hooks/useOperationDocumentOutcomes';
import {OPERATION_OUTCOMES,OPERATION_OUTCOME_LABELS,type OperationOutcome,type OperationOutcomePayload,type OperationOutcomeResult} from '@/lib/loads/operationDocumentOutcome';
import {getErrorMessage} from '@/lib/errors';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';import {Label} from '@/components/ui/label';import {Textarea} from '@/components/ui/textarea';import {Button} from '@/components/ui/button';
interface Props {loadId:string;documentId:string;invoiceNumber:string;onClose:()=>void;onConfirmed:(result:OperationOutcomeResult,payload:Omit<OperationOutcomePayload,'tenant_id'>)=>void}
export function OperationCorrectionDialog({loadId,documentId,invoiceNumber,onClose,onConfirmed}:Props){
 const context=useOperationDocumentContext(loadId,documentId);const api=useOperationDocumentOutcomes();const {user}=useAuth();const {currentTenant}=useTenant();
 const [selection,setSelection]=useState<{outcome:OperationOutcome;revision:string;historyId:string}|null>(null);
 const [stop,setStop]=useState('');const [time,setTime]=useState('');const [receiver,setReceiver]=useState('');const [reason,setReason]=useState('');
 const [quantities,setQuantities]=useState<Record<string,string>>({});const [error,setError]=useState<string|null>(null);
 useEffect(()=>{setSelection(null);setStop('');setTime('');setReceiver('');setReason('');setQuantities({});setError(null);},[loadId,documentId,user?.id,currentTenant?.id]);
 const pending=api.pending.some(item=>item.payload.document_id===documentId);
 const changed=!!selection&&selection.revision!==context.data?.revision;
 const disabled=api.isPending||pending||!!api.recoveryError||!context.data||context.isFetching||!selection||changed;
 const hasReceipt=selection&&['delivered','partial_delivery'].includes(selection.outcome);
 const submit=async()=>{
  if(disabled||!selection)return;setError(null);
  try{
   const date=new Date(time);if(!Number.isFinite(date.getTime()))throw new Error('Informe o horário real do resultado corrigido.');
   const returned=selection.outcome==='partial_delivery'?Object.fromEntries(Object.entries(quantities).filter(([,n])=>n!=='').map(([id,n])=>[id,Number(n)])):{};
   const payload={load_id:loadId,document_id:documentId,stop_id:stop,revision:selection.revision,correction_of:selection.historyId,
    outcome:selection.outcome,returned_items:returned,reason:reason.trim(),receiver_name:receiver.trim(),occurred_at:date.toISOString()};
   const result=await api.submit(payload);onConfirmed(result,payload);onClose();
  }catch(failure){setError(getErrorMessage(failure,'Não foi possível confirmar a correção.'));}
 };
 return <Dialog open onOpenChange={open=>{if(!open&&!api.isPending)onClose();}}><DialogContent>
  <DialogHeader><DialogTitle>Corrigir resultado da nota {invoiceNumber}</DialogTitle>
   <DialogDescription>Esta ação substitui o resultado atual com justificativa, preserva o histórico e não libera a nota para outra carga. Comprovantes anteriores permanecem separados; acertos existentes serão sinalizados para revisão, sem pagamento ou recálculo automático.</DialogDescription></DialogHeader>
  {context.isPending?<p role="status">Carregando resultado registrado…</p>:null}
  {context.error?<p role="alert">{getErrorMessage(context.error,'Falha ao carregar a nota.')} <Button variant="outline" onClick={()=>void context.refetch()}>Tentar novamente</Button></p>:null}
  {context.data&&!context.data.current_outcome_id?<p role="alert">Não há resultado auditado disponível. O registro legado precisa de reconciliação antes da correção.</p>:null}
  <div className="space-y-3">
   <div><Label htmlFor="correction-outcome">Novo resultado</Label><select id="correction-outcome" className="w-full rounded border bg-background p-2" disabled={api.isPending||!context.data?.current_outcome_id} value={selection?.outcome||''} onChange={e=>{
    const data=context.data;setSelection(e.target.value&&data?.current_outcome_id?{outcome:e.target.value as OperationOutcome,revision:data.revision,historyId:data.current_outcome_id}:null);
   }}><option value="">Selecione o resultado corrigido</option>{OPERATION_OUTCOMES.map(outcome=><option key={outcome} value={outcome}>{OPERATION_OUTCOME_LABELS[outcome]}</option>)}</select></div>
   <div><Label htmlFor="correction-stop">Parada do resultado</Label><select id="correction-stop" className="w-full rounded border bg-background p-2" disabled={api.isPending} value={stop} onChange={e=>setStop(e.target.value)}>
    <option value="">Selecione a parada</option>{context.data?.stops.map(s=><option key={s.id} value={s.id}>{s.destination} — {s.status}</option>)}</select></div>
   <div><Label htmlFor="correction-time">Data e hora reais do resultado corrigido</Label><Input id="correction-time" type="datetime-local" disabled={api.isPending} value={time} onChange={e=>setTime(e.target.value)}/></div>
   {hasReceipt?<div><Label htmlFor="correction-receiver">Nome do recebedor</Label><Input id="correction-receiver" value={receiver} maxLength={160} disabled={api.isPending} onChange={e=>setReceiver(e.target.value)}/></div>:null}
   {selection?.outcome==='partial_delivery'?<fieldset className="space-y-2"><legend>Quantidades devolvidas desta nota</legend>
    {context.data?.items?.map(item=><div key={item.id}><Label htmlFor={'correction-quantity-'+item.id}>{item.description||'Item'} — devolvido (total {item.quantity})</Label>
     <Input id={'correction-quantity-'+item.id} type="number" min="0" max={item.quantity} step="any" disabled={api.isPending} value={quantities[item.id]||''} onChange={e=>setQuantities(old=>({...old,[item.id]:e.target.value}))}/></div>)}
   </fieldset>:null}
   <div><Label htmlFor="correction-reason">Motivo e fonte da correção</Label><Textarea id="correction-reason" maxLength={2000} disabled={api.isPending} value={reason} onChange={e=>setReason(e.target.value)}/></div>
   <div aria-label="Histórico auditado">{context.data?.history.map(h=><p key={h.id} className="text-sm">{h.is_current?'Atual':'Anterior'}: {OPERATION_OUTCOME_LABELS[h.outcome as OperationOutcome]||h.outcome} · {new Date(h.occurred_at).toLocaleString('pt-BR')} · {h.reason}</p>)}</div>
   {changed?<p role="alert">A nota mudou. Revise o histórico e <button className="underline" onClick={()=>setSelection(null)}>selecione novamente o resultado</button>.</p>:null}
   {pending?<p role="alert">Correção sem confirmação. Feche este diálogo e use Recuperar resultado no topo da página.</p>:null}
   {api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}{error?<p role="alert">{error}</p>:null}
  </div><DialogFooter><Button variant="outline" disabled={api.isPending} onClick={onClose}>Cancelar</Button>
   <Button disabled={disabled||!stop||!time||reason.trim().length<5||!!hasReceipt&&receiver.trim().length<2} onClick={()=>void submit()}>Confirmar correção</Button></DialogFooter>
 </DialogContent></Dialog>;
}
