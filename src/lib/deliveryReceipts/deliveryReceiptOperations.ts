import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { removeSecureFiles, uploadSecureFile } from '@/lib/secureUpload';
import {deliveryReceiptCoverConfigSchema,type DeliveryReceiptCoverConfig} from './deliveryReceiptSupplier';

const id=z.string().uuid();
const nullableText=z.string().nullable();
const documentSchema=z.object({
  id,kind:z.enum(['nfe','nfse','cte','other_fiscal','operational_reference']),number:nullableText,
  series:nullableText,access_key:nullableText,issue_date:nullableText,issuer_name:nullableText,
  issuer_tax_id:nullableText,recipient_name:nullableText,supplier_id:id.nullable(),operational_reference:nullableText,
}).strict();
const partySchema=z.object({id,name:z.string()}).strict().nullable();
const vehicleSchema=z.object({id,plate:z.string()}).strict().nullable();
const clientSchema=z.object({id,name:z.string(),city:nullableText,state:nullableText}).strict().nullable();
export const deliveryReceiptRowSchema=z.object({
  id,delivery_event_id:id,trip_id:id,stop_id:id,delivered_at:z.string().datetime({offset:true}),
  previous_receipt_id:id.nullable().optional(),version:z.number().int().positive().optional(),
  captured_at:z.string().datetime({offset:true}).nullable(),digital_status:z.string(),physical_status:z.string(),
  email_status:z.string(),scan_mode:z.string(),has_original:z.boolean(),has_processed:z.boolean(),has_pdf:z.boolean(),
  rejection_reason:nullableText.optional(),
  receiver_name:nullableText,driver:partySchema,vehicle:vehicleSchema,client:clientSchema.default(null),load_ids:z.array(id).default([]),destination:nullableText,
  documents:z.array(documentSchema),updated_at:z.string().datetime({offset:true}),
}).strict();
export type DeliveryReceiptRow=z.infer<typeof deliveryReceiptRowSchema>;

const pageSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,rows:z.array(deliveryReceiptRowSchema),
  total:z.number().int().nonnegative(),limit:z.number().int().positive(),offset:z.number().int().nonnegative()}).strict();
export type DeliveryReceiptPage=z.infer<typeof pageSchema>;
export const DELIVERY_RECEIPT_PAGE_SIZE=25;
export interface DeliveryReceiptPagination {limit?:number;offset?:number}
export interface DeliveryReceiptFilters {search?:string;date_from?:string;date_to?:string;digital_status?:string;physical_status?:string;
  email_status?:string;scan_mode?:string;supplier_id?:string;driver_id?:string;vehicle_id?:string;document_kind?:string;has_pdf?:boolean;
  trip_id?:string;load_id?:string;client_id?:string;destination_city?:string;destination_state?:string;receiver?:string}
export interface DeliveryReceiptFilterOption {value:string;label:string}
export interface DeliveryReceiptWorkflowSummary {
  awaiting_sync:number;awaiting_validation:number;rejected:number;validated:number;physical_pending:number;
  ready_to_send:number;sent:number;send_failures:number;
}
export interface DeliveryReceiptFilterCatalog {
  total:number;queues:DeliveryReceiptWorkflowSummary;
  drivers:DeliveryReceiptFilterOption[];vehicles:DeliveryReceiptFilterOption[];suppliers:DeliveryReceiptFilterOption[];
  trips:DeliveryReceiptFilterOption[];loads:DeliveryReceiptFilterOption[];clients:DeliveryReceiptFilterOption[];
  cities:DeliveryReceiptFilterOption[];states:DeliveryReceiptFilterOption[];
}
export interface DeliveryReceiptEmailDraft {
  supplierKey:string;
  supplier:string;
  receiptIds:string[];
  recipients:string[];
  subject:string;
  body:string;
  cover:DeliveryReceiptCoverConfig;
}

