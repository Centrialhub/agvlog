import {useId,useState} from 'react';
import {RefreshCw,ReceiptText,WifiOff} from 'lucide-react';
import {DriverExpenseForm} from '@/components/driver/DriverExpenseForm';
import {Button} from '@/components/ui/button';
import {Card,CardContent} from '@/components/ui/card';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {useDriverExpenseHistory} from '@/hooks/useDriverExpenseHistory';
import {useDriverExpenseSubmission,useOperationalDriverExpenseSources} from '@/hooks/useDriverExpensesOperational';
import {useOnlineStatus} from '@/hooks/useOnlineStatus';
import {creationError} from '@/lib/financial/expenseCreationCommands';
import {expenseAmount,expenseCategoryLabels,expensePaymentLabels} from '@/lib/financial/expenseReviewCommands';

const statusLabels:Record<string,string>={pending:'Aguardando aprovação',approved:'Aprovada',rejected:'Rejeitada'};
const tripLabels:Record<string,string>={planned:'Planejada',in_transit:'Em trânsito',completed:'Concluída'};

export default function DriverOperationalExpenses(){
 const online=useOnlineStatus(),selectId=useId(),[open,setOpen]=useState(false),[source,setSource]=useState(''),[notice,setNotice]=useState('');
 const sources=useOperationalDriverExpenseSources(0,open),history=useDriverExpenseHistory(0),queue=useDriverExpenseSubmission();
 const pending=queue.pending.data??[];
 const synchronize=async()=>{try{const result=await queue.replay.mutateAsync();setNotice(result.confirmed?`${result.confirmed} despesa(s) confirmada(s) pelo servidor.`:result.pending?'Ainda há despesas pendentes de sincronização.':'Tudo sincronizado.');}catch(cause){setNotice(creationError(cause));}};
 return <div className="space-y-4">
  <div className="flex items-start justify-between gap-3"><div><h1 className="text-lg font-bold">Gastos da viagem</h1><p className="text-xs text-muted-foreground">Envie comprovantes para conferência da equipe operacional. Nenhum pagamento é lançado por esta tela.</p></div><Button onClick={()=>{setOpen(true);setSource('');}}>Novo gasto</Button></div>
  {notice?<p role="status">{notice}</p>:null}
  {pending.length?<Card><CardContent className="space-y-3 p-4"><div className="flex items-center gap-2"><WifiOff aria-hidden="true" className="h-4 w-4 text-warning"/><strong>{pending.length} envio(s) salvo(s) no aparelho</strong></div>
   {pending.map(item=><div key={item.requestId} className="rounded border p-2 text-xs"><p>{expenseCategoryLabels[item.category]??item.category} · {expenseAmount(item.amountCents/100)}</p><p>Viagem {item.sourceId.slice(0,8)} · {item.state==='needs_attention'?'Requer conferência':'Aguardando conexão'}</p>{item.lastError?<p className="text-destructive">{item.lastError}</p>:null}</div>)}
   <Button variant="outline" className="w-full" disabled={!online||queue.replay.isPending} onClick={()=>void synchronize()}><RefreshCw aria-hidden="true" className={`mr-2 h-4 w-4 ${queue.replay.isPending?'animate-spin':''}`}/>Sincronizar gastos</Button>
  </CardContent></Card>:null}
  <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto"><DialogHeader><DialogTitle>Novo gasto da viagem</DialogTitle><DialogDescription>O comprovante é obrigatório. Offline, o arquivo fica guardado neste aparelho até a confirmação.</DialogDescription></DialogHeader>
   {sources.isPending?<p role="status">Carregando suas viagens...</p>:sources.error?<p role="alert">{creationError(sources.error)}</p>:<><label htmlFor={selectId}>Viagem do gasto</label><select id={selectId} className="w-full rounded border p-2" value={source} onChange={event=>setSource(event.target.value)}>
    <option value="">Selecione a viagem</option>{sources.data?.rows.map(trip=><option key={trip.id} value={trip.id}>{tripLabels[trip.status]} · {trip.id.slice(0,8)} · {trip.notes||new Date(trip.created_at).toLocaleDateString('pt-BR')}</option>)}</select>
    {sources.data?.offline?<p role="status" className="text-xs">Viagens carregadas do armazenamento offline deste aparelho.</p>:null}</>}
   {source?<DriverExpenseForm sourceId={source} onSaved={message=>{setNotice(message);setOpen(false);setSource('');}}/>:null}
  </DialogContent></Dialog>
  <section aria-labelledby="driver-expense-history"><h2 id="driver-expense-history" className="font-semibold">Histórico enviado</h2>
   {history.isPending?<p role="status">Carregando despesas...</p>:history.error?<p role="alert">{creationError(history.error)}</p>:history.data?.rows.length?history.data.rows.map(expense=><Card key={expense.id}><CardContent className="space-y-1 p-3">
    <div className="flex justify-between gap-2"><p className="font-medium">{expenseCategoryLabels[expense.category]??expense.category}</p><strong>{expenseAmount(expense.amount)}</strong></div>
    <p className="text-sm">{statusLabels[expense.approval_status]??expense.approval_status} · {new Date(expense.expense_at).toLocaleString('pt-BR')}</p><p className="text-xs text-muted-foreground">{expensePaymentLabels[expense.payment_source]??expense.payment_source}</p>
    {expense.review_reason?<p role="status">Motivo da decisão: {expense.review_reason}</p>:null}
   </CardContent></Card>):<Card><CardContent className="py-8 text-center"><ReceiptText aria-hidden="true" className="mx-auto mb-2 h-7 w-7 text-muted-foreground"/><p>Nenhum gasto enviado nesta viagem.</p></CardContent></Card>}
  </section>
 </div>;
}
