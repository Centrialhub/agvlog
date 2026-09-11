import {readFileSync} from 'node:fs';
import {createMaintenanceDirectPartDatabase} from './maintenanceDirectPartDatabase';
export async function createStockAcquisitionDatabase(){const db=await createMaintenanceDirectPartDatabase();await db.exec(readFileSync('supabase/migrations/20260910170454_finance_stock_acquisition_associations.sql','utf8'));return db;}
