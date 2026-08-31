import {useState} from 'react';
import {useExpenseReview} from '@/hooks/useExpenseReview';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {expenseAmount,expenseCategoryLabels,expensePaymentLabels,expenseReviewError,expenseValidationLabels,type ExpenseReviewContext} from '@/lib/financial/expenseReviewCommands';
export function ExpenseReviewDialog({expenseId,onClose,onConfirmed}:{expenseId:string;onClose:()=>void;onConfirmed:()=>void}){
 const api=useExpenseReview(expenseId);const [action,setAction]=useState<'approve'|'reject'>('approve'),[reason,setReason]=useState(''),[error,setError]=useState('');
 const [frozen,setFrozen]=useState<ExpenseReviewContext|null>(null);const context=frozen??api.query.data;
 const changed=!!frozen&&!!api.query.data&&frozen.revision!==api.query.data.revision;
 const permitted=action==='approve'?context?.can_approve:context?.can_reject;
 return <Dialog open onOpenChange={open=>{if(!open&&!api.isPending)onClose();}}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader>
  <DialogTitle>Revisão da despesa</DialogTitle><DialogDescription>A revisão registra a decisão e sinaliza o acerto. Não efetua pagamento.</DialogDescription></DialogHeader>
  {api.query.isPending?<p role="status">Carregando revisão...</p>:null}
  {api.query.error?<p role="alert">{expenseReviewError(api.query.error)}</p>:null}
  {context?<><p>{expenseCategoryLabels[context.expense.category]||context.expense.category}: {expenseAmount(context.expense.amount)}</p>
   <p>{expensePaymentLabels[context.expense.payment_source]||context.expense.payment_source} · {context.expense.reimbursable?'Reembolsável':'Não reembolsável'}</p>
   {context.expense.notes?<p>{context.expense.notes}</p>:null}
   {context.expense.no_receipt?<p>Sem comprovante: {context.expense.no_receipt_reason||'sem justificativa'}</p>:null}
   {context.validation_errors.length?<div role="alert">{context.validation_errors.map(code=><p key={code}>{expenseValidationLabels[code]||'Dados da despesa exigem conferência.'}</p>)}</div>:null}
   {context.settlements.length?<p>O acerto relacionado ficará sinalizado para revisão. Valores e pagamentos anteriores serão preservados.</p>:null}
   {context.history.map(item=><p key={item.id}>{item.action==='approve'?'Aprovação':'Rejeição'}: {item.reason} · {new Date(item.created_at).toLocaleString('pt-BR')}</p>)}
   {context.status==='pending'&&(context.can_approve||context.can_reject)?<div className="space-y-3">
    <Label htmlFor="expense-review-action">Decisão</Label><select id="expense-review-action" className="w-full rounded border p-2" value={action} disabled={api.isPending} onChange={event=>{setFrozen(context);setAction(event.target.value as 'approve'|'reject');}}>
     <option value="approve">Aprovar</option><option value="reject">Rejeitar</option></select>
    <Label htmlFor="expense-review-reason">Motivo da revisão</Label><Textarea id="expense-review-reason" value={reason} maxLength={2000} disabled={api.isPending} onChange={event=>{setFrozen(context);setReason(event.target.value);}}/>
    <Button disabled={!permitted||reason.trim().length<5||changed||api.query.isFetching||!!api.query.error||api.isPending||!!api.pending||!!api.recoveryError} onClick={async()=>{
     setFrozen(context);setError('');try{await api.submit({expense_id:expenseId,action,reason,expected_revision:context.revision});onConfirmed();}catch(cause){setError(expenseReviewError(cause));}
    }}>Confirmar revisão</Button>
   </div>:<p>A revisão não está disponível para seu papel ou para o estado atual desta despesa.</p>}
  </>:null}
  {changed?<p role="alert">Os dados mudaram. Atualize a revisão e confira os valores novamente.</p>:null}
  {api.pending?<p role="alert">Revisão sem confirmação. Recupere o pedido pelo painel de recuperação antes de iniciar outro.</p>:null}
  {api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}{error?<p role="alert">{error}</p>:null}
  <div className="flex justify-end gap-2"><Button variant="outline" disabled={api.isPending} onClick={async()=>{const result=await api.query.refetch();if(result.data&&!result.error){setFrozen(result.data);setError('');}}}>Atualizar revisão</Button>
   <Button variant="outline" disabled={api.isPending} onClick={onClose}>Fechar</Button></div>
 </DialogContent></Dialog>;
}
