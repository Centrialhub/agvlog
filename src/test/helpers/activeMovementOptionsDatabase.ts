import {randomUUID} from 'node:crypto';
import {operationIds} from './operationOutcomeDatabase';
import {createFinancialScenario} from './receivableFinancialDatabase';
import {withLegacyReceiptSeed} from './legacyReceivableAssociationDatabase';
export const activeMovementOptionIds={...operationIds,account:'cf600000-0000-4000-8000-000000000001'};
import {readFileSync} from 'node:fs';
import {createLegacyReceivableAssociationDatabase} from './legacyReceivableAssociationDatabase';
// A single schema based on the real receipt/operational chain. Add the actual
// baseline shapes and reader dependency definitions used by the payable and
// settlement fixtures; never substitute a success/zero-return function.
export async function createActiveMovementOptionsDatabase(){
 const db=await createLegacyReceivableAssociationDatabase();
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const table of ['cost_centers','driver_settlements','driver_settlement_events','payroll_periods','payroll_entries','employees']){
  if((await db.query<{exists:boolean}>('select to_regclass($1) is not null exists',['public.'+table])).rows[0].exists)continue;
  const ddl=baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];if(!ddl)throw new Error(table);await db.exec(ddl);
  const defaults=baseline.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ALTER COLUMN[\\s\\S]*?;`))?.[0];if(defaults)await db.exec(defaults);await db.exec(`alter table ${table} add primary key(id)`);
 }
 const load=(name:string)=>readFileSync(`supabase/migrations/${name}.sql`,'utf8');
 // Existing receipt fixture has link tables with real column shapes, but omits
 // unrelated FKs. Install actual function bodies without recreating those tables.
 async function functions(name:string){const sql=load(name);const definitions=[...sql.matchAll(/create (?:or replace )?function [\s\S]*?\$\$;/gi)];if(!definitions.length)throw new Error('No functions: '+name);for(const m of definitions)await db.exec(m[0].replace(/^create function/i,'create or replace function'));for(const acl of sql.matchAll(/(?:revoke all on function|grant execute on function)[\s\S]*?;/gi))await db.exec(acl[0]);}
 for(const name of ['20260909212514_finance_delivery_unloading','20260909213959_finance_expense_batches','20260909220020_finance_expense_workspace_queries'])await db.exec(load(name));
 await functions('20260910002244_finance_payable_movement_links');
 await functions('20260910003529_finance_payable_link_reversal');
 await functions('20260910130540_finance_settlement_movement_links');
 await db.exec(load('20260910130921_finance_settlement_movement_options'));
 await functions('20260910132411_finance_settlement_link_reversals');
 const reversal=load('20260910132411_finance_settlement_link_reversals');await db.exec(reversal.slice(reversal.lastIndexOf('do $$declare body text;needle text;begin')));
 await db.exec(load('20260910133355_finance_new_settlement_payment_candidates'));
 // Full legacy payable migration applies origin/reversal semantics and its
 // dependency guards to the link tables already present in the receipt chain.
 await db.exec(load('20260910143833_finance_legacy_payable_associations'));
 await db.exec(load('20260910143920_finance_legacy_payable_association_options'));
 await db.exec(load('20260910145659_finance_legacy_receivable_association_options'));
 // This reader has no dependency on the manual expense write/receipt tables.
 const manual=load('20260910120756_finance_manual_expense_recording');const start=manual.indexOf('create function finance_private.manual_expense_movements(');if(start<0)throw new Error('manual_expense_movements');await db.exec(manual.slice(start));
 await db.exec(load('20260910182541_finance_movement_correction_foundation'));
 await db.exec(load('20260910184543_finance_active_movement_options'));
 return db;
}

export async function seedActiveMovementOptionOrigins(db:Awaited<ReturnType<typeof createActiveMovementOptionsDatabase>>){
 const i=activeMovementOptionIds;await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);
 const financial=await createFinancialScenario(db),payable=randomUUID(),legacyPayablePayment=randomUUID(),legacyReceivablePayment=randomUUID(),settlement=randomUUID(),settlementPayment=randomUUID(),trip=randomUUID();
 await db.query("insert into payables(id,tenant_id,supplier_name,category,description,amount,paid_amount,due_date,status,driver_id) values($1,$2,'Fornecedor QA','other','Título histórico',100,50,'2026-01-20','partial',$3)",[payable,i.tenant,i.driver]);
 await db.query("insert into payables_payments(id,tenant_id,payable_id,amount,paid_at,bank_account_id,method,created_by) values($1,$2,$3,50,'2026-01-20T15:00:00Z',$4,'pix',$5)",[legacyPayablePayment,i.tenant,payable,financial.bank,i.operator]);
 await withLegacyReceiptSeed(db,()=>db.query("insert into receivables_payments(id,tenant_id,receivable_id,amount,received_at,bank_account_id,method,created_by) values($1,$2,$3,50,'2026-01-20T15:00:00Z',$4,'pix',$5)",[legacyReceivablePayment,i.tenant,financial.receivable,financial.bank,i.operator]));
 await db.query("insert into driver_settlements(id,tenant_id,driver_id,status,driver_payable_amount,needs_recalculation) values($1,$2,$3,'approved',100,false)",[settlement,i.tenant,i.driver]);
 await db.query("insert into driver_settlement_payments(id,tenant_id,settlement_id,amount,paid_at) values($1,$2,$3,50,'2026-01-20T15:00:00Z')",[settlementPayment,i.tenant,settlement]);
 await db.query("insert into dispatch_trips(id,tenant_id,driver_id,status) values($1,$2,$3,'completed')",[trip,i.tenant,i.driver]);
 return {payable,legacyPayablePayment,receivable:financial.receivable,legacyReceivablePayment,settlement,settlementPayment,trip};
}
