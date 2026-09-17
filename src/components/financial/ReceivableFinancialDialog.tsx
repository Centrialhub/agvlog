import {ReceivableAdjustmentDialog} from './ReceivableAdjustmentDialog';
import {ReceivableSettlementAmounts} from './ReceivableSettlementAmounts';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {useReceivableFinancial} from '@/hooks/useReceivableFinancial';
import {deletePaymentAttachment,PAYMENT_METHODS,PAYMENT_METHOD_LABELS,uploadPaymentAttachment,type PaymentMethod} from '@/hooks/useFinancialPayments';
import {financialActionLabels,financialError,parseMoneyCents,type FinancialAction,type FinancialCommandInput} from '@/lib/financial/receivableCommands';
import {pendingFinancialAttachment} from '@/lib/financial/receivableFinancialOutbox';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {ReceivableMovementPicker} from './ReceivableMovementPicker';
import {ReceivablePaymentsPanel} from './ReceivablePaymentsPanel';
import type {FinancialContext} from '@/lib/financial/receivableCommands';
import {readReceivableAgreementPosition} from '@/lib/financial/receivableAgreementClient';
import {useQuery} from '@tanstack/react-query';

const brl=(cents:number)=>(cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function ReceivableFinancialDialog({receivableId,tenantId,onClose}:{receivableId:string;tenantId:string;onClose:()=>void}){
 const {currentTenant}=useTenant();const {user}=useAuth();if(currentTenant?.id!==tenantId||!user?.id)return null;
 return <FinancialForm key={`${tenantId}:${user.id}:${receivableId}`} receivableId={receivableId} tenantId={tenantId} onClose={onClose}/>;
}
function FinancialForm({receivableId,tenantId,onClose}:{receivableId:string;tenantId:string;onClose:()=>void}){
 const api=useReceivableFinancial(receivableId);const context=api.query.data;const busy=useRef(false);
 const agreementQuery=useQuery({queryKey:['receivable-agreement-position',tenantId,context?.actor_id,receivableId],queryFn:()=>readReceivableAgreementPosition(tenantId,context!.actor_id,receivableId),enabled:!!context,retry:false}),agreement=!agreementQuery.isFetching&&!agreementQuery.error?agreementQuery.data:undefined;
 const [allocations,setAllocations]=useState<Record<string,string>>({});
 const [adjustmentOpen,setAdjustmentOpen]=useState(false);
 const [action,setAction]=useState<FinancialAction|''>('');const [reason,setReason]=useState('');const [amount,setAmount]=useState('');const [date,setDate]=useState(today);
 const [bank,setBank]=useState('');const [method,setMethod]=useState<PaymentMethod>('pix');const [notes,setNotes]=useState('');const [payment,setPayment]=useState('');
 const [useExisting,setUseExisting]=useState(false),[movement,setMovement]=useState('');
 const [refundConfirmed,setRefundConfirmed]=useState(false);
 const [file,setFile]=useState<File|null>(null);const [attachment,setAttachment]=useState<string|null>(null);const [fileVersion,setFileVersion]=useState(0);
 const [working,setWorking]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const [selectedPayment,setSelectedPayment]=useState<{row:FinancialContext['payments'][number];revision:string}|null>(null);
 const clearPayment=useCallback(()=>{setSelectedPayment(null);setPayment('');setRefundConfirmed(false);},[]);
 const blocked=working||api.isPending||api.query.isFetching||!!api.query.error||!!api.pending||!!api.recoveryError||agreementQuery.isFetching||!!agreementQuery.error;
 useEffect(()=>{if(blocked||selectedPayment?.revision!==context?.revision)clearPayment();},[blocked,context?.revision,selectedPayment?.revision,clearPayment]);
 const allowed=context&&(action==='receive'?context.can_receive:action==='reverse'?refundConfirmed&&context.can_reverse&&selectedPayment?.revision===context.revision&&selectedPayment.row.id===payment&&!selectedPayment.row.reversed_at&&!selectedPayment.row.credit_id&&!selectedPayment.row.allocation_correction:action==='reconcile'?context.can_reconcile:false);
 const submit=async()=>{
  if(!context||!action||!allowed||busy.current)return;busy.current=true;setWorking(true);setError('');setNotice('');
  let uploadedPath:string|null=null;
  try{
   const common={receivable_id:receivableId,expected_revision:context.revision,reason};let input:FinancialCommandInput;
   if(action==='receive'){
    const cents=parseMoneyCents(amount);if(cents>context.open_cents)throw new Error('O recebimento excede o saldo em aberto.');
    if(!bank||!date)throw new Error('Selecione a conta e a data do recebimento.');
    if(useExisting&&!movement)throw new Error('Escolha a entrada já registrada para esta baixa.');
    let agreementFields={};if(agreement?.status==='active'){if(agreement.requires_reallocation)throw Error('finance_agreement_requires_reallocation');const selected=agreement.installments.flatMap(row=>{const raw=allocations[row.id]?.trim();return raw?[{installment_id:row.id,amount_cents:String(parseMoneyCents(raw))}]:[];});if(selected.reduce((sum,row)=>sum+Number(row.amount_cents),0)!==cents)throw Error('finance_agreement_distribution_sum');agreementFields={installment_allocations:selected,expected_agreement_revision:agreement.revision};}
    let path=attachment;if(file&&!path){path=await uploadPaymentAttachment(tenantId,'receivable',file);if(!path)throw new Error('O comprovante não foi enviado.');uploadedPath=path;setAttachment(path);}
    input={...common,action,amount_cents:cents,effective_date:date,bank_account_id:bank,method,notes:notes||null,attachment_path:path,...(useExisting?{movement_id:movement}:{}),...agreementFields};
   }else if(action==='reverse')input={...common,action,payment_id:payment,effective_date:date,refund_kind:'money_returned'};else input={...common,action};
   const result=await api.submit(input);setAction('');setReason('');setAmount('');setNotes('');setAllocations({});setFile(null);setAttachment(null);setFileVersion(n=>n+1);void agreementQuery.refetch();
   setMovement('');setUseExisting(false);
   clearPayment();
   setNotice(`Pedido confirmado: ${financialActionLabels[result.action]}. Saldos e histórico atualizados; nenhuma transferência bancária foi executada.`);
  }catch(cause){let message=financialError(cause);if(uploadedPath&&!pendingFinancialAttachment(window.localStorage,tenantId,context.actor_id,uploadedPath)){try{await deletePaymentAttachment(tenantId,'receivable',uploadedPath);setAttachment(null);}catch{message+=' O comprovante enviado ainda não pôde ser descartado; mantenha este diálogo aberto e tente voltar novamente.';}}setError(message);}finally{busy.current=false;setWorking(false);}
 };
 const close=async()=>{if(working||busy.current)return;if(attachment&&context&&!pendingFinancialAttachment(window.localStorage,tenantId,context.actor_id,attachment)){setWorking(true);setError('');try{await deletePaymentAttachment(tenantId,'receivable',attachment);setAttachment(null);}catch{setError('Não foi possível descartar o comprovante ainda não vinculado. Tente novamente antes de fechar.');setWorking(false);return;}setWorking(false);}onClose();};
 return <Dialog open onOpenChange={open=>{if(!open)void close();}}><DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto"><DialogHeader>
  <DialogTitle>Recebimentos — {context?.reference||'Título'}</DialogTitle><DialogDescription>Registro contábil de valores já recebidos. Não movimenta sua conta bancária. Estornos preservam os lançamentos originais.</DialogDescription></DialogHeader>
  {api.query.isPending?<p role="status">Consultando título e histórico…</p>:null}{api.query.error?<p role="alert">{api.query.error.message}</p>:null}{agreementQuery.error?<p role="alert">Não foi possível conferir as parcelas da renegociação. Nenhum recebimento pode ser confirmado até atualizar esta consulta. <Button variant="outline" onClick={()=>void agreementQuery.refetch()}>Tentar novamente</Button></p>:null}
  {context?<div className="space-y-3"><Button disabled={blocked} onClick={()=>setAdjustmentOpen(true)}>Conferir desconto ou perda</Button>{adjustmentOpen&&<ReceivableAdjustmentDialog key={`${tenantId}:${context.actor_id}:${receivableId}`} tenant={tenantId} actor={context.actor_id} receivable={receivableId} onClose={()=>setAdjustmentOpen(false)}/>}<ReceivableSettlementAmounts nominal={context.amount_cents} settled={context.settled_cents===undefined?context.received_cents:context.settled_cents} open={context.open_cents} cash={context.cash_received_cents} credit={context.credit_applied_cents} discount={context.discount_cents} loss={context.loss_cents}/>
   {context.source_issue==="finance_unloading_source_mismatch"?<p role="alert" className="rounded border border-amber-600 p-3">A origem da descarga diverge deste título. Novos recebimentos estão indisponíveis. Conferir ou conciliar o saldo não corrige o fornecedor nem o valor da origem. A devolução de um recebimento já realizado permanece disponível quando autorizada.</p>:null}
   {context.requires_reconciliation?<p role="alert">O histórico e as projeções divergem. {context.can_reconcile?'Um administrador pode conciliar os saldos com os lançamentos comprovados.':'Solicite revisão administrativa dos vínculos e comprovantes. Nenhum valor será registrado enquanto houver divergência.'}</p>:null}
   {context.fiscal_block_reason?<p role="alert">{context.fiscal_block_reason==='fiscal_origin_cancelled'?'Documento fiscal cancelado. Esta cobrança não aceita novos recebimentos.':context.fiscal_block_reason==='fiscal_origin_credit_pending'?'Documento cancelado com recebimento a regularizar como crédito. Confira a origem e o histórico.':context.fiscal_block_reason==='fiscal_origin_suspended'?'Recebimentos suspensos enquanto o cancelamento fiscal está em análise.':context.fiscal_block_reason==='fiscal_origin_review'?'A origem fiscal exige revisão antes de novos recebimentos.':'A autorização fiscal vigente não foi confirmada. Atualize o estado fiscal antes de registrar recebimentos.'}</p>:null}
   <fieldset disabled={blocked} className="space-y-3"><label className="block">Operação financeira<select className="h-10 w-full rounded border bg-background px-3" value={action} onChange={e=>setAction(e.target.value as FinancialAction|'')}><option value="">Selecione</option>
    {context.can_receive?<option value="receive">Registrar recebimento</option>:null}{context.can_reverse?<option value="reverse">Estornar recebimento</option>:null}{context.can_reconcile?<option value="reconcile">Conciliar projeções</option>:null}</select></label>
    {action==='receive'?<><label className="block">Valor recebido (R$)<Input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
     {agreement?.status==='active'?<fieldset className="space-y-2 rounded border p-3"><legend>Distribuição obrigatória entre parcelas</legend>{agreement.requires_reallocation?<p role="alert">Há saldo sem vencimento após uma reversão. Revise o acordo antes desta baixa.</p>:agreement.installments.filter(row=>row.open_cents!=='0').map((row,index)=><label className="block" key={row.id}>Parcela {index+1} · {new Date(row.due_on+'T12:00:00').toLocaleDateString('pt-BR')} · saldo {brl(Number(row.open_cents||0))}<Input inputMode="decimal" aria-label={`Valor para parcela ${index+1}`} value={allocations[row.id]||''} onChange={e=>setAllocations(old=>({...old,[row.id]:e.target.value}))}/></label>)}</fieldset>:null}
     <label className="block">Conta bancária<select className="h-10 w-full rounded border bg-background px-3" value={bank} onChange={e=>{setBank(e.target.value);setMovement('');}}><option value="">Selecione</option>{context.bank_accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
     <label className="block"><input type="checkbox" checked={useExisting} onChange={e=>{setUseExisting(e.target.checked);setMovement('');}}/> Este dinheiro já tem uma entrada registrada</label>
     {useExisting&&<ReceivableMovementPicker key={`${bank}:${date}`} tenant={tenantId} account={bank} date={date} value={movement} onSelect={setMovement}/>}
     {!context.bank_accounts.length?<p>Cadastre uma conta bancária ativa antes de registrar o recebimento.</p>:null}
     <label className="block">Forma de recebimento<select className="h-10 w-full rounded border bg-background px-3" value={method} onChange={e=>setMethod(e.target.value as PaymentMethod)}>{PAYMENT_METHODS.map(m=><option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}</select></label>
     <label className="block">Observação<Textarea maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
     <label className="block">Comprovante (opcional)<Input key={fileVersion} type="file" accept="image/*,application/pdf" onChange={e=>{setFile(e.target.files?.[0]||null);setAttachment(null);}}/></label></>:null}
    {action==='reverse'?<><p>Registre aqui a devolução integral já realizada ao pagador. A saída ficará pendente de conciliação com o extrato. Para uma baixa no título errado, use a correção de vínculo no histórico.</p><p>{selectedPayment?`Selecionado: ${selectedPayment.row.id} · ${brl(selectedPayment.row.amount_cents)}`:"Selecione o recebimento no histórico paginado abaixo."}</p><label className="block"><input type="checkbox" checked={refundConfirmed} onChange={e=>setRefundConfirmed(e.target.checked)}/> Confirmo que o dinheiro já foi devolvido ao pagador</label></>:null}
    {action&&action!=='reconcile'?<label className="block">Data da operação<Input type="date" max={today()} value={date} onChange={e=>{setDate(e.target.value);setMovement('');}}/></label>:null}
    {action?<label className="block">Motivo da operação<Textarea maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>:null}
   </fieldset>
   <ReceivablePaymentsPanel tenant={tenantId} actor={context.actor_id} receivableId={receivableId} financialRevision={context.revision} canReverse={context.can_reverse} disabled={blocked} selectedId={payment} onInvalidate={clearPayment} onRecorded={()=>void api.query.refetch()} onSelect={row=>{setSelectedPayment({row,revision:context.revision});setPayment(row.id);setAction("reverse");setRefundConfirmed(false);}}/>
  </div>:null}
  {api.pending?<p role="alert">Há uma operação sem confirmação. Use o painel de recuperação antes de iniciar outra.</p>:null}{api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}{error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
  <DialogFooter><Button variant="outline" disabled={working} onClick={()=>void close()}>Voltar</Button><Button variant="outline" disabled={working||api.isPending||api.query.isFetching} onClick={()=>void api.query.refetch()}>Atualizar estado</Button><Button disabled={blocked||!allowed||reason.trim().length<5} onClick={()=>void submit()}>Confirmar operação</Button></DialogFooter>
 </DialogContent></Dialog>;
}
