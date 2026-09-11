import {readFileSync} from 'node:fs';
import {createStockAcquisitionDatabase} from './stockAcquisitionDatabase';
export async function createStockConsumptionDatabase(){const db=await createStockAcquisitionDatabase();await db.exec(readFileSync('supabase/migrations/20260910171503_finance_stock_consumption_attributions.sql','utf8'));return db;}
