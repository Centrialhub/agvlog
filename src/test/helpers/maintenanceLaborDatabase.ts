import {readFileSync} from 'node:fs';
import {createLegacyExpenseCostDatabase} from './legacyExpenseCostDatabase';
export async function createMaintenanceLaborDatabase(){
 const db=await createLegacyExpenseCostDatabase();
 await db.exec(readFileSync('supabase/migrations/20260910160950_finance_maintenance_labor_cost_associations.sql','utf8'));
 return db;
}
