// @vitest-environment node
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createReceivableFinancialDatabase,financialCommand,financialPayload} from './helpers/receivableFinancialDatabase';
import {installFinanceFiscalInvoiceLifecycleFixture} from './helpers/financeFiscalInvoiceLifecycleFixture';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
const read=(name:string)=>readFileSync('supabase/migrations/'+name+'.sql','utf8');
it('reads a real cancellation credit for one receipt of a shared movement, preserving full bank capacity',async()=>{
 const {db}=await createReceivableFinancialDatabase(true,false);
 try{
  await db.exec('create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb)');await db.query("insert into auth.users values($1,'qa@example.test','{}')",[i.operator]);await db.exec(read('20260909212104_finance_ledger_foundation'));await installFinanceFiscalInvoiceLifecycleFixture(db);
  await db.exec(read('20260910024438_finance_receivable_movement_projection'));await db.exec(read('20260910025658_finance_receipt_allocation_corrections'));
  const guard=read('20260909235237_finance_legacy_rpc_boundary');await db.exec(guard.slice(0,guard.indexOf('-- Wrap')));
  const collector=read('20260911082303_finance_cash_forecast_private_collector'),start=collector.indexOf('create function finance_private.forecast_customer_credit_evidence');await db.exec(collector.slice(start,collector.indexOf('create function finance_private.cash_forecast_collect',start)));
  await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);
  const payer=randomUUID(),cte=randomUUID(),emission=randomUUID();await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Cliente fiscal QA',true)",[payer,i.tenant]);await db.query('insert into cte_documents(id,tenant_id,client_id,freight_value,net_value) values($1,$2,$3,100,100)',[cte,i.tenant,payer]);
  // Existing-provider facts in the isolated fixture; this does not call an issuer.
  await db.query("insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state,cte_document_id,access_key,authorization_protocol,number) values($1,$2,'cte','production','authorized','recorded',$3,$4,$5,'123')",[emission,i.tenant,cte,'1'.repeat(44),'2'.repeat(15)]);
  async function process(){const observation=(await db.query<{id:string}>('select id from finance_fiscal_observations where emission_id=$1 order by observed_order desc limit 1',[emission])).rows[0].id;return(await operationRpc<{v:{status:string,receivable_id:string,issue:string|null}}>(db,'select process_finance_fiscal_observation($1,$2) v',[i.tenant,observation])).rows[0].v;}
  const first=await process();expect(first.status).toBe('applied');const other=(await db.query<{id:string}>("insert into receivables(tenant_id,client_id,amount,received_amount,status,description) values($1,$2,50,0,'pending','Outro frete no PIX') returning id",[i.tenant,payer])).rows[0].id;
  const account='cf600000-0000-4000-8000-000000000001';await db.query("insert into bank_accounts(id,tenant_id,name) values($1,$2,'Banco QA')",[account,i.tenant]);const day=(await db.query<{v:string}>("select (clock_timestamp() at time zone 'America/Sao_Paulo')::date::text v")).rows[0].v;
  const movement=(await operationRpc<{v:{movement_id:string}}>(db,'select record_finance_movement($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:account,direction:'in',nature:'receipt',amount_cents:15000,occurred_on:day,description:'PIX compartilhado real',beneficiary_name:'Cliente fiscal QA',reason:'Conferência da entrada compartilhada'}])).rows[0].v;
  await financialCommand(db,await financialPayload(db,first.receivable_id,{amount_cents:10000,movement_id:movement.movement_id}));await financialCommand(db,await financialPayload(db,other,{amount_cents:5000,movement_id:movement.movement_id}));
  const before=(await db.query('select to_jsonb(p) p from receivables_payments p order by id')).rows;
  await db.query("update hub_fiscal_emissions set status='cancelled' where id=$1",[emission]);expect(await process()).toMatchObject({status:'applied'});
  const credit=(await db.query<{id:string}>('select id from finance_customer_credits')).rows[0].id;const evidence=(await db.query<{v:{valid:boolean,amount_cents:string}}>('select finance_private.forecast_customer_credit_evidence($1,$2) v',[i.tenant,credit])).rows[0].v;expect(evidence).toMatchObject({valid:true,amount_cents:'10000'});
  expect((await db.query('select to_jsonb(p) p from receivables_payments p order by id')).rows).toEqual(before);
  expect((await db.query<{n:number,sum:string}>('select count(*)::int n,sum(amount_cents)::text sum from finance_movements')).rows[0]).toEqual({n:1,sum:'15000'});
  expect((await db.query<{n:number,sum:string}>('select count(*)::int n,sum(amount)::text sum from bank_transactions')).rows[0]).toEqual({n:2,sum:'150.00'});
  expect((await db.query<{v:string}>('select sum(p.amount*100)::bigint::text v from finance_receivable_movement_links l join receivables_payments p on p.tenant_id=l.tenant_id and p.id=l.payment_id where l.movement_id=$1',[movement.movement_id])).rows[0].v).toBe('15000');
  await db.exec('rollback');
 }finally{await db.close();}
},30000);
