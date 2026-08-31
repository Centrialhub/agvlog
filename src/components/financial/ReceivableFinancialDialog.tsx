import {useRef,useState} from 'react';
import {useAuth} from '@/hooks/useAuth';
import {useTenant} from '@/hooks/useTenant';
import {useReceivableFinancial} from '@/hooks/useReceivableFinancial';
import {PAYMENT_METHODS,PAYMENT_METHOD_LABELS,uploadPaymentAttachment,type PaymentMethod} from '@/hooks/useFinancialPayments';
import {financialActionLabels,financialError,parseMoneyCents,type FinancialAction,type FinancialCommandInput} from '@/lib/financial/receivableCommands';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
const brl=(cents:number)=>(cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function ReceivableFinancialDialog({receivableId,tenantId,onClose}:{receivableId:string;tenantId:string;onClose:()=>void}){
 const {currentTenant}=useTenant();const {user}=useAuth();if(currentTenant?.id!==tenantId||!user?.id)return null;
 return <FinancialForm key={`${tenantId}:${user.id}:${receivableId}`} receivableId={receivableId} tenantId={tenantId} onClose={onClose}/>;
}
function FinancialForm({receivableId,tenantId,onClose}:{receivableId:string;tenantId:string;onClose:()=>void}){
 const api=useReceivableFinancial(receivableId);const context=api.query.data;const busy=useRef(false);
 const [action,setAction]=useState<FinancialAction|''>('');const [reason,setReason]=useState('');const [amount,setAmount]=useState('');const [date,setDate]=useState(today);
 const [bank,setBank]=useState('');const [method,setMethod]=useState<PaymentMethod>('pix');const [notes,setNotes]=useState('');const [payment,setPayment]=useState('');
 const [file,setFile]=useState<File|null>(null);const [attachment,setAttachment]=useState<string|null>(null);const [fileVersion,setFileVersion]=useState(0);
 const [working,setWorking]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const allowed=context&&(action==='receive'?context.can_receive:action==='reverse'?context.can_reverse&&context.payments.some(p=>p.id===payment&&!p.reversed_at):action==='reconcile'?context.can_reconcile:false);
 const submit=async()=>{
  if(!context||!action||!allowed||busy.current)return;busy.current=true;setWorking(true);setError('');setNotice('');
  try{
   const common={receivable_id:receivableId,expected_revision:context.revision,reason};let input:FinancialCommandInput;
   if(action==='receive'){
    const cents=parseMoneyCents(amount);if(cents>context.open_cents)throw new Error('O recebimento excede o saldo em aberto.');
    if(!bank||!date)throw new Error('Selecione a conta e a data do recebimento.');
    let path=attachment;if(file&&!path){path=await uploadPaymentAttachment(tenantId,'receivable',file);if(!path)throw new Error('O comprovante não foi enviado.');setAttachment(path);}
    input={...common,action,amount_cents:cents,effective_date:date,bank_account_id:bank,method,notes:notes||null,attachment_path:path};
   }else if(action==='reverse')input={...common,action,payment_id:payment,effective_date:date};else input={...common,action};
   const result=await api.submit(input);setAction('');setReason('');setAmount('');setNotes('');setFile(null);setAttachment(null);setFileVersion(n=>n+1);
   setNotice(`Pedido confirmado: ${financialActionLabels[result.action]}. Saldos e histórico atualizados; nenhuma transferência bancária foi executada.`);
  }catch(cause){setError(financialError(cause));}finally{busy.current=false;setWorking(false);}
 };
 const blocked=working||api.isPending||api.query.isFetching||!!api.query.error||!!api.pending||!!api.recoveryError;
 return <Dialog open onOpenChange={()=>onClose()}><DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto"><DialogHeader>
  <DialogTitle>Recebimentos — {context?.reference||'Título'}</DialogTitle><DialogDescription>Registro contábil de valores já recebidos. Não movimenta sua conta bancária. Estornos preservam os lançamentos originais.</DialogDescription></DialogHeader>
  {api.query.isPending?<p role="status">Consultando título e histórico…</p>:null}{api.query.error?<p role="alert">{api.query.error.message}</p>:null}
  {context?<div className="space-y-3"><dl className="grid grid-cols-3 gap-3 rounded border p-3 text-sm"><div><dt>Valor original</dt><dd>{brl(context.amount_cents)}</dd></div><div><dt>Recebido líquido</dt><dd>{brl(context.received_cents)}</dd></div><div><dt>Em aberto</dt><dd>{brl(context.open_cents)}</dd></div></dl>
   {context.requires_reconciliation?<p role="alert">O histórico e as projeções divergem. {context.can_reconcile?'Um administrador pode conciliar os saldos com os lançamentos comprovados.':'Solicite revisão administrativa dos vínculos e comprovantes. Nenhum valor será registrado enquanto houver divergência.'}</p>:null}
   <fieldset disabled={blocked} className="space-y-3"><label className="block">Operação financeira<select className="h-10 w-full rounded border bg-background px-3" value={action} onChange={e=>setAction(e.target.value as FinancialAction|'')}><option value="">Selecione</option>
    {context.can_receive?<option value="receive">Registrar recebimento</option>:null}{context.can_reverse?<option value="reverse">Estornar recebimento</option>:null}{context.can_reconcile?<option value="reconcile">Conciliar projeções</option>:null}</select></label>
    {action==='receive'?<><label className="block">Valor recebido (R$)<Input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
     <label className="block">Conta bancária<select className="h-10 w-full rounded border bg-background px-3" value={bank} onChange={e=>setBank(e.target.value)}><option value="">Selecione</option>{context.bank_accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
     {!context.bank_accounts.length?<p>Cadastre uma conta bancária ativa antes de registrar o recebimento.</p>:null}
     <label className="block">Forma de recebimento<select className="h-10 w-full rounded border bg-background px-3" value={method} onChange={e=>setMethod(e.target.value as PaymentMethod)}>{PAYMENT_METHODS.map(m=><option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}</select></label>
     <label className="block">Observação<Textarea maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
     <label className="block">Comprovante (opcional)<Input key={fileVersion} type="file" accept="image/*,application/pdf" onChange={e=>{setFile(e.target.files?.[0]||null);setAttachment(null);}}/></label></>:null}
    {action==='reverse'?<><p>O estorno é integral para o recebimento selecionado. Será criado um lançamento compensatório; o histórico não será apagado.</p><label className="block">Recebimento a estornar<select className="h-10 w-full rounded border bg-background px-3" value={payment} onChange={e=>setPayment(e.target.value)}><option value="">Selecione</option>{context.payments.filter(p=>!p.reversed_at).map(p=><option key={p.id} value={p.id}>{brl(p.amount_cents)} · {new Date(p.received_at).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})} · {p.id}</option>)}</select></label></>:null}
    {action&&action!=='reconcile'?<label className="block">Data da operação<Input type="date" max={today()} value={date} onChange={e=>setDate(e.target.value)}/></label>:null}
    {action?<label className="block">Motivo da operação<Textarea maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>:null}
   </fieldset>
   {context.payments.length?<section aria-label="Histórico de recebimentos" className="max-h-64 space-y-2 overflow-y-auto rounded border p-3"><h3>Histórico preservado</h3>{context.payments.map(p=><div key={p.id} className="border-b pb-2 text-sm"><p>{brl(p.amount_cents)} · {p.reversed_at?'Estornado — original preservado':'Recebido'} · {p.bank_account_name||'Conta não informada'}</p><p>{new Date(p.received_at).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})} · {p.notes||'Sem observação'}</p>{p.reversal_reason?<p>Motivo do estorno: {p.reversal_reason}</p>:null}</div>)}</section>:null}
   {!context.history_complete?<p role="status">Exibindo os 500 recebimentos mais recentes de {context.payment_count}. Os saldos consideram todo o histórico; recebimentos anteriores exigem consulta administrativa.</p>:null}
  </div>:null}
  {api.pending?<p role="alert">Há uma operação sem confirmação. Use o painel de recuperação antes de iniciar outra.</p>:null}{api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}{error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
  <DialogFooter><Button variant="outline" onClick={onClose}>Voltar</Button><Button variant="outline" disabled={working||api.isPending||api.query.isFetching} onClick={()=>void api.query.refetch()}>Atualizar estado</Button><Button disabled={blocked||!allowed||reason.trim().length<5} onClick={()=>void submit()}>Confirmar operação</Button></DialogFooter>
 </DialogContent></Dialog>;
}
