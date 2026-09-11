import {readFileSync} from 'node:fs';
import {createReceivableTemporalDatabase} from './receivableTemporalDatabase';
export async function createReceivableCapturedHistoryDatabase(){
 const db=await createReceivableTemporalDatabase();
 await db.exec(readFileSync('supabase/migrations/20260910201323_finance_receivable_captured_history.sql','utf8'));
 return db;
}
