import {readFileSync} from 'node:fs';
import {createFinanceLedgerDatabase} from './financeLedgerDatabase';
export async function createLegacyIntegrityDatabase(){

 const db=await createFinanceLedgerDatabase();const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const type of baseline.matchAll(/CREATE TYPE public\.[a-z_]+ AS ENUM \([\s\S]*?\);/g))await db.exec(type[0]);
 for(const table of ['bank_transactions','receivables_payments','payables_payments','driver_settlement_payments','closing_report_payments','load_payments','employee_advances','payables','payroll_entry_items','receivables','driver_settlements','closing_reports','loads','employees','payroll_entries','payroll_periods','bank_statement_imports']){
  const create=baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];if(!create)throw new Error(table);await db.exec(create);
  const defaults=baseline.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ALTER COLUMN[\\s\\S]*?;`))?.[0];if(defaults)await db.exec(defaults);await db.exec(`alter table ${table} add primary key(id)`);
 }
 await db.exec(`alter table closing_report_payments add column canonical_receivable_payment_id uuid;
 alter table load_payments add column receivable_payment_id uuid,add column bank_transaction_id uuid;`);
 // Real candidate table definitions. Referential constraints to command/graph
 // tables are omitted: this fixture tests reads, including damaged legacy rows.
 for(const [file,table] of [
  ['20260830183929_audit_receivable_payments_and_reversals','receivable_payment_reversals'],
  ['20260910024438_finance_receivable_movement_projection','finance_receivable_movement_links'],
  ['20260910002244_finance_payable_movement_links','finance_payable_movement_links'],
  ['20260910003529_finance_payable_link_reversal','finance_payable_link_reversals'],
  ['20260910130540_finance_settlement_movement_links','finance_settlement_movement_links'],
  ['20260910132411_finance_settlement_link_reversals','finance_settlement_link_reversals']]){
  const sql=readFileSync(`supabase/migrations/${file}.sql`,'utf8');let create=sql.match(new RegExp(`create table public\\.${table}\\s*\\([\\s\\S]*?\\n\\);`,'i'))?.[0];if(!create)throw new Error(table);
  create=create.replace(/,\s*foreign key\([^;]+?(?=,\s*foreign key|\s*\n\);)/gi,'').replace(/ references public\.\w+\([^)]*\)/g,'');await db.exec(create);
 }
 await db.exec(readFileSync('supabase/migrations/20260910142740_finance_legacy_adoption_inventory.sql','utf8'));

 await db.exec(readFileSync('supabase/migrations/20260910151011_finance_legacy_integrity_inventory.sql','utf8'));
 return db;
}
