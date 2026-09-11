import {readFileSync,readdirSync} from 'node:fs';
import {createUnloadingProjectionRepairDatabase} from './unloadingProjectionRepairDatabase';
export {seedUnloadingRepairSource} from './unloadingProjectionRepairDatabase';
export const readCancellationMigration=(name:string)=>readFileSync('supabase/migrations/'+name+'.sql','utf8');
export async function createCoordinatedUnloadingCancellationDatabase(){return createUnloadingProjectionRepairDatabase();}
export async function installCoordinatedCancellation(db:Awaited<ReturnType<typeof createCoordinatedUnloadingCancellationDatabase>>){
 const read=readCancellationMigration;
 // Real DDL for read-only dependency inventories; unrelated FK parents are outside this combined fixture.
 for(const table of ['finance_legacy_expense_cost_links','finance_maintenance_cost_claims','finance_maintenance_labor_links','finance_maintenance_direct_part_links','finance_stock_acquisition_links']){
  if((await db.query<{v:boolean}>('select to_regclass($1) is not null v',['public.'+table])).rows[0].v)continue;
  let ddl:string|undefined;for(const file of readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql')).sort()) {ddl=readFileSync('supabase/migrations/'+file,'utf8').match(new RegExp('create table public\\.'+table+'\\s*\\([\\s\\S]*?\\n\\);','i'))?.[0];if(ddl)break;}
  if(!ddl)throw new Error(table+' DDL missing');await db.exec(ddl.replace(/ references public\.[a-z_]+\([^)]*\)/gi,''));
 }
 for(const name of ['20260910205941_finance_unloading_receivable_source_guard','20260910210433_finance_unloading_receivable_context','20260910211156_finance_unloading_projection_repair','20260911045402_finance_unloading_origin_amendments','20260911051405_finance_unloading_origin_economic_flow'])await db.exec(read(name));
 const boundary=read('20260909235237_finance_legacy_rpc_boundary');await db.exec(boundary.slice(0,boundary.indexOf('-- Wrap')));
 const cancel=read('20260910175641_finance_unpaid_expense_cancellation');await db.exec(cancel.slice(0,cancel.indexOf('-- Keep original rows')));
 await db.exec(cancel.slice(cancel.indexOf('create trigger finance_cancelled_expense_payroll')));
 const manual=read('20260910181257_finance_unpaid_manual_expense_cancellation');await db.exec(manual.slice(manual.indexOf('-- Legacy row writers must not wait')));
 // Install the same active recorded-cost reader and canonical builder projection used by cancellation.
 const cost=read('20260910134948_finance_canonical_trip_cost_settlement');await db.exec(cost.slice(0,cost.indexOf('do $patch$')).replace('public.finance_expense_items','finance_private.active_expense_items'));
 
 const baseline=read('20260824224152_baseline');await db.exec('create schema cancellation_ddl');
 for(const table of ['cost_centers','employees','payroll_entries','payroll_entry_items','payroll_periods']){
  const ddl=baseline.match(new RegExp('CREATE TABLE public\\.'+table+' \\([\\s\\S]*?\\n\\);'))?.[0];if(!ddl)throw new Error(table);
  if(!(await db.query<{v:boolean}>('select to_regclass($1) is not null v',['public.'+table])).rows[0].v)await db.exec(ddl);
  else{await db.exec(ddl.replace('public.'+table,'cancellation_ddl.'+table));const cols=(await db.query<{name:string,type:string}>("select attname name,format_type(atttypid,atttypmod) type from pg_attribute where attrelid=$1::regclass and attnum>0 and not attisdropped",['cancellation_ddl.'+table])).rows;for(const col of cols)await db.exec('alter table public.'+table+' add column if not exists "'+col.name+'" '+col.type);}
 }
 const summary=read('20260910152557_finance_recorded_cost_summary');await db.exec(summary.replace('false cancelled,false needs_review','finance_private.expense_is_cancelled(e.tenant_id,e.id) cancelled,false needs_review'));
 await db.exec(read('20260911053349_finance_coordinated_unloading_cancellation'));

}
