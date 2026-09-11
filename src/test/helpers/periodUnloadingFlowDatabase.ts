import {readFileSync} from 'node:fs';
import {createLegacyReceivableAssociationDatabase} from './legacyReceivableAssociationDatabase';
export async function createPeriodUnloadingFlowDatabase(){
 const db=await createLegacyReceivableAssociationDatabase();const read=(file:string)=>readFileSync('supabase/migrations/'+file,'utf8');
 await db.exec('alter table fiscal_documents add column if not exists supplier_id uuid;alter table bank_accounts add column if not exists account_type text default \'checking\'');
 await db.exec(read('20260909212514_finance_delivery_unloading.sql'));
 await db.exec(read('20260910182541_finance_movement_correction_foundation.sql'));
 const closure=read('20260910162807_finance_account_period_closure_foundation.sql');
 for(const table of ['finance_account_period_closures','finance_account_period_reopenings']){
  const ddl=closure.match(new RegExp(`create table public\\.${table}\\s*\\([\\s\\S]*?\\n\\);`))?.[0];if(!ddl)throw new Error(table);await db.exec(ddl);
 }
 // Actual package implementation with no closed accounts in this bounded
 // fixture. Positive frozen coverage is tested by the complete close fixture.
 await db.exec(read('20260910193723_finance_period_money_package.sql'));
 await db.exec(read('20260910203516_finance_period_unloading_flow.sql'));
 return db;
}
