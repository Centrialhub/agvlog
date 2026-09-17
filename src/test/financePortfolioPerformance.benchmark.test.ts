// @vitest-environment node
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {performance} from 'node:perf_hooks';
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createReceivablePortfolioBulkReviewDatabase,portfolioReviewIds as ids} from './helpers/receivablePortfolioBulkReviewDatabase';

const benchmark=process.env.FINANCE_PORTFOLIO_BENCHMARK==='1'?describe:describe.skip;

function percentile(values:number[],fraction:number){
 const sorted=[...values].sort((a,b)=>a-b);
 return sorted[Math.max(0,Math.ceil(sorted.length*fraction)-1)];
}

async function sample(query:()=>Promise<unknown>,warmups=3,runs=20){
 for(let index=0;index<warmups;index++)await query();
 const durations:number[]=[];
 for(let index=0;index<runs;index++){
  const started=performance.now();
  await query();
  durations.push(performance.now()-started);
 }
 return {runs,p50_ms:percentile(durations,.5),p95_ms:percentile(durations,.95),max_ms:Math.max(...durations)};
}

benchmark('finance portfolio local 10k performance evidence',()=>{
 let db:PGlite;
 beforeAll(async()=>{
  db=await createReceivablePortfolioBulkReviewDatabase();
  await db.exec(readFileSync('supabase/migrations/20260911113458_finance_receivable_portfolio_bulk_evidence.sql','utf8'));
  await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[ids.tenant,ids.operator]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids.operator]);
  await db.query(`insert into receivables(tenant_id,amount,received_amount,status,description,created_at,due_date)
   select $1,100,0,'pending',case when n%20=0 then '10k needle benchmark' else '10k portfolio benchmark' end,
    timestamp '2026-01-01 15:00:00'+n*interval '1 millisecond',date '2026-12-31'
   from generate_series(1,10000)n`,[ids.tenant]);
 },60000);
 afterAll(async()=>{await db?.close();});

 it('measures summary and filtered pagination without making CI timing-dependent',async()=>{
  const readSummary=()=>db.query<{value:{total_titles:number;nominal_cents:string}}>(
   'select finance_private.receivable_portfolio_summary($1,null,null,null) value',[ids.tenant]);
  const readFilteredPage=()=>db.query<{value:{total:number;page:number;rows:unknown[]}}>(
   "select finance_private.receivables_page_by_origin($1,'needle','pending',null,null,null,2,'all') value",[ids.tenant]);

  const summary=(await readSummary()).rows[0].value;
  const page=(await readFilteredPage()).rows[0].value;
  expect(summary).toMatchObject({total_titles:10000,nominal_cents:'100000000'});
  expect(page).toMatchObject({total:500,page:2});
  expect(page.rows).toHaveLength(50);

  const measurements={
   environment:'PGlite local; database creation and 10k seed excluded',
   titles:10000,
   summary:await sample(readSummary),
   filtered_page:await sample(readFilteredPage),
  };
  console.info('FINANCE_PORTFOLIO_BENCHMARK '+JSON.stringify(measurements));
 },180000);
});
