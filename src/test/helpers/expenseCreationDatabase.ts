import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createExpenseReviewDatabase} from './expenseReviewDatabase.ts';
import {operationIds as i,operationRpc} from './operationOutcomeDatabase.ts';
export const expenseCreationMigration='20260830211707_make_driver_expense_creation_recoverable.sql';
export const expenseCreationSql=()=>readFileSync('supabase/migrations/'+expenseCreationMigration,'utf8');
export async function installManualExpenseFixture(db:PGlite){
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8').replace(/\r\n/g,'\n');
 const table='driver_settlement_loads';
 if(!(await db.query<{present:boolean}>('select to_regclass($1) is not null present',['public.'+table])).rows[0].present){
  const declaration=baseline.match(/CREATE TABLE public\.driver_settlement_loads \([\s\S]*?\n\);/)?.[0];if(!declaration)throw new Error('Missing real settlement load table');await db.exec(declaration);
  for(const match of baseline.matchAll(/ALTER TABLE ONLY public\.driver_settlement_loads\n {4}ALTER COLUMN[\s\S]*?;/g))await db.exec(match[0]);
  await db.exec('alter table public.driver_settlement_loads add primary key(id)');
 }
 const start=baseline.indexOf('CREATE OR REPLACE FUNCTION public._build_manual_driver_settlement('),end=baseline.indexOf('$function$;',start)+12;
 if(start<0)throw new Error('Missing actual manual settlement builder');await db.exec(baseline.slice(start,end));
}
export async function createExpenseCreationLegacyDatabase(){const result=await createExpenseReviewDatabase(false);await installManualExpenseFixture(result.db);return result;}
export async function installExpenseCreationFixture(db:PGlite){
 await installManualExpenseFixture(db);
 // Disposable fixture only: reproduce metadata populated by the Storage API.
 // Hosted objects must never be inserted/updated/deleted through SQL.
 await db.exec('alter table storage.objects add column if not exists user_metadata jsonb');
 // Earlier graph fixtures omitted name. The actual drivers schema requires it.
 await db.exec("update public.drivers set name='Motorista QA' where name is null;alter table public.drivers alter column name set not null");
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8').replace(/\r\n/g,'\n');
 await db.exec("create or replace function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;grant select on tenant_memberships to authenticated;");
 const start=baseline.indexOf('CREATE OR REPLACE FUNCTION public.is_user_internal_role('),end=baseline.indexOf('$function$;',start)+11;
 await db.exec(baseline.slice(start,end));
 for(const name of ['receipts_tenant_select','receipts_tenant_delete']){
  await db.exec('drop policy if exists '+name+' on storage.objects');
  await db.exec(baseline.match(new RegExp('CREATE POLICY '+name+'[\\s\\S]*?;'))![0]);
 }
}
export async function createExpenseCreationDatabase(){const value=await createExpenseReviewDatabase();await installExpenseCreationFixture(value.db);await value.db.exec(expenseCreationSql());return value;}
export async function creationContext(db:PGlite,source:string,type='trip'){
 return (await operationRpc<{result:{revision:string;can_create:boolean;driver_id:string}}>(db,'select get_expense_creation_context($1,$2,$3) result',[i.tenant,type,source])).rows[0].result;
}
let sequence=1;
export async function creationPayload(db:PGlite,source:string,type='trip',actor=i.user){
 return {version:1,tenant_id:i.tenant,actor_id:actor,request_id:'ec100000-0000-4000-8000-'+String(sequence++).padStart(12,'0'),source_type:type,source_id:source,
  expected_revision:(await creationContext(db,source,type)).revision,receipt:null as null|{sha256:string;mime:string;size:number},
  fields:{category:'food',amount_cents:2500,expense_at:'2026-08-30T12:00:00Z',payment_source:'driver',reimbursable:true,no_receipt:true,no_receipt_reason:'Comprovante indisponível em QA',cost_center:type==='settlement'?'operation':null}};
}
export async function creationCommand(db:PGlite,payload:unknown){return (await operationRpc<{result:{expense_id:string;command_id:string;status:string;confirmed:boolean;receipt_path:string|null}}>(db,'select create_driver_expense_command($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result;}
export async function manualSettlement(db:PGlite){return (await db.query<{id:string}>("insert into driver_settlements(tenant_id,driver_id,is_manual,status) values($1,$2,true,'pending_review') returning id",[i.tenant,i.driver])).rows[0].id;}
