import {readFileSync} from 'node:fs';
import {createMaintenanceLaborDatabase} from './maintenanceLaborDatabase';
export async function createMaintenanceDirectPartDatabase(){const db=await createMaintenanceLaborDatabase();await db.exec(readFileSync('supabase/migrations/20260910161702_finance_maintenance_direct_part_associations.sql','utf8'));return db;}
