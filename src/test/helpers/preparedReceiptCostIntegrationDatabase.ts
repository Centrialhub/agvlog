import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {installEffectiveCostReaderPredecessors,effectiveCostReadersSql} from './effectiveCostReadersDatabase';

const read=(name:string)=>readFileSync('supabase/migrations/'+name+'.sql','utf8');
function definition(sql:string,name:string){
 const start=sql.indexOf('create function '+name+'(');
 if(start<0)throw new Error('Missing exact function '+name);
 const delimiter=sql.slice(start).match(/\bas (\$\w*\$)/i);
 if(!delimiter)throw new Error('Missing function delimiter '+name);
 const end=sql.indexOf(delimiter[1]+';',start+delimiter.index!+delimiter[0].length);
 if(end<0)throw new Error('Missing function end '+name);
 return sql.slice(start,end+delimiter[1].length+1);
}

/** Full real upload SQL on the existing monetary fixture; no simulated validator. */
export async function installPreparedReceiptCostPredecessors(db:PGlite){
 if(!(await db.query<{v:boolean}>("select exists(select 1 from pg_constraint where conrelid='public.finance_expense_items'::regclass and conname='finance_expense_items_check') v")).rows[0].v)await db.exec("alter table public.finance_expense_items add constraint finance_expense_items_check check((receipt_path is not null) or coalesce(length(btrim(no_receipt_reason)),0)>=5)");
 await db.exec("alter table storage.objects add column if not exists user_metadata jsonb;create unique index if not exists prepared_receipt_object_identity on storage.objects(bucket_id,name);create schema if not exists private;create table if not exists client_portal_access(user_id uuid,tenant_id uuid,active boolean)");
 if(!(await db.query<{v:boolean}>("select to_regprocedure('auth.jwt()') is not null v")).rows[0].v)await db.exec("create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$");
 const context=read('20260910131125_active_tenant_auth_context');
 for(const name of ['user_can_access_tenant','request_tenant_id','is_request_tenant_member']){
  const signature='private.'+name+(name==='request_tenant_id'?'()':'(uuid)');
  if(!(await db.query<{v:boolean}>('select to_regprocedure($1) is not null v',[signature])).rows[0].v){const start=context.indexOf('create or replace function private.'+name+'(');if(start<0)throw new Error(signature);await db.exec(context.slice(start,context.indexOf('$function$;',start)+11));}
 }
 if(!(await db.query<{v:boolean}>("select to_regprocedure('finance_private.not_driver(uuid)') is not null v")).rows[0].v){const source=read('20260909234654_finance_legacy_driver_boundary'),start=source.indexOf('create function finance_private.not_driver(');await db.exec(source.slice(start,source.indexOf('$;',start)+3));}
 const artifacts=read('20260911040123_finance_upload_quarantine_artifacts_v2');
 const receipts=read('20260911042754_finance_expense_quarantine_receipt_links');
 await db.exec(artifacts);await db.exec(receipts);await db.exec(read('20260911044437_finance_enable_reviewed_image_derivatives'));
 // The shared reader installer contains these exact DDL/DTO excerpts. They are
 // already installed above by complete migrations; skip only duplicate excerpts.
 const start=receipts.indexOf('create table secure_upload_private.expense_receipts');
 const alreadyInstalled=new Set([
  artifacts.slice(0,artifacts.indexOf('create function secure_upload_private.authorization_revision')),
  definition(artifacts,'secure_upload_private.dto'),
  receipts.slice(start,receipts.indexOf('create function secure_upload_private.expense_receipt_source',start)),
 ]);
 const seen=new Set<string>();
 const adapter=new Proxy(db,{get(target,key){if(key==='exec')return async(sql:string)=>{if(alreadyInstalled.has(sql)){seen.add(sql);return [];}return target.exec(sql);};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
 await installEffectiveCostReaderPredecessors(adapter);
 if(seen.size!==3)throw new Error('Reader fixture excerpts changed; review full upload composition');
 await db.exec(effectiveCostReadersSql());
 await db.exec(read('20260911062534_finance_unloading_cost_public_boundary'));
}
