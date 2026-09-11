import {readFileSync} from 'node:fs';
import {createLegacyPayableAssociationDatabase} from './legacyPayableAssociationDatabase';
export async function createRecordedCostSummaryDatabase(){
 const db=await createLegacyPayableAssociationDatabase();
 for(const name of ['20260910125357_finance_recorded_costs.sql','20260910130032_finance_payroll_recorded_costs.sql','20260910152557_finance_recorded_cost_summary.sql'])await db.exec(readFileSync('supabase/migrations/'+name,'utf8'));
 return db;
}
