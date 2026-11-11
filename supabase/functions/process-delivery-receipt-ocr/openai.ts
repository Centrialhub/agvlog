import {parseReceiptRecognition,receiptRecognitionSchema,type ReceiptRecognition} from './recognition.ts';
import {receiptReadingPrompt} from './prompt.ts';
export interface ReceiptOcrUsage{requests:number;input_tokens:number;output_tokens:number}
const validTokens=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=2_000_000;
export async function readOpenAiReceipt(bytes:Uint8Array,mime:string,key:string,model:string,request:typeof fetch,
 usage:ReceiptOcrUsage):Promise<ReceiptRecognition>{
 if(!bytes.length||bytes.length>3*1024*1024||!['image/jpeg','image/png','image/webp'].includes(mime))throw new Error('ocr_image_unsupported');
 let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25_000);
 try{
  usage.requests++;
  const response=await request('https://api.openai.com/v1/responses',{method:'POST',redirect:'error',signal:controller.signal,
   headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,store:false,stream:false,
    max_output_tokens:2500,reasoning:{effort:'none'},instructions:receiptReadingPrompt,
    input:[{role:'user',content:[{type:'input_text',text:'Leia a data da entrega, o texto legível e a presença visual de assinatura deste canhoto.'},
     {type:'input_image',image_url:`data:${mime};base64,${btoa(binary)}`,detail:'high'}]}],
    text:{format:{type:'json_schema',name:'read_delivery_receipt',strict:true,schema:receiptRecognitionSchema}}})});
  if(!response.ok){
   let quota=false;
   if(response.status===429){try{quota=(await response.json())?.error?.code==='insufficient_quota';}catch{/* No provider diagnostics escape. */}}
   throw new Error(response.status===402||quota?'ocr_provider_credits_exhausted':response.status===429?'ocr_provider_rate_limited':'ocr_provider_failed');
  }
  let value;try{value=await response.json();}catch{throw new Error('ocr_result_invalid');}
  if(validTokens(value?.usage?.input_tokens)&&validTokens(value?.usage?.output_tokens)){
   usage.input_tokens+=value.usage.input_tokens;usage.output_tokens+=value.usage.output_tokens;
  }
  if(value?.status!=='completed'||!Array.isArray(value.output)
   ||value.output.some((item:Record<string,unknown>)=>!item||!['reasoning','message'].includes(String(item.type))))throw new Error('ocr_result_invalid');
  const messages=value.output.filter((item:Record<string,unknown>)=>item.type==='message');
  const message=messages[0];
  if(messages.length!==1||message.role!=='assistant'||message.status!=='completed'||!Array.isArray(message.content)
   ||message.content.length!==1||message.content[0]?.type!=='output_text'||typeof message.content[0]?.text!=='string'
   ||message.content[0].text.length>64_000)throw new Error('ocr_result_invalid');
  let result;try{result=JSON.parse(message.content[0].text);}catch{throw new Error('ocr_result_invalid');}
  return parseReceiptRecognition(result);
 }catch(error){
  if(controller.signal.aborted)throw new Error('ocr_provider_timeout');
  const allowed=['ocr_provider_credits_exhausted','ocr_provider_rate_limited','ocr_provider_failed','ocr_result_invalid'];
  throw new Error(error instanceof Error&&allowed.includes(error.message)?error.message:'ocr_provider_failed');
 }finally{clearTimeout(timer);}
}
