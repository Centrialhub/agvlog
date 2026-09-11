import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {readLegacyInventory,type LegacyInventoryRow} from '@/lib/financial/legacyInventoryClient';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
import {LegacyPayableAssociation} from './LegacyPayableAssociation';
import {LegacyReceivableAssociation} from './LegacyReceivableAssociation';
import {LegacyUnresolvedInventory} from './LegacyUnresolvedInventory';
const sources:Record<string,string>={receivables_payments:'Recebimento',receivable_payment_reversals:'Devolução de recebimento',payables_payments:'Pagamento de título',driver_settlement_payments:'Pagamento de acerto',closing_report_payments:'Recebimento de fechamento',load_payments:'Recebimento de carga',employee_advances:'Adiantamento de funcionário',bank_transactions:'Registro bancário antigo',payroll_entry_items:'Crédito já pago na folha'};
const reasons:Record<string,string>={paid_advance_payment_evidence_incomplete:'Adiantamento marcado como pago, mas os pagamentos vinculados não explicam o valor integral. Confira a origem antes de identificar a saída.',already_paid_without_exact_money_source:'Crédito da folha marcado como já pago, sem identificação exata da movimentação de origem.',receipt_without_canonical_link:'Recebimento sem vínculo com o registro financeiro atual.',refund_without_canonical_link:'Devolução sem vínculo com o registro financeiro atual.',payable_payment_without_mapping:'Pagamento sem associação ao registro financeiro atual.',settlement_without_active_link_account_unresolved:'Pagamento de acerto sem vínculo ativo; a conta precisa ser identificada.',closing_payment_without_payment_id:'Recebimento do fechamento sem identificação do recebimento correspondente.',load_payment_without_payment_id:'Recebimento da carga sem identificação do recebimento correspondente.',paid_advance_without_payment_account_unresolved:'Adiantamento marcado como pago, sem pagamento e conta identificados.',legacy_bank_row_requires_source_classification:'É necessário identificar se este registro veio do extrato ou de uma baixa antiga.'};
export function LegacyAdoptionInventory({tenant,actor,account,from,to,includeUnresolved=true}:{tenant:string;actor:string;account:string;from:string;to:string;includeUnresolved?:boolean}){
 const [open,setOpen]=useState(false),[page,setPage]=useState(1),[notice,setNotice]=useState('');
 const cache=useQueryClient();
 const query=useQuery({queryKey:['finance-legacy-inventory',tenant,actor,account,from,to,page],queryFn:()=>readLegacyInventory(tenant,account,from,to,page),enabled:open,retry:false});
 const data=query.isFetching||query.error?undefined:query.data;
 const associationRecorded=()=>{setNotice('Associação atualizada. O registro original e o dinheiro foram preservados.');void cache.invalidateQueries({queryKey:['finance-legacy-integrity-inventory',tenant,actor]});void query.refetch();};
 return <section aria-label="Pendências dos registros antigos" className="space-y-3 rounded border p-3"><h3 className="font-medium">Pendências dos registros antigos</h3>
 {!open?<Button variant="outline" onClick={()=>setOpen(true)}>Consultar registros antigos</Button>:<>
  <p>Esta consulta identifica registros que precisam ser conferidos antes da incorporação ao financeiro. Nenhum valor é lançado ou considerado conciliado aqui.</p>
  <Button variant="outline" disabled={query.isFetching} onClick={()=>void query.refetch()}>Atualizar pendências antigas</Button>
  {notice&&<p role="status">{notice}</p>}
  {query.isFetching&&<p role="status">Consultando registros antigos…</p>}{query.error&&<p role="alert">Não foi possível consultar os registros antigos. Atualize a consulta.</p>}
  {data&&<><h4 className="font-medium">Desta conta: {data.total} registro(s) a conferir</h4><Rows rows={data.rows} tenant={tenant} actor={actor} onRecorded={associationRecorded}/>
   <h4 className="font-medium">Sem conta identificada: {data.unknown_account.total} registro(s) na empresa</h4>
   <p className="rounded border border-amber-600 p-2">A lista sem conta é compartilhada por todas as contas da empresa neste período. Não some esses registros novamente ao consultar outra conta.</p><Rows rows={data.unknown_account.rows} tenant={tenant} actor={actor} onRecorded={associationRecorded}/>
   <p>Os valores são declarações históricas, podem descrever o mesmo dinheiro e não devem ser somados. Uma lista vazia não comprova que todos os registros antigos foram incorporados nem libera o fechamento.</p>
   <div className="flex items-center gap-3"><Button variant="outline" disabled={page===1} onClick={()=>setPage(page-1)}>Pendências anteriores</Button><span>Página {page} · até 30 registros de cada lista</span><Button variant="outline" disabled={page*30>=Math.max(data.total,data.unknown_account.total)} onClick={()=>setPage(page+1)}>Próximas pendências</Button></div>
  </>}
 </>}
 {includeUnresolved&&<LegacyUnresolvedInventory tenant={tenant} actor={actor}/>}
 </section>;
}
function Rows({rows,tenant,actor,onRecorded}:{rows:LegacyInventoryRow[];tenant:string;actor:string;onRecorded:()=>void}){return rows.length?<ul className="space-y-2">{rows.map(row=><li key={`${row.source_table}:${row.source_id}`} className="rounded border p-2"><p className="font-medium">{sources[row.source_table]||'Registro antigo'} · {row.occurred_on} · {row.direction==='in'?'Entrada declarada':row.direction==='out'?'Saída declarada':'Direção a esclarecer'}</p><p>{row.amount_cents===null?'Valor a esclarecer':formatFinanceCents(row.amount_cents)}</p><p>{reasons[row.reason]||'Origem e vínculos precisam de conferência.'}</p><details><summary>Identificação para rastreio</summary><p>Registro: {row.source_id}</p>{row.bank_transaction_id&&<p>Registro bancário: {row.bank_transaction_id}</p>}</details>{row.source_table==='payables_payments'&&<LegacyPayableAssociation tenant={tenant} actor={actor} payment={row.source_id} onRecorded={onRecorded}/>}{row.source_table==='receivables_payments'&&<LegacyReceivableAssociation tenant={tenant} actor={actor} payment={row.source_id} onRecorded={onRecorded}/>}</li>)}</ul>:<p>Nenhum registro nesta página.</p>;}
