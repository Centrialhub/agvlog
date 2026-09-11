import {readFileSync,readdirSync} from 'node:fs';import {createHash} from 'node:crypto';
import {createReceivableFinancialDatabase} from './receivableFinancialDatabase';
import {installInvoiceLifecycleFixture,invoiceLifecycleSql} from './clientInvoiceLifecycleDatabase';
import {installExpenseReviewFixture,expenseReviewSql} from './expenseReviewDatabase';
import {installExpenseCreationFixture,expenseCreationSql} from './expenseCreationDatabase';
import {installExpenseMfaFixture} from './expenseMfaDatabase';import {installSettlementAdjustmentFixture} from './settlementAdjustmentDatabase';
const read=(p:string)=>readFileSync(p,'utf8');const migration=(p:string)=>read('supabase/migrations/'+p);
export async function createFinanceForwardBlockDatabase(){
 const {db}=await createReceivableFinancialDatabase(true,false);const applied:Array<{file:string;sha256:string}>=[];
 const run=async(file:string,sql=read(file))=>{try{await db.exec(sql);applied.push({file,sha256:createHash('sha256').update(sql).digest('hex')});}catch(error){await db.close();throw new Error('BLOCK AT '+file+': '+String(error));}};
 await installInvoiceLifecycleFixture(db);await run('supabase/migrations/20260830192908_audit_client_invoice_lifecycle.sql',invoiceLifecycleSql());await installExpenseReviewFixture(db);await run('supabase/migrations/20260830203548_audit_driver_expense_reviews.sql',expenseReviewSql());await installExpenseCreationFixture(db);await run('supabase/migrations/20260830211707_make_driver_expense_creation_recoverable.sql',expenseCreationSql());await installExpenseMfaFixture(db);await installSettlementAdjustmentFixture(db);
 const baseline=migration('20260824224152_baseline.sql').replace(/\r\n/g,'\n');
 for(const table of ['payroll_generation_issues','employee_contracts','employee_incident_actions','payables','payables_payments','employees','employee_advances','payroll_periods','payroll_entries','payroll_entry_items','cost_centers','bank_statement_imports','bank_reconciliation_sessions','bank_reconciliation_audit']){
  if((await db.query<{v:boolean}>('select to_regclass($1) is not null v',['public.'+table])).rows[0].v)continue;
  const ddl=baseline.match(new RegExp('CREATE TABLE public\\.'+table+' \\([\\s\\S]*?\\n\\);'))?.[0];if(!ddl)throw Error('Missing baseline table '+table);await db.exec(ddl);
  for(const match of baseline.matchAll(new RegExp('ALTER TABLE ONLY public\\.'+table+'\\n {4}ALTER COLUMN[\\s\\S]*?;','g')))await db.exec(match[0]);await db.exec('alter table public.'+table+' add primary key(id)');
 }
 for(const name of ['create_manual_expense','import_bank_statement','run_bank_reconciliation','accept_financial_match','reject_financial_match','create_manual_financial_match','reverse_financial_match','_apply_match_amounts','close_reconciliation_session','_recalc_payable_paid','register_payable_payment','reverse_payable_payment','recompute_payroll_entry_totals','generate_payroll_period','approve_payroll_period','close_payroll_period','recalculate_payroll_entry','add_payroll_manual_item','delete_payroll_entry_item']){const fn=baseline.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?\\$function\\$;'))?.[0];if(!fn)throw Error(name);await db.exec(fn);}
 await db.exec('alter table payroll_entries add unique(payroll_period_id,employee_id);create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);alter table bank_accounts add column if not exists bank_code text,add column if not exists branch_number text,add column if not exists account_number text,add column if not exists account_type text;create table if not exists storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);alter table storage.objects add column if not exists metadata jsonb;');
 const earlier=readdirSync('supabase/migrations').filter(x=>x.startsWith('20260909')&&x.includes('_finance_')&&x>='20260909212104'&&x<'20260909234654').sort();for(const f of earlier)await run('supabase/migrations/'+f);
 // Restore only the exact current password-based role helpers observed remotely; no unrelated Auth/SSX migration is executed.
 const roleSource=migration('20260831164442_remove_authenticator_requirement.sql');for(const name of ['is_tenant_member','is_tenant_admin','is_tenant_operator_or_admin','is_user_internal_role']){const start=roleSource.indexOf('create or replace function public.'+name+'('),end=roleSource.indexOf('$function$;',start)+11;if(start<0||end<11)throw Error(name);await db.exec(roleSource.slice(start,end));}
 // Exact expense boundary release was tested atomically in its own suite; install constituent files here to record each dependency.
 await run('supabase/migrations/20260830231003_enforce_expense_creation_mfa.sql');await run('supabase/rollouts/finance_settlement_adjustments_current_auth.sql');
 for(const f of ['supabase/migrations/20260909234654_finance_legacy_driver_boundary.sql','supabase/rollouts/finance_adjustment_legacy_wrapper_compat.sql','supabase/migrations/20260909235237_finance_legacy_rpc_boundary.sql','supabase/migrations/20260910230200_finance_expense_review_read_boundary.sql','supabase/migrations/20260909235705_finance_legacy_receipt_boundary.sql','supabase/rollouts/finance_expense_adjustment_internal_only_policy.sql'])await run(f);
 for(const f of ['20260910000731_finance_payroll_payment_projection.sql','20260910002244_finance_payable_movement_links.sql','20260910003529_finance_payable_link_reversal.sql'])await run('supabase/migrations/'+f);
 const helper=read('src/test/helpers/financeFiscalInvoiceLifecycleFixture.ts');const ddl=helper.match(/await db\.exec\(`([\s\S]*?)`\)/)?.[1];if(!ddl)throw Error('Fiscal fixture declaration missing');await db.exec(ddl.replace('create table nfse_documents','create table if not exists nfse_documents'));
 for(const f of ['20260910004550_finance_fiscal_observation_queue.sql','20260910005509_finance_fiscal_receivable_basis.sql','20260910010034_finance_fiscal_receivable_projection.sql'])await run('supabase/migrations/'+f);
 await run('supabase/rollouts/20260910231716_finance_fiscal_credits_invoice_compat.sql');await run('supabase/migrations/20260910012152_finance_receivable_fiscal_context.sql');
 await run('supabase/migrations/20260910012756_finance_fiscal_queue_worker.sql');
 const files=readdirSync('supabase/migrations').filter(x=>x>='20260910013543'&&x<'20260910132407'&&x.includes('_finance_')).sort();for(const f of files)await run(f.includes('025658')?'supabase/rollouts/20260910232134_finance_receipt_correction_invoice_compat.sql':'supabase/migrations/'+f);
 return {db,applied};
}
