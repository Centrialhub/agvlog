import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {z} from 'zod';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {FinanceRejectedError,readFinanceIdentityCandidates,reviewFinanceStatementIdentity} from '@/lib/financial/ledgerClient';
import {statementReviewCommandSchema,statementReviewError,type StatementReviewCommand} from '@/lib/financial/statementReviewContract';
import {statementLinesSchema} from '@/lib/financial/statementHistoryContract';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
type Row=z.infer<typeof statementLinesSchema>['rows'][number];
export function StatementIdentityReview({tenant,actor,row,verification,onRecorded}:{tenant:string;actor:string;row:Row;verification:string;onRecorded:()=>void}){
  const key=`finance-identity-review:${tenant}:${actor}:${row.id}`;
  const [restored]=useState(()=>{try{const raw=sessionStorage.getItem(key);if(!raw)return {command:null,error:''};
    const command=statementReviewCommandSchema.parse(JSON.parse(raw));if(command.tenant_id!==tenant||command.row_id!==row.id)throw new Error('scope');return {command,error:''};
  }catch{return {command:null,error:'Não foi possível recuperar o pedido salvo. Não envie uma nova decisão nesta sessão.'};}});
  const [pending,setPending]=useState<StatementReviewCommand|null>(restored.command),[preview,setPreview]=useState<StatementReviewCommand|null>(null);
  const [open,setOpen]=useState(!!restored.command||!!restored.error),[page,setPage]=useState(1);
  const [decision,setDecision]=useState<'same_transaction'|'distinct_transaction'>('same_transaction'),[target,setTarget]=useState(''),[reason,setReason]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(restored.error),active=useRef(true),sending=useRef(false);
  const candidates=useQuery({queryKey:['finance-identity-candidates',tenant,actor,row.id,page],enabled:open&&!pending&&!preview&&decision==='same_transaction',retry:false,
    queryFn:()=>readFinanceIdentityCandidates(tenant,row.id,page)});
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  function prepare(){
    const parsed=statementReviewCommandSchema.safeParse({version:1,tenant_id:tenant,request_id:crypto.randomUUID(),row_id:row.id,
      bank_entry_id:decision==='same_transaction'?target:null,decision,reason,source_verification_id:verification,previous_review_id:row.manual_review?.id||null});
    if(!parsed.success){setError('Selecione a transação correspondente e informe justificativa com pelo menos 10 caracteres.');return;}
    setError('');setPreview(parsed.data);
  }
  async function submit(){
    if(sending.current||restored.error)return;const command=pending||preview;if(!command)return;
    const wasUncertain=!!pending;
    try{sessionStorage.setItem(key,JSON.stringify(command));}catch{setError('Não foi possível preservar o pedido no navegador. Nenhum envio foi iniciado.');return;}
    sending.current=true;setPending(command);setPreview(null);setBusy(true);setError('');
    try{await reviewFinanceStatementIdentity(command);sessionStorage.removeItem(key);if(active.current){setPending(null);setOpen(false);onRecorded();}}
    catch(cause){if(active.current){setError(statementReviewError(cause));
      if(cause instanceof FinanceRejectedError&&!wasUncertain){try{sessionStorage.removeItem(key);setPending(null);}catch{/* Keep frozen request if local cleanup fails. */}}
    }}finally{sending.current=false;if(active.current)setBusy(false);}
  }
  const frozen=pending||preview;
  if(!open)return <Button variant="outline" onClick={()=>setOpen(true)}>Revisar identificação manualmente</Button>;
  return <section className="space-y-3 rounded border p-3" aria-label="Revisar identificação da linha">
    <p className="font-medium">Revisão manual da identificação</p><p className="text-sm">A decisão e seu responsável permanecerão no histórico. Esta revisão não dá baixa em títulos nem confirma a conciliação bancária.</p>
    {frozen?<div className="space-y-2 text-sm"><p>{frozen.decision==='same_transaction'?'Mesma transação já importada':'Outra transação, distinta das importadas'}</p><p>Justificativa: {frozen.reason}</p>
      {pending&&<p role="status">Pedido preservado. Retome a confirmação com os mesmos dados.</p>}
      <Button disabled={busy||!!restored.error} onClick={()=>void submit()}>{busy?'Confirmando…':pending?'Retomar mesmo pedido':'Confirmar decisão manual'}</Button>
      {!pending&&<Button variant="outline" onClick={()=>setPreview(null)}>Voltar à edição</Button>}
    </div>:<div className="space-y-3">
      <label className="block text-sm">Decisão<select className="ml-2 rounded border bg-background p-2" value={decision} onChange={e=>setDecision(e.target.value as typeof decision)}>
        <option value="same_transaction">É a mesma transação já importada</option><option value="distinct_transaction">É outra transação</option></select></label>
      {decision==='same_transaction'&&<label className="block text-sm">Transação correspondente<select className="block w-full rounded border bg-background p-2" value={target} onChange={e=>setTarget(e.target.value)}>
        <option value="">Selecione após conferir os arquivos</option>{candidates.data?.rows.map(candidate=><option key={candidate.id} value={candidate.id} disabled={!candidate.source_verified}>{candidate.file_name} · {candidate.posted_on} · {candidate.description} · {formatFinanceCents(candidate.amount_cents)} · {candidate.counterparty_name||'Contraparte não informada'}{!candidate.source_verified?' · Original pendente de conferência':''}</option>)}</select></label>}
      {decision==='same_transaction'&&<>{candidates.isPending&&<p role="status">Buscando transações compatíveis…</p>}{candidates.error&&<p role="alert">Não foi possível consultar as transações. <Button variant="outline" onClick={()=>void candidates.refetch()}>Tentar novamente</Button></p>}
        {candidates.data&&<div className="flex items-center gap-3 text-sm"><Button variant="outline" disabled={page===1||candidates.isFetching} onClick={()=>{setTarget('');setPage(page-1);}}>Anteriores</Button>
          <span>{candidates.data.total} transações compatíveis · Página {page}</span><Button variant="outline" disabled={page*30>=candidates.data.total||candidates.isFetching} onClick={()=>{setTarget('');setPage(page+1);}}>Próximas</Button></div>}</>}
      <label className="block text-sm">Justificativa<Input value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)} placeholder="Quais evidências sustentam esta decisão?"/></label>
      <Button disabled={!!restored.error} onClick={prepare}>Revisar decisão antes de registrar</Button>
    </div>}{error&&<p role="alert">{error}</p>}
  </section>;
}
