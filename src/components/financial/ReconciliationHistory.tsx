import {invalidateAccountReview} from '@/lib/financial/invalidateAccountReview';
import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {readReconciliationHistory} from '@/lib/financial/ledgerClient';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
import {reconciliationEvidenceIssues} from '@/lib/financial/reconciliationHistoryContract';
import {ReconciliationReversal} from './ReconciliationReversal';
const timestamp=(value:string)=>new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
export function ReconciliationHistory({tenant,actor,statement}:{tenant:string;actor:string;statement:string}){
 const [open,setOpen]=useState(false),[page,setPage]=useState(1),[notice,setNotice]=useState('');const qc=useQueryClient();
 const query=useQuery({queryKey:['finance-reconciliation-history',tenant,actor,statement,page],enabled:open,retry:false,
  queryFn:()=>readReconciliationHistory(tenant,statement,page)}),data=query.error?undefined:query.data;
 function changed(){setNotice('Histórico atualizado; os registros originais foram preservados.');
  void invalidateAccountReview(qc,tenant);for(const key of ['finance-reconciliation-history','finance-reconciliation-options','finance-audit','finance-statement-lines'])void qc.invalidateQueries({queryKey:[key,tenant]});}
 if(!open)return <Button variant="outline" onClick={()=>setOpen(true)}>Histórico das conciliações</Button>;
 return <section aria-label="Histórico das conciliações" className="space-y-3 rounded border p-4"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Histórico das conciliações</h2>
  <Button variant="ghost" disabled={query.isFetching} onClick={()=>void query.refetch()}>Atualizar histórico</Button></div>
  <p className="text-sm">A marcação manual permanece no histórico, inclusive após reversão. Os totais abaixo são de cada grupo, que pode incluir linhas de outros arquivos; não representam o saldo deste período.</p>
  {notice&&<p role="status">{notice}</p>}{query.isPending&&<p role="status">Consultando histórico…</p>}{query.error&&<p role="alert">Não foi possível consultar as conciliações.</p>}
  {data&&<><p>{data.total} conciliação(ões) · {data.active_count} vínculo(s) ainda não revertido(s)</p>
   {data.rows.map(row=><article key={row.id} className={`space-y-2 rounded border p-3 ${row.method==='manual'||row.reversal?'border-amber-600':''}`}>
    <p className="font-semibold">{row.method==='manual'?'Conciliação manual':'Conciliação automática por referência'} · {row.reversal?'Revertida':row.evidence_issue?'Exige revisão das evidências':'Vínculo registrado'}</p>
    <p>{row.method==='automatic_reference'?'Importação iniciada por ':''}{row.actor_name} · {timestamp(row.created_at)}</p><p className="text-sm">{row.method==='manual'?'Responsável':'Responsável pela importação'}: {row.actor_id}</p>
    <p>{row.direction==='in'?'Entrada':'Saída'} · Total do grupo {formatFinanceCents(row.amount_cents)} · {row.movement_count} lançamento(s) e {row.bank_entry_count} linha(s) bancária(s)</p>
    <p>Justificativa: {row.reason}</p><p>Conferência da conta: {row.account_evidence}</p>
    {!row.reversal&&row.evidence_issue&&<p role="alert">{reconciliationEvidenceIssues[row.evidence_issue]} A decisão original permanece no histórico e precisa ser revista.</p>}
    <details><summary className="cursor-pointer">Ver registros usados na decisão</summary><div className="mt-2 space-y-2 text-sm"><h3 className="font-medium">Lançamentos</h3>
     {row.movements.map(item=><p key={item.id}>{item.date} · {item.counterparty||'Contraparte não informada'} · {item.description} · {formatFinanceCents(item.amount_cents)}</p>)}
     <h3 className="font-medium">Extrato</h3>{row.entries.map(item=><p key={item.id}>{item.date} · {item.counterparty||'Contraparte não informada'} · {item.description} · {formatFinanceCents(item.amount_cents)}</p>)}
    </div></details>
    {row.reversal&&<div className="rounded border border-amber-600 p-3"><p>Revertida por {row.reversal.actor_name} · {timestamp(row.reversal.created_at)}</p>
     <p className="text-sm">Responsável pela reversão: {row.reversal.actor_id}</p><p>{row.reversal.reason}</p></div>}
    <ReconciliationReversal tenant={tenant} actor={actor} group={row.id} reversed={!!row.reversal} onRecorded={changed}/>
   </article>)}{!data.rows.length&&<p>Nenhuma conciliação relacionada a este extrato.</p>}
   <div className="flex justify-between"><Button variant="outline" disabled={page===1||query.isFetching} onClick={()=>setPage(page-1)}>Anterior</Button>
    <span>Página {data.page} de {Math.max(1,Math.ceil(data.total/20))}</span><Button variant="outline" disabled={page*20>=data.total||query.isFetching} onClick={()=>setPage(page+1)}>Próxima</Button></div>
  </>}
 </section>;
}
