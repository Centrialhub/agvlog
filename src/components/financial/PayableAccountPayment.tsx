import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useBankAccounts,PAYMENT_METHODS,PAYMENT_METHOD_LABELS,type PaymentMethod} from '@/hooks/useFinancialPayments';
import {usePayableAction} from '@/hooks/usePayableAction';
import {readPayableMovements} from '@/lib/financial/ledgerClient';
import {accountPaymentSchema,type AccountPayment} from '@/lib/financial/payableActions';
import {formatFinanceCents,parseFinanceAmount} from '@/lib/financial/ledgerContract';
import {PayableApprovalDialog} from './PayableApprovalDialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';

export function PayableAccountPayment({tenant,actor,payable,onRecorded}:{tenant:string;actor:string;payable:string;onRecorded:()=>void}){
 const accounts=useBankAccounts(),cache=useQueryClient();
 const context=useQuery({queryKey:['finance-payable-options',tenant,actor,payable,'direct-payment'],queryFn:()=>readPayableMovements(tenant,payable,'',1),retry:false});
 const [account,setAccount]=useState(''),[amount,setAmount]=useState(''),[paidOn,setPaidOn]=useState(()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date())),[method,setMethod]=useState<PaymentMethod>('pix'),[reason,setReason]=useState(''),[reference,setReference]=useState(''),[error,setError]=useState(''),[approval,setApproval]=useState(false),[preview,setPreview]=useState<AccountPayment|null>(null);
 const action=usePayableAction(tenant,actor,payable,()=>{setPreview(null);setAmount('');setReason('');setReference('');onRecorded();});
 const data=!context.isFetching&&!context.isError?context.data:undefined;
 const frozen=action.pending&&'payable_id' in action.pending?action.pending:preview;
 function review(){
  const cents=parseFinanceAmount(amount);
  if(!data?.can_apply||!cents||BigInt(cents)>BigInt(data.remaining_cents)||accounts.isError||!accounts.data?.some(x=>x.id===account)){setError('Selecione a conta e informe um valor dentro do saldo de um título aprovado.');return;}
  const parsed=accountPaymentSchema.safeParse({version:1,tenant_id:tenant,request_id:crypto.randomUUID(),payable_id:payable,bank_account_id:account,amount_cents:cents,paid_on:paidOn,method,reason,bank_reference:reference});
  if(!parsed.success){setError('Informe a data do pagamento e uma observação com pelo menos 10 caracteres.');return;}
  setError('');setPreview(parsed.data);
 }
 return <section aria-label="Baixa com conta de origem" className="rounded border p-3 space-y-3">
  <h3 className="font-medium">Registrar pagamento realizado</h3><p className="text-sm">Informe de qual conta saiu o dinheiro. Será criada a saída e vinculada a baixa deste título. Se a saída já foi registrada, use a opção abaixo para vinculá-la.</p>
  {frozen?<div className="space-y-2"><p>Conta: {accounts.data?.find(x=>x.id===frozen.bank_account_id)?.name||frozen.bank_account_id}</p><p>Pagamento: {formatFinanceCents(frozen.amount_cents)} · {frozen.paid_on} · {PAYMENT_METHOD_LABELS[frozen.method]}</p><p>{frozen.reason}</p>
   {action.pending&&<p role="status">Pedido preservado. Retome a mesma baixa para evitar duplicidade.</p>}
   <Button disabled={action.busy||action.blocked} onClick={()=>void action.send(frozen)}>{action.busy?'Confirmando…':action.pending?'Retomar mesma baixa por conta':'Confirmar baixa nesta conta'}</Button>
   {!action.pending&&<Button variant="outline" onClick={()=>setPreview(null)}>Voltar à edição</Button>}
  </div>:<>
   {context.isFetching&&<p role="status">Conferindo saldo do título…</p>}
   {context.isError&&<p role="alert">Não foi possível conferir o saldo. <Button variant="link" onClick={()=>void context.refetch()}>Atualizar saldo</Button></p>}
   {data&&<p>Saldo em aberto: {formatFinanceCents(data.remaining_cents)}</p>}
   {data&&!data.can_apply&&<p>O título precisa estar aprovado e ter saldo disponível. {['pending','overdue'].includes(data.payable_status)&&<Button variant="outline" onClick={()=>setApproval(true)}>Conferir aprovação para baixa</Button>}</p>}
   <label className="block">Conta de origem<select className="block w-full rounded border p-2" value={account} onChange={e=>setAccount(e.target.value)} disabled={accounts.isPending||accounts.isError}><option value="">Selecione a conta que pagou a despesa</option>{accounts.data?.map(a=><option key={a.id} value={a.id}>{a.name}{a.bank_name?` — ${a.bank_name}`:''}</option>)}</select></label>
   {accounts.isError&&<p role="alert">Não foi possível carregar as contas. <Button variant="link" onClick={()=>void accounts.refetch()}>Recarregar contas</Button></p>}
   {accounts.data?.length===0&&<p>Nenhuma conta ativa cadastrada nesta empresa.</p>}
   <div className="grid gap-3 sm:grid-cols-2"><label>Valor pago (R$)<Input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="300,00"/></label><label>Data do pagamento<Input type="date" value={paidOn} onChange={e=>setPaidOn(e.target.value)}/></label></div>
   <label className="block">Forma de pagamento da baixa<select className="block rounded border p-2" value={method} onChange={e=>setMethod(e.target.value as PaymentMethod)}>{PAYMENT_METHODS.map(m=><option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}</select></label>
   <label className="block">Referência bancária (opcional)<Input value={reference} maxLength={200} onChange={e=>setReference(e.target.value)}/></label>
   <label className="block">Observação do pagamento<Input value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)}/></label>
   <Button disabled={!data?.can_apply||action.blocked||action.busy} onClick={review}>Revisar baixa por conta</Button>
  </>}
  {(error||action.error)&&<p role="alert">{error||action.error}</p>}
  {approval&&<PayableApprovalDialog tenant={tenant} actor={actor} payableId={payable} open onOpenChange={open=>{setApproval(open);if(!open)void cache.invalidateQueries({queryKey:['finance-payable-options',tenant,actor,payable]});}}/>}
 </section>;
}
