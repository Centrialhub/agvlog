import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {useClosingLifecycle} from '@/hooks/useClosingLifecycle';
import {STATUS_LABELS} from '@/hooks/useClosingReports';
import {closingActionLabels,closingLifecycleError,type ClosingAction} from '@/lib/closingReports/closingLifecycle';
export function ClosingLifecycleDialog({reportId,tenantId,onClose}:{reportId:string;tenantId:string;onClose:()=>void}){
 const {currentTenant}=useTenant();const {user}=useAuth();if(currentTenant?.id!==tenantId)return null;
 return <ClosingActionForm key={`${tenantId}:${user?.id}:${reportId}`} reportId={reportId} onClose={onClose}/>;
}
function ClosingActionForm({reportId,onClose}:{reportId:string;onClose:()=>void}){
 const api=useClosingLifecycle(reportId);const context=api.query.data;
 const [action,setAction]=useState<ClosingAction|''>('');const [reason,setReason]=useState('');const [sentTo,setSentTo]=useState('');const [channel,setChannel]=useState('');
 const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const submitAction=async()=>{
  if(!context||!action)return;setError('');setNotice('');
  try{const result=await api.submit({report_id:reportId,expected_revision:context.revision,action,reason,...(action==='mark_sent'?{sent_to:sentTo||null,channel:channel||null}:{})});
   setAction('');setReason('');setNotice(`Pedido confirmado: ${closingActionLabels[result.action]}. Nenhuma emissão fiscal ou transferência bancária foi executada.`);
  }catch(cause){setError(closingLifecycleError(cause));}
 };
 const allowed=action&&context?.allowed_actions.includes(action)&&!(action==='close'&&context.source_review_required);
 return <Dialog open onOpenChange={onClose}><DialogContent><DialogHeader><DialogTitle>Ações do fechamento {context?.closing_number||''}</DialogTitle>
  <DialogDescription>Confirme a ação sobre o estado atual. Toda alteração exige motivo e mantém histórico.</DialogDescription></DialogHeader>
  {api.query.isPending?<p role="status">Consultando estado atual…</p>:null}
  {api.query.error?<p role="alert">{api.query.error.message}</p>:null}
  {context?<div className="space-y-3"><p>Estado atual: {STATUS_LABELS[context.status]||context.status} · revisão {context.revision}</p>
   {context.has_financial_links?<p>Há fatura ou recebimento vinculado. Cancelamento e reabertura exigem conciliação financeira.</p>:null}
   {context.source_review_required?<p role="alert">Há origem sem validação financeira. O fechamento permanece indisponível até a revisão.</p>:null}
   <fieldset disabled={api.isPending} className="space-y-3"><label>Ação desejada<select className="h-10 w-full rounded border bg-background px-3" value={action} onChange={e=>setAction(e.target.value as ClosingAction|'')}><option value="">Selecione</option>{context.allowed_actions.map(value=><option key={value} value={value}>{closingActionLabels[value]}</option>)}</select></label>
    <label>Motivo da ação<Input maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    {action==='mark_sent'?<><p>Este comando apenas registra um envio já realizado; não envia e-mail ou mensagem.</p><label>Destinatário informado<Input maxLength={500} value={sentTo} onChange={e=>setSentTo(e.target.value)}/></label><label>Canal informado<Input maxLength={100} value={channel} onChange={e=>setChannel(e.target.value)}/></label></>:null}
   </fieldset>
  </div>:null}
  {api.pending?<p role="alert">Há transição sem confirmação. Use o painel de recuperação antes de iniciar outra.</p>:null}
  {api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}{error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
  <DialogFooter><Button variant="outline" onClick={onClose}>Voltar</Button><Button variant="outline" disabled={api.query.isFetching||api.isPending} onClick={()=>void api.query.refetch()}>Atualizar estado</Button>
   <Button disabled={!allowed||reason.trim().length<5||api.isPending||api.query.isFetching||!!api.query.error||!!api.pending||!!api.recoveryError} onClick={()=>void submitAction()}>Confirmar ação</Button></DialogFooter>
 </DialogContent></Dialog>;
}
