import {readFileSync} from 'node:fs';
import {createActiveMovementOptionsDatabase} from './activeMovementOptionsDatabase';
export async function createExpenseStatementJourneyDatabase(installCorrection=true){
 const db=await createActiveMovementOptionsDatabase();const read=(name:string)=>readFileSync('supabase/migrations/'+name+'.sql','utf8');
 await db.exec("alter table bank_accounts add column if not exists bank_code text,add column if not exists branch_number text,add column if not exists account_number text,add column if not exists account_type text;");
 await db.exec('create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint)');
 await db.exec('alter table storage.objects add column if not exists metadata jsonb,add column if not exists created_at timestamptz default clock_timestamp();alter table storage.objects alter column id set default gen_random_uuid()');
 await db.exec(read('20260909220941_finance_receipt_evidence'));
 const exists=async(name:string)=>(await db.query<{present:boolean}>('select to_regprocedure($1) is not null present',[name])).rows[0].present;
 const entries=[
 ['20260909222851_finance_statement_intake','public.intake_finance_statement(jsonb)'],
 ['20260909223737_finance_statement_source_verification','public.inspect_finance_statement_source(uuid,uuid)'],
 ['20260909230507_finance_statement_queries','public.list_finance_statements(uuid,jsonb)'],
 ['20260909231643_finance_statement_identity_review','public.review_finance_statement_identity(jsonb)'],
 ['20260909233625_finance_audit_queries','finance_private.audit_events(uuid,jsonb)'],
 ['20260910013543_finance_bank_reconciliation_groups','public.reconcile_finance_bank_group(jsonb)'],
 ['20260910014238_finance_reconciliation_workspace','finance_private.reconciliation_options(uuid,uuid,text,text,integer)'],
 ['20260910015331_finance_reconciliation_history','public.get_finance_reconciliation_history(uuid,jsonb)'],
 ] as const;
 for(const [file,fn] of entries)if(!await exists(fn))await db.exec(read(file));
 for(const name of ['20260910020543_finance_ofx_statement_intake','20260910021404_finance_native_statement_account','20260910022059_finance_automatic_reference_reconciliation','20260910023208_finance_automatic_reconciliation_status','20260910023911_finance_account_period_review','20260910142923_finance_statement_verification_reauthorization','20260910183506_finance_active_movement_financial_guards','20260910183442_finance_reconciliation_active_movements'])await db.exec(read(name));
 await db.exec(read('20260909221405_finance_expense_history_queries'));
 await db.exec(read('20260910124716_finance_expense_cost_center_totals'));
 const cancellation=read('20260910175641_finance_unpaid_expense_cancellation').match(/create table public\.finance_expense_cancellations\([\s\S]*?\n\);/)?.[0];if(!cancellation)throw new Error('Cancellation DDL missing');await db.exec(cancellation);
 await db.exec(read('20260910175733_finance_expense_cancellation_preview'));
 const custody=read('20260910142606_driver_trip_cargo_custody_cycle').match(/create table public\.trip_cargo_controls \([\s\S]*?\n\);/)?.[0];if(!custody)throw new Error('Custody DDL');await db.exec(custody);
 await db.exec('create schema if not exists private');
 const gate=read('20260910211800_canonical_trip_cargo_close_gate');
 for(const name of ['private.trip_cargo_is_closed_v1','finance_private.guard_trip_expense_cargo_closed_v1','finance_private.expense_options']){
  const start=gate.indexOf('create or replace function '+name+'('),end=gate.indexOf('$function$;',start);if(start<0||end<0)throw new Error(name);await db.exec(gate.slice(start,end+'$function$;'.length));
 }
 const triggerStart=gate.indexOf('create trigger finance_trip_expense_requires_closed_cargo_v1'),triggerEnd=gate.indexOf(';',triggerStart);await db.exec(gate.slice(triggerStart,triggerEnd+1));
 if(installCorrection)await db.exec(read('20260910220847_finance_cargo_expense_active_movements'));
 return db;
}
