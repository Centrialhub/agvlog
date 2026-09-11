import {readFileSync} from 'node:fs';
import {createLegacyReceivableAssociationDatabase} from './legacyReceivableAssociationDatabase';
export const receivableTemporalMigration='20260910195941_finance_receivable_temporal_foundation.sql';
export async function createReceivableTemporalDatabase(install=true){
 const db=await createLegacyReceivableAssociationDatabase();
 if(install)await db.exec(readFileSync('supabase/migrations/'+receivableTemporalMigration,'utf8'));
 return db;
}
