import {newExpenseLine,type ExpenseBatchDraft,type ExpenseLineDraft} from './expenseBatchContract';
import {parseFinanceAmount} from './ledgerContract';
/** Reuse descriptive context only; each new expense needs its own money and evidence. */
export function repeatExpenseLineDetails(source:ExpenseLineDraft,context:ExpenseBatchDraft['context']):ExpenseLineDraft{return {...newExpenseLine(context),category:source.category,description:source.description,date:source.date,supplier:source.supplier,supplierName:source.supplierName,center:source.center,payeeType:source.payeeType,dueDate:source.dueDate};}
export function expenseErrorField(line:ExpenseLineDraft,message:string):string {
  if(message.includes('entrega')&&(!line.delivery||line.receiptPath))return 'Entrega';
  if(message.includes('comprovante'))return line.receiptPath||line.category==='unloading'?'Comprovante':'Motivo sem comprovante';
  if(message.includes('quem forneceu'))return 'Estabelecimento / prestador';
  if(message.includes('favorecido'))return 'Favorecido';
  if(message.includes('vínculo')||message.includes('vinculado')||message.includes('saldo disponível'))return 'Valor vinculado';
  if(!line.description.trim())return 'Descrição';
  if(!parseFinanceAmount(line.amount))return 'Valor';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(line.date))return 'Data';
  return 'Categoria';
}
