import {useQueryClient} from '@tanstack/react-query';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Badge} from '@/components/ui/badge';
import {usePayablePayments,PAYMENT_METHOD_LABELS,type PaymentMethod} from '@/hooks/useFinancialPayments';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import type {Payable} from '@/hooks/usePayables';
import {PayableMovementLink} from './PayableMovementLink';
import {PayableLinkReversal} from './PayableLinkReversal';
import {LegacyPayableAssociation} from './LegacyPayableAssociation';
import {invalidateAccountReview} from '@/lib/financial/invalidateAccountReview';

interface Props{payable:Payable|null;open:boolean;onOpenChange:(open:boolean)=>void}
const fmt=(value:number)=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
export default function PayablePaymentDialog({payable,open,onOpenChange}:Props){
 const {currentTenant}=useTenant(),{user}=useAuth(),qc=useQueryClient();
 const [pagination,setPagination]=useState({payable:'',page:1});
 const page=pagination.payable===payable?.id?pagination.page:1;
 const {data:historyData,error:historyError,isFetching}=usePayablePayments(open?payable?.id??null:null,page);
 const history=isFetching?[]:historyData?.rows??[];
 if(!payable)return null;
 function recorded(){
  if(currentTenant)void invalidateAccountReview(qc,currentTenant.id);
  for(const key of ['payables','payables_payments','payroll_entries','payroll_periods','payroll_period','finance-options','finance-payable-options','finance-expenses','finance-audit','finance-legacy-inventory','finance-settlement-expense-context'])void qc.invalidateQueries({queryKey:[key]});
 }
 return <Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
   <DialogHeader><DialogTitle>Baixas — {payable.supplier_name}</DialogTitle></DialogHeader>
   <p>Valor do título: <strong>{fmt(Number(payable.amount))}</strong></p>
   <p className="text-sm text-muted-foreground">Use uma saída já registrada para dar baixa sem contar o dinheiro duas vezes. Se o envio ainda não estiver no sistema, <a href="/financial/movements" className="underline">registre a saída em Movimentações</a>.</p>
   {open&&currentTenant&&user&&<PayableMovementLink key={`${currentTenant.id}:${user.id}:${payable.id}`} tenant={currentTenant.id} actor={user.id} payable={payable.id} onRecorded={recorded}/>}
   {historyError?<p role="alert">Não foi possível carregar o histórico de baixas.</p>:history.length>0&&<section aria-label="Histórico de baixas" className="border rounded p-3 space-y-2">
    <p className="font-medium">Histórico de baixas</p>
    {history.map(payment=><div key={payment.id} className="border-b last:border-b-0 pb-2 text-sm">
     <div className="font-medium">{fmt(Number(payment.amount))} <Badge variant="secondary">{PAYMENT_METHOD_LABELS[payment.method as PaymentMethod]||payment.method}</Badge></div>
     <p>{new Date(payment.paid_at).toLocaleDateString('pt-BR')} · {payment.account_name||'—'}</p>
     {payment.notes&&<p>{payment.notes}</p>}
     {payment.reversal&&<div className="border-l-4 border-amber-600 pl-2">
      <Badge variant="outline">Vínculo desfeito manualmente</Badge>
      <p>{payment.reversal.actor_name} · {new Date(payment.reversal.created_at).toLocaleString('pt-BR')}</p>
      <p>{payment.reversal.reason}</p><p>{payment.link_origin==='legacy_adoption'?'O pagamento antigo foi preservado; desfazer a associação não reabre o título.':'Esta baixa não compõe o total pago atual.'}</p>
     </div>}
     {payment.link_origin==='canonical'&&payment.link_id&&currentTenant&&user&&<PayableLinkReversal key={`${currentTenant.id}:${user.id}:${payment.link_id}`} tenant={currentTenant.id} actor={user.id} link={payment.link_id} reversed={!!payment.reversal} onRecorded={recorded}/>}
     {payment.link_origin!=='canonical'&&currentTenant&&user&&<LegacyPayableAssociation key={`${currentTenant.id}:${user.id}:${payment.id}`} tenant={currentTenant.id} actor={user.id} payment={payment.id} onRecorded={recorded}/>}
    </div>)}
    <div className="flex justify-between"><Button variant="ghost" disabled={page===1||isFetching} onClick={()=>setPagination({payable:payable.id,page:page-1})}>Anterior</Button>
     <span>Página {page}</span><Button variant="ghost" disabled={page*30>=(historyData?.total??0)||isFetching} onClick={()=>setPagination({payable:payable.id,page:page+1})}>Próxima</Button></div>
   </section>}
  </DialogContent>
 </Dialog>;
}
