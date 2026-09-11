import {invalidateAccountReview} from '@/lib/financial/invalidateAccountReview';
import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {readPendingTransfers} from '@/lib/financial/ledgerClient';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
import type {PendingTransfer} from '@/lib/financial/transferStageContract';
import {TransferStageDialog} from './TransferStageDialog';
export function PendingTransfers({tenant,actor}:{tenant:string;actor:string}){
 const [open,setOpen]=useState(false),[page,setPage]=useState(1);
 const [dialog,setDialog]=useState<{mode:'depart'|'arrive'|'recover';departure?:PendingTransfer}|null>(null),qc=useQueryClient();
 const query=useQuery({queryKey:['finance-pending-transfers',tenant,actor,page],enabled:open,retry:false,queryFn:()=>readPendingTransfers(tenant,page)}),data=query.error?undefined:query.data;
 if(!open)return <Button variant="outline" onClick={()=>setOpen(true)}>Transferências em trânsito</Button>;
 return <section aria-label="Transferências em trânsito" className="space-y-3 rounded border p-4"><h2 className="font-semibold">Transferências em trânsito</h2>
  <p>Saídas registradas que ainda aguardam o registro da entrada. O valor pendente não é saldo disponível na conta de destino.</p>
  <div className="flex flex-wrap gap-2"><Button onClick={()=>setDialog({mode:'depart'})}>Registrar saída em trânsito</Button><Button variant="outline" onClick={()=>setDialog({mode:'recover'})}>Retomar etapa anterior</Button><Button variant="ghost" disabled={query.isFetching} onClick={()=>void query.refetch()}>Atualizar pendências</Button></div>
  {query.isPending&&<p role="status">Carregando transferências pendentes…</p>}{query.error&&<p role="alert">Não foi possível consultar as transferências pendentes.</p>}
  {data&&<><p>{data.total} transferência(s) · {formatFinanceCents(data.amount_cents)} aguardando registro de chegada</p>
   {data.rows.map(row=><article key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"><div><p>{row.source_name} → {row.destination_name} · {formatFinanceCents(row.amount_cents)}</p><p className="text-sm">Saída em {row.occurred_on.split('-').reverse().join('/')} · {row.bank_reference||'Referência não informada'}</p></div><Button variant="outline" onClick={()=>setDialog({mode:'arrive',departure:row})}>Registrar chegada</Button></article>)}
   {!data.rows.length&&<p>Nenhuma transferência pendente nesta página.</p>}
   <div className="flex justify-between"><Button variant="outline" disabled={page===1||query.isFetching} onClick={()=>setPage(page-1)}>Anteriores</Button><span>Página {page} de {Math.max(1,Math.ceil(data.total/20))}</span><Button variant="outline" disabled={page*20>=data.total||query.isFetching} onClick={()=>setPage(page+1)}>Próximas</Button></div>
  </>}
  {dialog&&<TransferStageDialog tenant={tenant} actor={actor} mode={dialog.mode} departure={dialog.departure} onClose={()=>setDialog(null)} onRecorded={()=>{setDialog(null);void invalidateAccountReview(qc,tenant);for(const prefix of ['finance-pending-transfers','finance-movements','finance-audit','finance-reconciliation-options','finance-automatic-reconciliation'])void qc.invalidateQueries({queryKey:[prefix]});}}/>}
 </section>;
}
