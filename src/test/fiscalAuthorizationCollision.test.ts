// @vitest-environment node
import {it,expect} from 'vitest';import {readFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';import {createReceivableFinancialDatabase} from './helpers/receivableFinancialDatabase';import {installFinanceFiscalInvoiceLifecycleFixture} from './helpers/financeFiscalInvoiceLifecycleFixture';import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
it('rejects a15digit integration batch as fiscal authorization without changing source, distinct authorization stays eligible',async()=>{
 const {db}=await createReceivableFinancialDatabase(true,false);try{
 await db.exec('create table auth.users(id uuid primary key)');await db.exec(readFileSync('supabase/migrations/20260909212104_finance_ledger_foundation.sql','utf8'));await installFinanceFiscalInvoiceLifecycleFixture(db);
 await db.exec('alter table hub_fiscal_emissions add column if not exists last_response jsonb');
 const patch=readFileSync('supabase/migrations/20260911051642_finance_fiscal_authorization_receipt_collision.sql','utf8');await db.exec(patch);await db.exec(patch);
 const payer=randomUUID();await db.query("insert into clients(id,tenant_id,company_name,active) values($1,$2,'Pagador QA',true)",[payer,i.tenant]);
 await db.exec('begin');
 for(const collision of [true,false]){const source=randomUUID(),emission=randomUUID();await db.query('insert into cte_documents(id,tenant_id,client_id,freight_value,net_value) values($1,$2,$3,100,100)',[source,i.tenant,payer]);const protocol='2'.repeat(15),lote=collision?protocol:'3'.repeat(15);
 await db.query("insert into hub_fiscal_emissions(id,tenant_id,doc_type,environment,status,dispatch_state,cte_document_id,access_key,authorization_protocol,number,last_response) values($1,$2,'cte','production','authorized','recorded',$3,$4,$5,'123',$6)",[emission,i.tenant,source,'1'.repeat(44),protocol,{document:{raw_response_json:{managersaas:{parsed:{lote}}}}}]);
 const before=(await db.query('select to_jsonb(e) v from hub_fiscal_emissions e where id=$1',[emission])).rows;
 const obs=(await db.query<{id:string;snapshot:{authorization_integration_receipt_collision:boolean}}>('select id,snapshot from finance_fiscal_observations where emission_id=$1',[emission])).rows[0];expect(obs.snapshot.authorization_integration_receipt_collision).toBe(collision);
 const basis=(await db.query<{v:{ready:boolean;issues:string[]}}>('select finance_private.fiscal_receivable_basis_internal($1,$2) v',[i.tenant,obs.id])).rows[0].v;expect(basis.ready).toBe(!collision);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);const result=(await operationRpc<{v:{status:string;issue:string|null}}>(db,'select process_finance_fiscal_observation($1,$2) v',[i.tenant,obs.id])).rows[0].v;expect(result.status).toBe(collision?'review':'applied');if(collision)expect(result.issue).toContain('authorization_integration_receipt_collision');
 expect((await db.query('select to_jsonb(e) v from hub_fiscal_emissions e where id=$1',[emission])).rows).toEqual(before);
 }
 expect((await db.query('select * from receivables')).rows).toHaveLength(1);expect((await db.query('select * from bank_transactions')).rows).toHaveLength(0);
 }finally{await db.close();}
},60000);
