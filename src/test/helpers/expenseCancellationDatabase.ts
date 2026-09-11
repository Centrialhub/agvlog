import {readFileSync} from 'node:fs';
import {createStockConsumptionDatabase} from './stockConsumptionDatabase';
export async function createExpenseCancellationDatabase(){
 const db=await createStockConsumptionDatabase();const read=(name:string)=>readFileSync(`supabase/migrations/${name}.sql`,'utf8');
 await db.exec(read('20260910002244_finance_payable_movement_links').split('create function finance_private.movement_used_cents')[0]);
 await db.exec(read('20260910162807_finance_account_period_closure_foundation').split('create function finance_private.can_close_account_period')[0]);
 // Actual statement import rowtype used by the closed-source resolver; no intake is claimed here.
 const intake=read('20260909222851_finance_statement_intake');const table=intake.match(/create table public.finance_statement_imports\s*\([\s\S]*?\n\);/i)?.[0];if(!table)throw new Error('statement import DDL');await db.exec(table);
 await db.exec(read('20260910163109_finance_account_period_closed_source_guards').split('create function finance_private.guard_closed_financial_source')[0]);
 for(const name of ['20260910130032_finance_payroll_recorded_costs','20260910152557_finance_recorded_cost_summary','20260910134943_finance_settlement_expense_context'])await db.exec(read(name));
 await db.exec(read('20260910175641_finance_unpaid_expense_cancellation'));return db;
}
