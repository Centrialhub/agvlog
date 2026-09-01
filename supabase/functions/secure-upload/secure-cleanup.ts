type CleanupReceipt={version:1;authorized:true;tenant_id:string;actor_id:string;bucket:string;paths:string[]};
type Failure={message?:string;code?:string}|null;
type CleanupResult={status:number;body:Record<string,unknown>};

export interface SecureCleanupInput{tenant:string;actor:string;bucket:string;paths:string[];correlationId:string}
export interface SecureCleanupDependencies{
 authorize:(args:{_tenant_id:string;_bucket:string;_paths:string[]})=>Promise<{data:unknown;error:Failure}>;
 consumeQuota:()=>Promise<boolean>;
 remove:(bucket:string,paths:string[])=>Promise<{error:Failure}>;
}

function receipt(value:unknown):CleanupReceipt|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const row=value as Record<string,unknown>;
 if(row.version!==1||row.authorized!==true||typeof row.tenant_id!=='string'||typeof row.actor_id!=='string'
  ||typeof row.bucket!=='string'||!Array.isArray(row.paths)||row.paths.some(path=>typeof path!=='string'))return null;
 return row as unknown as CleanupReceipt;
}

export async function secureCleanup(input:SecureCleanupInput,deps:SecureCleanupDependencies):Promise<CleanupResult>{
 const authorization=await deps.authorize({_tenant_id:input.tenant,_bucket:input.bucket,_paths:input.paths});
 const approved=receipt(authorization.data);
 if(authorization.error||!approved||approved.tenant_id!==input.tenant||approved.actor_id!==input.actor
  ||approved.bucket!==input.bucket||approved.paths.length!==input.paths.length
  ||approved.paths.some((path,index)=>path!==input.paths[index])){
  return {status:403,body:{error:'cleanup_not_authorized_or_evidence_retained',correlation_id:input.correlationId}};
 }
 if(!await deps.consumeQuota())return {status:429,body:{error:'upload_rate_limited',correlation_id:input.correlationId}};
 const removed=await deps.remove(input.bucket,input.paths);
 if(removed.error)return {status:503,body:{error:'cleanup_unavailable',correlation_id:input.correlationId}};
 return {status:200,body:{removed:input.paths.length,correlation_id:input.correlationId}};
}
