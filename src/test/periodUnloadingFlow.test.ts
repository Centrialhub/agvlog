// @vitest-environment node
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {createPeriodUnloadingFlowDatabase} from './helpers/periodUnloadingFlowDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {financialCommand,financialPayload,reversalPayload,financialContext} from './helpers/receivableFinancialDatabase';
import {withLegacyReceiptSeed} from './helpers/legacyReceivableAssociationDatabase';
import {periodUnloadingFlowSchema} from '@/lib/financial/periodUnloadingFlowContract';
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
async function read(from='2026-01-01',to='2026-01-31',supplier:string|null=null,page=1,revision:string|null=null){return periodUnloadingFlowSchema.parse((await operationRpc<{v:unknown}>(db,'select get_finance_period_unloading_flow($1,$2,$3,$4,$5,$6,$7) v',[i.tenant,from,to,[bank],supplier,page,revision])).rows[0].v);}
async function receive(id:string,amount:number,day='2026-02-10',movement?:string){return financialCommand(db,await financialPayload(db,id,{amount_cents:amount,effective_date:day,...(movement?{movement_id:movement}:{})}));}
it('separates January charge from February receipts and March refund with real commands',async()=>{
 const c=await charge();const p=await receive(c.receivable_id,6000);await receive(c.receivable_id,9000,'2026-02-15');
 const jan=await read();expect(jan.origin_totals).toMatchObject({valid:true,amount_cents:'15000'});expect(jan.receipt_totals.amount_cents).toBe('0');
 const feb=await read('2026-02-01','2026-02-28');expect(feb.origin_totals.amount_cents).toBe('0');expect(feb.receipt_totals).toMatchObject({valid:true,amount_cents:'15000'});expect(feb.money_links).toHaveLength(2);
 await financialCommand(db,reversalPayload(await financialPayload(db,c.receivable_id,{effective_date:'2026-03-01'}),p.payment_id!));
 const mar=await read('2026-03-01','2026-03-31');expect(mar.refund_totals).toMatchObject({valid:true,amount_cents:'6000'});expect(mar.rows[0].economic_on).toBe('2026-03-01');
});
it('links a 300 payment once when unloading uses 100 and freight uses 200',async()=>{
 const c=await charge(10000),freight=randomUUID(),movement=randomUUID();await db.query("insert into receivables(id,tenant_id,client_id,amount,received_amount,status) values($1,$2,$3,200,0,'pending')",[freight,i.tenant,c.supplier]);
 await db.query("insert into finance_movements(id,tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,created_by) values($1,$2,$3,'in','receipt',30000,'2026-02-10','Pix agrupado','Fornecedor',$4)",[movement,i.tenant,bank,i.operator]);
 await receive(c.receivable_id,10000,'2026-02-10',movement);await receive(freight,20000,'2026-02-10',movement);
 const result=await read('2026-02-01','2026-02-28');expect(result.receipt_totals).toMatchObject({valid:true,amount_cents:'10000'});expect(result.money_links).toMatchObject([{movement_id:movement,amount_cents:'30000',allocated_event_cents:'10000',money_covered:false}]);
});
it('diagnoses corrected allocations without pretending a refund occurred',async()=>{
 const c=await charge();const p=await receive(c.receivable_id,15000);
 await operationRpc(db,'select correct_finance_receipt_allocation($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),payment_id:p.payment_id,expected_revision:(await financialContext(db,c.receivable_id)).revision,reason:'Correção da alocação conferida'}]);
 const result=await read('2026-02-01','2026-02-28');expect(result.receipt_totals).toMatchObject({valid:false,amount_cents:null});expect(result.refund_totals.amount_cents).toBe('0');expect(result.rows[0].sidecars[0].kind).toBe('allocation_correction');
});
it('keeps one charge for two invoices and one money bridge after corrected capacity is reused',async()=>{
 const c=await charge(15000,'2026-01-10',undefined,true);expect((await read()).rows[0].document_ids).toHaveLength(2);const first=await receive(c.receivable_id,15000);
 const movement=(await db.query<{movement_id:string}>('select movement_id from finance_receivable_movement_links where tenant_id=$1 and payment_id=$2 and action=\'receive\'',[i.tenant,first.payment_id])).rows[0].movement_id;
 await operationRpc(db,'select correct_finance_receipt_allocation($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),payment_id:first.payment_id,expected_revision:(await financialContext(db,c.receivable_id)).revision,reason:'Trocar a associação sem duplicar dinheiro'}]);
 await receive(c.receivable_id,15000,'2026-02-10',movement);
 const result=await read('2026-02-01','2026-02-28');expect(result.receipt_totals).toMatchObject({count:2,valid:false,amount_cents:null});expect(result.money_links).toMatchObject([{movement_id:movement,amount_cents:'15000',allocated_event_cents:null}]);
});
it('changes revision on later registration of an earlier economic receipt and separates account selection',async()=>{
 const c=await charge(),before=await read('2026-02-01','2026-02-28');await receive(c.receivable_id,2000,'2026-02-01');await expect(read('2026-02-01','2026-02-28',null,1,before.revision)).rejects.toThrow('finance_history_changed');
 const empty=periodUnloadingFlowSchema.parse((await operationRpc<{v:unknown}>(db,'select get_finance_period_unloading_flow($1,$2,$3,$4) v',[i.tenant,'2026-01-01','2026-02-28',[]])).rows[0].v);
 expect(empty.origin_totals.amount_cents).toBe('15000');expect(empty.receipt_totals.amount_cents).toBe('0');expect(empty.account_scope.excluded_ids).toContain(bank);
});
it('does not attribute a payment to the old supplier when debtor changed before payment',async()=>{
 const c=await charge(),other=randomUUID();await db.query("insert into clients(id,tenant_id,active,company_name) values($1,$2,true,'Outro devedor')",[other,i.tenant]);await db.query('update receivables set client_id=$1 where id=$2',[other,c.receivable_id]);
 await receive(c.receivable_id,15000);const result=await read('2026-02-01','2026-02-28');expect(result.receipt_totals).toMatchObject({valid:false,amount_cents:null});expect(result.rows[0].issues).toContain('receipt_supplier_proof_missing');expect((await read()).origin_totals.amount_cents).toBe('15000');
});
it('keeps original supplier names and separates homonyms by ID',async()=>{
 const first=await charge(),second=await charge(20000);await db.query("update clients set company_name='Renomeado',active=false where id=$1",[first.supplier]);
 const result=await read();expect(result.supplier_groups).toHaveLength(2);expect(result.supplier_options.map(x=>x.name)).toEqual(['Fornecedor preservado','Fornecedor preservado']);
 expect((await read('2026-01-01','2026-01-31',first.supplier)).origin_totals.amount_cents).toBe('15000');expect(second.supplier).not.toBe(first.supplier);
});
it('keeps an undated historical receipt visible with diagnostics, not a fabricated economic day',async()=>{
 const c=await charge();await db.exec('set constraints all immediate');
 await withLegacyReceiptSeed(db,()=>db.query("insert into receivables_payments(id,tenant_id,receivable_id,amount,received_at,bank_account_id,created_by) values(gen_random_uuid(),$1,$2,10,'infinity',$3,$4)",[i.tenant,c.receivable_id,bank,i.operator]));
 const result=await read('2026-02-01','2026-02-28');expect(result.unknown_date_count).toBe(1);expect(result.rows[0].economic_on).toBeNull();expect(result.rows[0].issues).toContain('economic_date_unknown');expect(result.receipt_totals.valid).toBe(false);
});
it('invalidates the revision for a freight allocation correction outside the supplier filter',async()=>{
 const c=await charge(10000),freight=randomUUID(),movement=randomUUID();await db.query("insert into receivables(id,tenant_id,client_id,amount,received_amount,status) values($1,$2,$3,200,0,'pending')",[freight,i.tenant,c.supplier]);
 await db.query("insert into finance_movements(id,tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,created_by) values($1,$2,$3,'in','receipt',30000,'2026-02-10','Pix agrupado','Fornecedor',$4)",[movement,i.tenant,bank,i.operator]);
 await receive(c.receivable_id,10000,'2026-02-10',movement);const p=await receive(freight,20000,'2026-02-10',movement);const before=await read('2026-02-01','2026-02-28',c.supplier);
 await operationRpc(db,'select correct_finance_receipt_allocation($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),payment_id:p.payment_id,expected_revision:(await financialContext(db,freight)).revision,reason:'Correção apenas no frete do Pix'}]);
 await expect(read('2026-02-01','2026-02-28',c.supplier,1,before.revision)).rejects.toThrow('finance_history_changed');expect((await read('2026-02-01','2026-02-28')).receipt_totals.amount_cents).toBe('10000');
});
it('counts 1005 real charges and serves exact first and last pages without sampling totals',async()=>{
 const first=await charge(100),ids=[first.charge_id];for(let n=1;n<1005;n++)ids.push((await charge(100,'2026-01-10',first.supplier)).charge_id);ids.sort();
 const initial=await read();expect(initial.total).toBe(1005);expect(initial.origin_totals.amount_cents).toBe('100500');expect(initial.rows.map(r=>r.event_id)).toEqual(ids.slice(0,50));
 const last=await read('2026-01-01','2026-01-31',null,21,initial.revision);expect(last.rows.map(r=>r.event_id)).toEqual(ids.slice(1000));
},60000);
it('requires revision across pages and denies foreign accounts or mixed-driver access',async()=>{
 await charge();await expect(read('2026-01-01','2026-01-31',null,2)).rejects.toThrow('finance_history_revision_required');
 await expect(operationRpc(db,'select get_finance_period_unloading_flow($1,$2,$3,$4)',[i.tenant,'2026-01-01','2026-01-31',[randomUUID()]])).rejects.toThrow('finance_account_not_found');
 await db.query('insert into drivers(id,tenant_id,user_id,active) values(gen_random_uuid(),$1,$2,true)',[i.tenant,i.operator]);await expect(read()).rejects.toThrow('finance_access_denied');
});
it('returns safeParse failure without throwing on malformed cent values or null valid groups',async()=>{
 await charge();const valid=await read();
 for(const value of ['not-cents',null]){const broken=structuredClone(valid);broken.supplier_groups[0].origin_totals.amount_cents=value;
  expect(()=>periodUnloadingFlowSchema.safeParse(broken)).not.toThrow();expect(periodUnloadingFlowSchema.safeParse(broken).success).toBe(false);
 }
 const broken=structuredClone(valid);broken.origin_totals.amount_cents='NaN';expect(()=>periodUnloadingFlowSchema.safeParse(broken)).not.toThrow();expect(periodUnloadingFlowSchema.safeParse(broken).success).toBe(false);
});
it('diagnoses oversized historical command amounts before numeric conversion',async()=>{
 const c=await charge();const p=await receive(c.receivable_id,15000);
 // Explicit damaged-history fixture; ordinary writers cannot mutate commands.
 await db.exec('alter table receivable_financial_commands disable trigger receivable_commands_append_only');
 await db.query("update receivable_financial_commands set before_snapshot=jsonb_set(before_snapshot,'{evidence,receivable,amount}',to_jsonb(repeat('9',101))) where id=$1",[p.command_id]);
 await db.exec('alter table receivable_financial_commands enable trigger receivable_commands_append_only');
 const result=await read('2026-02-01','2026-02-28');expect(result.receipt_totals.valid).toBe(false);expect(result.rows[0].issues).toContain('receipt_supplier_proof_missing');
});
