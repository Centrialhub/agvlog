import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
export const cashForecastPureProjectionSql=()=>readFileSync('supabase/migrations/20260911084618_finance_cash_forecast_pure_projection.sql','utf8');
export async function installCashForecastPureProjection(db:PGlite){await db.exec(cashForecastPureProjectionSql());}
