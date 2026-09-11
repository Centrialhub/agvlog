import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {financeAs,financeIds as i} from './financeLedgerDatabase';
import {uploadArtifactSchema} from '@/lib/financial/uploadArtifactContract';

async function service(db:PGlite,sql:string,args:unknown[]){
 await db.exec('savepoint receipt_callback;set role service_role');
 try{const result=await db.query<{v:Record<string,unknown>}>(sql,args);await db.exec('reset role;release savepoint receipt_callback');return result.rows[0].v;}
 catch(error){await db.exec('rollback to savepoint receipt_callback');throw error;}
}

/** Real SQL protocol and hosted benchmark callback; not a new image/Storage execution. */
export async function prepareReceiptImageCallback(db:PGlite,sourceType:'expense_item'|'expense_draft',sourceId:string){
 const benchmark=JSON.parse(readFileSync('docs/qa/finance-image-hosted-benchmark-2026-09-11.json','utf8')) as {results:Array<{fixture?:string,body?:{output_mime:string,output_size:number,output_sha256:string}}>};
 const observed=benchmark.results.find(row=>row.fixture==='1x1.png')?.body;if(!observed)throw new Error('Reviewed image callback missing');
 const bytes=readFileSync('infra/upload-validation-bench/fixtures/1x1.png');
 const payload={version:2,tenant_id:i.tenant,request_id:randomUUID(),source_type:sourceType,source_id:sourceId,original_sha256:createHash('sha256').update(bytes).digest('hex'),size_bytes:bytes.length,declared_mime:observed.output_mime,format:'png'};
 const reserved=uploadArtifactSchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select reserve_finance_upload_artifact($1) v',[payload])).rows[0].v);
 const prepared=await service(db,'select prepare_finance_upload_artifact($1,$2,$3,$4,$5) v',[reserved.artifact_id,i.tenant,i.operator,payload.original_sha256,payload.size_bytes]);
 const derivative={bucket:'upload-validated',path:String(prepared.derived_prefix)+'.png',sha256:observed.output_sha256,size_bytes:observed.output_size,mime:observed.output_mime,method:'jpeg-png-reencode-v1',financial_mapping_required:false};
 await db.query('insert into storage.objects(bucket_id,name,metadata,user_metadata) values($1,$2,$3,$4)',['upload-quarantine',prepared.original_path,{size:payload.size_bytes,mimetype:payload.declared_mime},{version:2,artifact_id:reserved.artifact_id,sha256:payload.original_sha256,size_bytes:payload.size_bytes,kind:'quarantine_original'}]);
 await db.query('insert into storage.objects(bucket_id,name,metadata,user_metadata) values($1,$2,$3,$4)',['upload-validated',derivative.path,{size:derivative.size_bytes,mimetype:derivative.mime},{version:2,artifact_id:reserved.artifact_id,sha256:derivative.sha256,size_bytes:derivative.size_bytes,kind:'validated_derivative',original_sha256:payload.original_sha256}]);
 const finalize=async()=>uploadArtifactSchema.parse(await service(db,'select finalize_finance_upload_artifact($1) v',[{version:2,artifact_id:reserved.artifact_id,ticket:prepared.ticket,state:'sanitized_derivative',method:'jpeg-png-reencode-v1',derivative,issues:[]}]));
 return {reserved,finalize};
}
