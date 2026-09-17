import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {formatFinanceCents,parseFinanceAmount} from '@/lib/financial/ledgerContract';
import {readPayableMovements} from '@/lib/financial/ledgerClient';
import {PAYMENT_METHOD_LABELS,PAYMENT_METHODS,type PaymentMethod} from '@/hooks/useFinancialPayments';
import {applyPayableBulkSettlement,PayableBulkRejectedError,readPayableBulkContext} from '@/lib/financial/payableBulkSettlementClient';
import {payableBulkCommandSchema,payableBulkStorageKey,type PayableBulkCommand,type PayableBulkContext,type PayableBulkSelection} from '@/lib/financial/payableBulkSettlementContract';
import {createPayableBulkSettlementOutbox,lockPayableBulkSettlement,pendingPayableBulkSettlement,type PayableBulkSettlementRequest} from '@/lib/financial/payableBulkSettlementOutbox';
import type {PayableMovementOption} from '@/lib/financial/payableMovementContract';

type Saved=PayableBulkSettlementRequest;
type Props={tenant:string;actor:string;titles:PayableBulkSelection[];open:boolean;onOpenChange:(open:boolean)=>void;onRecorded:()=>void;onPendingChange?:(pending:boolean)=>void};
const centsInput=(value:string)=>{const cents=BigInt(value);return `${cents/100n},${String(cents%100n).padStart(2,'0')}`;};

function rejectionMessage(error:PayableBulkRejectedError){
  if(error.message==='finance_payable_bulk_changed'||error.message==='finance_payable_bulk_movement_changed')return 'A conta, a data, a saída ou um dos títulos mudou. Faça uma nova revisão.';
  if(error.message==='finance_movement_overallocated')return 'A saída não possui mais saldo suficiente para este lote.';
  if(error.message==='finance_payable_bulk_beneficiary_mismatch')return 'Os títulos precisam pertencer ao mesmo favorecido.';
  return 'A baixa em lote foi recusada. Confira os títulos e a saída selecionada.';
}

