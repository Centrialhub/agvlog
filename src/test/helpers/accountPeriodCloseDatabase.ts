import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createFinanceLedgerDatabase,financeIds as i} from './financeLedgerDatabase';
export async function createAccountPeriodCloseDatabase(guards=false){
 const db=await createFinanceLedgerDatabase();
 await db.exec(`alter table bank_accounts add column bank_code text default '001',add column branch_number text default '1234',add column account_number text default '123-4',add column account_type text default 'checking';
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
 alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;
create function finance_private.can_read_receipt(_path text) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if split_part(_path,'/',1) !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false;end if;
 return finance_private.can_access(split_part(_path,'/',1)::uuid);
end;$$;`);
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const type of baseline.matchAll(/CREATE TYPE public\.[a-z_]+ AS ENUM \([\s\S]*?\);/g))await db.exec(type[0]);
 // Baseline monetary source schemas, without unrelated FK graph. Source writers
 // and external storage authenticity need separate full-platform verification.
 for(const table of ['bank_transactions','receivables','receivables_payments','payables','payables_payments','driver_settlement_payments','closing_report_payments','load_payments','employee_advances','payroll_entry_items']){
  const create=baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];if(!create)throw new Error(table);await db.exec(create);
  const defaults=baseline.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ALTER COLUMN[\\s\\S]*?;`))?.[0];if(defaults)await db.exec(defaults);await db.exec(`alter table ${table} add primary key(id)`);
 }
 for(const table of ['bank_accounts','bank_transactions','receivables','receivables_payments'])await db.exec(`alter table ${table} add unique(tenant_id,id)`);
 const financial=readFileSync('supabase/migrations/20260830183929_audit_receivable_payments_and_reversals.sql','utf8');
 for(const table of ['receivable_financial_commands','receivable_payment_reversals']){const ddl=financial.match(new RegExp(`create table public\\.${table}\\s*\\([\\s\\S]*?\\n\\);`,'i'))?.[0];if(!ddl)throw new Error(table);await db.exec(ddl);}
 for(const name of ['20260909222851_finance_statement_intake','20260909223737_finance_statement_source_verification','20260909230507_finance_statement_queries','20260909231643_finance_statement_identity_review','20260909233625_finance_audit_queries','20260910013543_finance_bank_reconciliation_groups','20260910015331_finance_reconciliation_history','20260910020543_finance_ofx_statement_intake','20260910021404_finance_native_statement_account','20260910022059_finance_automatic_reference_reconciliation','20260910023911_finance_account_period_review','20260910033918_finance_internal_transfer_pairs','20260910034731_finance_transfers_in_transit','20260910130956_finance_statement_period_evidence','20260910140010_finance_account_opening_balances','20260910141240_finance_cash_opening_counts','20260910142143_finance_statement_coverage_approvals','20260910162807_finance_account_period_closure_foundation','20260910162958_finance_account_period_close_snapshot'])await db.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'));
 if(guards){
 for(const table of ['driver_settlements','closing_reports','loads','employees','payroll_entries','payroll_periods','bank_statement_imports']){const create=baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];if(!create)throw new Error(table);await db.exec(create);const defaults=baseline.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ALTER COLUMN[\\s\\S]*?;`))?.[0];if(defaults)await db.exec(defaults);await db.exec(`alter table ${table} add primary key(id)`);}
 await db.exec('alter table closing_report_payments add column canonical_receivable_payment_id uuid;alter table load_payments add column receivable_payment_id uuid,add column bank_transaction_id uuid;alter table receivables_payments add column financial_command_id uuid');
 for(const [file,table] of [
 ['20260910025658_finance_receipt_allocation_corrections','finance_receipt_allocation_corrections'],['20260910024438_finance_receivable_movement_projection','finance_receivable_movement_links'],['20260910002244_finance_payable_movement_links','finance_payable_movement_links'],['20260910003529_finance_payable_link_reversal','finance_payable_link_reversals'],['20260910130540_finance_settlement_movement_links','finance_settlement_movement_links'],['20260910132411_finance_settlement_link_reversals','finance_settlement_link_reversals'],['20260910145616_finance_legacy_receipt_associations','finance_legacy_receipt_movement_links'],['20260910145616_finance_legacy_receipt_associations','finance_legacy_receipt_link_reversals'],['20260909212514_finance_delivery_unloading','finance_unloading_charges'],['20260909213959_finance_expense_batches','finance_expense_batches'],['20260909213959_finance_expense_batches','finance_expense_items'],['20260909213959_finance_expense_batches','finance_expense_allocations']]){
 const sql=readFileSync(`supabase/migrations/${file}.sql`,'utf8');let ddl=sql.match(new RegExp(`create table public\\.${table}\\s*\\([\\s\\S]*?\\n\\);`,'i'))?.[0];if(!ddl)throw new Error(table);ddl=ddl.replace(/,\s*foreign key\([^;]+?(?=,\s*foreign key|\s*\n\);)/gi,'').replace(/ references public\.\w+\([^)]*\)/g,'');await db.exec(ddl);
 }
 await db.exec(readFileSync('supabase/migrations/20260909220941_finance_receipt_evidence.sql','utf8').replace('create function finance_private.can_read_receipt','create or replace function finance_private.can_read_receipt'));
 for(const name of ['20260910151011_finance_legacy_integrity_inventory','20260910163109_finance_account_period_closed_source_guards','20260910163116_finance_legacy_cut_reviews','20260910164923_finance_account_period_closure_evidence','20260910170213_finance_legacy_cut_settlement_mapping'])await db.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'));
 }
 return db;
}
export async function seedAccountCloseStatement(db:Awaited<ReturnType<typeof createAccountPeriodCloseDatabase>>,day:string,cents:number,from='2026-08-01',to='2026-08-31',entries:Array<{day:string;cents:number}>=[]){
 const id=randomUUID(),verification=randomUUID(),hash=id.replace(/-/g,'').repeat(2);
 const date=(value:string,time:string)=>({date:value,raw:value.replace(/-/g,'')+time+'[-3:BRT]',offset_minutes:-180});
 await db.query("insert into finance_statement_imports(id,tenant_id,bank_account_id,file_hash,source_path,file_name,source_snapshot,parser_version,mapping,period_start,period_end,currency,input_rows,created_by) values($1,$2,$3,$4,$5,'extrato.ofx','{}','native-ofx-v1','{}',$6,$7,'BRL',$9,$8)",[id,i.tenant,i.account,hash,'qa/'+id,from,to,i.operator,entries.length]);
 const entryIds:string[]=[];for(const [index,entry] of entries.entries()){const entryId=randomUUID();entryIds.push(entryId);await db.query("insert into finance_bank_entries(id,tenant_id,bank_account_id,first_import_id,source_row,posted_on,amount_cents,currency,bank_id,description,raw) values($1,$2,$3,$4,$5,$6,$7,'BRL',$8,'Entrada bancária real','{}')",[entryId,i.tenant,i.account,id,index+1,entry.day,entry.cents,entryId]);await db.query("insert into finance_statement_rows(tenant_id,import_id,source_row,raw,classification,bank_entry_id) values($1,$2,$3,'{}','new',$4)",[i.tenant,id,index+1,entryId]);}
 const report={hash_verified:true,actual_hash:hash,identity_trust:'native_file_identifier',native_evidence:{parser_version:'native-ofx-v1',currency:'BRL',account:{bank_id:'001',branch_id:'1234',account_id:'123-4',account_type:'CHECKING'},outside_declared_period:false,repeated_bank_ids:[],period:{start:date(from,'000000'),end:date(to,'235959')},ledger_balance:{amount_cents:cents,as_of:date(day,'235959')}}};
 await db.query("insert into finance_statement_verifications(id,tenant_id,import_id,actor_id,reader_version,source_revision,outcome,report) values($1,$2,$3,$4,'statement-source-v1','revision','rows_match',$5)",[verification,i.tenant,id,i.operator,report]);return {id,verification,entryIds};
}