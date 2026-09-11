import {refreshCustomerCredit} from '@/lib/financial/customerCreditCache';
import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {parseMoneyCents} from '@/lib/financial/receivableCommands';
import {formatFinanceCents} from '@/lib/financial/ledgerContract';
import {customerCreditError,customerCreditIssue,readCustomerCreditPreview} from '@/lib/financial/customerCreditClient';
import {CustomerCreditConfirmation} from './CustomerCreditConfirmation';
import {ReceivableSettlementAmounts} from './ReceivableSettlementAmounts';
export function CustomerCreditReview({tenant,actor,creditId,receivableId,applicationId,label}:{tenant:string;actor:string;creditId:string;receivableId:string;applicationId:string|null;label:string}){
 const [amount,setAmount]=useState(''),[proposal,setProposal]=useState<string|null>(null),[error,setError]=useState('');const cache=useQueryClient();
 const query=useQuery({queryKey:['finance-customer-credit-preview',tenant,actor,creditId,receivableId,applicationId,proposal],queryFn:()=>readCustomerCreditPreview(tenant,actor,creditId,receivableId,proposal!,applicationId),enabled:proposal!==null,retry:false});
 const data=query.isFetching||query.isError?undefined:query.data;
 const refresh=()=>refreshCustomerCredit(cache,tenant);
 return <section className="space-y-3 rounded border p-3" aria-label="Revisão do crédito"><h3>{applicationId?'Liberar aplicação existente':'Aplicar crédito ao título'}: {label}</h3><p className="text-xs">Título {receivableId} · crédito {creditId}</p><form onSubmit={e=>{e.preventDefault();try{setProposal(String(parseMoneyCents(amount)));setError('');if(proposal===String(parseMoneyCents(amount)))void query.refetch();}catch{setError('Informe um valor positivo com até duas casas decimais.');}}}><label>Valor<Input value={amount} onChange={e=>{setAmount(e.target.value);setProposal(null);}} inputMode="decimal"/></label><Button>Conferir crédito</Button></form>{error&&<p role="alert">{error}</p>}{query.isFetching&&<p role="status">Conferindo crédito e título…</p>}{query.error&&<p role="alert">{customerCreditError(query.error)}</p>}{data&&<><ReceivableSettlementAmounts nominal={data.target.nominal_cents} cash={data.target.cash_received_cents} credit={data.target.credit_applied_cents} settled={data.target.settled_cents} open={data.target.open_cents}/><p>Valor proposto: {formatFinanceCents(data.amount_cents)} · crédito disponível: {data.credit.available_cents===null?'Indeterminado':formatFinanceCents(data.credit.available_cents)}</p>{data.eligible&&data.target.settled_cents!==null&&data.target.open_cents!==null&&data.credit.available_cents!==null&&<p>Efeito previsto: total liquidado {formatFinanceCents((BigInt(data.target.settled_cents)+(data.action==='apply'?1n:-1n)*BigInt(data.amount_cents)).toString())}; em aberto {formatFinanceCents((BigInt(data.target.open_cents)+(data.action==='apply'?-1n:1n)*BigInt(data.amount_cents)).toString())}; crédito disponível {formatFinanceCents((BigInt(data.credit.available_cents)+(data.action==='apply'?-1n:1n)*BigInt(data.amount_cents)).toString())}.</p>}<p>Nenhuma entrada ou saída de dinheiro será registrada.</p>{data.blockers.map(b=><p role="alert" key={b}>{customerCreditIssue(b)}</p>)}</>}
 <CustomerCreditConfirmation tenant={tenant} actor={actor} preview={data} refresh={refresh}/></section>;
}