export function PayableBulkSettlementDialog({tenant,actor,titles,open,onOpenChange,onRecorded,onPendingChange}:Props){
  const storageKey=payableBulkStorageKey(tenant,actor);
  const [amounts,setAmounts]=useState<Record<string,string>>(()=>Object.fromEntries(titles.map(title=>[title.payable_id,centsInput(title.open_cents)])));
  const [search,setSearch]=useState(''),[term,setTerm]=useState(''),[page,setPage]=useState(1);
  const [choice,setChoice]=useState<PayableMovementOption|null>(null),[method,setMethod]=useState<PaymentMethod>('pix'),[reason,setReason]=useState('');
  const [preview,setPreview]=useState<Saved|null>(null),[pending,setPending]=useState<Saved|null>(null),[corrupt,setCorrupt]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const sending=useRef(false),live=useRef({tenant,actor,active:true}),pendingCallback=useRef(onPendingChange);live.current={tenant,actor,active:true};pendingCallback.current=onPendingChange;
  const sync=()=>{try{const saved=pendingPayableBulkSettlement(localStorage,tenant,actor)?.payload??null;setPending(saved);setCorrupt(false);pendingCallback.current?.(!!saved);}catch{setPending(null);setCorrupt(true);pendingCallback.current?.(true);}};
  const syncRef=useRef(sync);syncRef.current=sync;
  const [outbox]=useState(()=>createPayableBulkSettlementOutbox({storage:localStorage,assertContext:(t,a)=>{if(!live.current.active||live.current.tenant!==t||live.current.actor!==a)throw new Error('Recupere o pedido na sessão original.');},changed:()=>{if(live.current.active)syncRef.current();},lock:lockPayableBulkSettlement,send:applyPayableBulkSettlement,isDefinitive:error=>error instanceof PayableBulkRejectedError}));
  useEffect(()=>{live.current.active=true;syncRef.current();const listener=(event:StorageEvent)=>{if(event.key===null||event.key===storageKey)syncRef.current();};window.addEventListener('storage',listener);return()=>{live.current.active=false;window.removeEventListener('storage',listener);};},[storageKey]);
  const first=titles[0];
  const movements=useQuery({queryKey:['finance-payable-bulk-options',tenant,actor,first?.payable_id,term,page],enabled:open&&!!first&&!pending&&!preview&&!corrupt,
    queryFn:()=>readPayableMovements(tenant,first.payable_id,term,page),retry:false,staleTime:0});
  const frozen=pending||preview;

  async function review(){
    if(!choice){setError('Selecione a saída que pagou estes títulos.');return;}
    if(reason.trim().length<5){setError('Informe um motivo com pelo menos cinco caracteres.');return;}
    const items=[] as {payable_id:string;amount_cents:string}[];
    for(const title of titles){const cents=parseFinanceAmount(amounts[title.payable_id]||'');if(cents===null){setError('Informe um valor válido para cada título.');return;}items.push({payable_id:title.payable_id,amount_cents:String(cents)});}
    setBusy(true);setError('');
    try{
      const context=await readPayableBulkContext(tenant,actor,choice.id,items);
      if(!context.eligible){setError('A prévia encontrou saldo insuficiente ou título sem aprovação. Nenhuma baixa foi registrada.');return;}
      const command=payableBulkCommandSchema.parse({version:1,tenant_id:tenant,request_id:crypto.randomUUID(),movement_id:choice.id,bank_account_id:context.movement.bank_account_id,paid_on:context.movement.occurred_on,expected_revision:context.expected_revision,items,method,reason});
      setPreview({command,context});
    }catch(cause){setError(cause instanceof PayableBulkRejectedError?rejectionMessage(cause):'Não foi possível gerar a prévia autoritativa do lote.');}
    finally{if(live.current.active)setBusy(false);}
  }
  async function submit(){
    if(sending.current||corrupt)return;const saved=pending||preview;if(!saved)return;const wasPending=!!pending;
    sending.current=true;setBusy(true);setError('');
    try{if(wasPending)await outbox.recover(tenant,actor);else await outbox.submit(tenant,actor,saved);if(live.current.active){setPending(null);onRecorded();onOpenChange(false);}}
    catch(cause){if(live.current.active&&cause instanceof PayableBulkRejectedError&&!wasPending){setPreview(null);setError(rejectionMessage(cause));}
      else if(live.current.active&&wasPending)setError('Ainda não foi possível confirmar o pedido preservado. Tente retomá-lo novamente.');
      else if(live.current.active){let preserved=false;try{preserved=!!pendingPayableBulkSettlement(localStorage,tenant,actor);}catch{setCorrupt(true);}setError(preserved?'Não foi possível confirmar a resposta. O mesmo pedido foi preservado para retomada.':'Não foi possível preservar o pedido. Nenhuma baixa foi iniciada.');}}
    finally{sending.current=false;if(live.current.active)setBusy(false);}
  }

  return <Dialog open={open} onOpenChange={next=>{if(!busy)onOpenChange(next);}}><DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
    <DialogHeader><DialogTitle>Baixa em lote de contas a pagar</DialogTitle>
      <DialogDescription>Distribua uma única saída já registrada entre títulos do mesmo favorecido. O sistema não executa pagamento nem confirma o extrato.</DialogDescription>
    </DialogHeader>
    {frozen?<Review saved={frozen} pending={!!pending} busy={busy} onSubmit={()=>void submit()} onBack={()=>setPreview(null)}/>:<div className="space-y-4">
      <section aria-label="Títulos selecionados" className="space-y-2">{titles.map(title=><label key={title.payable_id} className="grid sm:grid-cols-[1fr_10rem] gap-2 items-end rounded border p-2">
        <span><strong>{title.supplier_name||'Favorecido não identificado'}</strong><span className="block text-sm">{title.description||title.payable_id} · saldo {formatFinanceCents(title.open_cents)}</span></span>
        Valor da baixa (R$)<Input aria-label={`Valor da baixa — ${title.description||title.payable_id}`} inputMode="decimal" value={amounts[title.payable_id]||''} onChange={event=>setAmounts(current=>({...current,[title.payable_id]:event.target.value}))}/>
      </label>)}</section>
      <section aria-label="Selecionar saída" className="space-y-2"><div className="flex gap-2"><Input aria-label="Buscar saída do lote" value={search} onChange={event=>setSearch(event.target.value)}/><Button variant="outline" onClick={()=>{setTerm(search);setPage(1);}}>Buscar saída</Button></div>
        {movements.isPending&&<p role="status">Consultando saídas registradas…</p>}{movements.error&&<p role="alert">Não foi possível consultar as saídas. <Button variant="outline" onClick={()=>void movements.refetch()}>Tentar novamente</Button></p>}
        {movements.data&&<><div className="max-h-48 overflow-auto">{movements.data.rows.map(row=><Button key={row.id} variant={choice?.id===row.id?'secondary':'ghost'} className="w-full h-auto justify-start text-left whitespace-normal" onClick={()=>setChoice(row)}>{row.beneficiary_name} · {row.account_name} · {row.occurred_on.split('-').reverse().join('/')} · disponível {formatFinanceCents(row.remaining_cents)}</Button>)}{!movements.data.rows.length&&<p>Nenhuma saída compatível encontrada.</p>}</div>
          <div className="flex justify-between"><Button variant="ghost" disabled={page===1} onClick={()=>setPage(page-1)}>Anterior</Button><span>Página {page}</span><Button variant="ghost" disabled={page*30>=movements.data.total} onClick={()=>setPage(page+1)}>Próxima</Button></div></>}
      </section>
      <label className="block">Forma registrada<select className="block w-full rounded border p-2" value={method} onChange={event=>setMethod(event.target.value as PaymentMethod)}>{PAYMENT_METHODS.map(value=><option key={value} value={value}>{PAYMENT_METHOD_LABELS[value]}</option>)}</select></label>
      <label className="block">Motivo da baixa em lote<Input maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/></label>
      <Button disabled={busy||!!movements.error||!movements.data||corrupt} onClick={()=>void review()}>{busy?'Gerando prévia…':'Revisar baixa em lote'}</Button>
    </div>}
    {corrupt&&<div role="alert"><p>O pedido salvo está inconsistente. Descarte-o para iniciar uma nova baixa.</p><Button variant="outline" onClick={()=>{try{localStorage.removeItem(storageKey);setCorrupt(false);setPending(null);pendingCallback.current?.(false);window.dispatchEvent(new StorageEvent('storage',{key:storageKey}));}catch{setError('Não foi possível descartar o pedido salvo.');}}}>Descartar pedido incompatível</Button></div>}
    {error&&<p role="alert">{error}</p>}
  </DialogContent></Dialog>;
}

