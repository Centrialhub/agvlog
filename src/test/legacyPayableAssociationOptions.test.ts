// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createLegacyPayableAssociationDatabase} from './helpers/legacyPayableAssociationDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {legacyPayableContextSchema} from '@/lib/financial/legacyPayableAssociationContract';
import {payablePaymentHistorySchema} from '@/lib/financial/payableMovementContract';
let db:PGlite;
beforeAll(async()=>{db=await createLegacyPayableAssociationDatabase();await db.exec(readFileSync('supabase/migrations/20260910143920_finance_legacy_payable_association_options.sql','utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function fixture(){const title=randomUUID(),payment=randomUUID(),tx=randomUUID();
 await db.query("insert into payables(id,tenant_id,supplier_name,category,description,amount,due_date,status,driver_id) values($1,$2,'Fornecedor antigo','other','Antigo',300,'2026-01-01','approved',$3)",[title,i.tenant,i.driver]);
 await db.query("insert into bank_transactions(id,tenant_id,bank_account_id,posted_at,description,amount,transaction_type,raw_payload) values($1,$2,$3,'2026-01-01T15:00:00Z','Baixa antiga',300,'debit','{}')",[tx,i.tenant,i.account]);
 await db.query("insert into payables_payments(id,tenant_id,payable_id,amount,paid_at,bank_account_id,method,bank_transaction_id,created_by) values($1,$2,$3,300,'2026-01-01T15:00:00Z',$4,'pix',$5,$6)",[payment,i.tenant,title,i.account,tx,i.operator]);return {title,payment,tx};
}
async function movement(extra:Record<string,unknown>={}){const result=await financeAs<{result:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1) result',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,driver_id:i.driver,direction:'out',nature:'payment',amount_cents:50000,occurred_on:'2026-01-01',description:'Saída já registrada',beneficiary_name:'Motorista QA',reason:'Conferência do registro histórico',...extra}]);return result.rows[0].result.movement_id;}
async function read(payment:string,page=1,actor=i.operator){return legacyPayableContextSchema.parse((await financeAs<{result:unknown}>(db,actor,'select get_finance_legacy_payable_association($1,$2,$3) result',[i.tenant,payment,page])).rows[0].result);}
async function associate(payment:string,movement_id:string){const preview=await read(payment);return (await financeAs<{result:{link_id:string}}>(db,i.operator,'select associate_finance_legacy_payable_payment($1) result',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),payment_id:payment,movement_id,revision:preview.revision,reason:'Associação explicitamente conferida'}])).rows[0].result;}
it('offers only same-day outgoing movements with matching driver and enough capacity',async()=>{
 const f=await fixture(),good=await movement();await movement({occurred_on:'2026-01-02'});await movement({driver_id:undefined});await movement({amount_cents:20000});await movement({direction:'in',nature:'receipt'});
 const result=await read(f.payment);expect(result).toMatchObject({eligible:true,issue:null,total:1,payment:{amount_cents:'30000',paid_on:'2026-01-01',bank_transaction_id:f.tx}});expect(result.rows[0]).toMatchObject({id:good,remaining_cents:'50000'});
});
it('uses shared remaining capacity rather than the original movement value',async()=>{
 const a=await fixture(),b=await fixture(),m=await movement();await associate(b.payment,m);expect((await read(a.payment)).rows).toEqual([]);
});
it('preserves association history across reversal and reassociation without duplicate payment rows',async()=>{
 const f=await fixture(),m=await movement(),first=await associate(f.payment,m);
 expect(await read(f.payment)).toMatchObject({eligible:false,active_link:first.link_id,total:0,history_total:1,history:[{actor_id:i.operator,origin:'legacy_adoption'}]});
 await financeAs(db,i.operator,'select reverse_finance_legacy_payable_association($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),link_id:first.link_id,reason:'Refazer associação preservando pagamento'}]);
 expect(await read(f.payment)).toMatchObject({eligible:true,active_link:null,history:[{reversal:{actor_id:i.operator}}]});
 const second=await associate(f.payment,m);const result=await read(f.payment);expect(result.active_link).toBe(second.link_id);expect(result.history_total).toBe(2);expect(result.payment.id).toBe(f.payment);
});
it('paginates all eligible exits and returns safe diagnostics for an invalid payment date',async()=>{
 const f=await fixture();for(let n=0;n<21;n++)await movement();expect(await read(f.payment)).toMatchObject({total:21,rows:expect.any(Array)});expect((await read(f.payment)).rows).toHaveLength(20);expect((await read(f.payment,2)).rows).toHaveLength(1);
 await db.query("update payables_payments set paid_at='infinity' where id=$1",[f.payment]);expect(await read(f.payment)).toMatchObject({eligible:false,payment:{paid_on:null},rows:[]});
});
it('denies drivers, unknown payments and invalid pages',async()=>{
 const f=await fixture();await expect(read(f.payment,1,i.driverUser)).rejects.toThrow('finance_access_denied');await expect(read(randomUUID())).rejects.toThrow('finance_payment_not_found');await expect(read(f.payment,0)).rejects.toThrow('finance_invalid_filters');
});
it('keeps canonical payment history distinguishable after upgrading the shared link table',async()=>{
 const title=randomUUID(),m=await movement();
 await db.query("insert into payables(id,tenant_id,supplier_name,category,description,amount,due_date,status) values($1,$2,'Fornecedor atual','other','Atual',300,'2026-01-01','approved')",[title,i.tenant]);
 await financeAs(db,i.operator,'select apply_finance_payable_movement($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),payable_id:title,movement_id:m,amount_cents:30000,method:'pix',reason:'Baixa atual conferida pelo financeiro'}]);
 const history=payablePaymentHistorySchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select get_finance_payable_payment_history($1,$2,1) result',[i.tenant,title])).rows[0].result);
 expect(history).toMatchObject({total:1,rows:[{link_origin:'canonical',reversal:null}]});
 const context=await read(history.rows[0].id);expect(context).toMatchObject({eligible:false,issue:'finance_legacy_payment_not_eligible',history:[]});
});