const deliveryReceiptEmailDraftSchema=z.object({
  supplierKey:z.string().trim().min(4).max(200),
  supplier:z.string().trim().min(2).max(200),
  receiptIds:z.array(id).min(1).max(5).refine(values=>new Set(values).size===values.length),
  recipients:z.array(z.string().trim().toLowerCase().email()).min(1).max(10).refine(values=>new Set(values).size===values.length),
  subject:z.string().trim().min(3).max(200),
  body:z.string().trim().min(3).max(5000),
  cover:deliveryReceiptCoverConfigSchema,
}).strict();
const deliveryReceiptEmailOutboxEntrySchema=z.object({
  requestId:id,draft:deliveryReceiptEmailDraftSchema,createdAt:z.string().datetime({offset:true}),
}).strict();
type DeliveryReceiptEmailOutboxEntry=z.infer<typeof deliveryReceiptEmailOutboxEntrySchema>;
const EMAIL_OUTBOX_MAX_AGE_MS=24*60*60*1000;
export const DELIVERY_RECEIPT_PDF_MIN_DPI=200;
export const DELIVERY_RECEIPT_PDF_MAX_BYTES=5*1024*1024;
const DELIVERY_RECEIPT_PDF_MARGIN_MM=4;

const commandSchema=z.object({id,digital_status:z.string().optional(),physical_status:z.string().optional(),
  updated_at:z.string().datetime({offset:true}),confirmed:z.literal(true)}).strict();
const physicalCommandSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,request_id:id,id,
  physical_status:z.enum(['received','missing','waived']),occurrence_event_id:id.nullable(),
  updated_at:z.string().datetime({offset:true}),confirmed:z.literal(true),replayed:z.boolean()}).strict();
const pdfPreparationSchema=z.object({version:z.literal(1),tenant_id:id,actor_id:id,request_id:id,receipt_id:id,
  bucket:z.literal('receipts'),source_kind:z.enum(['pdf','processed_image']),path:z.string().min(1),file_name:z.string().min(5),
  receipt_updated_at:z.string().datetime({offset:true})}).strict();
const pdfAttachmentSchema=z.object({version:z.literal(1),receipt_id:id,path:z.string().min(1),
  updated_at:z.string().datetime({offset:true}),confirmed:z.literal(true)}).strict();
const pdfCompletionSchema=z.object({version:z.literal(1),request_id:id,receipt_id:id,status:z.literal('completed'),
  completed_at:z.string().datetime({offset:true}),confirmed:z.literal(true)}).strict();
const emailQueuedSchema=z.object({version:z.literal(1),batch_id:id,status:z.string(),receipt_count:z.number().int().min(1).max(5),confirmed:z.literal(true)}).strict();
const emailSentSchema=z.object({batch_id:id,status:z.literal('sent'),provider_message_id:z.string().min(5).max(200),replayed:z.boolean()}).strict();

type ReceiptRpcArgs={
  list_delivery_receipts_v1:{_tenant_id:string;_filters:DeliveryReceiptFilters;_limit:number;_offset:number};
  review_delivery_receipt_v1:{_tenant_id:string;_receipt_id:string;_decision:'validated'|'rejected';_reason:string|null;_expected_updated_at:string};
  receive_physical_delivery_receipt_v1:{_tenant_id:string;_receipt_id:string;_expected_updated_at:string};
  record_delivery_receipt_physical_status_v1:{_tenant_id:string;_receipt_id:string;_request_id:string;
    _status:'received'|'missing'|'waived';_reason:string|null;_expected_updated_at:string};
  prepare_delivery_receipt_pdf_v1:{_tenant_id:string;_receipt_id:string;_request_id:string;_file_name:string};
  attach_delivery_receipt_pdf_v1:{_tenant_id:string;_receipt_id:string;_request_id:string;_path:string;_expected_updated_at:string};
  complete_delivery_receipt_pdf_download_v1:{_tenant_id:string;_receipt_id:string;_request_id:string};
  queue_delivery_receipt_email_v2:{_tenant_id:string;_request_id:string;_supplier_key:string;_supplier_name:string;_receipt_ids:string[];
    _recipients:string[];_subject:string;_body_text:string;_cover_config:DeliveryReceiptCoverConfig};
};
interface RpcResponse {data:unknown;error:unknown}
interface RpcBuilder extends PromiseLike<RpcResponse>{abortSignal:(signal:AbortSignal)=>PromiseLike<RpcResponse>}
const rpc=supabase.rpc as unknown as <Name extends keyof ReceiptRpcArgs>(name:Name,args:ReceiptRpcArgs[Name])=>RpcBuilder;

