import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createFinanceLedgerDatabase} from './financeLedgerDatabase';
// Real baseline/candidate definitions; unrelated receivable FKs are omitted.
// The native suite separately seeds historical payments before writer cutoff121937.
export async function createLegacyPayableAssociationDatabase(){
 const db=await createFinanceLedgerDatabase();
 const run=(sql:string)=>db.exec(sql);
 await run(`alter table drivers add column name text default 'Motorista QA';
 create table finance_statement_imports(id uuid primary key,tenant_id uuid,file_name text);
 create table finance_statement_rows(id uuid primary key,tenant_id uuid,source_row integer);`);
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const type of baseline.matchAll(/CREATE TYPE public\.[a-z_]+ AS ENUM \([\s\S]*?\);/g))await run(type[0]);
 for(const table of ['clients','cost_centers','dispatch_trips','dispatch_stops','fiscal_documents','dispatch_stop_documents','receivables','payables','bank_transactions','payroll_periods','employees','payroll_entries','payroll_entry_items','payables_payments','driver_settlements','driver_settlement_payments','receivables_payments','closing_report_payments','load_payments','employee_advances']){
  const create=baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];assert.ok(create,table);await run(create);
  const defaults=baseline.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ALTER COLUMN[\\s\\S]*?;`))?.[0];if(defaults)await run(defaults);await run(`alter table ${table} add primary key(id)`);
 }
 await run('create function public.is_tenant_admin(uuid) returns boolean language sql as $$select true$$;');
 for(const name of ['_recalc_payable_paid','reverse_payable_payment','close_payroll_period','register_payable_payment','create_manual_expense']){
  const body=baseline.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0];
  if(!body)throw new Error(`Missing ${name}`);await run(body);
 }
 await run('create trigger recalc after insert or update or delete on payables_payments for each row execute function _recalc_payable_paid();grant execute on function reverse_payable_payment(uuid) to authenticated;');
 for(const file of ['20260909212514_finance_delivery_unloading.sql','20260909213959_finance_expense_batches.sql','20260909220020_finance_expense_workspace_queries.sql','20260909233625_finance_audit_queries.sql','20260910000731_finance_payroll_payment_projection.sql','20260910002244_finance_payable_movement_links.sql','20260910003529_finance_payable_link_reversal.sql'])await run(readFileSync(`supabase/migrations/${file}`,'utf8'));


 const target='20260910130540_finance_settlement_movement_links.sql',sql=readFileSync('supabase/migrations/'+target,'utf8');
 await run('begin;'+sql+'commit;');console.log('Settlement candidate '+target+' SHA256 '+createHash('sha256').update(sql).digest('hex'));
 for(const file of ['20260910130921_finance_settlement_movement_options.sql','20260910131149_finance_settlement_link_audit.sql','20260910132411_finance_settlement_link_reversals.sql']){
  const candidate=readFileSync('supabase/migrations/'+file,'utf8');await run('begin;'+candidate+'commit;');
  console.log('Settlement candidate '+file+' SHA256 '+createHash('sha256').update(candidate).digest('hex'));
 }
 await run(`alter table closing_report_payments add column canonical_receivable_payment_id uuid;
 alter table load_payments add column receivable_payment_id uuid,add column bank_transaction_id uuid;`);
 for(const [file,table] of [['20260830183929_audit_receivable_payments_and_reversals','receivable_payment_reversals'],['20260910024438_finance_receivable_movement_projection','finance_receivable_movement_links']]){
  let definition=readFileSync(`supabase/migrations/${file}.sql`,'utf8').match(new RegExp(`create table public\\.${table}\\s*\\([\\s\\S]*?\\n\\);`,'i'))?.[0];assert.ok(definition);
  definition=definition.replace(/,\s*foreign key\([^;]+?(?=,\s*foreign key|\s*\n\);)/gi,'').replace(/ references public\.\w+\([^)]*\)/g,'');await run(definition);
 }
 await run(readFileSync('supabase/migrations/20260910142740_finance_legacy_adoption_inventory.sql','utf8'));
 await run(readFileSync('supabase/migrations/20260910143833_finance_legacy_payable_associations.sql','utf8'));
 return db;
}
