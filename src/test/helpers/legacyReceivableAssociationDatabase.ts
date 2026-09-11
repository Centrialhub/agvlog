import {readFileSync} from 'node:fs';
import {createReceivableFinancialDatabase} from './receivableFinancialDatabase';
import {operationIds as i} from './operationOutcomeDatabase';
import {installFinanceFiscalIntegrationFixture} from './financeFiscalIntegrationFixture';
export async function createLegacyReceivableAssociationDatabase(){
 const {db}=await createReceivableFinancialDatabase(true,false);
 await db.exec('create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb)');
 await db.query("insert into auth.users values($1,'financeiro@example.test','{\"full_name\":\"Financeiro QA\"}')",[i.operator]);
 await db.exec(readFileSync('supabase/migrations/20260909212104_finance_ledger_foundation.sql','utf8'));
 await installFinanceFiscalIntegrationFixture(db);
 for(const file of ['20260910024438_finance_receivable_movement_projection.sql','20260910025658_finance_receipt_allocation_corrections.sql','20260910030634_finance_explicit_receipt_refunds.sql','20260910032730_finance_movement_receipt_trace.sql','20260909233625_finance_audit_queries.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const table of ['payables','payables_payments','driver_settlement_payments','load_payments','employee_advances','payroll_entry_items']){
  if((await db.query<{found:boolean}>('select to_regclass($1) is not null found',['public.'+table])).rows[0].found)continue;
  const create=baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];if(!create)throw new Error(table);await db.exec(create);
  const defaults=baseline.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ALTER COLUMN[\\s\\S]*?;`))?.[0];if(defaults)await db.exec(defaults);await db.exec(`alter table ${table} add primary key(id)`);
 }
 await db.exec('alter table load_payments add column if not exists receivable_payment_id uuid,add column if not exists bank_transaction_id uuid;');
 for(const [file,table] of [['20260910002244_finance_payable_movement_links','finance_payable_movement_links'],['20260910003529_finance_payable_link_reversal','finance_payable_link_reversals'],['20260910130540_finance_settlement_movement_links','finance_settlement_movement_links'],['20260910132411_finance_settlement_link_reversals','finance_settlement_link_reversals']]){
  if((await db.query<{found:boolean}>('select to_regclass($1) is not null found',['public.'+table])).rows[0].found)continue;
  let definition=readFileSync(`supabase/migrations/${file}.sql`,'utf8').match(new RegExp(`create table public\\.${table}\\s*\\([\\s\\S]*?\\n\\);`,'i'))?.[0];if(!definition)throw new Error(table);
  definition=definition.replace(/,\s*foreign key\([^;]+?(?=,\s*foreign key|\s*\n\);)/gi,'').replace(/ references public\.\w+\([^)]*\)/g,'');await db.exec(definition);
 }
 await db.exec(readFileSync('supabase/migrations/20260910142740_finance_legacy_adoption_inventory.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910145616_finance_legacy_receipt_associations.sql','utf8'));
 return db;
}
// Simulate a row loaded before the command-required cutoff, not a writer bypass.
// All guards are restored before invoking the candidate association commands.
export async function withLegacyReceiptSeed<T>(db:Awaited<ReturnType<typeof createLegacyReceivableAssociationDatabase>>,seed:()=>Promise<T>):Promise<T>{
 await db.exec('savepoint historical_receipt_seed;alter table receivables_payments disable trigger guard_receivable_payment_history');
 try{const result=await seed();await db.exec('set constraints all immediate;alter table receivables_payments enable trigger guard_receivable_payment_history;set constraints all deferred;release savepoint historical_receipt_seed');return result;}
 catch(error){await db.exec('rollback to savepoint historical_receipt_seed;release savepoint historical_receipt_seed');throw error;}
}
