// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {createPeriodUnloadingFlowDatabase} from './helpers/periodUnloadingFlowDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {financialCommand,financialPayload,reversalPayload} from './helpers/receivableFinancialDatabase';
import {parseFinancialContext} from '@/lib/financial/receivableCommands';
let db:PGlite;const bank='cf600000-0000-4000-8000-000000000001';
beforeAll(async()=>{db=await createPeriodUnloadingFlowDatabase();},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);await db.query("update tenant_memberships set role='admin' where user_id=$1 and tenant_id=$2",[i.operator,i.tenant]);await db.query("insert into bank_accounts(id,tenant_id,name) values($1,$2,'Conta de recebimentos')",[bank,i.tenant]);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function charge(amount=15000,day='2026-01-10',supplier?:string,twoDocuments=false){
 const payer=supplier??randomUUID(),stop=randomUUID(),doc=randomUUID();if(!supplier)await db.query("insert into clients(id,tenant_id,active,company_name) values($1,$2,true,'Fornecedor preservado')",[payer,i.tenant]);
 const trip=(await db.query<{id:string}>('select id from dispatch_trips where tenant_id=$1 limit 1',[i.tenant])).rows[0].id;
 await db.query("insert into dispatch_stops(id,tenant_id,dispatch_trip_id,client_id,status,destination) values($1,$2,$3,$4,'pending','Entrega da descarga')",[stop,i.tenant,trip,payer]);
 await db.query("insert into fiscal_documents(id,tenant_id,client_id,supplier_id,document_type,status,invoice_number,value) values($1,$2,$3,$3,'inbound','ready','NF-DESCARGA',1000)",[doc,i.tenant,payer]);
 await db.query('insert into dispatch_stop_documents(id,tenant_id,dispatch_stop_id,fiscal_document_id) values(gen_random_uuid(),$1,$2,$3)',[i.tenant,stop,doc]);
 if(twoDocuments){const other=randomUUID();await db.query("insert into fiscal_documents(id,tenant_id,client_id,supplier_id,document_type,status,invoice_number,value) values($1,$2,$3,$3,'inbound','ready','NF-DESCARGA-2',500)",[other,i.tenant,payer]);await db.query('insert into dispatch_stop_documents(id,tenant_id,dispatch_stop_id,fiscal_document_id) values(gen_random_uuid(),$1,$2,$3)',[i.tenant,stop,other]);}
 const context=(await operationRpc<{v:{revision:string}}>(db,'select get_finance_delivery_context($1,$2) v',[i.tenant,stop])).rows[0].v;
 const result=(await operationRpc<{v:{charge_id:string;receivable_id:string}}>(db,'select record_finance_unloading($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),stop_id:stop,expected_revision:context.revision,amount_cents:amount,occurred_on:day,due_date:'2026-02-28',receipt_path:i.tenant+'/proof/unloading.pdf',reason:'Cobrança de descarga conferida'}])).rows[0].v;
 return{...result,supplier:payer,doc,stop};
}
async function install(){await db.exec(readFileSync('supabase/migrations/20260910210433_finance_unloading_receivable_context.sql','utf8'));}
async function context(id:string){const result=(await operationRpc<{v:unknown}>(db,'select get_receivable_financial_context($1,$2) v',[i.tenant,id])).rows[0].v;return parseFinancialContext(result,i.tenant,i.operator,id);}
it('keeps ordinary and compatible unloading collectible with independent source proof',async()=>{
 const c=await charge(),ordinary=randomUUID();await db.query("insert into receivables(id,tenant_id,client_id,amount,received_amount,status) values($1,$2,$3,150,0,'pending')",[ordinary,i.tenant,c.supplier]);await install();
 expect(await context(c.receivable_id)).toMatchObject({can_receive:true,source_issue:null,requires_reconciliation:false});expect((await context(c.receivable_id)).source_revision).toMatch(/^[a-f0-9]{32}$/);
 expect(await context(ordinary)).toMatchObject({can_receive:true,source_issue:null,source_revision:null});
 const p=await financialCommand(db,await financialPayload(db,c.receivable_id,{amount_cents:6000,effective_date:'2026-02-10'}));expect(p.payment_id).toBeTruthy();
});
it('diagnoses wrong debtor before receiving without pretending ledger reconciliation fixes it',async()=>{
 const c=await charge(),other=randomUUID();await db.query("insert into clients(id,tenant_id,active,company_name) values($1,$2,true,'Outro fornecedor')",[other,i.tenant]);await install();const before=await context(c.receivable_id);
 // The pre-205941 writer allowed this historical divergence; no disabled trigger.
 await db.query('update receivables set client_id=$1 where id=$2',[other,c.receivable_id]);const after=await context(c.receivable_id);
 expect(after).toMatchObject({can_receive:false,source_issue:'finance_unloading_source_mismatch',requires_reconciliation:false,reconciliation_reason:null});expect(after.revision).not.toBe(before.revision);expect(after.source_revision).not.toBe(before.source_revision);
});
it('preserves refund of a real receipt made before source guards were installed',async()=>{
 const c=await charge(),other=randomUUID();await db.query("insert into clients(id,tenant_id,active,company_name) values($1,$2,true,'Devedor legado')",[other,i.tenant]);await db.query('update receivables set client_id=$1 where id=$2',[other,c.receivable_id]);
 const p=await financialCommand(db,await financialPayload(db,c.receivable_id,{amount_cents:6000,effective_date:'2026-02-10'}));await db.exec(readFileSync('supabase/migrations/20260910205941_finance_unloading_receivable_source_guard.sql','utf8'));await install();
 expect(await context(c.receivable_id)).toMatchObject({can_receive:false,can_reverse:true,source_issue:'finance_unloading_source_mismatch',requires_reconciliation:false});
 const refund=await financialCommand(db,reversalPayload(await financialPayload(db,c.receivable_id,{effective_date:'2026-03-01'}),p.payment_id!));expect(refund.reversal_id).toBeTruthy();
 expect((await context(c.receivable_id)).can_receive).toBe(false);
});
