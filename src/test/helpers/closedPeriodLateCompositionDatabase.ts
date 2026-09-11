import {readFileSync} from 'node:fs';
import {createAccountPeriodCloseDatabase} from './accountPeriodCloseDatabase';
export async function createClosedPeriodLateCompositionDatabase(){
 const db=await createAccountPeriodCloseDatabase(true);
 const read=(name:string)=>readFileSync(`supabase/migrations/${name}.sql`,'utf8');
 const expense=read('20260909213959_finance_expense_batches').match(/create table public\.finance_expense_allocations\s*\([\s\S]*?\n\);/)?.[0];if(!expense)throw new Error('allocations');if(!(await db.query<{found:boolean}>("select to_regclass('public.finance_expense_allocations') is not null found")).rows[0].found)await db.exec(expense);
 await db.exec("alter table finance_payable_movement_links add column if not exists origin text not null default 'canonical'");
 for(const [file,name] of [['20260910132411_finance_settlement_link_reversals','movement_used_cents'],['20260910145616_finance_legacy_receipt_associations','receipt_movement_used_cents'],['20260910002244_finance_payable_movement_links','apply_payable_movement']]){
  const sql=read(file);const start=sql.indexOf(`function finance_private.${name}(`);if(start<0)throw new Error(name);const prefix=sql.lastIndexOf('create',start);await db.exec(sql.slice(prefix,sql.indexOf('$$;',start)+3));
 }
 await db.exec("grant execute on function finance_private.apply_payable_movement(jsonb) to authenticated;create function public.apply_finance_payable_movement(_payload jsonb) returns jsonb language sql security invoker as $$select finance_private.apply_payable_movement(_payload)$$;grant execute on function public.apply_finance_payable_movement(jsonb) to authenticated");
 await db.exec(read('20260910164942_finance_closed_period_late_payment_composition'));
 return db;
}
