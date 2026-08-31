import {useEffect,useState} from 'react';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {useOperationDocumentContext,useOperationDocumentOutcomes} from '@/hooks/useOperationDocumentOutcomes';
import {type OperationOutcome,type OperationOutcomePayload,type OperationOutcomeResult} from '@/lib/loads/operationDocumentOutcome';
import {getErrorMessage} from '@/lib/errors';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {Button} from '@/components/ui/button';
interface Props {loadId:string;documentId:string;invoiceNumber:string;outcome:OperationOutcome;onClose:()=>void;
 onConfirmed:(result:OperationOutcomeResult,payload:Omit<OperationOutcomePayload,'tenant_id'>)=>void}
export function OperationOutcomeDialog({loadId,documentId,invoiceNumber,outcome,onClose,onConfirmed}:Props){
 const context=useOperationDocumentContext(loadId,documentId);const api=useOperationDocumentOutcomes();const {user}=useAuth();const {currentTenant}=useTenant();
 const [stop,setStop]=useState('');const [time,setTime]=useState('');const [receiver,setReceiver]=useState('');const [reason,setReason]=useState('');const [error,setError]=useState<string|null>(null);
 useEffect(()=>{setStop('');setTime('');setReceiver('');setReason('');setError(null);},[loadId,documentId,outcome,user?.id,currentTenant?.id]);
 const pending=api.pending.some(item=>item.payload.document_id===documentId);const disabled=api.isPending||pending||!!api.recoveryError||!context.data||context.isFetching;
 const submit=async()=>{
  if(disabled||!context.data)return;setError(null);
  try{
   const date=new Date(time);if(!Number.isFinite(date.getTime()))throw new Error('Informe o horário real do resultado.');
   const payload={load_id:loadId,document_id:documentId,stop_id:stop,revision:context.data.revision,outcome,reason:reason.trim(),receiver_name:receiver.trim(),occurred_at:date.toISOString()};
   const result=await api.submit(payload);onConfirmed(result,payload);onClose();
  }catch(failure){setError(getErrorMessage(failure,'Não foi possível confirmar o resultado.'));}
 };
 return <Dialog open onOpenChange={open=>{if(!open&&!api.isPending)onClose();}}><DialogContent>
  <DialogHeader><DialogTitle>Confirmar resultado da nota {invoiceNumber}</DialogTitle>
   <DialogDescription>{outcome==='delivered'?'Confirmação manual pela operação. O comprovante fica pendente até recebimento e revisão.':'Registre o resultado e o motivo desta nota; as demais notas da parada não serão marcadas automaticamente.'}</DialogDescription></DialogHeader>
  {context.isPending?<p role="status">Carregando vínculos da nota…</p>:null}
  {context.error?<div role="alert">{getErrorMessage(context.error,'Falha ao carregar a nota.')} <Button variant="outline" onClick={()=>void context.refetch()}>Tentar novamente</Button></div>:null}
  <div className="space-y-3">
   <div><Label htmlFor="operation-outcome-stop">Parada confirmada</Label><select id="operation-outcome-stop" className="w-full rounded border bg-background p-2" value={stop} onChange={e=>setStop(e.target.value)} disabled={api.isPending}>
    <option value="">Selecione a parada</option>{context.data?.stops.map(s=><option key={s.id} value={s.id}>{s.destination} — {s.status}</option>)}</select></div>
   <div><Label htmlFor="operation-outcome-time">Data e hora reais do resultado</Label><Input id="operation-outcome-time" type="datetime-local" value={time} onChange={e=>setTime(e.target.value)} disabled={api.isPending}/></div>
   {outcome==='delivered'?<div><Label htmlFor="operation-outcome-receiver">Nome do recebedor</Label><Input id="operation-outcome-receiver" value={receiver} maxLength={160} onChange={e=>setReceiver(e.target.value)} disabled={api.isPending}/></div>:null}
   <div><Label htmlFor="operation-outcome-reason">Motivo e fonte da confirmação</Label><Textarea id="operation-outcome-reason" value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)} disabled={api.isPending}/></div>
   {context.data?.history.length?<div aria-label="Histórico de resultados">{context.data.history.map(h=><p key={h.id} className="text-sm">{h.outcome} · {h.source} · {new Date(h.occurred_at).toLocaleString('pt-BR')}</p>)}</div>:null}
   {pending?<p role="alert">Resultado sem confirmação. Feche este diálogo e use Recuperar resultado no topo da página.</p>:null}
   {api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}{error?<p role="alert">{error}</p>:null}
  </div><DialogFooter><Button variant="outline" disabled={api.isPending} onClick={onClose}>Cancelar</Button>
   <Button disabled={disabled||!stop||!time||reason.trim().length<5||outcome==='delivered'&&receiver.trim().length<2} onClick={()=>void submit()}>Confirmar resultado</Button></DialogFooter>
 </DialogContent></Dialog>;
}
