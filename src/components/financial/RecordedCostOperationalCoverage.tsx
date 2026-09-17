import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
import {readRecordedCostOperationalCoverage} from '@/lib/financial/recordedCostOperationalCoverageClient';
const label=(covered:number,pending:number)=>`${covered} comprovado(s) · ${pending} pendente(s)`;
export function RecordedCostOperationalCoverage({tenant,actor,from,to}:{tenant:string;actor:string;from:string;to:string}){
 const query=useQuery({queryKey:['finance-recorded-cost-operational-coverage',tenant,actor,from,to],queryFn:()=>readRecordedCostOperationalCoverage(tenant,from,to),retry:false}),data=query.isFetching||query.isError?undefined:query.data;
 return <section className="rounded border p-3 space-y-2 text-sm" aria-label="Cobertura operacional dos custos registrados"><h3 className="font-semibold">Manutenção e custos operacionais comprováveis</h3>
  <p>As associações auditadas identificam quais fontes operacionais já estão representadas nos custos registrados. Estes valores são informativos e nunca são somados novamente ao total.</p>
  {query.isFetching&&<p role="status">Conferindo cobertura operacional…</p>}{query.isError&&<p role="alert">Não foi possível conferir a cobertura operacional. <Button variant="link" onClick={()=>void query.refetch()}>Tentar novamente</Button></p>}
  {data&&<><p><strong>{data.recognized_cost_cents===null?'Valor a revisar':formatFinanceCents(data.recognized_cost_cents)}</strong> em {data.recognized_cost_count} custo(s) canônico(s) já incluído(s), com {data.double_counted_cents} centavo adicional.</p>
   {data.recognized_cost_needs_review_count>0&&<p role="alert">{data.recognized_cost_needs_review_count} associação(ões) apontam para custo cancelado, ausente ou sem versão efetiva comprovada.</p>}
   <div className="grid gap-1 md:grid-cols-2"><p>Mão de obra: {label(data.maintenance.labor.covered_count,data.maintenance.labor.pending_count)}</p><p>Peças compradas diretamente: {label(data.maintenance.direct_parts.covered_count,data.maintenance.direct_parts.pending_count)}</p><p>Compras de estoque: {label(data.maintenance.stock_acquisitions.covered_count,data.maintenance.stock_acquisitions.pending_count)}</p><p>Consumo de estoque: {label(data.maintenance.stock_consumptions.covered_count,data.maintenance.stock_consumptions.pending_count)}</p><p>Despesas antigas de motorista: {label(data.legacy_driver_expenses.covered_count,data.legacy_driver_expenses.pending_count)}</p><p>Ordens com composição ambígua: {data.maintenance.ambiguous_order_count}</p></div>
   <p>O consumo atribuído corresponde a {formatFinanceCents(data.maintenance.stock_consumptions.attributed_cents)} de compras já registradas; não é um novo gasto.</p>
   {data.review_pending_count>0&&<p role="alert">{data.review_pending_count} pendência(s) exigem associação ou decisão humana e, por isso, não recebem valor presumido.</p>}
   <p>Esta cobertura segue apenas o período. Busca, categoria e centro de custo não ocultam pendências cuja origem ainda não foi classificada.</p>
   <Button variant="outline" disabled={query.isFetching} onClick={()=>void query.refetch()}>Atualizar cobertura operacional</Button>
  </>}
 </section>;
}
