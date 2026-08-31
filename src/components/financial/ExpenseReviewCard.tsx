import {Card,CardContent} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {expenseAmount,expenseCategoryLabels,expensePaymentLabels,type ReviewExpense} from '@/lib/financial/expenseReviewCommands';
export function ExpenseReviewCard({expense,canReview,onReview,onReceipt}:{expense:ReviewExpense;canReview:boolean;onReview:()=>void;onReceipt:()=>void}){
 return <Card><CardContent className="space-y-2 p-4">
  <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{expenseCategoryLabels[expense.category]||expense.category}</p><strong>{expenseAmount(expense.amount)}</strong></div>
  <Badge variant={expense.approval_status==='rejected'?'destructive':'secondary'}>{expense.approval_status==='pending'?'Pendente':expense.approval_status==='approved'?'Aprovada':expense.approval_status==='rejected'?'Rejeitada':expense.approval_status}</Badge>
  <p className="text-sm">{expense.driver_name||'Motorista'} · {new Date(expense.expense_at).toLocaleString('pt-BR')}</p>
  <p className="text-sm">{expensePaymentLabels[expense.payment_source]||expense.payment_source} · {expense.reimbursable?'Reembolsável':'Não reembolsável'}{expense.paid_with_advance?' · Pago com adiantamento':''}</p>
  {(expense.city||expense.state)?<p className="text-sm">{[expense.city,expense.state].filter(Boolean).join('/')}</p>:null}
  {(expense.supplier_name||expense.document_number)?<p className="text-sm">{expense.supplier_name||'Fornecedor não informado'}{expense.document_number?' · Doc '+expense.document_number:''}</p>:null}
  {expense.odometer!==null?<p className="text-sm">Hodômetro: {expense.odometer.toLocaleString('pt-BR')} km</p>:null}
  {expense.notes?<p className="text-sm">{expense.notes}</p>:null}
  {expense.no_receipt?<p className="text-sm text-amber-700">Sem comprovante — {expense.no_receipt_reason||'sem justificativa informada'}</p>:null}
  {expense.review_reason?<p className="text-sm">Motivo da revisão: {expense.review_reason}</p>:null}
  <div className="flex flex-wrap justify-end gap-2">{expense.receipt_url?<Button variant="outline" onClick={onReceipt}>Ver comprovante</Button>:null}
   <Button variant="outline" onClick={onReview}>{expense.approval_status==='pending'&&canReview?'Revisar despesa':'Detalhes da revisão'}</Button></div>
 </CardContent></Card>;
}
