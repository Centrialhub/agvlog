import {useState} from 'react';
import type {ExpenseHistoryRow} from '@/lib/financial/expenseHistoryContract';
import {expenseCurrentCost,expenseCostMoney} from '@/lib/financial/expenseCostPresentation';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
import {Button} from '@/components/ui/button';
export function ExpenseCostHistory({row}:{row:ExpenseHistoryRow}){
  const [page,setPage]=useState(1);
  const amount=expenseCurrentCost(row),origin=row.cost_origin;
  const matches=origin?.tenant_id===row.tenant_id&&origin.expense_id===row.id&&origin.charge_id===row.unloading_id&&origin.payable_id===row.payable_id;
  return <section aria-label="Valor e alterações do custo" className="space-y-2 rounded border p-3 text-sm">
    <h3 className="font-medium">{row.cancelled?'Custo antes do cancelamento':'Custo vigente registrado'}: {expenseCostMoney(amount)}</h3>
    {row.cancelled&&<p>Gasto cancelado, excluído dos totais ativos. O valor acima permanece no histórico.</p>}
    {amount===null&&<p role="alert">Não foi possível confirmar o custo vigente. O valor original não substitui a conferência pendente.</p>}
    <p>Valor original preservado: {formatFinanceCents(row.amount_cents)}. Correções do custo não representam novos envios nem alteram automaticamente a cobrança.</p>
    {matches&&!!origin?.history.length&&<>
      <h4 className="font-medium">Retificações manuais do custo ({origin.history.length})</h4>
      {origin.history.slice((page-1)*20,page*20).map(event=><article key={event.id} className="rounded border border-amber-600 p-3">
        <p>De {formatFinanceCents(event.before_amount_cents)} para {formatFinanceCents(event.after_amount_cents)}</p>
        <p>{event.actor_name||'Responsável identificado abaixo'} · {new Date(event.created_at).toLocaleString('pt-BR')}</p>
        <p>Responsável: {event.actor_id}</p><p>Motivo: {event.reason}</p>
        {event.approval_reset&&<p>A aprovação anterior foi retirada; a obrigação voltou para pendente de aprovação.</p>}
        <p className="text-xs text-muted-foreground">Evento {event.id} · pedido {event.request_id}</p>
      </article>)}
      {origin.history.length>20&&<div className="flex gap-2"><Button variant="outline" disabled={page===1} onClick={()=>setPage(page-1)}>Retificações anteriores</Button><Button variant="outline" disabled={page*20>=origin.history.length} onClick={()=>setPage(page+1)}>Próximas retificações</Button></div>}
    </>}
  </section>;
}
