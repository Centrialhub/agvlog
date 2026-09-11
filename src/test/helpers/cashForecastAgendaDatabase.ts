import {randomUUID} from 'node:crypto';
import {financeIds} from './financeLedgerDatabase';
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createCashForecastCollectorDatabase} from './cashForecastCollectorDatabase';
export async function installCashForecastAgenda(db:PGlite){await db.exec(readFileSync('docs/qa/finance-manual-audit-predecessor-2026-09-11.sql','utf8'));for(const n of ['20260911084618_finance_cash_forecast_pure_projection','20260911084626_finance_cash_forecast_preserved_snapshots','20260911094523_finance_current_manual_audit_actions','20260911094505_finance_cash_forecast_audited_agenda'])await db.exec(readFileSync('supabase/migrations/'+n+'.sql','utf8'));}
export async function createCashForecastAgendaDatabase(){const db=await createCashForecastCollectorDatabase();try{await installCashForecastAgenda(db);return db;}catch(error){await db.close();throw error;}}

export async function seedCashForecastAgendaReceivable(db:PGlite){const payer=randomUUID();await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Agenda independente',true)",[payer,financeIds.tenant]);return(await db.query<{id:string}>("insert into receivables(tenant_id,client_id,amount,received_amount,status,due_date,description) values($1,$2,150,0,'pending',current_date-5,'Agenda preservada') returning id",[financeIds.tenant,payer])).rows[0].id;}
