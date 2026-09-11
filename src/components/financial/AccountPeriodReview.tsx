import {AccountPeriodClosePanel} from './AccountPeriodClosePanel';
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {readAccountPeriodReview} from '@/lib/financial/ledgerClient';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
import {TransferPeriodPosition} from './TransferPeriodPosition';
import {PeriodEvidenceReview} from './PeriodEvidenceReview';
import {AccountOpeningReview} from './AccountOpeningReview';
import {StatementCoverageReview} from './StatementCoverageReview';
import {LegacyAdoptionInventory} from './LegacyAdoptionInventory';
export function AccountPeriodReview({tenant,actor,account,from,to}:{tenant:string;actor:string;account:string;from:string;to:string}){
 const [open,setOpen]=useState(false),[draft,setDraft]=useState({from,to}),[period,setPeriod]=useState({from,to});
 const query=useQuery({queryKey:['finance-account-period',tenant,actor,account,period],enabled:open,retry:false,
  queryFn:()=>readAccountPeriodReview(tenant,account,period.from,period.to)}),data=query.error||query.isFetching?undefined:query.data;
 if(!open)return <Button variant="outline" onClick={()=>setOpen(true)}>Conferir conta no período</Button>;
 return <section aria-label="Conferência da conta no período" className="space-y-3 rounded border p-3"><h2 className="font-semibold">Conferência da conta no período</h2>
  <p className="text-sm">Considera os arquivos importados desta conta no intervalo, sem somar novamente linhas reconhecidas como a mesma transação.</p>
  <form className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();setPeriod({...draft});if(period.from===draft.from&&period.to===draft.to)void query.refetch();}}>
   <label>Início da conferência<Input required type="date" value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></label>
   <label>Fim da conferência<Input required type="date" min={draft.from} value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label>
   <Button type="submit" disabled={query.isFetching}>Consultar período</Button>
  </form>
  {query.isFetching&&<p role="status">Conferindo movimentos do período…</p>}{query.error&&<p role="alert">Não foi possível conferir o período. Verifique as datas e tente novamente.</p>}
  {data&&<><p className="font-medium">{data.account_name} · {data.from.split('-').reverse().join('/')} a {data.to.split('-').reverse().join('/')}</p>
   <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Comparação</th><th className="p-2">Entradas</th><th className="p-2">Saídas</th><th className="p-2">Movimentação líquida</th></tr></thead>
    <tbody>{[{label:'Transações identificadas nos extratos',value:data.bank},{label:'Lançamentos registrados',value:data.recorded},{label:'Diferença: registros menos extratos',value:data.difference}].map(row=><tr className="border-t" key={row.label}><th className="p-2">{row.label}</th><td className="p-2">{formatFinanceCents(row.value.in_cents)}</td><td className="p-2">{formatFinanceCents(row.value.out_cents)}</td><td className="p-2">{formatFinanceCents(row.value.net_cents)}</td></tr>)}</tbody></table></div>
   <p>{data.bank.count} transação(ões) identificada(s) no extrato · {data.recorded.count} lançamento(s) registrado(s).</p>
   <ul className="list-disc space-y-1 pl-5 text-sm"><li>{data.unmatched_bank_count} transação(ões) bancária(s) sem vínculo válido neste período.</li>
    <li>{data.unmatched_movement_count} lançamento(s) sem vínculo válido neste período.</li><li>{data.unresolved_row_count} linha(s) importada(s) com identidade pendente, fora dos totais de transações identificadas.</li>
    <li>{data.unverified_entry_count} transação(ões) cujo original ainda não confirma as linhas.</li><li>{data.evidence_review_count} conciliação(ões) com evidências a rever.</li>
    <li>{data.cross_period_count} conciliação(ões) atravessam as datas escolhidas.</li><li>{data.manual_group_count} conciliação(ões) manual(is), com responsáveis no histórico.</li></ul>
   <p role="alert">Conferência provisória: confira abaixo a incorporação dos registros antigos, a abertura da conta e a revisão de cobertura. A decisão de fechamento e seu histórico são consultados no painel próprio abaixo.</p>
   <p className="text-sm">Movimentação líquida não é saldo bancário. Valores iguais não encerram a conferência enquanto houver pendências.</p>
   <TransferPeriodPosition key={`${account}:${data.to}:${query.dataUpdatedAt}`} tenant={tenant} actor={actor} account={account} cutoff={data.to}/>
   <PeriodEvidenceReview key={`evidence:${account}:${data.from}:${data.to}:${query.dataUpdatedAt}`} tenant={tenant} actor={actor} account={account} from={data.from} to={data.to}/>
  </>}
  <AccountPeriodClosePanel key={`close:${tenant}:${actor}:${account}:${period.from}:${period.to}`} tenant={tenant} actor={actor} account={account} from={period.from} to={period.to}/>
  <AccountOpeningReview key={`opening:${tenant}:${actor}:${account}:${period.from}:${period.to}`} tenant={tenant} actor={actor} account={account} from={period.from} to={period.to}/>
  <StatementCoverageReview key={`coverage:${tenant}:${actor}:${account}:${period.from}:${period.to}`} tenant={tenant} actor={actor} account={account} from={period.from} to={period.to}/>
  <LegacyAdoptionInventory key={`legacy:${tenant}:${actor}:${account}:${period.from}:${period.to}`} tenant={tenant} actor={actor} account={account} from={period.from} to={period.to}/>
 </section>;
}
