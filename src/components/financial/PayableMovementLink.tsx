import {movementUseError} from '@/lib/financial/movementUseErrors';
import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {z} from 'zod';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {applyPayableMovement,readPayableMovements,FinanceRejectedError} from '@/lib/financial/ledgerClient';
import {payableMovementCommandSchema,payableMovementOptionSchema,type PayableMovementOption} from '@/lib/financial/payableMovementContract';
import {formatFinanceCents,parseFinanceAmount} from '@/lib/financial/ledgerContract';
import {PAYMENT_METHODS,PAYMENT_METHOD_LABELS,type PaymentMethod} from '@/hooks/useFinancialPayments';

const savedSchema=z.object({command:payableMovementCommandSchema,choice:payableMovementOptionSchema,title:z.string()});
type Saved=z.infer<typeof savedSchema>;
export function PayableMovementLink({tenant,actor,payable,onRecorded}:{tenant:string;actor:string;payable:string;onRecorded:()=>void}){
 const key=`finance-payable-link:${tenant}:${actor}:${payable}`;
 const [restored]=useState(()=>{try{const raw=sessionStorage.getItem(key);if(!raw)return {saved:null,error:''};
  const saved=savedSchema.parse(JSON.parse(raw));if(saved.command.tenant_id!==tenant||saved.command.payable_id!==payable||saved.command.movement_id!==saved.choice.id)throw new Error('scope');
  return {saved,error:''};
 }catch{return {saved:null,error:'Não foi possível recuperar o pedido anterior. Não envie outro pedido nesta sessão.'};}});
 const [pending,setPending]=useState<Saved|null>(restored.saved),[preview,setPreview]=useState<Saved|null>(null);
 const [open,setOpen]=useState(!!restored.saved||!!restored.error),[choice,setChoice]=useState<PayableMovementOption|null>(null);
 const [search,setSearch]=useState(''),[term,setTerm]=useState(''),[page,setPage]=useState(1),[amount,setAmount]=useState('');
 const [method,setMethod]=useState<PaymentMethod>('pix'),[reason,setReason]=useState(''),[error,setError]=useState(restored.error),[busy,setBusy]=useState(false);
 const sending=useRef(false),active=useRef(true);useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const query=useQuery({queryKey:['finance-payable-options',tenant,actor,payable,term,page],enabled:open&&!pending&&!restored.error,
  queryFn:()=>readPayableMovements(tenant,payable,term,page),staleTime:0});
 function prepare(){
  const cents=parseFinanceAmount(amount),data=query.data;
  if(!choice||!data||query.error||!data.can_apply){setError('Selecione uma saída para um título aprovado com saldo disponível.');return;}
  if(cents===null||BigInt(cents)>BigInt(choice.remaining_cents)||BigInt(cents)>BigInt(data.remaining_cents)){setError('O valor deve caber no saldo da saída e do título.');return;}
  const command=payableMovementCommandSchema.safeParse({version:1,tenant_id:tenant,request_id:crypto.randomUUID(),payable_id:payable,movement_id:choice.id,amount_cents:cents,method,reason});
  if(!command.success){setError('Informe valor, forma de pagamento e motivo com pelo menos cinco caracteres.');return;}
  setPreview({command:command.data,choice,title:data.payable_name});setError('');
 }
 async function submit(){
  if(sending.current||restored.error)return;const saved=pending||preview;if(!saved)return;const wasUncertain=!!pending;
  try{sessionStorage.setItem(key,JSON.stringify(saved));}catch{setError('Não foi possível preservar o pedido. Nenhum envio foi iniciado.');return;}
  sending.current=true;setBusy(true);setPending(saved);setPreview(null);setError('');
  try{await applyPayableMovement(saved.command);sessionStorage.removeItem(key);if(active.current){setPending(null);setChoice(null);setOpen(false);setAmount('');onRecorded();}}
  catch(cause){if(active.current){setError(cause instanceof FinanceRejectedError?(movementUseError(cause)||'O vínculo foi recusado. Confira os saldos e a situação do título.'):'Não foi possível confirmar a resposta. Retome o mesmo pedido.');
   if(cause instanceof FinanceRejectedError&&!wasUncertain){try{sessionStorage.removeItem(key);setPending(null);void query.refetch();}catch{/* Preserve exact identity if cleanup fails. */}}}}
  finally{sending.current=false;if(active.current)setBusy(false);}
 }
 if(!open)return <Button onClick={()=>setOpen(true)}>Vincular saída já registrada</Button>;
 const frozen=pending||preview;
 return <section aria-label="Vincular saída ao título" className="rounded border p-3 space-y-3">
  <p className="text-sm">Selecione o envio que pagou este título. O vínculo não executa pagamento e não confirma conciliação bancária.</p>
  {frozen?<div className="space-y-2 text-sm">
   <p>Título: {frozen.title}</p><p>Destinatário do envio: {frozen.choice.beneficiary_name}</p>
   <p>{frozen.choice.account_name} · {frozen.choice.occurred_on} · {frozen.choice.bank_reference||frozen.choice.description}</p>
   <p>Total do envio: {formatFinanceCents(frozen.choice.amount_cents)}</p>
   <p className="font-medium">Parcela para este título: {formatFinanceCents(frozen.command.amount_cents)}</p>
   <p>Forma registrada: {PAYMENT_METHOD_LABELS[frozen.command.method]}</p><p>Motivo: {frozen.command.reason}</p>
   {pending&&<p role="status">Pedido preservado. Retome com os mesmos dados.</p>}
   <Button disabled={busy||!!restored.error} onClick={()=>void submit()}>{busy?'Confirmando…':pending?'Retomar mesma baixa':'Confirmar vínculo e registrar baixa'}</Button>
   {!pending&&<Button variant="outline" onClick={()=>setPreview(null)}>Voltar à edição</Button>}
  </div>:<>
   <div className="flex gap-2"><Input aria-label="Buscar saída" value={search} onChange={e=>setSearch(e.target.value)}/><Button onClick={()=>{setTerm(search);setPage(1);}}>Buscar</Button></div>
   {query.isPending&&<p role="status">Carregando saídas…</p>}
   {query.error&&<p role="alert">Não foi possível consultar as saídas. <Button onClick={()=>void query.refetch()}>Tentar novamente</Button></p>}
   {query.data&&!query.error&&<>
    <p>Saldo do título: {formatFinanceCents(query.data.remaining_cents)}</p>
    {!query.data.can_apply&&<p>O título precisa estar aprovado e ter saldo disponível para receber este vínculo.</p>}
    <div className="max-h-44 overflow-auto">{query.data.rows.map(row=><Button key={row.id} variant={choice?.id===row.id?'secondary':'ghost'} className="w-full h-auto text-left justify-start whitespace-normal" onClick={()=>setChoice(row)}>
     {row.beneficiary_name} · {row.account_name} · {row.occurred_on} · {row.bank_reference||row.description} · Disponível {formatFinanceCents(row.remaining_cents)}
    </Button>)}{!query.data.rows.length&&<p>Nenhuma saída disponível.</p>}</div>
    <div className="flex justify-between"><Button variant="ghost" disabled={page===1} onClick={()=>setPage(page-1)}>Anterior</Button><span>Página {page}</span><Button variant="ghost" disabled={page*30>=query.data.total} onClick={()=>setPage(page+1)}>Próxima</Button></div>
   </>}
   {choice&&<p>Envio selecionado: {choice.beneficiary_name} · {choice.occurred_on}</p>}
   <label className="block">Valor para este título (R$)<Input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="300,00"/></label>
   <label className="block">Forma de pagamento<select className="block border rounded p-2" value={method} onChange={e=>setMethod(e.target.value as PaymentMethod)}>{PAYMENT_METHODS.map(m=><option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}</select></label>
   <label className="block">Motivo do vínculo<Input maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <Button disabled={!!restored.error||!!query.error||!query.data?.can_apply} onClick={prepare}>Revisar vínculo</Button>
  </>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
