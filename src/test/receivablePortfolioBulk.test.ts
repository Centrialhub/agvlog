// @vitest-environment node
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createReceivablePortfolioBulkReviewDatabase,portfolioReviewIds as i} from './helpers/receivablePortfolioBulkReviewDatabase';
const sql=readFileSync('supabase/migrations/20260911113458_finance_receivable_portfolio_bulk_evidence.sql','utf8');
it('keeps the exact portfolio DTO and filters with bulk evidence, leaving snapshot and page definitions intact',async()=>{
 const db=await createReceivablePortfolioBulkReviewDatabase();try{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);
  await db.query("insert into clients(id,tenant_id,company_name) values(md5('bulk-client')::uuid,$1,'Bulk client')",[i.tenant]);
  await db.query("insert into receivables(id,tenant_id,client_id,amount,status,description,due_date,created_at) select md5('bulk-title-'||n)::uuid,$1,md5('bulk-client')::uuid,n/100.0,'pending','Bulk title',date '2026-09-01'+n,timestamp '2026-09-01'+n*interval '1 hour' from generate_series(1,100)n",[i.tenant]);
  const signatures=['public._receivable_financial_snapshot(uuid,uuid)','finance_private.receivables_page(uuid,text,text,uuid,date,date,integer)'];
  const before=await db.query('select oid,prosrc,proacl from pg_proc where oid=any($1::regprocedure[])',[signatures]);
  await db.exec(sql);
  expect((await db.query('select oid,prosrc,proacl from pg_proc where oid=any($1::regprocedure[])',[signatures])).rows).toEqual(before.rows);
  await db.exec('set role authenticated');
  const clientId=(await db.query<{id:string}>("select md5('bulk-client')::uuid id")).rows[0].id;
  for(const [from,to,client] of [[null,null,null],['2026-09-02','2026-09-03',null],[null,null,clientId]]){
   const values=[i.tenant,from,to,client];
   const actual=(await db.query<{v:unknown}>('select public.get_finance_receivable_portfolio_summary($1,$2,$3,$4) v',values)).rows[0].v;
   const expected=(await db.query<{v:unknown}>('select finance_private.receivable_portfolio_scalar_oracle($1,$2,$3,$4) v',values)).rows[0].v;
   expect(actual).toEqual(expected);
  }
 }finally{await db.close();}
},60000);
it('rejects changed scalar evidence before replacing the published aggregate',async()=>{
 const db=await createReceivablePortfolioBulkReviewDatabase();try{
  const before=(await db.query<{v:string}>("select prosrc v from pg_proc where oid='finance_private.receivable_portfolio_summary(uuid,date,date,uuid)'::regprocedure")).rows[0].v;
  await db.exec('grant execute on function finance_private.cash_receivable_ledger_evidence(uuid,uuid) to authenticated');
  await expect(db.exec(sql)).rejects.toMatchObject({code:'55000'});
  expect((await db.query<{v:string}>("select prosrc v from pg_proc where oid='finance_private.receivable_portfolio_summary(uuid,date,date,uuid)'::regprocedure")).rows[0].v).toBe(before);
 }finally{await db.close();}
},60000);
