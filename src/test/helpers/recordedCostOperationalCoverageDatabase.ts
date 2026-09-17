import {readFileSync} from 'node:fs';
import {createStockConsumptionDatabase} from './stockConsumptionDatabase';
export async function createRecordedCostOperationalCoverageDatabase(){
 const db=await createStockConsumptionDatabase();
 await db.exec(`create or replace function finance_private.expense_is_cancelled(uuid,uuid) returns boolean language sql stable set search_path='' as $$select false$$;
 create or replace function finance_private.effective_cost_amount(t uuid,expense uuid,strict boolean default false) returns bigint language sql stable security definer set search_path='' as $$select amount_cents from public.finance_expense_items where tenant_id=t and id=expense$$;`);
 await db.exec(readFileSync('supabase/migrations/20260914213840_finance_recorded_cost_operational_coverage.sql','utf8'));
 return db;
}
