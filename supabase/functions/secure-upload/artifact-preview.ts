interface Dependencies{
 read:()=>PromiseLike<{data:unknown;error:unknown}>;
 sign:(bucket:string,path:string)=>PromiseLike<{data:{signedUrl:string}|null;error:unknown}>;
}
export async function previewExpenseArtifact(tenant:string,expense:string,artifact:string,deps:Dependencies){
 const result=await deps.read();
 if(result.error||!result.data||typeof result.data!=='object')throw new Error('upload_artifact_unavailable');
 const a=result.data as Record<string,unknown>,d=a.derivative as Record<string,unknown>|null;
 if(a.version!==2||a.tenant_id!==tenant||a.artifact_id!==artifact||a.source_type!=='expense_item'||a.source_id!==expense||a.state!=='sanitized_derivative'||a.usable!==true||!d||d.bucket!=='upload-validated'||d.method!=='jpeg-png-reencode-v1'||!['image/jpeg','image/png'].includes(String(d.mime)))throw new Error('upload_artifact_unavailable');
 const ext=d.mime==='image/jpeg'?'jpg':'png',expected=`${tenant}/${a.request_id}/validated.${ext}`;
 if(d.path!==expected||typeof d.sha256!=='string'||!/^[a-f0-9]{64}$/.test(d.sha256))throw new Error('upload_artifact_unavailable');
 const signed=await deps.sign('upload-validated',expected);
 if(signed.error||!signed.data?.signedUrl||!signed.data.signedUrl.startsWith('https://'))throw new Error('upload_artifact_unavailable');
 return {version:2,tenant_id:tenant,expense_id:expense,artifact_id:artifact,url:signed.data.signedUrl,mime:d.mime,expires_in:300};
}
