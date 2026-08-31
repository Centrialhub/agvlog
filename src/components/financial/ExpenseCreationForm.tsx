import {useEffect,useId,useRef,useState} from 'react';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {useExpenseCreation} from '@/hooks/useExpenseCreation';
import {creationError,type ExpenseCreationContext,type ExpenseFields} from '@/lib/financial/expenseCreationCommands';
import {describeExpenseReceipt} from '@/lib/financial/expenseReceiptUpload';
import {expenseCategoryLabels,expensePaymentLabels} from '@/lib/financial/expenseReviewCommands';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
type Props={sourceType:'trip'|'settlement';sourceId:string;onConfirmed?:()=>void};
export function ExpenseCreationForm(props:Props){
 const {currentTenant}=useTenant(),{user}=useAuth();return currentTenant&&user?<ScopedForm key={currentTenant.id+':'+user.id+':'+props.sourceType+':'+props.sourceId} {...props}/>:<p>Entre e selecione a empresa.</p>;
}
const localDate=()=>{const date=new Date();return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);};
function ScopedForm({sourceType,sourceId,onConfirmed}:Props){
 const command=useExpenseCreation(sourceType,sourceId),prefix=useId(),alive=useRef(true);
 const [preview,setPreview]=useState<ExpenseCreationContext|null>(null),[invalidated,setInvalidated]=useState(false),[message,setMessage]=useState(''),[preparing,setPreparing]=useState(false);
 const [form,setForm]=useState({category:'fuel',amount:'',expense_at:localDate(),payment_source:'driver',reimbursable:true,supplier_name:'',document_number:'',city:'',state:'',odometer:'',cost_center:'',notes:'',no_receipt:false,no_receipt_reason:''});
 const [file,setFile]=useState<File>();
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(!preview&&command.query.data)setPreview(command.query.data);},[preview,command.query.data]);
 const changed=!!preview&&!!command.query.data&&preview.revision!==command.query.data.revision;
 const disabled=preparing||command.isPending||!!command.pending||!!command.recoveryError;
 const field=(name:keyof typeof form,value:string|boolean)=>setForm(f=>({...f,[name]:value}));
 const textField=(name:'amount'|'expense_at'|'supplier_name'|'document_number'|'city'|'state'|'odometer'|'cost_center'|'no_receipt_reason',label:string,type='text')=><div><label htmlFor={prefix+name}>{label}</label><Input id={prefix+name} type={type} value={form[name]} onChange={e=>field(name,e.target.value)} inputMode={name==='amount'?'decimal':undefined}/></div>;
 const submit=async()=>{
  if(disabled||command.query.error||command.query.isPending||!preview||changed||invalidated||!preview.can_create)return;setPreparing(true);setMessage('');
  try{
   if(!/^\d+(?:[.,]\d{1,2})?$/.test(form.amount.trim()))throw new Error('Informe um valor positivo com no máximo duas casas decimais.');
   const [whole,fraction='']=form.amount.trim().replace(',','.').split('.'),amount=Number(whole)*100+Number(fraction.padEnd(2,'0'));
   const date=new Date(form.expense_at);if(!Number.isFinite(date.getTime()))throw new Error('Informe a data e hora da despesa.');
   const receipt=form.no_receipt?null:file?await describeExpenseReceipt(file):null;if(!alive.current)return;
   const fields:ExpenseFields={...form,category:form.category as ExpenseFields['category'],payment_source:form.payment_source as ExpenseFields['payment_source'],
    amount_cents:amount,expense_at:date.toISOString(),odometer:form.odometer?Number(form.odometer):null,no_receipt_reason:form.no_receipt?form.no_receipt_reason:null};
   // The UI amount string is not part of the strict API contract.
   const {amount:unused,...rest}=fields as ExpenseFields&{amount:string};void unused;
   await command.submit({source_type:sourceType,source_id:sourceId,expected_revision:preview.revision,fields:rest,receipt},form.no_receipt?undefined:file);
   if(alive.current){setMessage('Despesa registrada e aguardando aprovação.');onConfirmed?.();}
  }catch(cause){if(alive.current){setMessage(creationError(cause));setInvalidated(true);}}
  finally{if(alive.current)setPreparing(false);}
 };
 return <form className="space-y-3" onSubmit={e=>{e.preventDefault();void submit();}}>
  {command.query.isPending?<p role="status">Carregando contexto da despesa...</p>:null}
  {command.query.error?<p role="alert">{creationError(command.query.error)}</p>:null}
  {preview&&!command.query.error?<p>Motorista: {preview.driver_name} · {sourceType==='trip'?'Viagem':'Acerto'} {sourceId.slice(0,8)}</p>:null}
  {preview&&!preview.can_create?<p role="alert">Este acerto ou viagem não aceita novas despesas.</p>:null}
  {changed||invalidated?<p role="alert">Confira o contexto atualizado antes de reenviar.</p>:null}
  <Button type="button" variant="outline" disabled={disabled} onClick={()=>void command.query.refetch().then(result=>{if(alive.current&&result.data&&!result.error){setPreview(result.data);setInvalidated(false);}})}>Atualizar contexto da despesa</Button>
  <fieldset disabled={disabled} className="space-y-3">
   <div><label htmlFor={prefix+'category'}>Categoria</label><select id={prefix+'category'} className="w-full rounded border p-2" value={form.category} onChange={e=>field('category',e.target.value)}>{Object.entries(expenseCategoryLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
   {textField('amount','Valor (R$)')}{textField('expense_at','Data e hora da despesa','datetime-local')}
   <div><label htmlFor={prefix+'payment'}>Origem do pagamento</label><select id={prefix+'payment'} className="w-full rounded border p-2" value={form.payment_source} onChange={e=>{const payment=e.target.value;setForm(f=>({...f,payment_source:payment,reimbursable:!['company_card','company_account'].includes(payment)}));}}>{Object.entries(expensePaymentLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
   <label className="flex gap-2"><input type="checkbox" checked={form.reimbursable} disabled={['company_card','company_account','advance'].includes(form.payment_source)} onChange={e=>field('reimbursable',e.target.checked)}/>Incluir no reembolso do motorista</label>
   {form.payment_source==='advance'?<p>O gasto integra o acerto; o adiantamento deve estar registrado separadamente para o abatimento.</p>:null}
   {sourceType==='settlement'?textField('cost_center','Centro de custo'):null}
   {textField('supplier_name','Fornecedor')}{textField('document_number','Nº documento')}{textField('city','Cidade')}{textField('state','UF')}{textField('odometer','Hodômetro (km)')}
   <div><label htmlFor={prefix+'notes'}>Observação</label><Textarea id={prefix+'notes'} value={form.notes} onChange={e=>field('notes',e.target.value)}/></div>
   <label className="flex gap-2"><input type="checkbox" checked={form.no_receipt} onChange={e=>{field('no_receipt',e.target.checked);setFile(undefined);}}/>Sem comprovante</label>
   {form.no_receipt?textField('no_receipt_reason','Motivo da ausência do comprovante'):<div><label htmlFor={prefix+'receipt'}>Comprovante (imagem ou PDF)</label><input id={prefix+'receipt'} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" onChange={e=>setFile(e.target.files?.[0])}/><p>Máximo 10 MB. Arquivo verificado antes do registro.</p></div>}
  </fieldset>
  {command.pending?<p role="alert">Recupere a despesa pendente no painel de recuperação antes de iniciar outra.</p>:null}
  {command.recoveryError?<p role="alert">{command.recoveryError}</p>:null}{message?<p role="status">{message}</p>:null}
  <Button type="submit" disabled={disabled||!!command.query.error||command.query.isPending||!preview?.can_create||changed||invalidated}>{preparing||command.isPending?'Registrando...':'Registrar despesa'}</Button>
 </form>;
}
