import {readFileSync} from 'node:fs';
import {createFinanceProductionRpcDatabase} from './financeProductionRpcDatabase';
export async function createFinanceAuditDatabase(){
 const db=await createFinanceProductionRpcDatabase();
 const dependencies=JSON.parse(readFileSync('src/test/fixtures/payableActionsDependencies.json','utf8'));
 const additional=JSON.parse(readFileSync('src/test/fixtures/financeAuditRemediationSchema.json','utf8'));
 await db.exec('set check_function_bodies=off');
 for(const sql of dependencies.tables)await db.exec(sql);
 for(const sql of dependencies.functions)await db.exec(sql);
 for(const sql of dependencies.views)await db.exec(sql);
 for(const sql of additional.functions)await db.exec(sql);
 for(const column of additional.columns){
  if(column.default&&!column.default.includes('nextval'))await db.exec(`alter table public.${column.table} alter column ${column.name} set default ${column.default}`);
 }
 await db.exec(`set check_function_bodies=on;alter table public.tenants add primary key(id);alter table public.payables add primary key(id);
 create unique index on public.finance_commands(tenant_id,request_id);
 alter table finance_events alter column id set default gen_random_uuid();
 alter table finance_events alter column created_at set default now();`);
 for(const sql of dependencies.triggers)await db.exec(sql);
 await db.exec(readFileSync('supabase/migrations/20260922213900_payable_account_payment_and_archive.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260923132052_finance_audit_manual_title_commands.sql','utf8'));
 await db.exec(readFileSync('src/test/fixtures/financeAuditInvoiceRelations.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260923132100_finance_audit_invoice_pagination.sql','utf8'));
 await db.exec('alter table public.hub_fiscal_emissions add primary key(id)');
 await db.exec(readFileSync('supabase/migrations/20260923132108_finance_audit_fiscal_work_queue.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260923132117_finance_configurable_approval_limits.sql','utf8'));
 await db.exec(readFileSync('src/test/fixtures/financeApprovalFunctions.sql','utf8'));
 await db.exec(readFileSync('src/test/fixtures/financeEntityAuditLog.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260923134704_finance_approval_final_value_guard.sql','utf8'));
 return db;
}
