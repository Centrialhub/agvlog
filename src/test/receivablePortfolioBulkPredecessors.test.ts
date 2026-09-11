// @vitest-environment node
import {it,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {createReceivablePortfolioBulkReviewDatabase,portfolioReviewIds as i} from './helpers/receivablePortfolioBulkReviewDatabase';
it('captures the exact published scalar oracle and real current dependencies for bulk differential review',async()=>{
 const db=await createReceivablePortfolioBulkReviewDatabase();try{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);
  const original=(await db.query<{v:unknown}>('select finance_private.receivable_portfolio_summary($1,null,null,null) v',[i.tenant])).rows[0].v;
  expect((await db.query<{v:unknown}>('select finance_private.receivable_portfolio_scalar_oracle($1,null,null,null) v',[i.tenant])).rows[0].v).toEqual(original);
  const catalog=(await db.query("select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' signature,md5(replace(prosrc,E'\\r\\n',E'\\n')) normalized_md5,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='finance_private' and p.proname in('receivable_portfolio_summary','cash_receivable_ledger_evidence','receivable_credit_evidence','customer_credit_position','receivable_fiscal_issue')) or (n.nspname='public' and p.proname in('_receivable_financial_snapshot','receivable_fiscal_issue')) order by 1")).rows;
  expect(catalog.length).toBeGreaterThanOrEqual(6);
  writeFileSync('docs/qa/finance-receivable-portfolio-bulk-predecessors-2026-09-11.json',JSON.stringify(catalog,null,2)+'\n','utf8');
 }finally{await db.close();}
},60000);
