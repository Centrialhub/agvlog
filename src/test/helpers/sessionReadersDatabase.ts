import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {settlementAdjustmentDatabase} from './settlementAdjustmentDatabase.ts';
const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
async function install(db:PGlite,sql:string,name:string){
 const start=sql.toLowerCase().indexOf('create or replace function public.'+name+'('),end=sql.indexOf('$function$;',start)+11;
 if(start<0||end<11)throw new Error('Missing actual function '+name);await db.exec(sql.slice(start,end));
}
export async function sessionReadersDatabase(){
 const value=await settlementAdjustmentDatabase(),db=value.db;
 await db.exec("alter table public.tenants add column name text not null default 'Tenant QA',add column plan_key text not null default 'qa',add column timezone text not null default 'America/Sao_Paulo'");
 if(!(await db.query<{present:boolean}>("select to_regclass('public.client_portal_access') is not null present")).rows[0].present){
  const declaration=baseline.match(/CREATE TABLE public\.client_portal_access \([\s\S]*?\n\);/)?.[0];if(!declaration)throw new Error('Missing actual portal table');await db.exec(declaration);
 }
 for(const name of ['list_driver_settlements','list_driver_settlement_filter_options'])await install(db,baseline,name);
 await install(db,readFileSync('supabase/migrations/20260826165000_require_privileged_mfa.sql','utf8'),'get_current_memberships_v1');
 const release=readFileSync('supabase/migrations/20260828210458_enforce_privileged_mfa_release.sql','utf8');
 for(const name of ['session_has_privileged_mfa_v1','get_user_portal_tenants'])await install(db,release,name);
 return value;
}
