import {useQueryClient} from '@tanstack/react-query';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Badge} from '@/components/ui/badge';
import {usePayablePayments,PAYMENT_METHOD_LABELS,type PaymentMethod} from '@/hooks/useFinancialPayments';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import type {Payable} from '@/hooks/usePayables';
import {PayableAccountPayment} from './PayableAccountPayment';
import {PayableMovementLink} from './PayableMovementLink';
import {PayableLinkReversal} from './PayableLinkReversal';
import {LegacyPayableAssociation} from './LegacyPayableAssociation';
import {invalidateAccountReview} from '@/lib/financial/invalidateAccountReview';
import {supabase} from '@/integrations/supabase/client';

interface Props{payable:Payable|null;open:boolean;onOpenChange:(open:boolean)=>void}
const fmt=(value:number)=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export default function PayablePaymentDialog({payable,open,onOpenChange}:Props){
 const {currentTenant}=useTenant(),{user}=useAuth(),qc=useQueryClient();
 const [pagination,setPagination]=useState<{payable:string;page:number;revision:string|null}>({payable:'',page:1,revision:null});
 const [receiptError,setReceiptError]=useState('');
 const current=pagination.payable===payable?.id?pagination:{payable:payable?.id??'',page:1,revision:null},page=current.page;
 const {data:historyData,error:historyError,isFetching,refetch:refetchHistory}=usePayablePayments(open?payable?.id??null:null,page,current.revision);
 useEffect(()=>{if(payable&&historyData&&current.revision===null)setPagination({payable:payable.id,page,revision:historyData.page_revision});},[payable,historyData,current.revision,page]);
 const history=isFetching?[]:historyData?.rows??[];
 if(!payable)return null;
 function recorded(){
  setPagination({payable:payable!.id,page:1,revision:null});
  if(currentTenant)void invalidateAccountReview(qc,currentTenant.id);
  for(const key of ['payables','payables_payments','finance-payable-portfolio','payroll_entries','payroll_periods','payroll_period','finance-options','finance-payable-options','finance-expenses','finance-audit','finance-legacy-inventory','finance-settlement-expense-context'])void qc.invalidateQueries({queryKey:[key]});
 }
 async function openReceipt(path:string){setReceiptError('');if(!currentTenant||!path.startsWith(`${currentTenant.id}/`)||path.includes('..')||path.includes('\\')){setReceiptError('O caminho do comprovante é inválido.');return;}const popup=window.open('about:blank','_blank');if(!popup){setReceiptError('O navegador bloqueou a nova aba. Permita pop-ups para abrir o comprovante.');return;}popup.opener=null;try{const signed=await supabase.storage.from('receipts').createSignedUrl(path,300);if(signed.error||!signed.data?.signedUrl)throw signed.error;popup.location.replace(signed.data.signedUrl);}catch{popup.close();setReceiptError('Não foi possível abrir o comprovante. Tente novamente.');}}
 return <Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
   <DialogHeader><DialogTitle>Baixas — {payable.supplier_name}</DialogTitle><DialogDescription>Registre ou revise pagamentos vinculados a esta conta a pagar.</DialogDescription></DialogHeader>
   <p>Valor do título: <strong>{fmt(Number(payable.amount))}</strong></p>

   {open&&currentTenant&&user&&<PayableAccountPayment key={`account:${currentTenant.id}:${user.id}:${payable.id}`} tenant={currentTenant.id} actor={user.id} payable={payable.id} onRecorded={recorded}/>}
   {receiptError&&<p role="alert">{receiptError}</p>}
   {open&&currentTenant&&user&&<PayableMovementLink key={`${currentTenant.id}:${user.id}:${payable.id}`} tenant={currentTenant.id} actor={user.id} payable={payable.id} onRecorded={recorded}/>}
   {historyError?<p role="alert">Não foi possível carregar o histórico de baixas. Ele pode ter mudado durante a navegação. <Button variant="link" disabled={isFetching} onClick={()=>{if(page===1&&current.revision===null)void refetchHistory();else setPagination({payable:payable.id,page:1,revision:null});}}>Atualizar histórico</Button></p>:history.length>0&&<section aria-label="Histórico de baixas" className="border rounded p-3 space-y-2">
    <p className="font-medium">Histórico de baixas</p>
    {history.map(payment=><div key={payment.id} className="border-b last:border-b-0 pb-2 text-sm">
     <div className="font-medium">{fmt(Number(payment.amount))} <Badge variant="secondary">{PAYMENT_METHOD_LABELS[payment.method as PaymentMethod]||payment.method}</Badge></div>
     <p>{new Date(payment.paid_at).toLocaleDateString('pt-BR')} · {payment.account_name||'—'}</p>
     {payment.notes&&<p>{payment.notes}</p>}
     {payment.attachment_url&&<Button variant="outline" onClick={()=>void openReceipt(payment.attachment_url!)}>Abrir comprovante da baixa</Button>}
     {payment.reversal&&<div className="border-l-4 border-amber-600 pl-2">
      <Badge variant="outline">Vínculo desfeito manualmente</Badge>
      <p>{payment.reversal.actor_name} · {new Date(payment.reversal.created_at).toLocaleString('pt-BR')}</p>
      <p>{payment.reversal.reason}</p><p>{payment.link_origin==='legacy_adoption'?'O pagamento antigo foi preservado; desfazer a associação não reabre o título.':'Esta baixa não compõe o total pago atual.'}</p>
     </div>}
     {payment.link_origin==='canonical'&&payment.link_id&&currentTenant&&user&&<PayableLinkReversal key={`${currentTenant.id}:${user.id}:${payment.link_id}`} tenant={currentTenant.id} actor={user.id} link={payment.link_id} reversed={!!payment.reversal} onRecorded={recorded}/>}
     {payment.link_origin!=='canonical'&&currentTenant&&user&&<LegacyPayableAssociation key={`${currentTenant.id}:${user.id}:${payment.id}`} tenant={currentTenant.id} actor={user.id} payment={payment.id} onRecorded={recorded}/>}
    </div>)}
    <div className="flex justify-between"><Button variant="ghost" disabled={page===1||isFetching||!current.revision} onClick={()=>setPagination({payable:payable.id,page:page-1,revision:current.revision})}>Anterior</Button>
     <span>Página {page}</span><Button variant="ghost" disabled={page*30>=(historyData?.total??0)||isFetching||!current.revision} onClick={()=>setPagination({payable:payable.id,page:page+1,revision:current.revision})}>Próxima</Button></div>
   </section>}
  </DialogContent>
 </Dialog>;
}