export async function listDeliveryReceipts(tenant:string,actor:string,filters:DeliveryReceiptFilters,
  pagination:DeliveryReceiptPagination={},signal?:AbortSignal) {
  const limit=pagination.limit??DELIVERY_RECEIPT_PAGE_SIZE,offset=pagination.offset??0;
  const request=rpc('list_delivery_receipts_v1',{_tenant_id:tenant,_filters:filters,_limit:limit,_offset:offset});
  const {data,error}=await (signal?request.abortSignal(signal):request);
  if(error)throw error;
  const parsed=pageSchema.safeParse(data);
  if(!parsed.success||parsed.data.tenant_id!==tenant||parsed.data.actor_id!==actor)throw new Error('Lista de canhotos incompatível com a sessão atual.');
  if(parsed.data.limit!==limit||parsed.data.offset!==offset)throw new Error('Paginação de canhotos incompatível com a consulta solicitada.');
  return parsed.data;
}

export async function listAllDeliveryReceipts(tenant:string,actor:string,filters:DeliveryReceiptFilters,signal?:AbortSignal){
  const rows:DeliveryReceiptRow[]=[],seen=new Set<string>();let offset=0,total=1;
  while(offset<total){
    const page=await listDeliveryReceipts(tenant,actor,filters,{limit:100,offset},signal);total=page.total;
    for(const row of page.rows)if(!seen.has(row.id)){seen.add(row.id);rows.push(row);}
    if(page.rows.length===0&&offset<total)throw new Error('A lista completa de canhotos filtrados não pôde ser carregada.');
    offset+=page.limit;
  }
  return rows;
}

function sortedOptions(entries:Iterable<readonly[string,string]>){
  return [...new Map(entries).entries()].map(([value,label])=>({value,label}))
    .sort((left,right)=>left.label.localeCompare(right.label,'pt-BR',{sensitivity:'base'})||left.value.localeCompare(right.value));
}

export function deliveryReceiptWorkflowSummary(rows:DeliveryReceiptRow[]):DeliveryReceiptWorkflowSummary{
  return {
    awaiting_sync:rows.filter(row=>row.digital_status==='pending_upload').length,
    awaiting_validation:rows.filter(row=>row.digital_status==='uploaded'||row.digital_status==='pending_validation').length,
    rejected:rows.filter(row=>row.digital_status==='rejected').length,
    validated:rows.filter(row=>row.digital_status==='validated').length,
    physical_pending:rows.filter(row=>row.physical_status==='pending_return'||row.physical_status==='missing').length,
    ready_to_send:rows.filter(row=>row.digital_status==='validated'&&row.has_pdf&&row.email_status==='not_sent').length,
    sent:rows.filter(row=>row.email_status==='sent'||row.email_status==='delivered').length,
    send_failures:rows.filter(row=>row.email_status==='failed'||row.email_status==='bounced').length,
  };
}

export function deliveryReceiptFilterCatalog(rows:DeliveryReceiptRow[]):DeliveryReceiptFilterCatalog{
  const cities=new Map<string,string>(),states=new Map<string,string>();
  for(const row of rows){
    const city=row.client?.city?.trim();if(city&&!cities.has(city.toLocaleLowerCase('pt-BR')))cities.set(city.toLocaleLowerCase('pt-BR'),city);
    const state=row.client?.state?.trim().toUpperCase();if(state)states.set(state,state);
  }
  return {total:rows.length,queues:deliveryReceiptWorkflowSummary(rows),
    drivers:sortedOptions(rows.flatMap(row=>row.driver?[[row.driver.id,row.driver.name] as const]:[])),
    vehicles:sortedOptions(rows.flatMap(row=>row.vehicle?[[row.vehicle.id,row.vehicle.plate] as const]:[])),
    suppliers:sortedOptions(rows.flatMap(row=>row.documents.flatMap(document=>document.supplier_id?
      [[document.supplier_id,document.issuer_name?.trim()||'Fornecedor sem nome'] as const]:[]))),
    trips:sortedOptions(rows.map(row=>[row.trip_id,`Viagem ${row.trip_id.slice(0,8)}`] as const)),
    loads:sortedOptions(rows.flatMap(row=>row.load_ids.map(load=>[load,`Carga ${load.slice(0,8)}`] as const))),
    clients:sortedOptions(rows.flatMap(row=>row.client?[[row.client.id,row.client.name] as const]:[])),
    cities:sortedOptions(cities.entries()),states:sortedOptions(states.entries())};
}

