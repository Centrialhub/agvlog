import {ExpenseCostCoverage} from './ExpenseCostCoverage';
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {Button} from '@/components/ui/button';
import {FinanceAccessBoundary} from './FinanceAccessBoundary';
import {formatFinanceCents,financeError} from '@/lib/financial/ledgerContract';
import {readSettlementExpenseContext} from '@/lib/financial/settlementExpenseContextClient';
import {expenseCategories} from '@/lib/financial/expenseBatchContract';
export function SettlementExpenseContext({settlement}:{settlement:string}){
 const {currentTenant}=useTenant(),{user}=useAuth();if(!currentTenant||!user)return null;
 return <FinanceAccessBoundary><SettlementExpenseContextPanel key={`${currentTenant.id}:${user.id}:${settlement}`} tenant={currentTenant.id} actor={user.id} settlement={settlement}/></FinanceAccessBoundary>;
}
const money=(value:string|null)=>value===null?'Indeterminado':formatFinanceCents(value);
const payeeLabels={driver:'Motorista',supplier:'Fornecedor',none:'Sem complemento a pagar',unknown:'Favorecido precisa de revisão'};
const statuses:Record<string,string>={pending:'Pendente',approved:'Aprovado',paid:'Pago',cancelled:'Cancelado',overdue:'Vencido'};
export function SettlementExpenseContextPanel({tenant,actor,settlement}:{tenant:string;actor:string;settlement:string}){
 const [page,setPage]=useState(1);
 const query=useQuery({queryKey:['finance-settlement-expense-context',tenant,actor,settlement,page],queryFn:()=>readSettlementExpenseContext(tenant,settlement,page),retry:false});
 const data=query.error||query.isFetching?undefined:query.data;
 return <section aria-label="Gastos conferidos da viagem" className="rounded border p-3 space-y-3">
 <div className="flex justify-between gap-2"><h3 className="font-semibold">Gastos conferidos da viagem</h3><Button size="sm" variant="outline" disabled={query.isFetching} onClick={()=>void query.refetch()}>Atualizar gastos</Button></div>
 <p className="text-sm">O custo destes gastos compõe o acerto. O complemento já está em Contas a pagar e não cria outro crédito de reembolso no acerto ou na folha.</p>
 {query.isFetching&&<p role="status">Consultando gastos e títulos…</p>}{query.isError&&<p role="alert">Não foi possível consultar os gastos. {financeError(query.error)}</p>}
 {data&&(data.trip_id===null?<p>Este acerto não tem vínculo de viagem. Os gastos das cargas não são associados automaticamente.</p>:<>
 <dl className="grid grid-cols-2 gap-2 text-sm">{[['Custo total',data.total_cents],['Vínculos históricos com saídas',data.allocated_cents],['Complementos em títulos',data.payable_cents],['Pago dos complementos',data.paid_cents],['Complementos em aberto',data.outstanding_cents]].map(([label,value])=><div key={label}><dt>{label}</dt><dd className="font-semibold">{money(value)}</dd></div>)}</dl>
 <p className="text-xs text-muted-foreground">Totais de todos os {data.total} gastos vinculados à viagem, incluindo as outras páginas. Estes valores não confirmam conciliação bancária.</p>
 {data.needs_review_count>0&&<p role="alert">{data.needs_review_count} gasto(s) precisam de revisão antes de determinar o complemento correto.</p>}
 {data.rows.length===0?<p>Nenhum gasto conferido nesta página.</p>:<div className="space-y-2">{data.rows.map(row=><article key={row.id} className={`rounded border p-3 space-y-1 text-sm ${row.needs_review?'border-amber-600':''}`}>
 <h4 className="font-medium">{row.description}</h4><p>{expenseCategories[row.category as keyof typeof expenseCategories]||'Categoria a revisar'} · {row.occurred_on} · custo {money(row.amount_cents)}</p><p>Vinculado historicamente: {money(row.allocated_cents)}</p>{row.coverage&&<ExpenseCostCoverage coverage={row.coverage} costCents={row.amount_cents}/>}
 {row.needs_review&&<p className="font-medium">Revisão necessária</p>}{row.cost_origin&&<details><summary>Origem e alterações do custo</summary><p>Original preservado: {money(row.cost_origin.original_amount_cents)} · vigente: {money(row.cost_origin.effective_amount_cents)}</p>{row.cost_origin.history.map(event=><p key={event.id} className="border-l-2 border-amber-600 pl-2">Ajuste manual: {money(event.before_amount_cents)} para {money(event.after_amount_cents)} · {event.actor_name||'Nome não informado'} ({event.actor_id}) · {event.created_at} · motivo: {event.reason} · evento {event.id}{event.approval_reset&&' · aprovação anterior retirada'}</p>)}</details>}
 {row.payable_id?<><p>{payeeLabels[row.payee_type]}: {row.payee_name||'Não identificado'}</p><p>Título: {row.payable_id} · {statuses[row.payable_status||'']||'Status requer revisão'}</p><p>Complemento {money(row.payable_cents)} · pago {money(row.paid_cents)} · em aberto {money(row.outstanding_cents)}</p></>:<p>{payeeLabels[row.payee_type]}</p>}
 </article>)}</div>}
 <div className="flex gap-2 items-center"><Button variant="outline" disabled={page===1} onClick={()=>setPage(page-1)}>Anterior</Button><span>Página {page}</span><Button variant="outline" disabled={page*30>=data.total} onClick={()=>setPage(page+1)}>Próxima</Button></div>
 <Link className="text-primary underline text-sm" to="/payables">Consultar contas a pagar</Link>
 </>)}
 </section>;
}
