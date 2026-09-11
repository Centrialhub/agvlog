import {ExpenseFundingSummary} from '@/components/financial/ExpenseFundingSummary';
import {expenseCurrentCost,expenseCostMoney} from '@/lib/financial/expenseCostPresentation';
import {LegacyCostInventory} from '@/components/financial/LegacyCostInventory';
import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {useFinanceAccess} from '@/hooks/useFinanceLedger';
import {readExpenseHistory} from '@/lib/financial/ledgerClient';
import {expenseCategories} from '@/lib/financial/expenseBatchContract';
import {financeError,formatFinanceCents} from '@/lib/financial/ledgerContract';
import type {ExpenseFilters,ExpenseHistoryRow} from '@/lib/financial/expenseHistoryContract';
import {ExpenseBatchDialog} from '@/components/financial/ExpenseBatchDialog';
import {ExpenseHistoryDetail} from '@/components/financial/ExpenseHistoryDetail';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
const initial:ExpenseFilters={page:1,page_size:30,search:'',from:'',to:'',category:'',context:'',missing_receipt:false};
export default function FinanceExpenses(){
  const {currentTenant,currentRole}=useTenant(),{user}=useAuth(),access=useFinanceAccess();
  if(!currentTenant||!user)return <p>Entre e selecione a empresa.</p>;
  if(!['owner','admin','operator'].includes(currentRole||''))return <p role="alert">Acesso financeiro não permitido.</p>;
  if(access.isPending)return <p role="status">Verificando acesso…</p>;
  if(access.error)return <p role="alert">Não foi possível verificar o acesso. <Button onClick={()=>void access.refetch()}>Tentar novamente</Button></p>;
  if(!access.data)return <p role="alert">Acesso financeiro não permitido.</p>;
  return <ExpenseWorkspace key={`${currentTenant.id}:${user.id}`} tenant={currentTenant.id} actor={user.id}/>;
}
function ExpenseWorkspace({tenant,actor}:{tenant:string;actor:string}){
  const [filters,setFilters]=useState(initial),[draft,setDraft]=useState(initial),[entry,setEntry]=useState(false);
  const [selected,setSelected]=useState<ExpenseHistoryRow|null>(null),[notice,setNotice]=useState('');
  const qc=useQueryClient(),query=useQuery({queryKey:['finance-expenses',tenant,actor,filters],retry:false,queryFn:()=>readExpenseHistory(tenant,filters)});
  const page=query.isFetching||query.isError?undefined:query.data;
  const selectedRow=page?.rows.find(row=>row.id===selected?.id);
  return <div className="space-y-5"><div className="flex items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Gastos conferidos</h1>
    <p className="text-sm text-muted-foreground">Gastos registrados em lote, com categorias, comprovantes e utilização dos envios.</p></div><Button onClick={()=>setEntry(true)}>Conferir gastos em lote</Button></div>
    {notice&&<p role="status">{notice}</p>}<LegacyCostInventory tenant={tenant} actor={actor}/>
    <form className="flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();setFilters({...draft,page:1});setSelected(null);}}>
      <label className="text-sm">Buscar<Input value={draft.search} onChange={e=>setDraft({...draft,search:e.target.value})} placeholder="Gasto, prestador ou documento"/></label>
      <label className="text-sm">De<Input type="date" value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></label>
      <label className="text-sm">Até<Input type="date" value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label>
      <label className="text-sm">Categoria<select className="block h-10 rounded border bg-background px-2" value={draft.category} onChange={e=>setDraft({...draft,category:e.target.value})}>
        <option value="">Todas</option>{Object.entries(expenseCategories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label className="text-sm">Origem<select className="block h-10 rounded border bg-background px-2" value={draft.context} onChange={e=>setDraft({...draft,context:e.target.value})}>
        <option value="">Todas</option><option value="trip">Viagem</option><option value="office">Sede</option><option value="personnel">Pessoal / folha</option><option value="maintenance">Manutenção</option><option value="other">Outros</option></select></label>
      <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={draft.missing_receipt} onChange={e=>setDraft({...draft,missing_receipt:e.target.checked})}/>Sem comprovante</label>
      <Button type="submit">Filtrar</Button>
    </form>
    {query.isPending&&<p role="status">Carregando gastos…</p>}{query.error&&<p role="alert">{financeError(query.error)} <Button onClick={()=>void query.refetch()}>Atualizar</Button></p>}
    {page&&!query.error&&<><div className="grid gap-3 sm:grid-cols-4">{[['Gastos',expenseCostMoney(page.total_cents)],['Vinculado a envios',formatFinanceCents(page.allocated_cents)],
      ['Complementos gerados',expenseCostMoney(page.complement_cents)],['Sem comprovante',String(page.missing_receipt_count)]].map(([label,value])=><div key={label} className="rounded border p-4"><p className="text-sm">{label}</p><p className="text-xl font-semibold">{value}</p></div>)}</div>
      {!!page.cost_needs_review_count&&<p role="alert">{page.cost_needs_review_count} gasto(s) com origem de custo pendente de conferência. Totais afetados estão indisponíveis.</p>}
      <p className="text-xs text-muted-foreground">{page.active_count} ativo(s) e {page.cancelled_count} cancelado(s). Totais dos gastos ativos do filtro; cancelados permanecem no histórico. Complementos gerados incluem títulos que podem já ter sido pagos; consulte o status no detalhe.</p>
      <div className="flex flex-wrap gap-2">{page.categories.map(c=><span key={c.category} className="rounded bg-muted px-3 py-1 text-sm">{expenseCategories[c.category as keyof typeof expenseCategories]||c.category}: {expenseCostMoney(c.amount_cents)}</span>)}</div>
      <section aria-label="Gastos por centro de custo" className="space-y-2"><h2 className="font-semibold">Por centro de custo</h2>
        {page.gross_reserved_cents!==undefined&&<ExpenseFundingSummary historical costCents={page.total_cents} grossReservedCents={page.gross_reserved_cents} driverCustodyCents={page.driver_custody_cents??null} paymentRecoveryCents={page.payment_recovery_cents??null}/>}<p className="text-xs text-muted-foreground">Cada gasto conferido é contado uma vez. Envios e títulos de complemento não são somados novamente. Estes totais não incluem despesas registradas fora dos lotes.</p>
        {filters.cost_center&&<Button variant="outline" onClick={()=>{setFilters({...filters,cost_center:'',page:1});setDraft({...draft,cost_center:''});}}>Todos os centros</Button>}
        <div className="flex flex-wrap gap-2">{(page.cost_centers||[]).map(center=><Button key={center.cost_center_id||'unassigned'} variant="outline" onClick={()=>{
          const cost_center=center.cost_center_id||'unassigned';setFilters({...filters,cost_center,page:1});setDraft({...draft,cost_center});setSelected(null);
        }}>{center.cost_center_name||'Sem centro de custo'}: {expenseCostMoney(center.amount_cents)} · {center.item_count} gasto(s)</Button>)}</div>
      </section>
      <div className="rounded border"><Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Gasto / prestador</TableHead><TableHead>Categoria</TableHead><TableHead>Comprovante</TableHead><TableHead className="text-right">Valor vigente / histórico</TableHead><TableHead>Revisão</TableHead></TableRow></TableHeader>
        <TableBody>{page.rows.map(row=><TableRow key={row.id}><TableCell>{row.occurred_on.split('-').reverse().join('/')}</TableCell><TableCell><p>{row.description}</p>{row.cancelled&&<p className="text-amber-700">Cancelado — excluído dos totais ativos</p>}<p className="text-xs text-muted-foreground">{row.supplier_name}</p></TableCell>
          <TableCell>{expenseCategories[row.category as keyof typeof expenseCategories]||row.category}</TableCell><TableCell>{row.receipt_path?'Anexado':(row.receipt_artifact_count??0)>0?'Anexado posteriormente':row.no_receipt_reason?'Ausente — justificado':'Ausente — sem justificativa'}</TableCell><TableCell className="text-right">{expenseCostMoney(expenseCurrentCost(row))}{!!row.cost_origin?.history.length&&<p className="text-xs text-amber-700">Retificado · original {formatFinanceCents(row.amount_cents)}</p>}</TableCell>
          <TableCell><Button variant="ghost" aria-label={`Detalhar ${row.description}`} onClick={()=>setSelected(row)}>Detalhar</Button></TableCell></TableRow>)}
          {!page.rows.length&&<TableRow><TableCell colSpan={6} className="py-8 text-center">Nenhum gasto neste filtro.</TableCell></TableRow>}</TableBody></Table></div>
      <div className="flex items-center justify-between"><Button variant="outline" disabled={filters.page===1||query.isFetching} onClick={()=>setFilters({...filters,page:filters.page-1})}>Anterior</Button>
        <span>Página {page.page} de {Math.max(1,Math.ceil(page.total/page.page_size))}</span><Button variant="outline" disabled={page.page*page.page_size>=page.total||query.isFetching} onClick={()=>setFilters({...filters,page:filters.page+1})}>Próxima</Button></div>
    </>}
    {selected&&<ExpenseHistoryDetail actor={actor} row={selectedRow||selected} currentUnavailable={!selectedRow} onClose={()=>setSelected(null)}/>}
    {entry&&<ExpenseBatchDialog tenant={tenant} actor={actor} onClose={()=>setEntry(false)} onRecorded={()=>{
      setEntry(false);setNotice('Lote registrado. Os gastos e vínculos estão disponíveis para revisão.');
      void qc.invalidateQueries({queryKey:['finance-recorded-costs',tenant,actor]});
      void qc.invalidateQueries({queryKey:['finance-legacy-cost-context',tenant,actor]});
      void qc.invalidateQueries({queryKey:['finance-maintenance-labor-context',tenant,actor]});
      void qc.invalidateQueries({queryKey:['finance-maintenance-direct-part-context',tenant,actor]});
      void qc.invalidateQueries({queryKey:['finance-stock-acquisition-context',tenant,actor]});
      void qc.invalidateQueries({queryKey:['finance-stock-cost-inventory',tenant,actor]});
      void qc.invalidateQueries({queryKey:['finance-legacy-cost-inventory',tenant,actor]});
      void qc.invalidateQueries({queryKey:['finance-recorded-cost-summary',tenant,actor]});
      void qc.invalidateQueries({queryKey:['finance-expenses',tenant,actor]});void qc.invalidateQueries({queryKey:['finance-options',tenant,actor]});
      void qc.invalidateQueries({queryKey:['payables']});void qc.invalidateQueries({queryKey:['receivables']});
      void qc.invalidateQueries({queryKey:['finance-settlement-expense-context',tenant]});
      void qc.invalidateQueries({queryKey:['driver_settlement']});void qc.invalidateQueries({queryKey:['driver_settlements']});
    }}/>}
  </div>;
}
