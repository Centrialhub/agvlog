import type {sanitizeQuarantineImage} from './quarantine-image.ts';
import {validateQuarantinedData} from './quarantine-validation.ts';

type Rpc = (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
export interface QuarantineDependencies {
 caller:Rpc;
 image?:(bytes:Uint8Array)=>Promise<ReturnType<typeof sanitizeQuarantineImage>>;
 service:Rpc;
 // Must create exclusively, or verify the complete existing bytes on replay. Never overwrite.
 put:(bucket:string,path:string,bytes:Uint8Array,mime:string,metadata:Record<string,unknown>)=>Promise<void>;
}
export async function quarantineSha256(bytes:Uint8Array):Promise<string>{
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes).buffer)),b=>b.toString(16).padStart(2,'0')).join('');
}
const record=(value:unknown):Record<string,unknown>=>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('upload_response_invalid');
 return value as Record<string,unknown>;
};
const uuid=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export async function quarantineUpload(input:{tenant:string;actor:string;request:string;sourceType:string;sourceId:string;format:string;mime:string;bytes:Uint8Array;delimiter?:';'|','|'\t'},deps:QuarantineDependencies):Promise<Record<string,unknown>>{
 const {tenant,actor,request,sourceType,sourceId,format,mime,bytes}=input;
 if(![tenant,actor,request,sourceId].every(uuid)||!['trip','settlement','bank_account','expense_item','expense_draft'].includes(sourceType)||!['ofx','csv','jpeg','png','pdf','xls','xlsx','unknown'].includes(format)||!bytes.length||bytes.length>10485760)throw new Error('upload_invalid_request');
 const sha256=await quarantineSha256(bytes);
 const rpc=async(fn:Rpc,name:string,args:Record<string,unknown>)=>{const result=await fn(name,args);if(result.error)throw result.error;return record(result.data);};
 const check=(value:unknown)=>{
  const dto=record(value),original=record(dto.original);
  if(dto.version!==2||dto.tenant_id!==tenant||dto.actor_id!==actor||dto.request_id!==request||dto.source_type!==sourceType||dto.source_id!==sourceId||original.sha256!==sha256||original.size_bytes!==bytes.length||original.format!==format||typeof dto.artifact_id!=='string'||!uuid(dto.artifact_id))throw new Error('upload_response_identity_mismatch');
  if(typeof original.received!=='boolean'||typeof dto.usable!=='boolean'||!['quarantined','validated_data','sanitized_derivative','rejected','validation_failed'].includes(String(dto.state))||!Array.isArray(dto.issues)||dto.issues.some(issue=>typeof issue!=='string'))throw new Error('upload_response_invalid');
  let derivative:Record<string,unknown>|null=null;
  if(dto.derivative!==null){const d=record(dto.derivative);if(d.bucket!=='upload-validated'||typeof d.path!=='string'||!['json','jpg','png'].some(ext=>d.path===`${tenant}/${request}/validated.${ext}`))throw new Error('upload_response_identity_mismatch');
    derivative={bucket:d.bucket,path:d.path,sha256:d.sha256,size_bytes:d.size_bytes,mime:d.mime,method:d.method,financial_mapping_required:d.financial_mapping_required};}
  // Return only the public DTO. Service tickets and original paths can never escape through this response.
  return {version:2,tenant_id:tenant,actor_id:actor,request_id:request,artifact_id:dto.artifact_id,source_type:sourceType,source_id:sourceId,state:dto.state,
    original:{sha256,size_bytes:bytes.length,format,received:original.received},usable:dto.usable,derivative,issues:dto.issues};
 };
 const reserved=check(await rpc(deps.caller,'reserve_finance_upload_artifact',{_payload:{version:2,tenant_id:tenant,request_id:request,source_type:sourceType,source_id:sourceId,original_sha256:sha256,size_bytes:bytes.length,declared_mime:mime,format}}));
 const artifact=reserved.artifact_id;
 const prepared=await rpc(deps.service,'prepare_finance_upload_artifact',{_artifact_id:artifact,_tenant_id:tenant,_actor_id:actor,_sha256:sha256,_size_bytes:bytes.length});
 if(prepared.version!==2||prepared.artifact_id!==artifact||typeof prepared.ticket!=='string'||!uuid(prepared.ticket)||prepared.original_bucket!=='upload-quarantine'||prepared.original_path!==`${tenant}/${request}/original`||prepared.derived_bucket!=='upload-validated'||prepared.derived_prefix!==`${tenant}/${request}/validated`)throw new Error('upload_response_identity_mismatch');
 const existing=check(prepared.result);
 // A completed original is immutable. Replays return its recorded outcome, including quarantine/rejection.
 if(record(existing.original).received===true)return existing;
 await deps.put('upload-quarantine',String(prepared.original_path),bytes,'application/octet-stream',{version:2,artifact_id:artifact,sha256,size_bytes:bytes.length,kind:'quarantine_original'});
 let state='quarantined',method:string|null=null,derivative:Record<string,unknown>|null=null,issues:string[]=[];
 let validation:ReturnType<typeof validateQuarantinedData>|(ReturnType<typeof sanitizeQuarantineImage>&{financialMappingRequired:false})|null=null;
 if(format==='jpeg'||format==='png'){
  if(!deps.image)issues=['image_processing_unavailable'];
  else try{validation={...await deps.image(bytes),financialMappingRequired:false};}catch(error){if(error instanceof Error&&error.message.startsWith('image_runtime_'))throw error;issues=[error instanceof Error&&/^image_[a-z_]+$/.test(error.message)?error.message:'image_validation_failed'];}
 }else try{validation=validateQuarantinedData(format,bytes,input.delimiter);}catch{state='rejected';issues=['structured_validation_failed'];}
 if(validation?.state==='quarantined')issues=[validation.issue];
 if(validation?.state==='validated_data'||validation?.state==='sanitized_derivative'){
  const extension=validation.mime==='image/jpeg'?'jpg':validation.mime==='image/png'?'png':'json';
  const derivedHash=await quarantineSha256(validation.bytes),path=prepared.derived_prefix+'.'+extension;
  if(validation.bytes.length>20971520)throw new Error('upload_derivative_size_limit');
  await deps.put('upload-validated',path,validation.bytes,validation.mime,{version:2,artifact_id:artifact,sha256:derivedHash,size_bytes:validation.bytes.length,kind:'validated_derivative',original_sha256:sha256});
  state=validation.state;method=validation.method;
  derivative={bucket:'upload-validated',path,sha256:derivedHash,size_bytes:validation.bytes.length,mime:validation.mime,method,financial_mapping_required:validation.financialMappingRequired};
 }
 return check(await rpc(deps.service,'finalize_finance_upload_artifact',{_payload:{version:2,artifact_id:artifact,ticket:prepared.ticket,state,method,derivative,issues}}));
}
