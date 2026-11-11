import {readOpenAiReceipt,type ReceiptOcrUsage} from './openai.ts';
import {receiptReadingPrompt} from './prompt.ts';
import {parseReceiptRecognition,receiptRecognitionSchema,type ReceiptRecognition} from './recognition.ts';
type Disabled={available:false;errorCode:'ocr_not_configured'|'ocr_adapter_unsupported'};
export type OcrAdapterAvailability=Disabled|{available:true;provider:'lovable'|'openai';model:string;usage?:ReceiptOcrUsage;read:(bytes:Uint8Array,mime:string)=>Promise<ReceiptRecognition>};
export function resolveDeliveryReceiptOcrAdapter(value:string|undefined,key?:string,model?:string,request:typeof fetch=fetch):OcrAdapterAvailability{
 if(!value||value.trim()===''||value==='disabled')return {available:false,errorCode:'ocr_not_configured'};
 if(value!=='lovable'&&value!=='openai')return {available:false,errorCode:'ocr_adapter_unsupported'};
 if(!key?.trim()||key.length>512||/[\r\n]/.test(key))return {available:false,errorCode:'ocr_not_configured'};
 const selectedModel=model||(value==='openai'?'gpt-6-luna':'google/gemini-3-flash-preview');
 if(!/^[a-zA-Z0-9_.:/-]{1,120}$/.test(selectedModel))return {available:false,errorCode:'ocr_adapter_unsupported'};
 if(value==='openai'){const usage:ReceiptOcrUsage={requests:0,input_tokens:0,output_tokens:0};return {available:true,provider:'openai',model:selectedModel,usage,read:(bytes,mime)=>readOpenAiReceipt(bytes,mime,key,selectedModel,request,usage)};}
 return {available:true,provider:'lovable',model:selectedModel,read:async(bytes,mime)=>{
  if(bytes.length>3*1024*1024||!['image/jpeg','image/png','image/webp'].includes(mime))throw new Error('ocr_image_unsupported');
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25_000);
  try{
   const response=await request('https://ai.gateway.lovable.dev/v1/chat/completions',{method:'POST',signal:controller.signal,
    headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:selectedModel,stream:false,max_tokens:2500,
     messages:[{role:'system',content:receiptReadingPrompt},
      {role:'user',content:[{type:'text',text:'Leia a data da entrega, o texto legível e a presença visual de assinatura deste canhoto.'},
       {type:'image_url',image_url:{url:`data:${mime};base64,${btoa(binary)}`}}]}],
     tools:[{type:'function',function:{name:'read_delivery_receipt',description:'Leitura do canhoto com evidência textual e presença visual de assinatura, sem autenticação de identidade.',parameters:receiptRecognitionSchema}}],
     tool_choice:{type:'function',function:{name:'read_delivery_receipt'}}})});
   if(!response.ok)throw new Error(response.status===402?'ocr_provider_credits_exhausted':response.status===429?'ocr_provider_rate_limited':'ocr_provider_failed');
   const json=await response.json();const calls=json?.choices?.[0]?.message?.tool_calls;
   if(!Array.isArray(calls)||calls.length!==1||calls[0]?.function?.name!=='read_delivery_receipt'||typeof calls[0].function.arguments!=='string')throw new Error('ocr_result_invalid');
   return parseReceiptRecognition(JSON.parse(calls[0].function.arguments));
  }catch(error){if(controller.signal.aborted)throw new Error('ocr_provider_timeout');throw error;}
  finally{clearTimeout(timer);}
 }};
}
