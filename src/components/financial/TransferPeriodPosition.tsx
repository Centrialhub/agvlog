import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {readTransferPeriod} from '@/lib/financial/ledgerClient';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
import {transferPeriodLabels} from '@/lib/financial/transferPeriodContract';
export function TransferPeriodPosition({tenant,actor,account,cutoff}:{tenant:string;actor:string;account:string;cutoff:string}){
 const [page,setPage]=useState(1);
 const query=useQuery({queryKey:['finance-transfer-period',tenant,actor,account,cutoff,page],retry:false,queryFn:()=>readTransferPeriod(tenant,account,cutoff,page)}),data=query.error?undefined:query.data;
 return <section aria-label="Transferências na data de corte" className="space-y-2 rounded border p-3"><h3 className="font-semibold">Transferências em {cutoff.split('-').reverse().join('/')}</h3>
  {query.isPending&&<p role="status">Conferindo transferências na data de corte…</p>}{query.error&&<div role="alert"><p>Não foi possível conferir as transferências nesta data.</p><Button variant="outline" onClick={()=>void query.refetch()}>Tentar novamente</Button></div>}
  {data&&<><p>Saídas desta conta ainda em trânsito: {formatFinanceCents(data.outbound_transit_cents)}.</p><p>Valores em trânsito para esta conta: {formatFinanceCents(data.inbound_transit_cents)}.</p>
   <p className="text-sm">Posição pelas datas informadas nos registros atuais. Não é um fechamento congelado nem confirmação bancária. Os valores aguardando chegada não são saldo disponível no destino.</p>
   {data.unlinked_count>0&&<p role="alert">{data.unlinked_count} registro(s) de transferência sem contraparte identificada precisam de revisão; não compõem os valores em trânsito acima.</p>}
   {data.rows.map(row=><article key={row.movement_id} className="rounded border p-2 text-sm"><p>{row.source_name||'Origem não identificada'} → {row.destination_name||'Destino não identificado'} · {formatFinanceCents(row.amount_cents)}</p><p>{transferPeriodLabels[row.status]}</p><p>Registro: {row.occurred_on.split('-').reverse().join('/')}{row.arrived_on&&row.status==='arrived_after_cutoff'?` · Chegada: ${row.arrived_on.split('-').reverse().join('/')}`:''}</p></article>)}
   {!data.total&&<p>Nenhuma pendência de transferência identificada nesta data.</p>}
   {(data.total>20||page>1)&&<div className="flex justify-between"><Button variant="outline" disabled={page===1||query.isFetching} onClick={()=>setPage(page-1)}>Anteriores</Button><span>Página {page}</span><Button variant="outline" disabled={page*20>=data.total||query.isFetching} onClick={()=>setPage(page+1)}>Próximas</Button></div>}
  </>}
 </section>;
}