export async function getDeliveryReceiptFilterCatalog(tenant:string,actor:string,signal?:AbortSignal){
  const rows=await listAllDeliveryReceipts(tenant,actor,{},signal);
  return deliveryReceiptFilterCatalog(rows);
}

export async function reviewDeliveryReceipt(tenant:string,row:DeliveryReceiptRow,decision:'validated'|'rejected',reason?:string) {
  const {data,error}=await rpc('review_delivery_receipt_v1',{_tenant_id:tenant,_receipt_id:row.id,_decision:decision,
    _reason:reason?.trim()||null,_expected_updated_at:row.updated_at});
  if(error)throw error;
  const parsed=commandSchema.safeParse(data);
  if(!parsed.success||parsed.data.id!==row.id||parsed.data.digital_status!==decision)throw new Error('A revisão do canhoto não foi confirmada.');
  return parsed.data;
}

export async function recordPhysicalDeliveryReceiptStatus(tenant:string,actor:string,row:DeliveryReceiptRow,
  status:'received'|'missing'|'waived',reason?:string,requestId=crypto.randomUUID()) {
  const {data,error}=await rpc('record_delivery_receipt_physical_status_v1',{_tenant_id:tenant,_receipt_id:row.id,_request_id:requestId,
    _status:status,_reason:reason?.trim()||null,_expected_updated_at:row.updated_at});
  if(error)throw error;
  const parsed=physicalCommandSchema.safeParse(data);
  if(!parsed.success||parsed.data.tenant_id!==tenant||parsed.data.actor_id!==actor||parsed.data.id!==row.id||parsed.data.physical_status!==status){
    throw new Error('A custódia física do canhoto não foi confirmada.');
  }
  return parsed.data;
}

export async function receivePhysicalDeliveryReceipt(tenant:string,actor:string,row:DeliveryReceiptRow) {
  return recordPhysicalDeliveryReceiptStatus(tenant,actor,row,'received');
}

export function deliveryReceiptError(cause:unknown) {
  const message=cause instanceof Error?cause.message:typeof cause==='object'&&cause&&'message'in cause?String(cause.message):'';
  if(/waiver_admin_required/i.test(message))return 'Somente proprietário ou administrador pode dispensar a devolução do papel.';
  if(/invalid_physical_status/i.test(message))return 'Informe uma justificativa com pelo menos 5 caracteres para a exceção do canhoto físico.';
  if(/not_authorized|permission denied|42501/i.test(message))return 'Sua sessão não pode consultar ou revisar canhotos desta empresa.';
  if(/changed|40001|concurrent/i.test(message))return 'O canhoto foi alterado por outra pessoa. Atualize a lista antes de continuar.';
  if(/invalid.*review|22023/i.test(message))return 'Informe uma justificativa válida para a rejeição.';
  if(/physical_status_(unchanged|regression)/i.test(message))return 'Essa alteração não é válida para o estado atual do canhoto físico.';
  if(/rate.?limit|429/i.test(message))return 'O provedor limitou os envios. Aguarde o horário indicado e tente novamente com o mesmo lote.';
  if(/delivery_email_busy/i.test(message))return 'Este lote já está sendo enviado. Aguarde alguns instantes e tente novamente.';
  if(/outbox.*expired/i.test(message))return 'A confirmação deste envio expirou. Verifique o histórico antes de gerar um novo lote.';
  if(/template.*changed|supplier_conflict/i.test(message))return 'O modelo deste fornecedor mudou ou já existe. Atualize o painel antes de salvar novamente.';
  if(/replacement.*file|file_signature|invalid_upload/i.test(message))return 'O arquivo substituto não é um scan ou PDF válido desta empresa.';
  if(/replacement.*conflict/i.test(message))return 'A substituição não corresponde à solicitação original. Atualize o canhoto antes de continuar.';
  return message||'Não foi possível concluir a operação com o canhoto.';
}

