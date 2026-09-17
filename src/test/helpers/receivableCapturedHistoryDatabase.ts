import {readFileSync} from 'node:fs';
import {createReceivableTemporalDatabase} from './receivableTemporalDatabase';
export async function createReceivableCapturedHistoryDatabase(){
 const db=await createReceivableTemporalDatabase();
 await db.exec(readFileSync('supabase/migrations/20260910201323_finance_receivable_captured_history.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260917143000_make_receivable_captured_history_revision_constant_cost.sql','utf8'));
 return db;
}
