import {readFileSync} from 'node:fs';
import {createPaidProjectionChainDatabase} from './paidProjectionChainDatabase';
export async function createCashPeriodCloseDatabase(){const db=await createPaidProjectionChainDatabase();await db.exec(readFileSync('supabase/migrations/20260910173906_finance_cash_period_closure.sql','utf8'));return db;}