export function deliveryReceiptFileName(row:DeliveryReceiptRow) {
  const supplier=row.documents.find(document=>document.issuer_name)?.issuer_name||'FORNECEDOR';
  const safe=supplier.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'FORNECEDOR';
  const load=row.load_ids.length===0?'SEM-CARGA':row.load_ids.length===1?row.load_ids[0].slice(0,8):`${row.load_ids[0].slice(0,8)}-M${row.load_ids.length}`;
  return `CANHOTO_${safe}_${row.delivered_at.slice(0,10)}_CARGA-${load}_ENTREGA-${row.delivery_event_id.slice(0,8)}.pdf`;
}

function blobDataUrl(blob:Blob):Promise<string>{
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(reader.error??new Error('Não foi possível ler o scan.'));
    reader.onload=()=>resolve(String(reader.result));reader.readAsDataURL(blob);});
}

function imageSize(url:string):Promise<{width:number;height:number}>{
  return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve({width:image.naturalWidth,height:image.naturalHeight});
    image.onerror=()=>reject(new Error('O scan processado não pôde ser convertido em PDF.'));image.src=url;});
}

export interface DeliveryReceiptPdfMetrics {
  orientation:'portrait'|'landscape';
  widthMm:number;
  heightMm:number;
  effectiveDpi:number;
}

export function deliveryReceiptPdfMetrics(pixelWidth:number,pixelHeight:number):DeliveryReceiptPdfMetrics {
  if(!Number.isFinite(pixelWidth)||!Number.isFinite(pixelHeight)||pixelWidth<=0||pixelHeight<=0){
    throw new Error('O scan processado possui dimensões inválidas. Recapture o canhoto.');
  }
  const orientation=pixelWidth>pixelHeight?'landscape':'portrait',pageWidth=orientation==='landscape'?297:210,pageHeight=orientation==='landscape'?210:297,
    scale=Math.min((pageWidth-DELIVERY_RECEIPT_PDF_MARGIN_MM*2)/pixelWidth,(pageHeight-DELIVERY_RECEIPT_PDF_MARGIN_MM*2)/pixelHeight),
    widthMm=pixelWidth*scale,heightMm=pixelHeight*scale,
    effectiveDpi=Math.min(pixelWidth/(widthMm/25.4),pixelHeight/(heightMm/25.4));
  return {orientation,widthMm,heightMm,effectiveDpi};
}

function assertReceiptPdfDpi(metrics:DeliveryReceiptPdfMetrics){
  if(metrics.effectiveDpi+Number.EPSILON<DELIVERY_RECEIPT_PDF_MIN_DPI){
    throw new Error('O scan não possui resolução suficiente para gerar um PDF de 200 DPI. Recapture o canhoto com o papel inteiro e a câmera em maior resolução.');
  }
}

function compressedScanDataUrl(dataUrl:string,width:number,height:number,quality:number){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');if(!context)throw new Error('Este navegador não conseguiu compactar o scan. Recapture o canhoto ou tente em outro aparelho.');
  return imageElement(dataUrl).then(image=>{context.drawImage(image,0,0,width,height);return canvas.toDataURL('image/jpeg',quality);});
}

function imageElement(url:string):Promise<HTMLImageElement>{
  return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);
    image.onerror=()=>reject(new Error('O scan processado não pôde ser convertido em PDF.'));image.src=url;});
}

