import {readFileSync} from 'node:fs';
import {createFinanceLedgerDatabase} from './financeLedgerDatabase';
// Actual baseline table shapes/defaults and candidate command; narrow dependencies
// for expense capacity are explicit and do not claim full migration coverage.
export async function createSettlementPaymentDatabase(){
 const db=await createFinanceLedgerDatabase();
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const table of ['driver_settlements','driver_settlement_payments','driver_settlement_events','payroll_periods','payroll_entries','payroll_entry_items','employees','payables','payables_payments']){
  const create=baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];if(!create)throw new Error(table);await db.exec(create);
  const defaults=baseline.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ALTER COLUMN[\\s\\S]*?;`))?.[0];if(defaults)await db.exec(defaults);
  await db.exec(`alter table ${table} add primary key(id)`);
 }
 await db.exec('alter table payroll_entries add unique(payroll_period_id,employee_id);create table finance_expense_items(id uuid,tenant_id uuid,unique(tenant_id,id));create table bank_transactions(id uuid primary key);');
 for(const [file,table] of [['20260909213959_finance_expense_batches.sql','finance_expense_allocations'],['20260910002244_finance_payable_movement_links.sql','finance_payable_movement_links'],['20260910003529_finance_payable_link_reversal.sql','finance_payable_link_reversals']]){
  const sql=readFileSync('supabase/migrations/'+file,'utf8');const create=sql.match(new RegExp(`create table public\\.${table}\\s*\\([\\s\\S]*?\\);`))?.[0];if(!create)throw new Error(table);await db.exec(create);
 }
 for(const name of ['_log_settlement_event','register_driver_settlement_payment','register_driver_settlement_payment_v2','recompute_payroll_entry_totals','generate_payroll_period','approve_payroll_period','close_payroll_period','recalculate_payroll_entry','add_payroll_manual_item','delete_payroll_entry_item']){
  const fn=baseline.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0];if(!fn)throw new Error(name);await db.exec(fn);
 }
 await db.exec("create function public.is_tenant_operator_or_admin(uuid) returns boolean language sql stable as $$select finance_private.can_access($1)$$;");
 await db.exec('create view finance_private.active_payable_payments as select p.* from payables_payments p where not exists(select 1 from finance_payable_movement_links l join finance_payable_link_reversals r on r.link_id=l.id where l.payment_id=p.id)');
 await db.exec(readFileSync('supabase/migrations/20260910130540_finance_settlement_movement_links.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260909233625_finance_audit_queries.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910130921_finance_settlement_movement_options.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910131149_finance_settlement_link_audit.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910132411_finance_settlement_link_reversals.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910133352_finance_payroll_lifecycle_serialization.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910133421_finance_settlement_payment_recording.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910133355_finance_new_settlement_payment_candidates.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910133700_finance_retire_legacy_settlement_payment_writers.sql','utf8'));
 return db;
}
