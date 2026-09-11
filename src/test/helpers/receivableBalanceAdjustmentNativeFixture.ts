import {readFileSync} from 'node:fs';
import {createReceivableBalanceAdjustmentReviewDatabase,seedCustomerCreditRefundSource} from './receivableBalanceAdjustmentReviewDatabase';
export async function prepareBalanceAdjustmentNative(){
 const db=await createReceivableBalanceAdjustmentReviewDatabase();
 const source=await seedCustomerCreditRefundSource(db);await db.exec('commit');
 await db.exec(readFileSync('supabase/migrations/20260911115046_finance_receivable_balance_adjustments.sql','utf8'));
 return source;
}
