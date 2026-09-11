import {useId,useState} from 'react';
import {WifiOff} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {useOnlineStatus} from '@/hooks/useOnlineStatus';
import {useDriverExpenseSubmission,useOperationalDriverExpenseContext} from '@/hooks/useDriverExpensesOperational';
import {creationError,type ExpenseCreationInput,type ExpenseFields} from '@/lib/financial/expenseCreationCommands';
import {expenseCategoryLabels,expensePaymentLabels} from '@/lib/financial/expenseReviewCommands';

interface Props {sourceId:string;onSaved:(message:string)=>void}
const localDate=()=>{const now=new Date();return new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16);};

export function DriverExpenseForm({sourceId,onSaved}:Props){
 const prefix=useId(),online=useOnlineStatus(),contextQuery=useOperationalDriverExpenseContext(sourceId),command=useDriverExpenseSubmission();
 const [file,setFile]=useState<File>(),[message,setMessage]=useState('');
 const [form,setForm]=useState({category:'fuel',amount:'',expense_at:localDate(),payment_source:'driver',reimbursable:true,supplier_name:'',document_number:'',city:'',state:'',odometer:'',notes:''});
 const field=(name:keyof typeof form,value:string|boolean)=>setForm(current=>({...current,[name]:value}));
 const textField=(name:'amount'|'expense_at'|'supplier_name'|'document_number'|'city'|'state'|'odometer',label:string,type='text')=><div><label htmlFor={prefix+name}>{label}</label><Input id={prefix+name} type={type} value={form[name]} onChange={event=>field(name,event.target.value)} inputMode={name==='amount'?'decimal':undefined}/></div>;
 const context=contextQuery.data?.context;const disabled=command.submit.isPending||contextQuery.isPending||!context?.can_create;
 const submit=async()=>{
  setMessage('');try{
   if(!context)throw contextQuery.error??new Error('Carregue o contexto da viagem.');if(!file)throw new Error('Fotografe ou selecione o comprovante da despesa.');
   if(!/^\d+(?:[.,]\d{1,2})?$/.test(form.amount.trim()))throw new Error('Informe um valor positivo com no máximo duas casas decimais.');
   const [whole,fraction='']=form.amount.trim().replace(',','.').split('.'),amountCents=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(amountCents<=0)throw new Error('Informe um valor positivo.');
   const expenseAt=new Date(form.expense_at);if(!Number.isFinite(expenseAt.getTime()))throw new Error('Informe a data e hora da despesa.');
   const fields:ExpenseFields={category:form.category as ExpenseFields['category'],amount_cents:amountCents,expense_at:expenseAt.toISOString(),payment_source:form.payment_source as ExpenseFields['payment_source'],reimbursable:form.reimbursable,
    no_receipt:false,no_receipt_reason:null,notes:form.notes||null,supplier_name:form.supplier_name||null,document_number:form.document_number||null,city:form.city||null,state:form.state||null,odometer:form.odometer?Number(form.odometer):null,cost_center:null};
   const input:ExpenseCreationInput={source_type:'trip',source_id:sourceId,expected_revision:context.revision,fields,receipt:null};const result=await command.submit.mutateAsync({input,file});
   const notice=result.queued?result.message:'Despesa enviada e aguardando aprovação da equipe interna.';setMessage(notice);onSaved(notice);setFile(undefined);setForm(current=>({...current,amount:'',supplier_name:'',document_number:'',notes:''}));
  }catch(cause){setMessage(creationError(cause));}
 };
 return <form className="space-y-3" onSubmit={event=>{event.preventDefault();void submit();}}>
  {contextQuery.isPending?<p role="status">Carregando a viagem...</p>:null}
  {contextQuery.error&&!context?<p role="alert">{creationError(contextQuery.error)}</p>:null}
  {contextQuery.data?.offline?<p role="status" className="flex items-center gap-2 rounded bg-warning/10 p-2 text-xs"><WifiOff aria-hidden="true" className="h-4 w-4"/>Contexto salvo no aparelho. O envio ficará pendente até a conexão voltar.</p>:null}
  {context&&!context.can_create?<p role="alert">Esta viagem não aceita novas despesas.</p>:null}
  <fieldset disabled={disabled} className="space-y-3">
   <div><label htmlFor={prefix+'category'}>Categoria</label><select id={prefix+'category'} className="w-full rounded border p-2" value={form.category} onChange={event=>field('category',event.target.value)}>{Object.entries(expenseCategoryLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
   {textField('amount','Valor (R$)')}{textField('expense_at','Data e hora da despesa','datetime-local')}
   <div><label htmlFor={prefix+'payment'}>Origem do pagamento</label><select id={prefix+'payment'} className="w-full rounded border p-2" value={form.payment_source} onChange={event=>{const payment=event.target.value;setForm(current=>({...current,payment_source:payment,reimbursable:!['company_card','company_account'].includes(payment)}));}}>{Object.entries(expensePaymentLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
   <label className="flex gap-2"><input type="checkbox" checked={form.reimbursable} disabled={['company_card','company_account','advance'].includes(form.payment_source)} onChange={event=>field('reimbursable',event.target.checked)}/>Solicitar reembolso ao motorista</label>
   {textField('supplier_name','Fornecedor')}{textField('document_number','Nº do documento')}{textField('city','Cidade')}{textField('state','UF')}{textField('odometer','Hodômetro (km)')}
   <div><label htmlFor={prefix+'notes'}>Observação</label><Textarea id={prefix+'notes'} value={form.notes} onChange={event=>field('notes',event.target.value)}/></div>
   <div><label htmlFor={prefix+'receipt'}>Comprovante obrigatório</label><input id={prefix+'receipt'} type="file" required capture="environment" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf" onChange={event=>setFile(event.target.files?.[0])}/><p className="text-xs text-muted-foreground">Foto ou PDF, até 10 MB. O arquivo fica salvo no aparelho até a confirmação do servidor.</p></div>
  </fieldset>
  {!online?<p className="text-xs text-muted-foreground">Sem conexão: o registro será salvo no aparelho e sincronizado automaticamente.</p>:null}
  {message?<p role="status">{message}</p>:null}
  <Button type="submit" className="w-full" disabled={disabled}>{command.submit.isPending?'Salvando...':online?'Enviar para aprovação':'Salvar para sincronizar'}</Button>
 </form>;
}