function Review({saved,pending,busy,onSubmit,onBack}:{saved:{command:PayableBulkCommand;context:PayableBulkContext};pending:boolean;busy:boolean;onSubmit:()=>void;onBack:()=>void}){
  const {context,command}=saved;
  return <section aria-label="Revisão da baixa em lote" className="space-y-3">
    <div className="rounded border p-3"><p><strong>Favorecido da saída:</strong> {context.movement.beneficiary_name}</p><p><strong>Conta:</strong> {context.movement.account_name} · {context.movement.bank_account_id}</p><p><strong>Data do pagamento:</strong> {context.movement.occurred_on.split('-').reverse().join('/')}</p><p><strong>Referência:</strong> {context.movement.bank_reference||context.movement.description}</p><p><strong>Total distribuído:</strong> {formatFinanceCents(context.total_cents)}</p><p><strong>Saldo disponível da saída antes da baixa:</strong> {formatFinanceCents(context.movement.remaining_cents)}</p></div>
    <ul>{context.items.map(item=><li key={item.payable_id}>{item.description||item.payable_id}: {formatFinanceCents(item.amount_cents)}</li>)}</ul>
    <p>Forma registrada: {PAYMENT_METHOD_LABELS[command.method]} · Motivo: {command.reason}</p>
    {pending&&<p role="status">Pedido preservado. Retome exatamente a mesma baixa.</p>}
    <div className="flex gap-2"><Button disabled={busy} onClick={onSubmit}>{busy?'Confirmando…':pending?'Retomar mesma baixa':'Confirmar baixa em lote'}</Button>{!pending&&<Button variant="outline" onClick={onBack}>Voltar à edição</Button>}</div>
  </section>;
}
