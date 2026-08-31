import {Button} from '@/components/ui/button';
import {useClosingSourcePreview} from '@/hooks/useClosingSourcePreview';
import type {FreightAllocation} from '@/lib/closingReports/closingReportBuilder';
import type {ClosingAttemptPreview} from '@/lib/closingReports/closingAttemptPreview';
const money=(value:number)=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const outcomeLabels:Record<string,string>={delivered:'Entregue',partial_delivery:'Entrega parcial',returned:'Devolvida',refused:'Recusada',
 failed:'Falha na entrega',cancelled:'Cancelada',not_delivered:'Não entregue'};
export function ClosingAttemptPreviewPanel({filters,allocation='per_nf',onlyWithCte=false}:{filters:unknown;allocation?:FreightAllocation;onlyWithCte?:boolean}){
 const query=useClosingSourcePreview(filters,{allocation,onlyWithCte});const preview=query.data;
 if(query.contextError)return <p role="alert">{query.contextError}</p>;
 if(query.error)return <div role="alert">{query.error.message}<Button onClick={()=>void query.refetch()}>Consultar novamente</Button></div>;
 if(!preview)return <p role="status">Consultando tentativas e origens fiscais…</p>;
 return <ClosingAttemptPreviewView preview={preview} isFetching={query.isFetching} onRefresh={()=>void query.refetch()}/>;
}
export function ClosingAttemptPreviewView({preview,isFetching=false,onRefresh}:{preview:ClosingAttemptPreview;isFetching?:boolean;onRefresh:()=>void}){
 return <section aria-label="Prévia por tentativa de entrega" className="space-y-3">
  <p>Prévia de conferência. Não cria relatório, não fatura e não registra pagamento.</p>
  <p role="status">{preview.totals.attempt_count} tentativa(s), {preview.totals.fiscal_document_count} nota(s) distinta(s).</p>
  <p>Valor das notas distintas: {money(preview.totals.total_invoice_value)}. Frete das tentativas: {money(preview.totals.total_freight_value)}.</p>
  {preview.financial_review_required?<p role="alert">Há origens que exigem revisão financeira. Valores não confirmados não foram herdados ou rateados.</p>:null}
  <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Contexto e valores de cada tentativa</caption>
   <thead><tr>{['Nota','Carga','Tentativa','Resultado auditado','Data do resultado','Peso','Volumes','Frete'].map(label=><th key={label} scope="col" className="p-2 text-left">{label}</th>)}</tr></thead>
   <tbody>{preview.items.map(item=><tr key={item.metadata.source_key}>
    <th scope="row" className="p-2">{item.invoice_number||'Sem número'}</th><td className="p-2">{item.load_number||'Sem carga'}</td>
    <td className="p-2">{item.metadata.attempt_id?'Reentrega '+item.metadata.attempt_id:'Original'}{item.metadata.historical?' · histórica':''}</td>
    <td className="p-2">{item.delivery_status?outcomeLabels[item.delivery_status]||item.delivery_status:'Sem resultado auditado'}</td>
    <td className="p-2">{item.metadata.occurred_at?new Date(item.metadata.occurred_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Não registrada'}</td>
    <td className="p-2">{item.weight_kg.toLocaleString('pt-BR')} kg{item.metadata.physical_source==='reserved_attempt'?' · saldo reservado':''}</td>
    <td className="p-2">{item.metadata.volume_count_verified?item.volume_count.toLocaleString('pt-BR'):'Não confirmados'}</td>
    <td className="p-2">{money(item.freight_value)}{item.metadata.financial_review_required?' · revisar':''}</td>
   </tr>)}</tbody>
  </table></div>
  {!preview.items.length?<p>Nenhuma tentativa corresponde aos filtros.</p>:null}
  {preview.divergences.length?<details><summary>Conferir {preview.divergences.length} aviso(s)</summary><ul>
   {preview.divergences.map((warning,index)=><li key={warning.code+':'+index}>{warning.invoice_number?'Nota '+warning.invoice_number+': ':''}{warning.description}</li>)}
  </ul></details>:null}
  <Button disabled={isFetching} onClick={onRefresh}>Atualizar prévia</Button>
 </section>;
}
