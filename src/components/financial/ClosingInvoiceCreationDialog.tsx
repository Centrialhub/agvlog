import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {useClientInvoiceLifecycle} from '@/hooks/useClientInvoiceLifecycle';
import {invoiceError} from '@/lib/financial/clientInvoiceCommands';
export function ClosingInvoiceCreationDialog({reportId,tenantId,onClose}:{reportId:string;tenantId:string;onClose:()=>void}){
 const {currentTenant}=useTenant();const {user}=useAuth();if(currentTenant?.id!==tenantId||!user?.id)return null;
 return <CreationForm key={`${tenantId}:${user.id}:${reportId}`} reportId={reportId} onClose={onClose}/>;
}
function CreationForm({reportId,onClose}:{reportId:string;onClose:()=>void}){
 const api=useClientInvoiceLifecycle(undefined,reportId);const context=api.creation.data;const [reason,setReason]=useState('');const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const submit=async()=>{if(!context)return;setError('');try{const result=await api.submit({action:'generate_closing',report_id:reportId,expected_revision:context.revision,reason});setNotice(`Fatura ${result.invoice_number} confirmada. Um único título foi criado.`);setReason('');}catch(cause){setError(invoiceError(cause));}};
 return <Dialog open onOpenChange={()=>onClose()}><DialogContent><DialogHeader><DialogTitle>Faturar fechamento</DialogTitle><DialogDescription>Cria a fatura comercial e o título vinculados. Não emite documento fiscal nem transfere valores.</DialogDescription></DialogHeader>
  {api.creation.isPending?<p role="status">Conferindo fechamento…</p>:null}{api.creation.error?<p role="alert">{api.creation.error.message}</p>:null}
  {context?<><p>Valor da fatura: {(context.amount_cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</p>{!context.can_generate?<p>Este fechamento não está disponível para uma nova fatura. Confira o vínculo já existente.</p>:null}<label>Motivo do faturamento<Input maxLength={2000} value={reason} disabled={api.isPending} onChange={e=>setReason(e.target.value)}/></label></>:null}
  {api.pending?<p role="alert">Há pedido de fatura sem confirmação. Recupere-o no painel global antes de continuar.</p>:null}{api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}{error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
  <DialogFooter><Button variant="outline" onClick={onClose}>Voltar</Button><Button variant="outline" disabled={api.isPending||api.creation.isFetching} onClick={()=>void api.creation.refetch()}>Atualizar prévia</Button><Button disabled={!context?.can_generate||reason.trim().length<5||api.isPending||api.creation.isFetching||!!api.creation.error||!!api.pending||!!api.recoveryError} onClick={()=>void submit()}>Confirmar faturamento</Button></DialogFooter>
 </DialogContent></Dialog>;
}
