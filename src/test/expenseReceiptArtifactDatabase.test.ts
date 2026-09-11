// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {createUploadQuarantineDatabase,quarantineMigration} from './helpers/uploadQuarantineDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:Awaited<ReturnType<typeof createUploadQuarantineDatabase>>;
const migration=readFileSync('supabase/migrations/20260911042754_finance_expense_quarantine_receipt_links.sql','utf8');
beforeAll(async()=>{db=await createUploadQuarantineDatabase();},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true),set_config('request.headers',$3,true)",[i.operator,JSON.stringify({active_tenant_id:i.tenant,role:'authenticated'}),JSON.stringify({'x-agvlog-tenant-id':i.tenant})]);await db.exec(quarantineMigration);});
afterEach(async()=>db.exec('rollback'));afterAll(async()=>db.close());
async function expense(context='office'){
 const source=readFileSync('supabase/migrations/20260909213959_finance_expense_batches.sql','utf8');
 if(!(await db.query<{v:boolean}>("select to_regprocedure('finance_private.record_expense_batch(jsonb)') is not null v")).rows[0].v)await db.exec(source.slice(source.indexOf('create function finance_private.record_expense_batch')));
 const id=randomUUID();await financeAs(db,i.operator,'select record_finance_expense_batch($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),context,description:'Compra com comprovante posterior',reason:'Documento aguardando validação segura',items:[{id,category:'office',description:'Material de escritório',amount_cents:1000,occurred_on:'2026-08-15',supplier_name:'Fornecedor preservado',payee_type:'supplier',no_receipt_reason:'Aguardando comprovante seguro',allocations:[]}]}]);return id;
}
it('preserves captured baselines and extends reservation only to an existing expense',async()=>{
 const before=(await db.query('select finance_private.movement_correction_runtime_state() v')).rows;await db.exec(migration);expect((await db.query('select finance_private.movement_correction_runtime_state() v')).rows).toEqual(before);
 const id=await expense();const p={version:2,tenant_id:i.tenant,request_id:randomUUID(),source_type:'expense_item',source_id:id,original_sha256:createHash('sha256').update('receipt').digest('hex'),size_bytes:50,declared_mime:'image/png',format:'png'};
 const out=(await financeAs<{v:{artifact_id:string}}>(db,i.operator,'select reserve_finance_upload_artifact($1) v',[p])).rows[0].v;
 expect(out.artifact_id).toBeDefined();await expect(financeAs(db,i.operator,'select reserve_finance_upload_artifact($1)',[{...p,request_id:randomUUID(),source_id:randomUUID()}])).rejects.toMatchObject({code:'42501'});
 await expect(financeAs(db,i.operator,'select attach_finance_expense_receipt_artifact($1)',[{version:2,tenant_id:i.tenant,request_id:randomUUID(),expense_id:id,artifact_id:out.artifact_id,reason:'Anexo ainda em quarentena'}])).rejects.toMatchObject({code:'55000'});
 expect((await financeAs(db,i.operator,'select get_finance_expense_receipt_artifacts($1,$2) v',[i.tenant,id])).rows).toEqual([{v:{version:2,tenant_id:i.tenant,expense_id:id,receipts:[]}}]);
 expect((await db.query('select receipt_path,no_receipt_reason,amount_cents from finance_expense_items where id=$1',[id])).rows).toEqual([{receipt_path:null,no_receipt_reason:'Aguardando comprovante seguro',amount_cents:1000}]);
 expect((await db.query('select count(*)::int n from secure_upload_private.expense_receipts')).rows).toEqual([{n:0}]);
});
it('covers personnel expense identity and denies cross-company, mixed-driver and raw table access',async()=>{
 await db.exec(migration);const id=await expense('personnel');await expect(financeAs(db,i.operator,'select get_finance_expense_receipt_artifacts($1,$2)',[i.otherTenant,id])).rejects.toMatchObject({code:'42501'});
 await db.query("insert into tenant_memberships values($1,$2,'driver',true)",[i.tenant,i.operator]);await expect(financeAs(db,i.operator,'select get_finance_expense_receipt_artifacts($1,$2)',[i.tenant,id])).rejects.toMatchObject({code:'42501'});
 expect((await db.query("select has_table_privilege('authenticated','secure_upload_private.expense_receipts','SELECT') raw,has_function_privilege('service_role','public.attach_finance_expense_receipt_artifact(jsonb)','EXECUTE') service")).rows).toEqual([{raw:false,service:false}]);
});
it('rejects a changed source resolver atomically rather than installing over an unreviewed authority',async()=>{
 await db.exec("create or replace function secure_upload_private.assert_source(t uuid,kind text,source uuid) returns void language plpgsql security definer set search_path='' as $$begin raise exception 'changed';end$$");
 await db.exec('savepoint install');await expect(db.exec(migration)).rejects.toThrow('upload_source_contract_changed');await db.exec('rollback to savepoint install');
 expect((await db.query("select to_regclass('secure_upload_private.expense_receipts') is null missing")).rows).toEqual([{missing:true}]);
});
const imageEnable=readFileSync('supabase/migrations/20260911044437_finance_enable_reviewed_image_derivatives.sql','utf8');
async function serviceCall(sql:string,args:unknown[]=[]){await db.exec('savepoint image_service;set role service_role');try{const out=await db.query<{v:Record<string,unknown>}>(sql,args);await db.exec('reset role;release savepoint image_service');return out.rows[0].v;}catch(e){await db.exec('rollback to savepoint image_service');throw e;}}
async function imageCallback(expenseId:string,format:'png'|'jpeg'){
 // Storage callback metadata exercises the real SQL finalizer; byte decoding is independently proved by the hosted benchmark.
 const benchmark=JSON.parse(readFileSync('docs/qa/finance-image-hosted-benchmark-2026-09-11.json','utf8')) as {results:Array<{fixture?:string,body?:{output_mime:string,output_size:number,output_sha256:string}}>};
 const observed=benchmark.results.find(x=>x.fixture===`1x1.${format==='jpeg'?'jpg':'png'}`)?.body;if(!observed)throw new Error('hosted callback missing');
 const originalBytes=readFileSync(`infra/upload-validation-bench/fixtures/1x1.${format==='jpeg'?'jpg':'png'}`);
 const payload={version:2,tenant_id:i.tenant,request_id:randomUUID(),source_type:'expense_item',source_id:expenseId,original_sha256:createHash('sha256').update(originalBytes).digest('hex'),size_bytes:originalBytes.length,declared_mime:observed.output_mime,format};
 const a=(await financeAs<{v:{artifact_id:string}}>(db,i.operator,'select reserve_finance_upload_artifact($1) v',[payload])).rows[0].v;
 const prepared=await serviceCall('select prepare_finance_upload_artifact($1,$2,$3,$4,$5) v',[a.artifact_id,i.tenant,i.operator,payload.original_sha256,payload.size_bytes]);
 const d={bucket:'upload-validated',path:String(prepared.derived_prefix)+(format==='jpeg'?'.jpg':'.png'),sha256:observed.output_sha256,size_bytes:observed.output_size,mime:observed.output_mime,method:'jpeg-png-reencode-v1',financial_mapping_required:false};
 await db.query('insert into storage.objects(bucket_id,name,metadata,user_metadata) values($1,$2,$3,$4)', ['upload-quarantine',prepared.original_path,{size:payload.size_bytes,mimetype:payload.declared_mime},{version:2,artifact_id:a.artifact_id,sha256:payload.original_sha256,size_bytes:payload.size_bytes,kind:'quarantine_original'}]);
 await db.query('insert into storage.objects(bucket_id,name,metadata,user_metadata) values($1,$2,$3,$4)', ['upload-validated',d.path,{size:d.size_bytes,mimetype:d.mime},{version:2,artifact_id:a.artifact_id,sha256:d.sha256,size_bytes:d.size_bytes,kind:'validated_derivative',original_sha256:payload.original_sha256}]);
 return {artifactId:a.artifact_id,payload:{version:2,artifact_id:a.artifact_id,ticket:prepared.ticket,state:'sanitized_derivative',method:'jpeg-png-reencode-v1',derivative:d,issues:[]}};
}
it('finalizes reviewed PNG/JPEG callbacks, attaches and replays without changing cost or legacy evidence',async()=>{
 const baseline=(await db.query('select finance_private.movement_correction_runtime_state() v')).rows;await db.exec(migration);await db.exec(imageEnable);expect((await db.query('select finance_private.movement_correction_runtime_state() v')).rows).toEqual(baseline);
 const id=await expense();const original=(await db.query('select to_jsonb(e) v from finance_expense_items e where id=$1',[id])).rows;
 for(const format of ['png','jpeg'] as const){
  const a=await imageCallback(id,format);const final=await serviceCall('select finalize_finance_upload_artifact($1) v',[a.payload]);expect(final).toMatchObject({usable:true,state:'sanitized_derivative'});expect(await serviceCall('select finalize_finance_upload_artifact($1) v',[a.payload])).toEqual(final);
  const command={version:2,tenant_id:i.tenant,request_id:randomUUID(),expense_id:id,artifact_id:a.artifactId,reason:'Comprovante adicional sanitizado'};
  const link=(await financeAs(db,i.operator,'select attach_finance_expense_receipt_artifact($1) v',[command])).rows;expect((await financeAs(db,i.operator,'select attach_finance_expense_receipt_artifact($1) v',[command])).rows).toEqual(link);
  await expect(financeAs(db,i.operator,'select attach_finance_expense_receipt_artifact($1)',[{...command,reason:'Motivo diferente no mesmo pedido'}])).rejects.toMatchObject({code:'23505'});
 }
 const history=(await financeAs<{v:{receipts:unknown[]}}>(db,i.operator,'select get_finance_expense_receipt_artifacts($1,$2) v',[i.tenant,id])).rows[0].v;expect(history.receipts).toHaveLength(2);expect(JSON.stringify(history)).not.toContain('/original');
 expect((await db.query('select to_jsonb(e) v from finance_expense_items e where id=$1',[id])).rows).toEqual(original);
 expect((await db.query("select action,count(*)::int n from secure_upload_private.events where action in('validation_recorded','expense_receipt_attached') group by action order by action")).rows).toEqual([{action:'expense_receipt_attached',n:2},{action:'validation_recorded',n:2}]);
 expect((await financeAs(db,i.operator,"select name from storage.objects where bucket_id='upload-quarantine'")).rows).toEqual([]);
 expect((await financeAs(db,i.operator,"select name from storage.objects where bucket_id='upload-validated'")).rows).toHaveLength(2);
});
it('rejects wrong image method, oversized output and substituted hashes without promoting the artifact',async()=>{
 await db.exec(migration);await db.exec(imageEnable);const id=await expense();const a=await imageCallback(id,'png');
 await expect(serviceCall('select finalize_finance_upload_artifact($1) v',[{...a.payload,method:'other-codec'}])).rejects.toMatchObject({code:'23514'});
 await expect(serviceCall('select finalize_finance_upload_artifact($1) v',[{...a.payload,derivative:{...a.payload.derivative,size_bytes:5242881}}])).rejects.toMatchObject({code:'23514'});
 await expect(serviceCall('select finalize_finance_upload_artifact($1) v',[{...a.payload,derivative:{...a.payload.derivative,sha256:'f'.repeat(64)}}])).rejects.toMatchObject({code:'23514'});
 expect((await db.query('select state from secure_upload_private.artifacts where id=$1',[a.artifactId])).rows).toEqual([{state:'quarantined'}]);
 await db.query('update tenant_memberships set active=false where tenant_id=$1 and user_id=$2',[i.tenant,i.operator]);await expect(serviceCall('select finalize_finance_upload_artifact($1) v',[a.payload])).rejects.toMatchObject({code:'42501'});
});
it('resolves the real expense history missing-receipt filter and count while preserving the original reason and totals',async()=>{
 await db.exec(migration);await db.exec(imageEnable);const id=await expense();
 if(!(await db.query<{v:boolean}>("select to_regclass('public.finance_expense_cancellations') is not null v")).rows[0].v){const sql=readFileSync('supabase/migrations/20260910175641_finance_unpaid_expense_cancellation.sql','utf8');await db.exec(sql.slice(0,sql.indexOf('create function finance_private.expense_is_cancelled')));}
 if(!(await db.query<{v:boolean}>("select to_regprocedure('finance_private.list_expenses(uuid,jsonb)') is not null v")).rows[0].v)await db.exec(readFileSync('supabase/migrations/20260909221405_finance_expense_history_queries.sql','utf8'));
 const baselineDDL=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');const costDDL=baselineDDL.match(/CREATE TABLE public\.cost_centers \([\s\S]*?\n\);/)?.[0];if(!costDDL)throw new Error('cost center DDL missing');await db.exec(costDDL);
 const reader=readFileSync('supabase/migrations/20260910175733_finance_expense_cancellation_preview.sql','utf8');await db.exec(reader.slice(reader.indexOf('create or replace function finance_private.list_expenses')));
 const baseline=(await db.query('select finance_private.movement_correction_runtime_state() v')).rows;
 await db.exec(readFileSync('supabase/migrations/20260911044823_finance_expense_receipt_artifact_status.sql','utf8'));
 const list=async(filters={})=>(await financeAs<{v:{total:number,total_cents:string,missing_receipt_count:number,rows:Array<{receipt_path:null,no_receipt_reason:string,receipt_artifact_count:number}>}}>(db,i.operator,'select list_finance_expenses($1,$2) v',[i.tenant,filters])).rows[0].v;
 expect(await list({missing_receipt:true})).toMatchObject({total:1,missing_receipt_count:1,total_cents:'1000'});
 const a=await imageCallback(id,'png');await serviceCall('select finalize_finance_upload_artifact($1) v',[a.payload]);
 expect(await list({missing_receipt:true})).toMatchObject({total:1,missing_receipt_count:1});
 await financeAs(db,i.operator,'select attach_finance_expense_receipt_artifact($1)',[{version:2,tenant_id:i.tenant,request_id:randomUUID(),expense_id:id,artifact_id:a.artifactId,reason:'Comprovante anexado após saneamento'}]);
 expect(await list({missing_receipt:true})).toMatchObject({total:0,missing_receipt_count:0});
 expect(await list()).toMatchObject({total:1,total_cents:'1000',missing_receipt_count:0,rows:[{receipt_path:null,no_receipt_reason:'Aguardando comprovante seguro',receipt_artifact_count:1}]});
 expect((await db.query('select finance_private.movement_correction_runtime_state() v')).rows).toEqual(baseline);
});