async function scanPdf(scan:Blob,fileName:string):Promise<File>{
  const [{default:JsPdf},dataUrl]=await Promise.all([import('jspdf'),blobDataUrl(scan)]);
  const size=await imageSize(dataUrl),sourceMetrics=deliveryReceiptPdfMetrics(size.width,size.height);assertReceiptPdfDpi(sourceMetrics);
  const render=(imageDataUrl:string,format:string,metrics:DeliveryReceiptPdfMetrics)=>{
    const pdf=new JsPdf({orientation:metrics.orientation,unit:'mm',format:'a4',compress:true}),pageWidth=pdf.internal.pageSize.getWidth(),pageHeight=pdf.internal.pageSize.getHeight();
    pdf.addImage(imageDataUrl,format,(pageWidth-metrics.widthMm)/2,(pageHeight-metrics.heightMm)/2,metrics.widthMm,metrics.heightMm,undefined,'MEDIUM');
    return new File([pdf.output('blob')],fileName,{type:'application/pdf'});
  };
  const sourceFormat=scan.type==='image/png'?'PNG':scan.type==='image/webp'?'WEBP':'JPEG',originalPdf=render(dataUrl,sourceFormat,sourceMetrics);
  if(originalPdf.size<=DELIVERY_RECEIPT_PDF_MAX_BYTES)return originalPdf;

  const profiles=[{dpi:Math.min(sourceMetrics.effectiveDpi,300),quality:.86},{dpi:Math.min(sourceMetrics.effectiveDpi,300),quality:.74},
    {dpi:Math.min(sourceMetrics.effectiveDpi,250),quality:.7},{dpi:Math.min(sourceMetrics.effectiveDpi,225),quality:.64},
    {dpi:DELIVERY_RECEIPT_PDF_MIN_DPI,quality:.58},{dpi:DELIVERY_RECEIPT_PDF_MIN_DPI,quality:.5}];
  for(const profile of profiles){
    const width=Math.min(size.width,Math.ceil(sourceMetrics.widthMm/25.4*profile.dpi)),
      height=Math.min(size.height,Math.ceil(sourceMetrics.heightMm/25.4*profile.dpi)),metrics=deliveryReceiptPdfMetrics(width,height);
    assertReceiptPdfDpi(metrics);
    const compressedDataUrl=await compressedScanDataUrl(dataUrl,width,height,profile.quality),candidate=render(compressedDataUrl,'JPEG',metrics);
    if(candidate.size<=DELIVERY_RECEIPT_PDF_MAX_BYTES)return candidate;
  }
  throw new Error('Não foi possível gerar um PDF de até 5 MB sem reduzir o canhoto abaixo de 200 DPI. Recapture o canhoto com boa iluminação, sem reflexos e preenchendo o enquadramento.');
}

function saveBlob(blob:Blob,fileName:string){
  const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=fileName;
  document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
}

export async function downloadDeliveryReceiptPdf(tenant:string,actor:string,row:DeliveryReceiptRow){
  const requestId=crypto.randomUUID(),fileName=deliveryReceiptFileName(row);
  const preparedResponse=await rpc('prepare_delivery_receipt_pdf_v1',{_tenant_id:tenant,_receipt_id:row.id,_request_id:requestId,_file_name:fileName});
  if(preparedResponse.error)throw preparedResponse.error;
  const prepared=pdfPreparationSchema.parse(preparedResponse.data);
  if(prepared.tenant_id!==tenant||prepared.actor_id!==actor||prepared.receipt_id!==row.id||prepared.request_id!==requestId){
    throw new Error('A preparação do PDF não pertence a esta sessão.');
  }
  const downloaded=await supabase.storage.from(prepared.bucket).download(prepared.path);
  if(downloaded.error||!downloaded.data)throw downloaded.error??new Error('O arquivo do canhoto não está disponível.');
  let pdfBlob:Blob=downloaded.data;
  if(prepared.source_kind==='processed_image'){
    const pdfFile=await scanPdf(downloaded.data,fileName);
    const path=await uploadSecureFile({tenantId:tenant,bucket:'receipts',folder:`delivery-pdfs/${row.id}`,file:pdfFile,kind:'proof'});
    const attached=await rpc('attach_delivery_receipt_pdf_v1',{_tenant_id:tenant,_receipt_id:row.id,_request_id:requestId,_path:path,
      _expected_updated_at:prepared.receipt_updated_at});
    if(attached.error){await removeSecureFiles(tenant,'receipts',[path]).catch(()=>undefined);throw attached.error;}
    const parsed=pdfAttachmentSchema.parse(attached.data);if(parsed.receipt_id!==row.id||parsed.path!==path)throw new Error('O PDF gerado não foi vinculado ao canhoto.');
    pdfBlob=pdfFile;
  }
  const completed=await rpc('complete_delivery_receipt_pdf_download_v1',{_tenant_id:tenant,_receipt_id:row.id,_request_id:requestId});
  if(completed.error)throw completed.error;
  const completion=pdfCompletionSchema.parse(completed.data);
  if(completion.request_id!==requestId||completion.receipt_id!==row.id)throw new Error('O download do PDF não foi auditado.');
  saveBlob(pdfBlob,fileName);
  return completion;
}

