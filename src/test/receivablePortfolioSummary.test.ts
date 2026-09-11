// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createLegacyReceivableAssociationDatabase} from './helpers/legacyReceivableAssociationDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {receivablePortfolioSchema} from '@/lib/financial/receivablePortfolioContract';
import {createFinancialScenario,financialCommand,financialPayload} from './helpers/receivableFinancialDatabase';
let db:PGlite;
beforeAll(async()=>{db=await createLegacyReceivableAssociationDatabase();await db.exec(readFileSync('supabase/migrations/20260910151617_finance_receivable_portfolio_summary.sql','utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function read(from:string|null=null,to:string|null=null,client:string|null=null){return receivablePortfolioSchema.parse((await operationRpc<{result:Record<string,unknown>}>(db,'select get_finance_receivable_portfolio_summary($1,$2,$3,$4) result',[i.tenant,from,to,client])).rows[0].result);}
async function title(amount:number,created='2026-01-01T15:00:00Z',received:number|null=0,tenant=i.tenant){
 const id=randomUUID();await db.query("insert into receivables(id,tenant_id,description,amount,status,received_amount,created_at,updated_at,due_date) values($1,$2,'Título manual QA',$3,'pending',$4,$5,clock_timestamp(),'2020-01-01')",[id,tenant,amount,received,created]);return id;
}
it('aggregates more than 1000 titles without truncating the portfolio',async()=>{
 await db.query("insert into receivables(id,tenant_id,description,amount,status,received_amount,created_at,updated_at,due_date) select gen_random_uuid(),$1,'Título manual QA',1.01,'pending',0,'2026-01-01T15:00:00Z',clock_timestamp(),'2020-01-01' from generate_series(1,1005)",[i.tenant]);
 expect(await read()).toMatchObject({total_titles:1005,invalid_titles:0,totals_valid:true,nominal_cents:'101505',open_cents:'101505',overdue_cents:'101505',received_allocated_cents:'0'});
});
it('counts partial allocated receipts separately from outstanding value',async()=>{
 const s=await createFinancialScenario(db);await financialCommand(db,await financialPayload(db,s.receivable,{amount_cents:4000}));
 expect(await read()).toMatchObject({total_titles:1,totals_valid:true,nominal_cents:'24000',received_allocated_cents:'4000',open_cents:'20000',status_rows:[{status:'partial',open_cents:'20000',received_allocated_cents:'4000'}]});
});
it('applies Sao Paulo day boundaries and tenant isolation',async()=>{
 await title(10,'2026-01-02T02:59:59Z');await title(20,'2026-01-02T03:00:00Z');await title(999,'2026-01-01T15:00:00Z',0,i.otherTenant);
 expect(await read('2026-01-01','2026-01-01')).toMatchObject({total_titles:1,nominal_cents:'1000'});
});
it('exposes invalid values and undated titles without presenting partial sums as totals',async()=>{
 await title(10);await title(20,'infinity');
 expect(await read('2026-01-01','2026-01-01')).toMatchObject({total_titles:2,invalid_titles:1,totals_valid:false,nominal_cents:null,received_allocated_cents:null,open_cents:null,overdue_cents:null});
});
it('denies invalid filters, foreign client and mixed driver profiles',async()=>{
 await expect(read('2026-01-02','2026-01-01')).rejects.toThrow('finance_invalid_filters');await expect(read(null,null,randomUUID())).rejects.toThrow('finance_client_not_found');
 await db.query('insert into drivers(id,tenant_id,user_id,active) values(gen_random_uuid(),$1,$2,true)',[i.tenant,i.operator]);await expect(read()).rejects.toThrow('finance_access_denied');
});
it('accepts a new unpaid title with null projected receipts only when the financial snapshot balances',async()=>{
 await title(25,'2026-01-01T15:00:00Z',null);
 expect(await read()).toMatchObject({totals_valid:true,nominal_cents:'2500',open_cents:'2500',received_allocated_cents:'0'});
});
it('rejects nonfinite due dates instead of fabricating an overdue balance',async()=>{
 const id=await title(10);await db.query("update receivables set due_date='-infinity' where id=$1",[id]);
 expect(await read()).toMatchObject({totals_valid:false,invalid_titles:1,overdue_cents:null});
});
it('does not count a fiscal-blocked title as collectible even when its ledger balances',async()=>{
 const id=await title(10),cte=randomUUID();
 await db.query("insert into cte_documents(id,tenant_id,cte_number,status) values($1,$2,'QA-REJECTED','rejected')",[cte,i.tenant]);
 await db.query('update receivables set cte_document_id=$1 where id=$2',[cte,id]);
 const state=(await db.query<{result:{requires_reconciliation:boolean;fiscal_block_reason:string}}>('select _receivable_financial_snapshot($1,$2) result',[i.tenant,id])).rows[0].result;
 expect(state).toMatchObject({requires_reconciliation:false,fiscal_block_reason:'fiscal_authorization_unavailable'});
 expect(await read()).toMatchObject({invalid_titles:1,totals_valid:false,open_cents:null});
});
