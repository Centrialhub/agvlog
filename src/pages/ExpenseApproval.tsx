import {useState} from 'react';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {useExpenseReviewList} from '@/hooks/useExpenseReview';
import {ExpenseReviewCard} from '@/components/financial/ExpenseReviewCard';
import {ExpenseReviewDialog} from '@/components/financial/ExpenseReviewDialog';
import {ExpenseReceiptDialog} from '@/components/financial/ExpenseReceiptDialog';
import {Button} from '@/components/ui/button';
import {expenseReviewError,type ReviewExpense} from '@/lib/financial/expenseReviewCommands';
export default function ExpenseApproval(){
 const {currentTenant}=useTenant();const {user}=useAuth();
 if(!currentTenant||!user)return <p>Entre e selecione a empresa para consultar despesas.</p>;
 return <ScopedExpenseApproval key={currentTenant.id+':'+user.id} tenantId={currentTenant.id}/>;
}
function ScopedExpenseApproval({tenantId}:{tenantId:string}){
 const [filter,setFilter]=useState<'pending'|'reviewed'>('pending'),[offset,setOffset]=useState(0);
 const [selected,setSelected]=useState<string|null>(null),[receipt,setReceipt]=useState<ReviewExpense|null>(null),[notice,setNotice]=useState('');
 const query=useExpenseReviewList(filter,offset);const page=query.data;
 return <div className="max-w-3xl space-y-5">
  <div><h1 className="text-xl font-bold">Aprovação de Despesas</h1><p className="text-sm text-muted-foreground">Revise os gastos do motorista e acompanhe as decisões registradas.</p></div>
  <div className="flex gap-2" role="group" aria-label="Filtrar despesas">
   <Button variant={filter==='pending'?'default':'outline'} aria-pressed={filter==='pending'} onClick={()=>{setFilter('pending');setOffset(0);}}>Pendentes</Button>
   <Button variant={filter==='reviewed'?'default':'outline'} aria-pressed={filter==='reviewed'} onClick={()=>{setFilter('reviewed');setOffset(0);}}>Revisadas</Button>
   <Button variant="outline" disabled={query.isFetching} onClick={()=>void query.refetch()}>Atualizar despesas</Button>
  </div>
  {notice?<p role="status">{notice}</p>:null}
  {query.isPending?<p role="status">Carregando despesas...</p>:null}
  {query.error?<p role="alert">Falha ao consultar despesas: {expenseReviewError(query.error)}</p>:null}
  {page&&!query.error?<>
   {!page.can_review?<p className="text-sm">Consulta disponível. A aprovação e a rejeição exigem administrador da empresa.</p>:null}
   <p className="text-sm">{page.total} despesas {filter==='pending'?'pendentes':'revisadas'} · página {Math.floor(offset/50)+1}</p>
   {page.rows.length===0?<p>{offset>0?'Nenhuma despesa nesta página. Volte à anterior.':'Nenhuma despesa encontrada neste filtro.'}</p>:page.rows.map(expense=><ExpenseReviewCard key={expense.id} expense={expense} canReview={page.can_review} onReview={()=>{setSelected(expense.id);setNotice('');}} onReceipt={()=>setReceipt(expense)}/>)}
   <div className="flex justify-between"><Button variant="outline" disabled={offset===0||query.isFetching} onClick={()=>setOffset(value=>Math.max(0,value-50))}>Página anterior</Button>
    <Button variant="outline" disabled={offset+50>=page.total||query.isFetching} onClick={()=>setOffset(value=>value+50)}>Próxima página</Button></div>
  </>:null}
  {selected?<ExpenseReviewDialog key={selected} expenseId={selected} onClose={()=>setSelected(null)} onConfirmed={()=>{setSelected(null);setNotice('Revisão confirmada pelo banco.');}}/>:null}
  {receipt?.receipt_url?<ExpenseReceiptDialog key={receipt.id+':'+receipt.receipt_url} tenantId={tenantId} path={receipt.receipt_url} onClose={()=>setReceipt(null)}/>:null}
 </div>;
}
