import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {prepareBalanceAdjustmentNative} from './receivableBalanceAdjustmentNativeFixture';

export async function prepareReceivableRenegotiationNativeFixture(){
 const source=await prepareBalanceAdjustmentNative();
 const db=new PGlite();
 await db.exec(readFileSync('supabase/migrations/20260914214752_finance_receivable_renegotiation.sql','utf8'));
 await db.exec('reset role');
 return source;
}
