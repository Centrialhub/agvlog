import {useId,useState} from 'react';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {useDriverExpenseHistory,useDriverExpenseSources} from '@/hooks/useDriverExpenseHistory';
import {ExpenseCreationForm} from '@/components/financial/ExpenseCreationForm';
import {ExpenseReceiptDialog} from '@/components/financial/ExpenseReceiptDialog';
import {Button} from '@/components/ui/button';
import {Card,CardContent} from '@/components/ui/card';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {ListFilterBar} from '@/components/ui/list-filter-bar';
import {matchesSearch} from '@/lib/listFilters';
import {creationError} from '@/lib/financial/expenseCreationCommands';
import {expenseAmount,expenseCategoryLabels,expensePaymentLabels} from '@/lib/financial/expenseReviewCommands';
const statusLabels:Record<string,string>={pending:'Pendente',approved:'Aprovada',rejected:'Rejeitada'};
const tripLabels:Record<string,string>={planned:'Planejada',in_transit:'Em trânsito',completed:'Concluída'};
export default function DriverExpenses(){
 const {currentTenant}=useTenant(),{user}=useAuth();
 return currentTenant&&user?<ScopedExpenses key={currentTenant.id+':'+user.id} tenant={currentTenant.id}/>:<p>Entre e selecione a empresa.</p>;
}
function ScopedExpenses({tenant}:{tenant:string}){
 const [offset,setOffset]=useState(0),[sourceOffset,setSourceOffset]=useState(0),[open,setOpen]=useState(false),[source,setSource]=useState(''),[receipt,setReceipt]=useState<string>();
 const [search,setSearch]=useState(''),[status,setStatus]=useState('all'),[category,setCategory]=useState('all'),[message,setMessage]=useState('');
 const query=useDriverExpenseHistory(offset),sources=useDriverExpenseSources(sourceOffset,open),selectId=useId();
 const rows=query.data?.rows??[],shown=rows.filter(e=>matchesSearch(search,e.notes,e.supplier_name,e.document_number,e.review_reason)&&(status==='all'||e.approval_status===status)&&(category==='all'||e.category===category));
 return <div className="space-y-4">
  <div className="flex justify-between"><h1 className="text-lg font-bold">Despesas</h1><Button onClick={()=>{setOpen(true);setSource('');}}>Nova despesa</Button></div>
  {message?<p role="status">{message}</p>:null}
  <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto"><DialogHeader><DialogTitle>Nova despesa</DialogTitle><DialogDescription>Escolha a viagem e confira o gasto antes de registrar.</DialogDescription></DialogHeader>
   {sources.isPending?<p role="status">Carregando viagens...</p>:sources.error?<p role="alert">{creationError(sources.error)}</p>:<>
    <label htmlFor={selectId}>Viagem da despesa</label><select id={selectId} className="w-full rounded border p-2" value={source} onChange={e=>setSource(e.target.value)}>
     <option value="">Selecione a viagem</option>{sources.data?.rows.map(t=><option key={t.id} value={t.id}>{tripLabels[t.status]} · {t.id.slice(0,8)} · {t.notes||new Date(t.created_at).toLocaleDateString('pt-BR')}</option>)}
    </select><p>{sources.data?.total??0} viagens disponíveis · página {sourceOffset/50+1}</p></>}
   <div className="flex gap-2"><Button variant="outline" disabled={sources.isFetching||sourceOffset===0} onClick={()=>{setSource('');setSourceOffset(n=>n-50);}}>Viagens anteriores</Button>
    <Button variant="outline" disabled={sources.isFetching||!sources.data||sourceOffset+50>=sources.data.total} onClick={()=>{setSource('');setSourceOffset(n=>n+50);}}>Mais viagens</Button>
    {sources.error?<Button variant="outline" onClick={()=>void sources.refetch()}>Consultar viagens novamente</Button>:null}</div>
   {source?<ExpenseCreationForm sourceType="trip" sourceId={source} onConfirmed={()=>{setOpen(false);setMessage('Despesa registrada e aguardando aprovação.');}}/>:null}
  </DialogContent></Dialog>
  <ListFilterBar activeCount={Number(!!search)+Number(status!=='all')+Number(category!=='all')} onReset={()=>{setSearch('');setStatus('all');setCategory('all');}} resultCount={shown.length} totalCount={rows.length} loading={query.isPending}
   description="Filtros aplicados à página atual. Use a paginação para consultar despesas anteriores." fields={[
    {key:'search',label:'Buscar despesa',type:'search',value:search,onChange:setSearch,placeholder:'Fornecedor, documento, observação ou motivo'},
    {key:'approval',label:'Aprovação',value:status,onChange:setStatus,options:[{value:'all',label:'Todas as situações'},...Object.entries(statusLabels).map(([value,label])=>({value,label}))]},
    {key:'category',label:'Categoria da despesa',value:category,onChange:setCategory,options:[{value:'all',label:'Todas as categorias'},...Object.entries(expenseCategoryLabels).map(([value,label])=>({value,label}))]},
   ]}/>
  {query.isPending?<p role="status">Carregando despesas...</p>:query.error?<div role="alert"><p>Falha ao consultar despesas: {creationError(query.error)}</p><Button onClick={()=>void query.refetch()}>Tentar novamente</Button></div>:<>
   <p>{query.data?.total??0} despesas · página {offset/50+1}</p>
   {!shown.length?<p>Nenhuma despesa encontrada nesta página para os filtros selecionados.</p>:shown.map(e=><Card key={e.id}><CardContent className="space-y-1 p-3">
    <div className="flex justify-between"><h2 className="font-medium">{expenseCategoryLabels[e.category]||e.category}</h2><strong>{expenseAmount(e.amount)}</strong></div>
    <p>{statusLabels[e.approval_status]||e.approval_status} · {new Date(e.expense_at).toLocaleString('pt-BR')}</p>
    <p>{e.dispatch_trip_id?'Viagem '+e.dispatch_trip_id.slice(0,8):'Acerto manual'} · {expensePaymentLabels[e.payment_source]||e.payment_source}</p>
    {e.notes?<p>{e.notes}</p>:null}{e.supplier_name?<p>Fornecedor: {e.supplier_name}</p>:null}
    {e.review_reason?<p>Motivo da revisão: {e.review_reason}</p>:null}
    {e.receipt_url?<Button variant="outline" onClick={()=>setReceipt(e.receipt_url!)}>Ver comprovante</Button>:<p>Sem comprovante: {e.no_receipt_reason||'Ausência não justificada no registro legado'}</p>}
   </CardContent></Card>)}
   <div className="flex gap-2"><Button variant="outline" disabled={offset===0||query.isFetching} onClick={()=>setOffset(n=>n-50)}>Página anterior</Button><Button variant="outline" disabled={!query.data||offset+50>=query.data.total||query.isFetching} onClick={()=>setOffset(n=>n+50)}>Próxima página</Button></div>
  </>}
  {receipt?<ExpenseReceiptDialog tenantId={tenant} path={receipt} onClose={()=>setReceipt(undefined)}/>:null}
 </div>;
}
