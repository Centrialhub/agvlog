import {ManualExpenseCancellationReview} from './ManualExpenseCancellationReview';
import {ExpenseCancellationReview} from './ExpenseCancellationReview';
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {readRecordedCosts} from '@/lib/financial/ledgerClient';
import type {RecordedCostFilters} from '@/lib/financial/recordedCostsContract';
import {formatFinanceCents,financeError} from '@/lib/financial/ledgerContract';
import {expenseCategories} from '@/lib/financial/expenseBatchContract';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
const initial:RecordedCostFilters={page:1,from:'',to:'',search:'',cost_center:'',category:''};
export function RecordedCosts({tenant,actor}:{tenant:string;actor:string}){
 const [filters,setFilters]=useState(initial),[draft,setDraft]=useState(initial);
 const query=useQuery({queryKey:['finance-recorded-costs',tenant,actor,filters],retry:false,queryFn:()=>readRecordedCosts(tenant,filters)}),data=query.data;
 const center=(value:string)=>{setFilters({...filters,cost_center:value,page:1});setDraft({...draft,cost_center:value});};
 return <section className="space-y-4"><h2 className="text-xl font-semibold">Custos registrados</h2>
  <p className="text-sm">Gastos em lote e despesas avulsas do novo financeiro. Envios, pagamentos e títulos complementares não são somados novamente. Remuneração da folha aprovada inclui salário, diárias, horas, comissões e bônus. Outros créditos da folha precisam de classificação; manutenção e registros antigos fora desses fluxos ainda precisam de integração.</p>
  <form className="flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();setFilters({...draft,page:1});}}>
   <label>Buscar<Input value={draft.search} maxLength={200} onChange={e=>setDraft({...draft,search:e.target.value})}/></label>
   <label>De<Input type="date" value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></label>
   <label>Até<Input type="date" min={draft.from||undefined} value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label>
   <Button type="submit">Filtrar custos</Button><Button type="button" variant="outline" onClick={()=>{setDraft(initial);setFilters(initial);}}>Limpar filtros</Button>
  </form>
  {query.isPending&&<p role="status">Carregando custos…</p>}{query.error&&<p role="alert">{financeError(query.error)} <Button onClick={()=>void query.refetch()}>Tentar novamente</Button></p>}
  {data&&!query.error&&<><p className="text-2xl font-semibold">{formatFinanceCents(data.total_cents)}</p><p>{data.total} registro(s) no filtro · {data.cancelled_count} cancelado(s), excluído(s) do total</p>
   {data.needs_review_count>0&&<p role="alert">{data.needs_review_count} despesa(s) com valor alterado no título. O total preserva o valor original do gasto; revise as divergências.</p>}
   {data.recorded_date_count>0&&<p>{data.recorded_date_count} despesa(s) sem competência informada usam a data do registro.</p>}
   {data.payroll_unclassified_count>0&&<p role="alert">No período, {data.payroll_unclassified_count} crédito(s) da folha, somando {formatFinanceCents(data.payroll_unclassified_cents)}, aguardam classificação por origem e não entram neste total. Essa pendência considera todos os centros e categorias do período.</p>}
   {filters.cost_center&&<Button variant="outline" onClick={()=>center('')}>Todos os centros</Button>}
   <div className="flex flex-wrap gap-2">{data.cost_centers.map(c=><Button key={c.cost_center_id||'unassigned'} variant="outline" onClick={()=>center(c.cost_center_id||'unassigned')}>{c.cost_center_name||'Sem centro de custo'}: {formatFinanceCents(c.amount_cents)}</Button>)}</div>
   <div className="flex flex-wrap gap-2">{data.categories.map(c=><span key={c.category}>{expenseCategories[c.category as keyof typeof expenseCategories]||c.category}: {formatFinanceCents(c.amount_cents)}</span>)}</div>
   <Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Gasto / fornecedor</TableHead><TableHead>Origem</TableHead><TableHead>Centro de custo</TableHead><TableHead>Valor original</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader><TableBody>
   {data.rows.map(row=><TableRow key={`${row.source}:${row.id}`}><TableCell>{row.occurred_on.split('-').reverse().join('/')}<p className="text-xs">{row.date_basis==='recorded_date'?'Data do registro':row.date_basis==='payroll_period'?'Início da folha':row.date_basis==='competence_date'?'Competência':'Data do gasto'}</p></TableCell><TableCell>{row.description}<p>{row.supplier_name}</p></TableCell><TableCell>{row.source==='manual_expense'?'Despesa avulsa':row.source==='payroll_item'?'Remuneração da folha':'Gasto em lote'}</TableCell><TableCell>{row.cost_center_name||'Não informado'}</TableCell><TableCell>{formatFinanceCents(row.amount_cents)}</TableCell><TableCell>{row.cancelled?'Cancelado — excluído do total':'Incluído'}{row.needs_review&&<p>Valor do título divergente</p>}{row.source==='expense_batch'&&<ExpenseCancellationReview tenant={tenant} actor={actor} expenseId={row.id}/>}{row.source==='manual_expense'&&<ManualExpenseCancellationReview tenant={tenant} actor={actor} payableId={row.id}/>}</TableCell></TableRow>)}
   {!data.rows.length&&<TableRow><TableCell colSpan={6}>Nenhum custo neste filtro.</TableCell></TableRow>}</TableBody></Table>
   <div className="flex items-center justify-between"><Button variant="outline" disabled={filters.page===1||query.isFetching} onClick={()=>setFilters({...filters,page:filters.page-1})}>Anterior</Button><span>Página {data.page} de {Math.max(1,Math.ceil(data.total/30))}</span><Button variant="outline" disabled={data.page*30>=data.total||query.isFetching} onClick={()=>setFilters({...filters,page:filters.page+1})}>Próxima</Button></div>
  </>}
 </section>;
}
