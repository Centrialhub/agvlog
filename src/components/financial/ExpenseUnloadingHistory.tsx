import type {ExpenseHistoryRow} from '@/lib/financial/expenseHistoryContract';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';

const day=(value:string)=>value.split('-').reverse().join('/');
export function ExpenseUnloadingHistory({row}:{row:Pick<ExpenseHistoryRow,'tenant_id'|'unloading_id'|'receivable_id'|'unloading_origin'|'amount_cents'|'supplier_name'>}) {
  if(!row.unloading_id||!row.receivable_id)return null;
  const origin=row.unloading_origin;
  const matches=origin?.tenant_id===row.tenant_id&&origin.charge_id===row.unloading_id&&origin.receivable_id===row.receivable_id;
  const current=matches&&origin.verified?origin.effective:null;
  return <section className="space-y-3 rounded border p-3 text-sm" aria-label="Cobrança de descarga">
    <h3 className="font-medium">Reembolso de descarga</h3>
    <p>Custo original registrado: {formatFinanceCents(row.amount_cents)} · {row.supplier_name}</p>
    {!current?<p role="status">Cobrança vigente não confirmada nesta consulta. Consulte o título antes de registrar o recebimento.</p>:<>
      <p className="font-medium">{current.status==='cancelled'?'Direito de cobrança cancelado':'Direito de cobrança vigente'}: {formatFinanceCents(current.amount_cents)} · {current.supplier_name||'Fornecedor sem nome cadastrado'}</p>
      <p>O direito de cobrança informa o valor recuperável. Baixas e saldo em aberto devem ser consultados no título.</p>
      {origin?.original&&<p>Registro original da cobrança: {formatFinanceCents(origin.original.amount_cents)} · {origin.original.supplier_name}</p>}
      {!!origin?.history.length&&<div className="space-y-3"><h4 className="font-medium">Alterações da cobrança</h4>{origin.history.map(event=><div key={event.id} className="border-l-2 pl-3">
        <p>{event.operation==='cancel_origin'?'Cancelamento':'Correção'} · Data econômica: {day(event.effective_on)}</p>
        <p>De {formatFinanceCents(event.before.amount_cents)} ({event.before.supplier_name}) para {formatFinanceCents(event.after.amount_cents)} ({event.after.supplier_name})</p>
        <p>{event.actor_name||'Responsável identificado abaixo'} · {event.reason}</p><p className="text-xs text-muted-foreground">Responsável: {event.actor_id} · Registrado em {new Date(event.created_at).toLocaleString('pt-BR')}</p>
      </div>)}</div>}
    </>}
  </section>;
}
