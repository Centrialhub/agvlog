import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {expenseMfaDatabase,expenseMfaActor} from './expenseMfaDatabase.ts';
import {operationIds as i,operationRpc} from './operationOutcomeDatabase.ts';
export const settlementAdjustmentMigration='20260830233637_audit_driver_settlement_adjustments.sql';
export const settlementAdjustmentSql=()=>readFileSync('supabase/migrations/'+settlementAdjustmentMigration,'utf8');
export async function installSettlementAdjustmentFixture(db:PGlite){
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8').replace(/\r\n/g,'\n');
 for(const name of ['add_driver_settlement_adjustment','remove_driver_settlement_adjustment']){
  const start=baseline.indexOf('CREATE OR REPLACE FUNCTION public.'+name+'('),end=baseline.indexOf('$function$;',start)+11;
  if(start<0||end<11)throw new Error('Missing real adjustment API '+name);await db.exec(baseline.slice(start,end));
 }
 await db.exec('revoke all on function public.add_driver_settlement_adjustment(uuid,text,numeric,text,text) from public,anon,authenticated,service_role;grant execute on function public.add_driver_settlement_adjustment(uuid,text,numeric,text,text) to authenticated,service_role;revoke all on function public.remove_driver_settlement_adjustment(uuid,uuid,text) from public,anon,authenticated,service_role;grant execute on function public.remove_driver_settlement_adjustment(uuid,uuid,text) to authenticated,service_role;');
 for(const table of ['driver_settlements','driver_settlement_items','driver_settlement_events','driver_settlement_payments']){
  await db.exec('alter table public.'+table+' enable row level security;grant select,insert,update,delete on public.'+table+' to authenticated');
  for(const match of baseline.matchAll(new RegExp('CREATE POLICY [^\\n]+ ON public\\.'+table+'[\\s\\S]*?;','g')))await db.exec(match[0]);
 }
}
export async function settlementAdjustmentDatabase(candidate=true){
 const value=await expenseMfaDatabase();await installSettlementAdjustmentFixture(value.db);
 if(candidate)await value.db.exec(settlementAdjustmentSql());return value;
}
export async function tripSettlement(db:PGlite,trip:string){return (await db.query<{id:string}>('select _build_driver_settlement($1,$2) id',[i.tenant,trip])).rows[0].id;}
export const adjustmentActor=expenseMfaActor;
export async function legacyAdjustment(db:PGlite,settlement:string,nature:string|null='credit',amount:string|number=10,reason='Conferência QA'){
 return operationRpc(db,'select add_driver_settlement_adjustment($1,$2,$3::numeric,$4,$5) id',[settlement,nature,amount,'Ajuste QA',reason]);
}
export async function adjustmentContext(db:PGlite,settlement:string){
 return (await operationRpc<{result:{revision:string;can_add:boolean;can_remove:boolean;items:Record<string,unknown>[];totals:Record<string,unknown>}}>(db,'select get_driver_settlement_adjustment_context($1,$2) result',[i.tenant,settlement])).rows[0].result;
}
export async function adjustmentPayload(db:PGlite,settlement:string,item:string|null=null){
 return {version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:randomUUID(),settlement_id:settlement,action:item?'remove':'add',item_id:item,
  nature:item?null:'credit',amount_cents:item?null:1000,description:item?null:'Ajuste QA',reason:'Conferência de ajuste QA',expected_revision:(await adjustmentContext(db,settlement)).revision};
}
export async function adjustmentCommand(db:PGlite,payload:unknown){
 return (await operationRpc<{result:{confirmed:boolean;item_id:string;command_id:string;revision:string}}>(db,'select apply_driver_settlement_adjustment($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result;
}
