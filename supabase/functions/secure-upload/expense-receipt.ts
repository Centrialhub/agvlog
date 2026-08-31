// Service metadata is trusted only because browser writes to this reserved
// root are denied. Do not permit generic upload/cleanup to use the same root.
type Receipt = {sha256:string;mime:string;size:number};
type Probe = {version:1;tenant_id:string;actor_id:string;request_id:string;source_type:string;source_id:string;path:string;uploaded:boolean;receipt:Receipt;metadata:Record<string,unknown>};
interface Dependencies {
 inspect:(args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
 upload:(path:string,bytes:Uint8Array,options:{contentType:string;upsert:false;cacheControl:string;metadata:Record<string,unknown>})=>PromiseLike<{error:unknown}>;
 scan:()=>Promise<{available:boolean;clean:boolean}>;
}
const uuid=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const extensions:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/heic':'heic','image/heif':'heif','application/pdf':'pdf'};
export async function expenseReceiptUpload(
 context:{tenant:string;actor:string;request:string;sourceType:string;sourceId:string;mime:string;bytes:Uint8Array;declaredHash:string},deps:Dependencies,
):Promise<{status:number;body:Record<string,unknown>}>{
 const {tenant,actor,request,sourceType,sourceId,mime,bytes,declaredHash}=context;
 const fail=(status:number,error:string)=>({status,body:{error}});
 if(![tenant,actor,request,sourceId].every(uuid)||!['trip','settlement'].includes(sourceType)||!extensions[mime]||!bytes.length||bytes.length>10485760)return fail(400,'expense_receipt_invalid_request');
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes).buffer)),byte=>byte.toString(16).padStart(2,'0')).join('');
 if(sha256!==declaredHash)return fail(400,'expense_receipt_hash_mismatch');
 const receipt:Receipt={sha256,mime,size:bytes.length},path=tenant+'/expense-receipts/'+actor+'/'+request+'/receipt.'+extensions[mime];
 const args={_tenant_id:tenant,_actor_id:actor,_request_id:request,_source_type:sourceType,_source_id:sourceId,_receipt:receipt};
 const expected={version:1,tenant_id:tenant,actor_id:actor,request_id:request,source_type:sourceType,source_id:sourceId,...receipt,scanned:true};
 const inspect=async():Promise<Probe|null>=>{
  const {data,error}=await deps.inspect(args);if(error||!data||typeof data!=='object')return null;const p=data as Probe;
  if(p.version!==1||p.tenant_id!==tenant||p.actor_id!==actor||p.request_id!==request||p.source_type!==sourceType||p.source_id!==sourceId||p.path!==path||typeof p.uploaded!=='boolean'
   ||!p.receipt||!p.metadata||Object.entries(receipt).some(([k,v])=>p.receipt[k as keyof Receipt]!==v)||Object.entries(expected).some(([k,v])=>p.metadata[k]!==v))return null;
  return p;
 };
 const ack=()=>({status:200,body:{version:1,tenant_id:tenant,actor_id:actor,request_id:request,source_type:sourceType,source_id:sourceId,path,uploaded:true,receipt}});
 let probe=await inspect();if(!probe)return fail(403,'expense_receipt_not_authorized_or_context_changed');
 if(probe.uploaded)return ack();
 const scan=await deps.scan();if(!scan.available)return fail(503,'malware_scanner_unavailable');if(!scan.clean)return fail(422,'malware_detected');
 // Permission/source state can change while scanning. Validate again before
 // storing anything. A race after this point still cannot create an expense.
 probe=await inspect();if(!probe)return fail(403,'expense_receipt_not_authorized_or_context_changed');if(probe.uploaded)return ack();
 const {error}=await deps.upload(path,bytes,{contentType:mime,upsert:false,cacheControl:'3600',metadata:expected});
 // Covers a lost upload response or a concurrent upload to this exact path.
 // Never overwrite, never rescan a confirmed existing object.
 const confirmed=await inspect();if(confirmed?.uploaded)return ack();
 return fail(503,error?'storage_unavailable':'expense_receipt_unconfirmed');
}
