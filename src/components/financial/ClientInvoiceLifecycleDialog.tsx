import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {useClientInvoiceLifecycle} from '@/hooks/useClientInvoiceLifecycle';
import {invoiceActionLabels,invoiceError,type InvoiceAction} from '@/lib/financial/clientInvoiceCommands';
import {INVOICE_STATUS_LABELS,type InvoiceStatus} from '@/hooks/useClientInvoices';
const brl=(cents:number)=>(cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export function ClientInvoiceLifecycleDialog({invoiceId,tenantId,onClose}:{invoiceId:string;tenantId:string;onClose:()=>void}){
 const {currentTenant}=useTenant();const {user}=useAuth();if(currentTenant?.id!==tenantId||!user?.id)return null;
 return <InvoiceActionForm key={`${tenantId}:${user.id}:${invoiceId}`} invoiceId={invoiceId} onClose={onClose}/>;
}
function InvoiceActionForm({invoiceId,onClose}:{invoiceId:string;onClose:()=>void}){
 const api=useClientInvoiceLifecycle(invoiceId);const context=api.query.data;
 const [action,setAction]=useState<'mark_sent'|'cancel'|'reactivate'|''>('');const [reason,setReason]=useState('');const [sentTo,setSentTo]=useState('');const [channel,setChannel]=useState('manual');
 const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const allowed=context&&(action==='cancel'?context.can_cancel:action==='reactivate'?context.can_reactivate:action==='mark_sent'?context.can_mark_sent:false);
 const submit=async()=>{if(!context||!action)return;setError('');setNotice('');try{
  const common={invoice_id:invoiceId,expected_revision:context.revision,reason};
  const result=await api.submit(action==='mark_sent'?{...common,action,sent_to:sentTo,channel}:{...common,action});
  setAction('');setReason('');setNotice(`Pedido confirmado: ${invoiceActionLabels[result.action]}. Consulte o estado financeiro atualizado.`);
 }catch(cause){setError(invoiceError(cause));}};
 return <Dialog open onOpenChange={()=>onClose()}><DialogContent><DialogHeader><DialogTitle>Ações da fatura {context?.invoice_number||''}</DialogTitle>
  <DialogDescription>Ações sobre a fatura comercial. Não emitem nem cancelam CT-e/NFS-e, não transferem dinheiro e não enviam mensagens.</DialogDescription></DialogHeader>
  {api.query.isPending?<p role="status">Consultando fatura…</p>:null}{api.query.error?<p role="alert">{api.query.error.message}</p>:null}
  {context?<div className="space-y-3"><p>Estado: {INVOICE_STATUS_LABELS[context.status as InvoiceStatus]||context.status} · Recebido: {brl(context.received_cents)} · Em aberto: {brl(context.open_cents)}</p>
   {context.received_cents>0?<p>Há recebimento líquido. Estorne os recebimentos antes de cancelar esta fatura.</p>:null}
   {context.requires_reconciliation?<p role="alert">Os estados vinculados exigem conferência. Cancelar ou reativar, quando disponível, faz uma conciliação explícita preservando o histórico.</p>:null}
   <fieldset disabled={api.isPending} className="space-y-3"><label className="block">Ação da fatura<select className="h-10 w-full rounded border bg-background px-3" value={action} onChange={e=>setAction(e.target.value as typeof action)}><option value="">Selecione</option>
    {context.can_mark_sent?<option value="mark_sent">Registrar envio</option>:null}{context.can_cancel?<option value="cancel">Cancelar fatura</option>:null}{context.can_reactivate?<option value="reactivate">Reativar fatura</option>:null}</select></label>
    <label className="block">Motivo da ação<Input maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    {action==='mark_sent'?<><p>Registre apenas um envio já realizado por você; este comando não envia a fatura.</p><label className="block">Destinatário informado<Input maxLength={500} value={sentTo} onChange={e=>setSentTo(e.target.value)}/></label><label className="block">Canal informado<Input maxLength={100} value={channel} onChange={e=>setChannel(e.target.value)}/></label></>:null}
    {action==='cancel'?<p>O título e o fechamento vinculado serão cancelados juntos. Valores, vínculos e documentos históricos permanecem preservados.</p>:null}
    {action==='reactivate'?<p>A mesma fatura e seus vínculos serão reativados somente se a origem continuar válida e não tiver sido cobrada em outro documento.</p>:null}
   </fieldset>
   {context.history.length?<section aria-label="Histórico da fatura" className="max-h-40 overflow-y-auto border p-2 text-sm">{context.history.map(entry=><p key={entry.id}>{invoiceActionLabels[entry.action as InvoiceAction]} — {entry.reason}</p>)}</section>:null}
  </div>:null}
  {api.pending?<p role="alert">Há pedido de fatura sem confirmação. Recupere-o no painel global antes de continuar.</p>:null}{api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}{error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
  <DialogFooter><Button variant="outline" onClick={onClose}>Voltar</Button><Button variant="outline" disabled={api.query.isFetching||api.isPending} onClick={()=>void api.query.refetch()}>Atualizar estado</Button>
   <Button disabled={!allowed||reason.trim().length<5||api.isPending||api.query.isFetching||!!api.query.error||!!api.pending||!!api.recoveryError||(action==='mark_sent'&&(!sentTo.trim()||!channel.trim()))} onClick={()=>void submit()}>Confirmar ação da fatura</Button></DialogFooter>
 </DialogContent></Dialog>;
}
