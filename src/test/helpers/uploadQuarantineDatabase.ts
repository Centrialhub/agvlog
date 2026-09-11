import {readFileSync} from 'node:fs';
import {createPublicManualMovementVoidDatabase} from './publicManualMovementVoidDatabase';
export const quarantineMigration=readFileSync('supabase/migrations/20260911040123_finance_upload_quarantine_artifacts_v2.sql','utf8');
export async function createUploadQuarantineDatabase(){const db=await createPublicManualMovementVoidDatabase();
 await db.exec("alter table storage.objects add column if not exists user_metadata jsonb;alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated,anon;create unique index if not exists quarantine_fixture_object_identity on storage.objects(bucket_id,name);create schema if not exists private;create table if not exists client_portal_access(user_id uuid,tenant_id uuid,active boolean);");
 if(!(await db.query<{v:boolean}>("select to_regprocedure('auth.jwt()') is not null v")).rows[0].v)await db.exec("create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$");
 const context=readFileSync('supabase/migrations/20260910131125_active_tenant_auth_context.sql','utf8');
 for(const name of ['user_can_access_tenant','request_tenant_id','is_request_tenant_member']){
  const signature='private.'+name+(name==='request_tenant_id'?'()':'(uuid)');
  if(!(await db.query<{v:boolean}>('select to_regprocedure($1) is not null v',[signature])).rows[0].v){const start=context.indexOf('create or replace function private.'+name+'(');await db.exec(context.slice(start,context.indexOf('$function$;',start)+11));}
 }
 if(!(await db.query<{v:boolean}>("select to_regprocedure('finance_private.require_access(uuid)') is not null v")).rows[0].v){const s=readFileSync('supabase/migrations/20260909235237_finance_legacy_rpc_boundary.sql','utf8');await db.exec(s.slice(0,s.indexOf('-- Wrap')));}
 const driver=readFileSync('supabase/migrations/20260909234654_finance_legacy_driver_boundary.sql','utf8');const start=driver.indexOf('create function finance_private.not_driver(');await db.exec(driver.slice(start,driver.indexOf('$;',start)+3));
 const verification=(await db.query<{body:string}>("select prosrc body from pg_proc where oid='finance_private.record_statement_verification(jsonb)'::regprocedure")).rows[0].body;
 if(!verification.includes('Revalidate the originating actor after waiting'))await db.exec(readFileSync('supabase/migrations/20260910142923_finance_statement_verification_reauthorization.sql','utf8'));
 return db;
}
