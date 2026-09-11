import {invalidateAccountReview} from '@/lib/financial/invalidateAccountReview';
import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {StatementIdentityReview} from './StatementIdentityReview';
import {StatementReviewReversal} from './StatementReviewReversal';
import {StatementBalanceReport} from './StatementBalanceReport';
import {StatementReconciliation} from './StatementReconciliation';
import {ReconciliationHistory} from './ReconciliationHistory';
import {NativeStatementAccount} from './NativeStatementAccount';
import {AutomaticReconciliationStatus} from './AutomaticReconciliationStatus';
import {AccountPeriodReview} from './AccountPeriodReview';
import {supabase} from '@/integrations/supabase/client';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {readFinanceStatementLines} from '@/lib/financial/ledgerClient';
import {statementIdentityLabels,statementSourceLabels,type StatementLineFilters,type StatementSummary} from '@/lib/financial/statementHistoryContract';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
export function StatementHistoryDetail({statement,actor,onClose}:{statement:StatementSummary;actor:string;onClose:()=>void}){
  const [filters,setFilters]=useState<StatementLineFilters>({page:1,page_size:30,classification:''}),[link,setLink]=useState(''),[error,setError]=useState(''),[linkBusy,setLinkBusy]=useState(false);
  const live=useRef(true);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  const qc=useQueryClient();
  const query=useQuery({queryKey:['finance-statement-lines',statement.tenant_id,actor,statement.id,filters],retry:false,
    queryFn:()=>readFinanceStatementLines(statement.tenant_id,statement.id,filters)}),data=query.data;
  async function original(){
    if(!statement.source_path.startsWith(`${statement.tenant_id}/imports/${statement.file_hash}.`)){setError('Arquivo fora do contexto esperado.');return;}
    setLinkBusy(true);setError('');
    try{const response=await supabase.storage.from('finance-statements').createSignedUrl(statement.source_path,60,{download:statement.file_name});
      if(!live.current)return;if(response.error||!response.data?.signedUrl?.startsWith('https://')){setError('Original indisponível ou sem permissão.');return;}setLink(response.data.signedUrl);
    }catch{if(live.current)setError('Não foi possível acessar o original.');}finally{if(live.current)setLinkBusy(false);}
  }
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
    <DialogHeader><DialogTitle>{statement.file_name}</DialogTitle><DialogDescription>{statement.account_name} · {statementSourceLabels[statement.source_verification]}</DialogDescription></DialogHeader>
    <p className="text-sm">Confira a identificação da conta no original e a cobertura do período. As linhas abaixo representam a importação recebida; conferir as linhas não certifica o saldo de todo o período.</p>
    <StatementBalanceReport report={statement.verification_report?.balance_check}/>
    <NativeStatementAccount key={`account:${statement.id}`} tenant={statement.tenant_id} actor={actor} statement={statement.id} account={statement.bank_account_id}/>
    <AutomaticReconciliationStatus key={`automatic:${statement.tenant_id}:${actor}:${statement.id}`} tenant={statement.tenant_id} actor={actor} statement={statement.id}/>
    <AccountPeriodReview key={`period:${statement.tenant_id}:${actor}:${statement.id}`} tenant={statement.tenant_id} actor={actor} account={statement.bank_account_id} from={statement.period_start} to={statement.period_end}/>
    <StatementReconciliation key={`${statement.tenant_id}:${actor}:${statement.id}`} tenant={statement.tenant_id} actor={actor} statement={statement.id}/>
    <ReconciliationHistory key={`history:${statement.tenant_id}:${actor}:${statement.id}`} tenant={statement.tenant_id} actor={actor} statement={statement.id}/>
    <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={linkBusy} onClick={()=>void original()}>{linkBusy?'Preparando acesso…':'Acessar arquivo original'}</Button>
      {link&&<a className="self-center underline" href={link} target="_blank" rel="noopener noreferrer">Baixar original — link válido por 1 minuto</a>}</div>{error&&<p role="alert">{error}</p>}
    <label className="text-sm">Filtrar linhas<select className="ml-2 h-10 rounded border bg-background px-2" value={filters.classification} onChange={e=>setFilters({...filters,page:1,classification:e.target.value})}>
      <option value="">Todas</option>{Object.entries(statementIdentityLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    {query.isPending&&<p role="status">Carregando linhas…</p>}{query.error&&<p role="alert">Não foi possível consultar as linhas. <Button onClick={()=>void query.refetch()}>Tentar novamente</Button></p>}
    {data&&!query.error&&<><p className="text-sm">{data.total} registros no filtro · Soma das linhas: {formatFinanceCents(data.row_amount_total_cents)}. Este valor não é saldo bancário.</p>
      <div className="space-y-2">{data.rows.map(row=><details key={row.id} className="rounded border p-3"><summary className="cursor-pointer text-sm">
        <span className="font-medium">Registro {row.source_row} · {row.posted_on.split('-').reverse().join('/')} · {row.description} · {formatFinanceCents(row.amount_cents)}</span>
        <span className="mt-1 block">{statementIdentityLabels[row.classification]}</span>
        {row.manual_review&&<span className="mt-1 block rounded border border-amber-600 px-2 py-1 font-semibold">Identificação revisada manualmente · {row.manual_review.actor_name}</span>}</summary>
        <div className="mt-3 space-y-2 text-sm"><p>Contraparte: {row.counterparty_name||'Não informada'} {row.counterparty_document||''}</p>
          <p>Identificador do banco: {row.bank_id||'Não informado'} · Documento: {row.document_number||'Não informado'}</p>
          {row.manual_review&&<div className="rounded border border-amber-600 p-3"><p>{row.manual_review.decision==='same_transaction'?'Identificada como a mesma transação':'Identificada como outra transação'} · {new Date(row.manual_review.created_at).toLocaleString('pt-BR')}</p><p>{row.manual_review.reason}</p></div>}
          {row.candidate_count>0&&<><p>{row.candidate_count} coincidência(s) registrada(s). Exibindo até 5 para consulta; nenhum vínculo é alterado nesta tela.</p>
            {row.candidate_preview.map(candidate=><div key={candidate.id} className="rounded bg-muted p-2">{candidate.posted_on} · {candidate.description} · {formatFinanceCents(candidate.amount_cents)} · {candidate.bank_id||'Sem identificador'}</div>)}</>}
          {row.manual_review?.reversal&&<p className="rounded border border-amber-600 p-3">Decisão revertida por {row.manual_review.reversal.actor_name} · {new Date(row.manual_review.reversal.created_at).toLocaleString('pt-BR')} · {row.manual_review.reversal.reason}. A linha precisa de nova revisão.</p>}
          {row.manual_review&&!row.manual_review.reversal&&<StatementReviewReversal key={row.manual_review.id} tenant={statement.tenant_id} actor={actor} reviewId={row.manual_review.id} onRecorded={()=>{
            void invalidateAccountReview(qc,statement.tenant_id);void qc.invalidateQueries({queryKey:['finance-statement-lines',statement.tenant_id,actor]});void qc.invalidateQueries({queryKey:['finance-statements',statement.tenant_id,actor]});void qc.invalidateQueries({queryKey:['finance-identity-candidates',statement.tenant_id,actor]});
          }}/>}
          {(!row.manual_review||row.manual_review.reversal)&&['ambiguous','reference_conflict','repeated_reference'].includes(row.classification)&&data.source_verification_id&&statement.source_verification==='rows_match'&&
            <StatementIdentityReview tenant={statement.tenant_id} actor={actor} row={row} verification={data.source_verification_id} onRecorded={()=>{
              void invalidateAccountReview(qc,statement.tenant_id);void qc.invalidateQueries({queryKey:['finance-statement-lines',statement.tenant_id,actor]});void qc.invalidateQueries({queryKey:['finance-statements',statement.tenant_id,actor]});
            }}/>}
        </div></details>)}{!data.rows.length&&<p>Nenhuma linha neste filtro.</p>}</div>
      <div className="flex items-center justify-between"><Button variant="outline" disabled={filters.page===1||query.isFetching} onClick={()=>setFilters({...filters,page:filters.page-1})}>Anterior</Button>
        <span>Página {data.page} de {Math.max(1,Math.ceil(data.total/data.page_size))}</span><Button variant="outline" disabled={data.page*data.page_size>=data.total||query.isFetching} onClick={()=>setFilters({...filters,page:filters.page+1})}>Próxima</Button></div>
      <details><summary className="cursor-pointer font-medium">Histórico da importação</summary><div className="mt-2 space-y-3">{data.history.map(event=><div key={event.id} className="border-l-2 pl-3 text-sm"><p className="font-medium">{event.actor_name} · {event.action==='mapped_rows_received'?'Registrou a importação':event.action==='source_checked'?'Solicitou conferência do original no servidor':event.action==='identity_reviewed_manually'?'Revisou a identificação manualmente':event.action==='identity_review_reversed'?'Reverteu a decisão manual':'Atualização registrada'}</p>
        <p>{new Date(event.created_at).toLocaleString('pt-BR')} · {event.reason}</p></div>)}</div></details>
    </>}
  </DialogContent></Dialog>;
}
