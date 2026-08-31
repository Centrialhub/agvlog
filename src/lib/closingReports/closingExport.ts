import type {BuiltItem,SummaryLine} from './closingReportBuilder';
export function closingItemTrace(item:BuiltItem){
 const metadata=item.metadata&&typeof item.metadata==='object'&&!Array.isArray(item.metadata)?item.metadata as Record<string,unknown>:{};
 return {attempt:typeof metadata.attempt_id==='string'?metadata.attempt_id:metadata.source_key?'Original':'Não informado',
  outcome:item.delivery_status||'Sem resultado auditado',review:metadata.financial_review_required===true||metadata.review_required===true?'Revisão necessária':'',
  sourceKey:typeof metadata.source_key==='string'?metadata.source_key:''};
}
export function closingExportTotals(items:BuiltItem[],summary:SummaryLine[]=[]){
 const seen=new Map<string,number>();let value=0,weight=0,freight=0;
 for(const [index,item] of items.entries()){
  const key=item.invoice_key?.trim()||item.fiscal_document_id||`row:${item.sort_order}:${index}`;
  if([item.invoice_value,item.weight_kg,item.freight_value].some(n=>!Number.isFinite(n)||n<0))throw new Error('Valores inválidos no relatório. Concilie antes de exportar.');
  if(seen.has(key)&&seen.get(key)!==item.invoice_value)throw new Error('A mesma nota tem valores divergentes. Concilie antes de exportar.');
  if(!seen.has(key)){value+=item.invoice_value;seen.set(key,item.invoice_value);}weight+=item.weight_kg;freight+=item.freight_value;
 }
 if(!items.length)for(const row of summary){value+=row.total_invoice_value;weight+=row.total_weight_kg;freight+=row.total_freight_value;}
 return {value:Math.round(value*100)/100,weight,freight:Math.round(freight*100)/100,notes:seen.size,attempts:items.length};
}
export function closingTripKey(item:BuiltItem){return item.load_id||closingItemTrace(item).sourceKey||`${item.fiscal_document_id||'manual'}:${item.sort_order}`;}