function canonicalEmailDraft(draft:DeliveryReceiptEmailDraft){
  return deliveryReceiptEmailDraftSchema.parse({...draft,receiptIds:[...draft.receiptIds].sort(),
    recipients:[...draft.recipients].map(value=>value.trim().toLowerCase()).sort(),subject:draft.subject.trim(),
    body:draft.body.trim(),supplier:draft.supplier.trim()});
}

function emailOutboxKey(tenant:string,actor:string){return `agvlog:delivery-receipt-email:v1:${tenant}:${actor}`;}

function readEmailOutbox(tenant:string,actor:string):DeliveryReceiptEmailOutboxEntry[]{
  if(typeof localStorage==='undefined')throw new Error('delivery_email_outbox_unavailable');
  try{
    const parsed=JSON.parse(localStorage.getItem(emailOutboxKey(tenant,actor))??'[]');
    if(!Array.isArray(parsed))return [];
    return parsed.map(value=>deliveryReceiptEmailOutboxEntrySchema.safeParse(value)).filter(result=>result.success).map(result=>result.data);
  }catch(cause){
    if(cause instanceof SyntaxError)return [];
    throw new Error('delivery_email_outbox_unavailable');
  }
}

function writeEmailOutbox(tenant:string,actor:string,entries:DeliveryReceiptEmailOutboxEntry[]){
  try{localStorage.setItem(emailOutboxKey(tenant,actor),JSON.stringify(entries));}
  catch{throw new Error('delivery_email_outbox_unavailable');}
}

export async function queueAndSendDeliveryReceiptEmail(tenant:string,actor:string,draft:DeliveryReceiptEmailDraft,
  options:{requestId?:string}={}){
  id.parse(tenant);id.parse(actor);const canonical=canonicalEmailDraft(draft);const serialized=JSON.stringify(canonical);
  const outbox=readEmailOutbox(tenant,actor);let pending=outbox.find(entry=>JSON.stringify(entry.draft)===serialized);
  if(pending&&Date.now()-Date.parse(pending.createdAt)>EMAIL_OUTBOX_MAX_AGE_MS)throw new Error('delivery_email_outbox_expired');
  if(!pending){pending={requestId:options.requestId??crypto.randomUUID(),draft:canonical,createdAt:new Date().toISOString()};
    writeEmailOutbox(tenant,actor,[...outbox,pending].slice(-20));}
  if(options.requestId&&pending.requestId!==options.requestId)throw new Error('delivery_email_request_conflict');
  const requestId=pending.requestId;
  const queuedResponse=await rpc('queue_delivery_receipt_email_v2',{_tenant_id:tenant,_request_id:requestId,
    _supplier_key:canonical.supplierKey,_supplier_name:canonical.supplier,_receipt_ids:canonical.receiptIds,_recipients:canonical.recipients,
    _subject:canonical.subject,_body_text:canonical.body,_cover_config:canonical.cover});
  if(queuedResponse.error)throw queuedResponse.error;
  const queued=emailQueuedSchema.parse(queuedResponse.data);
  if(queued.batch_id!==requestId||queued.receipt_count!==canonical.receiptIds.length){
    throw new Error('A fila de envio não corresponde aos canhotos selecionados.');
  }
  const invocation=await supabase.functions.invoke('send-delivery-receipts',{body:{tenant_id:tenant,batch_id:queued.batch_id}});
  if(invocation.error)throw invocation.error;
  const sent=emailSentSchema.safeParse(invocation.data);
  if(!sent.success||sent.data.batch_id!==queued.batch_id)throw new Error('O provedor não confirmou o envio dos canhotos.');
  writeEmailOutbox(tenant,actor,readEmailOutbox(tenant,actor).filter(entry=>entry.requestId!==requestId));
  return sent.data;
}
