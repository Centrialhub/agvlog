import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {readMovementReceiptTrace} from '@/lib/financial/ledgerClient';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
export function MovementReceiptTrace({tenant,actor,movement,onClose}:{tenant:string;actor:string;movement:string;onClose:()=>void}){
 const [page,setPage]=useState(1);
 const query=useQuery({queryKey:['finance-movement-receipts',tenant,actor,movement,page],queryFn:()=>readMovementReceiptTrace(tenant,movement,page),retry:false});
 const data=query.error||query.isFetching?undefined:query.data;
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
  <DialogHeader><DialogTitle>Vínculos com recebíveis</DialogTitle><DialogDescription>Histórico de títulos associados a esta movimentação. Estes vínculos não confirmam a conciliação bancária.</DialogDescription></DialogHeader>
  {query.isFetching&&<p role="status">Carregando vínculos…</p>}
  {query.error&&<div role="alert"><p>Não foi possível consultar os vínculos.</p><Button onClick={()=>void query.refetch()}>Tentar novamente</Button></div>}
  {data&&<><p>{data.total} vínculo(s) no histórico.</p>{!data.rows.length&&<p>Nenhum vínculo com recebível nesta página. Outros tipos de composição não aparecem nesta consulta.</p>}
   {data.rows.map(row=><article key={`${row.origin}:${row.link_id}`} className="space-y-2 rounded border p-3">
    <h3 className="font-semibold">{row.reference} · {formatFinanceCents(row.amount_cents)}</h3>
    <p>{row.origin==='legacy_adoption'?(row.association_reversal?'Associação antiga desfeita — recebimento preservado':'Recebimento antigo associado à entrada'):row.action==='reverse'?'Devolução de dinheiro registrada':row.correction?'Vínculo corrigido — não compõe mais o recebido do título':row.credit?'Recebimento convertido em crédito após cancelamento fiscal':row.reversal_id?'Recebimento com devolução registrada':'Recebimento vinculado ao título'}</p>
    <p className="text-sm">Registrado em {new Date(row.created_at).toLocaleString('pt-BR')}</p>
    {row.correction&&<div className="rounded border border-amber-500 p-2 text-sm"><p>Correção manual por {row.correction.actor_name} em {new Date(row.correction.created_at).toLocaleString('pt-BR')}</p><p>{row.correction.reason}</p><p className="break-all">Responsável: {row.correction.actor_id}</p><p>O dinheiro registrado foi preservado.</p></div>}
    {row.origin==='legacy_adoption'&&<div className="rounded border border-amber-600 p-2 text-sm"><p>Associação manual por {row.association.actor_name} ({row.association.actor_id}) em {new Date(row.association.created_at).toLocaleString('pt-BR')}</p><p>Motivo: {row.association.reason}</p><p>Declarou que o recebimento já registrado corresponde integralmente à entrada escolhida. Autenticidade bancária não atestada.</p><p>Associação: {row.link_id}</p>{row.association_reversal&&<><p>Associação desfeita manualmente por {row.association_reversal.actor_name} ({row.association_reversal.actor_id}) em {new Date(row.association_reversal.created_at).toLocaleString('pt-BR')}</p><p>Motivo da correção: {row.association_reversal.reason}</p><p>Esta correção preservou o recebimento e não reabriu o título.</p></>}{row.reversal_id&&<p>Este recebimento também possui uma devolução de dinheiro registrada separadamente.</p>}</div>}
    {row.credit&&<p className="text-sm">Crédito gerado: {formatFinanceCents(row.credit.amount_cents)}. Não representa uma nova entrada de dinheiro.</p>}
   </article>)}
   <div className="flex items-center justify-between"><Button variant="outline" disabled={page===1||query.isFetching} onClick={()=>setPage(page-1)}>Anterior</Button><span>Página {page} de {Math.max(1,Math.ceil(data.total/20))}</span><Button variant="outline" disabled={page*20>=data.total||query.isFetching} onClick={()=>setPage(page+1)}>Próxima</Button></div>
  </>}
 </DialogContent></Dialog>;
}
