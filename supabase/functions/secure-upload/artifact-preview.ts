interface Dependencies{
 read:()=>PromiseLike<{data:unknown;error:unknown}>;
 sign:(bucket:string,path:string)=>PromiseLike<{data:{signedUrl:string}|null;error:unknown}>;
}
export async function previewExpenseArtifact(tenant:string,expense:string,artifact:string,deps:Dependencies){
 const result=await deps.read();
 if(result.error||!result.data||typeof result.data!=='object')throw new Error('upload_artifact_unavailable');
 const history=result.data as Record<string,unknown>;
 if(history.version!==2||history.tenant_id!==tenant||history.expense_id!==expense||!Array.isArray(history.receipts))throw new Error('upload_artifact_unavailable');
 const matches=history.receipts.filter(value=>value&&typeof value==='object'&&(value as Record<string,unknown>).artifact_id===artifact);
 if(matches.length!==1)throw new Error('upload_artifact_unavailable');
 const link=matches[0] as Record<string,unknown>;
 if(!link.evidence||typeof link.evidence!=='object')throw new Error('upload_artifact_unavailable');
 const a=link.evidence as Record<string,unknown>,d=a.derivative as Record<string,unknown>|null;
 const bound=a.source_type==='expense_item'?a.source_id===expense&&link.receipt_intent_id==null:
  a.source_type==='expense_draft'&&typeof link.receipt_intent_id==='string'&&a.source_id===link.receipt_intent_id;
 if(a.version!==2||a.tenant_id!==tenant||a.artifact_id!==artifact||!bound||a.state!=='sanitized_derivative'||a.usable!==true||!d||d.bucket!=='upload-validated'||d.method!=='jpeg-png-reencode-v1'||!['image/jpeg','image/png'].includes(String(d.mime)))throw new Error('upload_artifact_unavailable');
 const ext=d.mime==='image/jpeg'?'jpg':'png',expected=`${tenant}/${a.request_id}/validated.${ext}`;
 if(d.path!==expected||typeof d.sha256!=='string'||!/^[a-f0-9]{64}$/.test(d.sha256))throw new Error('upload_artifact_unavailable');
 const signed=await deps.sign('upload-validated',expected);
 if(signed.error||!signed.data?.signedUrl||!signed.data.signedUrl.startsWith('https://'))throw new Error('upload_artifact_unavailable');
 return {version:2,tenant_id:tenant,expense_id:expense,artifact_id:artifact,url:signed.data.signedUrl,mime:d.mime,expires_in:300};
}
