import {readFileSync} from 'node:fs';
import {createLegacyReceivableAssociationDatabase} from './legacyReceivableAssociationDatabase';
export async function createReceivablePaymentsPageDatabase(){
 const db=await createLegacyReceivableAssociationDatabase();
 await db.exec(readFileSync('supabase/migrations/20260910202421_finance_receivable_payments_page.sql','utf8'));
 return db;
}
