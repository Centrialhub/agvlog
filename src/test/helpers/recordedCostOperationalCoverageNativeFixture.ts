import {readFileSync} from 'node:fs';
import {createRecordedCostOperationalCoverageDatabase} from './recordedCostOperationalCoverageDatabase';

export async function prepareRecordedCostOperationalCoverageNativeFixture(){
 const db=await createRecordedCostOperationalCoverageDatabase();
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 const table=baseline.match(/CREATE TABLE public\.bank_transactions \([\s\S]*?\n\);/)?.[0];
 const defaults=baseline.match(/ALTER TABLE ONLY public\.bank_transactions\s+ALTER COLUMN[\s\S]*?;/)?.[0];
 if(!table)throw new Error('bank_transactions baseline table not found');
 await db.exec(table);
 if(defaults)await db.exec(defaults);
 await db.exec('alter table public.bank_transactions add primary key(id)');
 await db.exec('reset role');
}
