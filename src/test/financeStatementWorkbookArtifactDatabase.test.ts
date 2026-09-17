// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {createUploadQuarantineDatabase,quarantineMigration} from './helpers/uploadQuarantineDatabase';
import {financeAs,financeIds as ids} from './helpers/financeLedgerDatabase';

const bridge=readFileSync('supabase/migrations/20260911041340_finance_quarantine_statement_artifact_bridge.sql','utf8');
const imageDerivatives=readFileSync('supabase/migrations/20260911044437_finance_enable_reviewed_image_derivatives.sql','utf8');
const workbookSupport=readFileSync('supabase/migrations/20260915031254_finance_statement_workbook_artifact_support.sql','utf8');
let db:Awaited<ReturnType<typeof createUploadQuarantineDatabase>>;

beforeAll(async()=>{db=await createUploadQuarantineDatabase();},30000);
beforeEach(async()=>{
  await db.exec('begin');
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true),set_config('request.headers',$3,true)",
    [ids.operator,JSON.stringify({active_tenant_id:ids.tenant,role:'authenticated'}),JSON.stringify({'x-agvlog-tenant-id':ids.tenant})],
  );
});
afterEach(async()=>db.exec('rollback'));
afterAll(async()=>db.close());

async function service<T=Record<string,unknown>>(sql:string,args:unknown[]=[]){
  await db.exec('savepoint service_call;set role service_role');
  try{
    const result=await db.query<{v:T}>(sql,args);
    await db.exec('reset role;release savepoint service_call');
    return result.rows[0].v;
  }catch(error){
    await db.exec('rollback to savepoint service_call;release savepoint service_call');
    throw error;
  }
}

async function createWorkbookArtifact(format:'xls'|'xlsx'){
  const request=randomUUID(),originalHash='a'.repeat(64),derivativeHash='b'.repeat(64);
  const identity={version:2,tenant_id:ids.tenant,request_id:request,source_type:'bank_account',source_id:ids.account,
    original_sha256:originalHash,size_bytes:50,declared_mime:'application/octet-stream',format};
  const reserved=(await financeAs<{v:{artifact_id:string}}>(db,ids.operator,'select reserve_finance_upload_artifact($1) v',[identity])).rows[0].v;
  const prepared=await service<{ticket:string;original_path:string;derived_prefix:string}>(
    'select prepare_finance_upload_artifact($1,$2,$3,$4,$5) v',
    [reserved.artifact_id,ids.tenant,ids.operator,originalHash,50],
  );
  await db.query(
    "insert into storage.objects(bucket_id,name,metadata,user_metadata) values('upload-quarantine',$1,$2,$3)",
    [prepared.original_path,{size:50,mimetype:'application/octet-stream'},{version:2,artifact_id:reserved.artifact_id,sha256:originalHash,size_bytes:50,kind:'quarantine_original'}],
  );
  const path=prepared.derived_prefix+'.json';
  await db.query(
    "insert into storage.objects(bucket_id,name,metadata,user_metadata) values('upload-validated',$1,$2,$3)",
    [path,{size:80,mimetype:'application/json'},{version:2,artifact_id:reserved.artifact_id,sha256:derivativeHash,original_sha256:originalHash,size_bytes:80,kind:'validated_derivative'}],
  );
  const finalized=await service<{usable:boolean;state:string;derivative:{path:string;method:string}}>(
    'select finalize_finance_upload_artifact($1) v',
    [{version:2,artifact_id:reserved.artifact_id,ticket:prepared.ticket,state:'validated_data',method:'strict-workbook-matrix-v1',
      derivative:{bucket:'upload-validated',path,sha256:derivativeHash,size_bytes:80,mime:'application/json',method:'strict-workbook-matrix-v1',financial_mapping_required:true},issues:[]}],
  );
  return {request,artifactId:reserved.artifact_id,originalHash,path,finalized};
}

it.each(['xls','xlsx'] as const)('accepts only mapped-workbook-v1 for a validated %s derivative',async format=>{
  await db.exec(quarantineMigration);
  await db.exec(bridge);
  await db.exec(imageDerivatives);
  const publicWrapperBefore=(await db.query<{hash:string}>("select md5(pg_get_functiondef('public.intake_finance_statement_artifact(jsonb)'::regprocedure)) hash")).rows[0].hash;
  await db.exec(workbookSupport);

  const artifact=await createWorkbookArtifact(format);
  expect(artifact.finalized).toMatchObject({usable:true,state:'validated_data',derivative:{method:'strict-workbook-matrix-v1'}});
  const payload={version:2,tenant_id:ids.tenant,request_id:artifact.request,bank_account_id:ids.account,artifact_id:artifact.artifactId,
    file_hash:artifact.originalHash,source_path:artifact.path,currency:'BRL',parser_version:'mapped-workbook-v1',
    mapping:{sheet_index:0,header_row:0,date_column:0,description_column:1,amount_column:2,date_format:'dmy',number_format:'decimal'},
    rows:[{amount_cents:-500,posted_on:'2026-08-15',description:'Despesa Excel',raw:{source_row:2,cells:['15/08/2026','Despesa Excel','-5.00']}}],
    period_start:'2026-08-15',period_end:'2026-08-15',reason:'Mapeamento Excel conferido no derivado inerte',file_name:`original.${format}`};

  await expect(financeAs(db,ids.operator,'select intake_finance_statement_artifact($1)',[{...payload,parser_version:'mapped-csv-v1'}])).rejects.toMatchObject({code:'23514'});
  const receipt=(await financeAs<{v:{import_id:string}}>(db,ids.operator,'select intake_finance_statement_artifact($1) v',[payload])).rows[0].v;
  expect((await db.query('select parser_version,source_snapshot#>>\'{artifact,original,format}\' format from finance_statement_imports where id=$1',[receipt.import_id])).rows)
    .toEqual([{parser_version:'mapped-workbook-v1',format}]);

  const after=(await db.query<{hash:string}>("select md5(pg_get_functiondef('public.intake_finance_statement_artifact(jsonb)'::regprocedure)) hash")).rows[0].hash;
  expect(after).toBe(publicWrapperBefore);
  expect((await db.query("select has_function_privilege('authenticated','secure_upload_private.finalize(jsonb)','execute') auth_finalize,has_function_privilege('service_role','secure_upload_private.finalize(jsonb)','execute') service_finalize,has_function_privilege('anon','finance_private.intake_statement_artifact(jsonb)','execute') anon_intake")).rows)
    .toEqual([{auth_finalize:false,service_finalize:true,anon_intake:false}]);
});

it('fails closed when the production finalizer predecessor drifts',async()=>{
  await db.exec(quarantineMigration);
  await db.exec(bridge);
  await db.exec(imageDerivatives);
  await db.exec(`do $drift$
    declare body text;
    begin
      select prosrc into body from pg_proc where oid='secure_upload_private.finalize(jsonb)'::regprocedure;
      execute format('create or replace function secure_upload_private.finalize(_payload jsonb) returns jsonb language plpgsql security definer set search_path='''' as %L',body||E'\\n');
    end
  $drift$`);
  await db.exec('savepoint migration_attempt');
  await expect(db.exec(workbookSupport)).rejects.toMatchObject({code:'55000',message:'finance_workbook_finalize_predecessor_changed'});
  await db.exec('rollback to savepoint migration_attempt');
});
