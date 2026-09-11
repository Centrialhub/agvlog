// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {createPeriodUnloadingFlowDatabase} from './helpers/periodUnloadingFlowDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {financialCommand,financialPayload,reversalPayload,financialContext} from './helpers/receivableFinancialDatabase';
let db:PGlite;const bank='cf600000-0000-4000-8000-000000000001';
beforeAll(async()=>{db=await createPeriodUnloadingFlowDatabase();await db.exec(readFileSync("supabase/migrations/20260910205941_finance_unloading_receivable_source_guard.sql","utf8"));},30000);
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
async function sql(text:string,args:unknown[]=[]){await db.exec('savepoint attempt');try{const result=await db.query(text,args);await db.exec('release savepoint attempt');return result;}catch(e){await db.exec('rollback to savepoint attempt;release savepoint attempt');throw e;}}
async function receive(id:string,amount=15000){return financialCommand(db,await financialPayload(db,id,{amount_cents:amount,effective_date:'2026-02-10'}));}
it('protects original identity, amount and generic cancellation before payment',async()=>{
 const c=await charge();for(const expression of ["amount=151","client_id=null","client_invoice_id=gen_random_uuid()","closing_report_id=gen_random_uuid()","fiscal_document_id=gen_random_uuid()"]){await expect(sql('update receivables set '+expression+' where id=$1',[c.receivable_id])).rejects.toThrow('finance_unloading_source_immutable');}
 for(const status of ['cancelled','invoiced'])await expect(sql('update receivables set status=$1 where id=$2',[status,c.receivable_id])).rejects.toThrow('finance_unloading_status_requires_command');
 await expect(sql('delete from receivables where id=$1',[c.receivable_id])).rejects.toThrow('finance_unloading_source_immutable');
});
it('preserves permitted edits and real receipt, refund, correction and reuse',async()=>{
 const c=await charge();await sql("update receivables set description='Nota corrigida',due_date='2026-03-01',invoice_number='OBS' where id=$1",[c.receivable_id]);
 const p=await receive(c.receivable_id,6000);await financialCommand(db,reversalPayload(await financialPayload(db,c.receivable_id,{effective_date:'2026-03-01'}),p.payment_id!));
 const other=await receive(c.receivable_id);await operationRpc(db,'select correct_finance_receipt_allocation($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),payment_id:other.payment_id,expected_revision:(await financialContext(db,c.receivable_id)).revision,reason:'Corrigir alocação preservando origem'}]);
 await receive(c.receivable_id);expect((await db.query<{amount:string}>('select amount::numeric(20,2)::text amount from receivables where id=$1',[c.receivable_id])).rows[0].amount).toBe('150.00');
});
it('rejects new receipt on a previously divergent origin but allows its existing refund',async()=>{
 const c=await charge();const p=await receive(c.receivable_id,6000);
 // Simulate pre-migration inconsistent charge, keeping the actual title/payment writers intact.
 await db.exec('alter table finance_unloading_charges disable trigger user');await db.query('update finance_unloading_charges set amount_cents=16000 where id=$1',[c.charge_id]);await db.exec('alter table finance_unloading_charges enable trigger user');
 await expect(receive(c.receivable_id,1000)).rejects.toThrow('finance_unloading_source_mismatch');
 await financialCommand(db,reversalPayload(await financialPayload(db,c.receivable_id,{effective_date:'2026-03-01'}),p.payment_id!));
 expect((await db.query<{n:number}>('select count(*)::int n from receivable_payment_reversals where payment_id=$1',[p.payment_id])).rows[0].n).toBe(1);
});
it('keeps the unloading writer reauthorization immediately after lock and before replay',async()=>{
 const body=(await db.query<{v:string}>("select pg_get_functiondef('finance_private.record_unloading(jsonb)'::regprocedure) v")).rows[0].v;
 const lock=body.indexOf('perform pg_advisory_xact_lock');const reauth=body.indexOf('if not finance_private.can_access(t)',lock);expect(reauth).toBeGreaterThan(lock);expect(reauth).toBeLessThan(body.indexOf('select * into existing',lock));
});
it('rejects a new charge pointing to another amount or debtor before linking',async()=>{
 const c=await charge(),other=randomUUID();await db.query("insert into receivables(id,tenant_id,client_id,amount,received_amount,status) values($1,$2,$3,151,0,'pending')",[other,i.tenant,c.supplier]);
 await expect(sql("insert into finance_unloading_charges select (jsonb_populate_record(null::finance_unloading_charges,to_jsonb(c)||jsonb_build_object('id',gen_random_uuid(),'receivable_id',$1::uuid))).* from finance_unloading_charges c where id=$2",[other,c.charge_id])).rejects.toThrow('finance_unloading_source_mismatch');
});
it('does not let generic edits reactivate an old cancelled unloading title',async()=>{
 const c=await charge();await db.exec('alter table receivables disable trigger a_unloading_receivable_source');await db.query("update receivables set status='cancelled' where id=$1",[c.receivable_id]);await db.exec('alter table receivables enable trigger a_unloading_receivable_source');
 await expect(sql("update receivables set status='pending' where id=$1",[c.receivable_id])).rejects.toThrow('finance_unloading_status_requires_command');
});
