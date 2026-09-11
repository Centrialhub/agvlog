import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
const read=(name:string)=>readFileSync('supabase/migrations/'+name+'.sql','utf8');
function definition(sql:string,name:string){const start=sql.search(new RegExp('create (?:or replace )?function '+name.split('.').join('\\.')+'\\('));if(start<0)throw Error(name);const match=sql.slice(start).match(/\bas (\$\w*\$)/i);if(!match)throw Error(name+' delimiter');const end=sql.indexOf(match[1]+';',start+match.index!+match[0].length);if(end<0)throw Error(name+' end');return sql.slice(start,end+match[1].length+1);}
export async function installEffectiveCostReaderPredecessors(db:PGlite){
 const legacy=read('20260910155442_finance_legacy_expense_cost_associations');
 if(!(await db.query<{v:boolean}>("select to_regclass('public.finance_legacy_expense_cost_reversals') is not null v")).rows[0].v){const ddl=legacy.match(/create table public\.finance_legacy_expense_cost_reversals\s*\([\s\S]*?\n\);/i)?.[0];if(!ddl)throw Error('legacy reversals');await db.exec(ddl);}
 const legacyPatch=legacy.indexOf('do $$declare body text;needle text;begin',legacy.indexOf('-- Keep the legacy expense'));
 await db.exec(legacy.slice(legacyPatch,legacy.indexOf('end$$;',legacyPatch)+7));
 await db.exec(read('20260910125357_finance_recorded_costs'));
 await db.exec(read('20260910130032_finance_payroll_recorded_costs').replace('false cancelled,false needs_review','finance_private.expense_is_cancelled(e.tenant_id,e.id) cancelled,false needs_review'));
 const manual=read('20260910181257_finance_unpaid_manual_expense_cancellation');
 if(!(await db.query<{v:boolean}>("select to_regclass('public.finance_manual_expense_cancellations') is not null v")).rows[0].v)await db.exec(manual.slice(0,manual.indexOf('create function finance_private.manual_expense_cancellation_context')));
 await db.exec(manual.slice(manual.indexOf('do $$declare signature text;definition text;patched text;begin'),manual.indexOf('-- Legacy row writers')));
 await db.exec(read('20260910134943_finance_settlement_expense_context').replace('public.finance_expense_items','finance_private.active_expense_items'));
 await db.exec(definition(read('20260910175733_finance_expense_cancellation_preview'),'finance_private.list_expenses'));
 await db.exec('revoke all on function finance_private.list_expenses(uuid,jsonb) from public,anon,authenticated,service_role;grant execute on function finance_private.list_expenses(uuid,jsonb) to authenticated');
 // Exact quarantine schema/DTO and count function, with no simulated validation success.
 const artifact=read('20260911040123_finance_upload_quarantine_artifacts_v2');
 await db.exec(artifact.slice(0,artifact.indexOf('create function secure_upload_private.authorization_revision')));
 await db.exec(definition(artifact,'secure_upload_private.dto'));
 const receipts=read('20260911042754_finance_expense_quarantine_receipt_links');const table=receipts.indexOf('create table secure_upload_private.expense_receipts');await db.exec(receipts.slice(table,receipts.indexOf('create function secure_upload_private.expense_receipt_source',table)));
 await db.exec('alter table storage.objects add column if not exists user_metadata jsonb');
 await db.exec(read('20260911044823_finance_expense_receipt_artifact_status'));
 await db.exec(read('20260911051729_finance_expense_unloading_effective_origin'));
 const payableLinks=read('20260910002244_finance_payable_movement_links');
 if(!(await db.query<{v:boolean}>("select to_regprocedure('finance_private.check_payable_payment_insert()') is not null v")).rows[0].v){await db.exec(definition(payableLinks,'finance_private.check_payable_payment_insert').replace('from public.payables_payments where payable_id=p.id','from finance_private.active_payable_payments where payable_id=p.id'));await db.exec('revoke all on function finance_private.check_payable_payment_insert() from public,anon,authenticated,service_role;create trigger finance_payable_payment_capacity before insert on public.payables_payments for each row execute function finance_private.check_payable_payment_insert()');}
 await db.exec(read('20260910180040_finance_payable_portfolio'));
 await db.exec(read('20260911050116_finance_payable_portfolio_global_filters'));
}
export const effectiveCostReadersSql=()=>read('20260911060700_finance_effective_cost_readers');

export async function installEffectiveCostBuilder(db:PGlite){
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const match of baseline.matchAll(/CREATE TYPE public\.([a-z_]+) AS ENUM \([\s\S]*?\);/g))if(!(await db.query<{v:boolean}>('select to_regtype($1) is not null v',['public.'+match[1]])).rows[0].v)await db.exec(match[0]);
 await db.exec('create schema settlement_test_definitions');
 for(const table of ['driver_settlements','driver_settlement_items','driver_settlement_payments','driver_settlement_events','driver_expenses','dispatch_trip_loads','loads','trip_routes']){
  const ddl=baseline.match(new RegExp('CREATE TABLE public\\.'+table+' \\([\\s\\S]*?\\n\\);'))?.[0];if(!ddl)throw new Error(table);
  if(!(await db.query<{v:boolean}>('select to_regclass($1) is not null v',['public.'+table])).rows[0].v)await db.exec(ddl);
  else{
   await db.exec(ddl.replace('public.'+table,'settlement_test_definitions.'+table));
   const columns=(await db.query<{name:string,type:string}>("select attname name,format_type(atttypid,atttypmod) type from pg_attribute where attrelid=$1::regclass and attnum>0 and not attisdropped",['settlement_test_definitions.'+table])).rows;
   for(const col of columns)await db.exec('alter table public.'+table+' add column if not exists "'+col.name+'" '+col.type);
  }
  for(const d of baseline.matchAll(new RegExp('ALTER TABLE ONLY public\\.'+table+'\\s+ALTER COLUMN[\\s\\S]*?;','g')))await db.exec(d[0]);
 }
 for(const name of ['_log_settlement_event','_build_driver_settlement']){const fn=baseline.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?\\$function\\$;'))?.[0];if(!fn)throw new Error(name);await db.exec(fn);}
 const costs=readFileSync('supabase/migrations/20260910134948_finance_canonical_trip_cost_settlement.sql','utf8');await db.exec(costs.slice(0,costs.indexOf('-- Extend, rather than bypass')).replace('create function finance_private.canonical_trip_costs','create or replace function finance_private.canonical_trip_costs').replace('from public.finance_expense_items e','from finance_private.active_expense_items e'));

}
