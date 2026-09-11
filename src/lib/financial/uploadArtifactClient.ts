import {supabase} from '@/integrations/supabase/client';
import {readBlobBytes} from '@/lib/uploadPolicy';
import {uploadArtifactSchema,type UploadArtifact} from './uploadArtifactContract';
export interface UploadArtifactRequest{
 tenantId:string;actorId:string;requestId:string;sourceType:UploadArtifact['source_type'];sourceId:string;
 file:File;format:UploadArtifact['original']['format'];delimiter?:';'|','|'\t';
}
export async function uploadFinanceArtifact(p:UploadArtifactRequest):Promise<UploadArtifact>{
 const bytes=await readBlobBytes(p.file);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes).buffer)),b=>b.toString(16).padStart(2,'0')).join('');
 const body=new FormData();body.set('action','finance_upload_v2');body.set('tenant_id',p.tenantId);body.set('request_id',p.requestId);
 body.set('source_type',p.sourceType);body.set('source_id',p.sourceId);body.set('format',p.format);body.set('file',p.file);
 if(p.delimiter)body.set('delimiter',p.delimiter);
 const {data,error}=await supabase.functions.invoke('secure-upload',{body});
 if(error)throw new Error('Envio sem confirmação. Tente recuperar com o mesmo pedido e arquivo.');
 const a=uploadArtifactSchema.parse(data);
 if(a.tenant_id!==p.tenantId||a.actor_id!==p.actorId||a.request_id!==p.requestId||a.source_type!==p.sourceType||a.source_id!==p.sourceId||a.original.sha256!==hash||a.original.size_bytes!==p.file.size||a.original.format!==p.format)throw new Error('A confirmação não corresponde ao arquivo e à origem selecionados.');
 return a;
}
