import {inspectPayableXml,type PayableXmlReader} from './xml.ts';
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
const record=(value:unknown)=>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('payable_xml_response_invalid');return value as Record<string,unknown>;};
export async function preservePayableXml(input:{tenant:string;actor:string;request:string;bytes:Uint8Array},deps:{caller:Rpc;service:Rpc;parser:()=>PayableXmlReader;put:(path:string,bytes:Uint8Array,metadata:Record<string,unknown>)=>Promise<void>}){
 const {tenant,actor,request,bytes}=input;if(![tenant,actor,request].every(v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)))throw Error('payable_xml_invalid_request');
 const summary=inspectPayableXml(bytes,deps.parser),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes).buffer)),b=>b.toString(16).padStart(2,'0')).join('');
 const call=async(rpc:Rpc,name:string,args:Record<string,unknown>)=>{const {data,error}=await rpc(name,args);if(error)throw error;return record(data);};
 const check=(data:unknown)=>{const a=record(data);if(a.version!==1||a.tenant_id!==tenant||a.actor_id!==actor||a.request_id!==request||a.sha256!==sha256||a.size_bytes!==bytes.length||typeof a.artifact_id!=='string'||!/^[0-9a-f-]{36}$/i.test(a.artifact_id)||a.signature_verified!==false||a.antivirus_verified!==false||!['reserved','original_quarantined'].includes(String(a.state)))throw Error('payable_xml_response_identity');if(a.state==='original_quarantined'){const stored=record(a.summary);if(Object.keys(stored).length!==Object.keys(summary).length||Object.entries(summary).some(([k,v])=>stored[k]!==v))throw Error('payable_xml_summary_mismatch');}return{version:1,tenant_id:tenant,actor_id:actor,request_id:request,artifact_id:a.artifact_id,sha256,size_bytes:bytes.length,state:a.state,summary:a.state==='original_quarantined'?summary:null,signature_verified:false,antivirus_verified:false};};
 const reserved=check(await call(deps.caller,'reserve_finance_payable_xml',{_payload:{version:1,tenant_id:tenant,request_id:request,sha256,size_bytes:bytes.length}}));
 if(reserved.state==='original_quarantined')return reserved;
 const prepared=await call(deps.service,'prepare_finance_payable_xml',{_tenant_id:tenant,_actor_id:actor,_artifact_id:reserved.artifact_id});if(check(prepared.artifact).artifact_id!==reserved.artifact_id)throw Error('payable_xml_response_identity');
 const path=`${tenant}/${actor}/${request}/original`;if(prepared.bucket!=='payable-xml-quarantine'||prepared.path!==path||typeof prepared.ticket!=='string')throw Error('payable_xml_response_identity');
 await deps.put(path,bytes,{artifact_id:reserved.artifact_id,sha256,size_bytes:bytes.length,kind:'quarantined_payable_xml'});
 const completed=check(await call(deps.service,'finish_finance_payable_xml',{_payload:{artifact_id:reserved.artifact_id,ticket:prepared.ticket,summary}}));
 if(completed.state!=='original_quarantined'||completed.artifact_id!==reserved.artifact_id)throw Error('payable_xml_not_preserved');
 // Reauthorize the active authenticated caller after service work, including replay.
 return check(await call(deps.caller,'reserve_finance_payable_xml',{_payload:{version:1,tenant_id:tenant,request_id:request,sha256,size_bytes:bytes.length}}));
}
