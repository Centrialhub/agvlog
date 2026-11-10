export interface ReceiptRecognition {
 text:string;date_text:string|null;delivery_date:string|null;date_confidence:number;
 signature_presence:'present'|'absent'|'uncertain';signature_confidence:number;needs_review:boolean;
}
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const score=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1;
export function dateFromWrittenText(value:string|null):string|null{
 if(!value)return null;
 const iso=value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
 const br=value.trim().match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/);
 const year=iso?Number(iso[1]):br?Number(br[3])+(br[3].length===2?2000:0):0;
 const month=iso?Number(iso[2]):br?Number(br[2]):0,day=iso?Number(iso[3]):br?Number(br[1]):0;
 if(year<2000||year>2099||month<1||month>12||day<1||day>31)return null;
 const date=new Date(Date.UTC(year,month-1,day));
 return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?date.toISOString().slice(0,10):null;
}
export function parseReceiptRecognition(value:unknown,now=new Date()):ReceiptRecognition{
 if(!object(value)||Object.keys(value).some(k=>!['text','date_text','delivery_date','date_confidence','signature_presence','signature_confidence','needs_review'].includes(k))
  ||typeof value.text!=='string'||value.text.length>8000||!score(value.date_confidence)||!score(value.signature_confidence)
  ||!(value.date_text===null||typeof value.date_text==='string'&&value.date_text.length<=120)
  ||!(value.delivery_date===null||typeof value.delivery_date==='string')||typeof value.needs_review!=='boolean'
  ||!['present','absent','uncertain'].includes(String(value.signature_presence)))throw new Error('ocr_result_invalid');
 const dateText=value.date_text as string|null,parsed=dateFromWrittenText(dateText);
 const date=parsed===value.delivery_date?parsed:null;
 return {text:value.text.trim(),date_text:dateText,delivery_date:date,date_confidence:date?value.date_confidence as number:0,
  signature_presence:value.signature_presence as ReceiptRecognition['signature_presence'],signature_confidence:value.signature_confidence as number,
  needs_review:value.needs_review||!date||date>now.toISOString().slice(0,10)||(value.date_confidence as number)<0.85
   ||value.signature_presence!=='present'||(value.signature_confidence as number)<0.9};
}
export const receiptRecognitionSchema={type:'object',additionalProperties:false,properties:{
 text:{type:'string',maxLength:8000},date_text:{type:['string','null'],maxLength:120},delivery_date:{type:['string','null']},
 date_confidence:{type:'number',minimum:0,maximum:1},signature_presence:{type:'string',enum:['present','absent','uncertain']},
 signature_confidence:{type:'number',minimum:0,maximum:1},needs_review:{type:'boolean'}},
 required:['text','date_text','delivery_date','date_confidence','signature_presence','signature_confidence','needs_review']};
