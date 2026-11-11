import {resolveDeliveryReceiptOcrAdapter} from './adapter.ts';
export function receiptOcrConfiguration(env:(name:string)=>string|undefined,request:typeof fetch=fetch){
 const provider=env('DELIVERY_RECEIPT_OCR_ADAPTER');
 const openai=provider==='openai';
 return resolveDeliveryReceiptOcrAdapter(provider,env(openai?'OPENAI_API_KEY':'LOVABLE_API_KEY'),
  env(openai?'OPENAI_RECEIPT_OCR_MODEL':'DELIVERY_RECEIPT_OCR_MODEL'),request);
}
