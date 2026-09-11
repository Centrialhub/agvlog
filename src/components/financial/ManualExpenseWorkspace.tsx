import {useEffect,useRef,useState} from 'react';
import {z} from 'zod';
import {useQueryClient} from '@tanstack/react-query';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {useClients} from '@/hooks/useClients';
import {useCostCenters} from '@/hooks/useCostCenters';
import {PAYABLE_CATEGORIES,PAYABLE_CATEGORY_LABELS} from '@/hooks/usePayables';
import {PAYMENT_METHODS,PAYMENT_METHOD_LABELS,uploadPaymentAttachment} from '@/hooks/useFinancialPayments';
import {FinanceRejectedError,recordManualExpense} from '@/lib/financial/ledgerClient';
import {manualExpenseCommandSchema,type ManualExpenseCommand} from '@/lib/financial/manualExpenseContract';
import {payableMovementOptionSchema,type PayableMovementOption} from '@/lib/financial/payableMovementContract';
import {financeError,formatFinanceCents,parseFinanceAmount} from '@/lib/financial/ledgerContract';
import {ManualExpenseMovementPicker} from './ManualExpenseMovementPicker';
const savedSchema=z.object({actor:z.string().uuid(),command:manualExpenseCommandSchema,choice:payableMovementOptionSchema.nullable(),centerName:z.string().optional()});
type Saved=z.infer<typeof savedSchema>;
export function ManualExpenseWorkspace({tenant,actor,onClose}:{tenant:string;actor:string;onClose:()=>void}){
 const key=`finance-manual-expense:${tenant}:${actor}`,qc=useQueryClient(),clients=useClients(),centers=useCostCenters();
 const [restored]=useState(()=>{try{const raw=sessionStorage.getItem(key);if(!raw)return {saved:null,error:''};const saved=savedSchema.parse(JSON.parse(raw));if(saved.actor!==actor||saved.command.tenant_id!==tenant||(saved.command.movement_id||null)!==(saved.choice?.id||null))throw new Error('scope');return {saved,error:''};}catch{return {saved:null,error:'Não foi possível recuperar a despesa anterior. Não crie outro pedido nesta sessão.'};}});
 const [pending,setPending]=useState<Saved|null>(restored.saved),[preview,setPreview]=useState<Saved|null>(null),[choice,setChoice]=useState<PayableMovementOption|null>(null);
 const [form,setForm]=useState({description:'',supplier:'',supplierName:'',category:'other',amount:'',due:'',competence:'',document:'',notes:'',method:'pix',reason:'',center:''});
 const [paid,setPaid]=useState(false),[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(restored.error);
 const live=useRef(true),sending=useRef(false);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const frozen=pending||preview,suppliers=(clients.data||[]).filter(c=>c.is_supplier);
 const refresh=()=>{for(const prefix of ['finance-recorded-costs','finance-recorded-cost-summary','payables','payables_payments','finance-audit','finance-manual-expense-options','finance-payable-options','finance-options'])void qc.invalidateQueries({queryKey:[prefix]});};
 async function prepare(){
  if(sending.current||restored.error)return;
  const amount=parseFinanceAmount(form.amount),supplier=suppliers.find(s=>s.id===form.supplier);
  if(paid&&(!choice||amount===null||BigInt(amount)>BigInt(choice.remaining_cents))){setError('Escolha uma saída registrada com valor disponível para esta despesa.');return;}
  const parsed=manualExpenseCommandSchema.safeParse({version:1,tenant_id:tenant,request_id:crypto.randomUUID(),supplier_name:supplier?.company_name||form.supplierName.trim()||'Despesa avulsa',...(form.supplier?{supplier_id:form.supplier}:{}),description:form.description,category:form.category,amount_cents:amount,...(form.center?{cost_center_id:form.center}:{}),...(form.due?{due_date:form.due}:{}),...(form.competence?{competence_date:form.competence}:{}),document_number:form.document,notes:form.notes,reason:form.reason,...(paid?{movement_id:choice?.id,method:form.method}:{})});
  if(!parsed.success){setError('Confira descrição, valor, datas e motivo com pelo menos cinco caracteres.');return;}
  sending.current=true;setBusy(true);setError('');
  try{const command:ManualExpenseCommand=parsed.data;if(file){const path=await uploadPaymentAttachment(tenant,'payable',file);if(!path)throw new Error('upload failed');command.receipt_path=path;}if(live.current)setPreview({actor,command,choice:paid?choice:null,centerName:centers.fullData.find(c=>c.id===form.center)?.name});}
  catch{if(live.current)setError('Não foi possível preparar o comprovante. A despesa não foi enviada.');}
  finally{sending.current=false;if(live.current)setBusy(false);}
 }
 async function submit(){if(!frozen||sending.current||restored.error)return;const saved=frozen,uncertain=!!pending;
  try{sessionStorage.setItem(key,JSON.stringify(saved));}catch{setError('Não foi possível preservar o pedido. A despesa não foi enviada.');return;}
  sending.current=true;setBusy(true);setPending(saved);setPreview(null);setError('');
  try{await recordManualExpense(saved.command);sessionStorage.removeItem(key);refresh();if(live.current)onClose();}
  catch(cause){if(live.current){setError(financeError(cause));if(cause instanceof FinanceRejectedError&&!uncertain){try{sessionStorage.removeItem(key);setPending(null);refresh();}catch{/* Keep uncertain request. */}}}}
  finally{sending.current=false;if(live.current)setBusy(false);}
 }
 const input=(field:keyof typeof form,label:string,type='text')=><label className="block">{label}<Input value={form[field]} type={type} onChange={e=>setForm({...form,[field]:e.target.value})}/></label>;
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" onInteractOutside={e=>{if(busy)e.preventDefault();}}><DialogHeader><DialogTitle>Nova despesa avulsa</DialogTitle><DialogDescription>Registre a obrigação e, se já estiver paga, vincule a saída existente. Nenhum pagamento será executado.</DialogDescription></DialogHeader>
  {frozen?<section className="space-y-3"><p className="font-semibold">{frozen.command.description} · {formatFinanceCents(frozen.command.amount_cents)}</p><p>{frozen.command.supplier_name}</p>
   {frozen.choice?<p>Saída já registrada: {frozen.choice.beneficiary_name} · {frozen.choice.account_name} · {frozen.choice.occurred_on.split('-').reverse().join('/')}. Nenhuma outra saída será criada.</p>:<p>Será criada uma conta a pagar pendente, sem movimentação de dinheiro.</p>}
   <p>Centro de custo: {frozen.command.cost_center_id?(frozen.centerName||frozen.command.cost_center_id):'Não informado'}</p><p>Motivo: {frozen.command.reason}</p>{frozen.command.receipt_path&&<p>Comprovante anexado para validação e preservação.</p>}{pending&&<p role="status">Pedido preservado. Retome a mesma despesa para confirmar o resultado.</p>}
   <Button disabled={busy||!!restored.error} onClick={()=>void submit()}>{busy?'Confirmando…':pending?'Retomar mesma despesa':'Confirmar registro da despesa'}</Button>{!pending&&<Button variant="outline" onClick={()=>setPreview(null)}>Voltar à edição</Button>}
  </section>:<fieldset disabled={busy||!!restored.error} className="space-y-3">
   {input('description','Descrição')}{input('amount','Valor (R$)')}
   <label className="block">Categoria<select className="block h-10 w-full rounded border bg-background" value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{PAYABLE_CATEGORIES.map(c=><option key={c} value={c}>{PAYABLE_CATEGORY_LABELS[c]}</option>)}</select></label>
   <label className="block">Centro de custo<select className="block h-10 w-full rounded border bg-background" value={form.center} onChange={e=>setForm({...form,center:e.target.value})}><option value="">Sem centro de custo</option>{centers.fullData.filter(c=>c.active).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <label className="block">Fornecedor<select className="block h-10 w-full rounded border bg-background" value={form.supplier} onChange={e=>setForm({...form,supplier:e.target.value})}><option value="">Digitar fornecedor</option>{!clients.error&&suppliers.map(s=><option key={s.id} value={s.id}>{s.company_name}</option>)}</select></label>
   {!form.supplier&&input('supplierName','Nome do fornecedor')}{clients.error&&<p role="alert">Não foi possível consultar fornecedores cadastrados.</p>}
   {input('due','Vencimento','date')}{input('competence','Competência','date')}{input('document','Documento / referência')}{input('notes','Observações')}{input('reason','Motivo do registro')}
   <label className="block"><input type="checkbox" checked={paid} onChange={e=>setPaid(e.target.checked)}/> Já foi paga com uma saída registrada</label>
   {paid&&<><ManualExpenseMovementPicker tenant={tenant} actor={actor} value={choice} onSelect={setChoice}/><label className="block">Forma registrada<select className="block h-10 w-full rounded border bg-background" value={form.method} onChange={e=>setForm({...form,method:e.target.value})}>{PAYMENT_METHODS.map(m=><option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}</select></label></>}
   <label className="block">Comprovante (opcional)<Input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
   <Button disabled={busy} onClick={()=>void prepare()}>{busy?'Preparando…':'Revisar despesa'}</Button>
  </fieldset>}
  {error&&<p role="alert">{error}</p>}
 </DialogContent></Dialog>;
}
