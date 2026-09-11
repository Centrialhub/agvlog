import {z} from 'zod';
import {readBlobBytes} from '@/lib/uploadPolicy';
import {uploadFinanceArtifact,type UploadArtifactRequest} from './uploadArtifactClient';
const savedSchema=z.object({version:z.literal(2),tenant:z.string().uuid(),actor:z.string().uuid(),sourceType:z.string(),sourceId:z.string().uuid(),sha256:z.string().regex(/^[a-f0-9]{64}$/),request:z.string().uuid()}).strict();
export async function uploadRecoverableFinanceArtifact(p:Omit<UploadArtifactRequest,'requestId'>){
 const bytes=await readBlobBytes(p.file),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes).buffer)),b=>b.toString(16).padStart(2,'0')).join('');
 const key=`finance-upload-v2:${p.tenantId}:${p.actorId}:${p.sourceType}:${p.sourceId}:${p.format}:${sha256}`;
 if(!navigator.locks?.request)throw new Error('Este navegador não oferece proteção para recuperar o mesmo envio entre janelas.');
 return navigator.locks.request(key,{mode:'exclusive'},async()=>{
  const raw=localStorage.getItem(key),expected={version:2 as const,tenant:p.tenantId,actor:p.actorId,sourceType:p.sourceType,sourceId:p.sourceId,sha256};
  let request:string;
  if(raw){const saved=savedSchema.safeParse(JSON.parse(raw));if(!saved.success||Object.entries(expected).some(([k,v])=>saved.data[k as keyof typeof expected]!==v))throw new Error('O registro de recuperação deste envio está inconsistente. Nenhum novo pedido foi enviado.');request=saved.data.request;}
  else{request=crypto.randomUUID();localStorage.setItem(key,JSON.stringify({...expected,request}));}
  return uploadFinanceArtifact({...p,requestId:request});
 });
}
