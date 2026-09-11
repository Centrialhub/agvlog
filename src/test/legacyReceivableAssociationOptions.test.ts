// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createLegacyReceivableAssociationDatabase,withLegacyReceiptSeed} from './helpers/legacyReceivableAssociationDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {createFinancialScenario,financialPayload,financialCommand} from './helpers/receivableFinancialDatabase';
import {legacyReceivableContextSchema} from '@/lib/financial/legacyReceivableAssociationContract';
import {movementReceiptTraceSchema} from '@/lib/financial/movementReceiptTraceContract';
let db:PGlite;
beforeAll(async()=>{db=await createLegacyReceivableAssociationDatabase();for(const file of ['20260910145659_finance_legacy_receivable_association_options.sql','20260910150338_finance_legacy_receipt_movement_trace.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function fixture(){
 const s=await createFinancialScenario(db),payment=randomUUID(),tx=randomUUID();
 await db.query("insert into bank_transactions(id,tenant_id,bank_account_id,posted_at,description,amount,transaction_type,raw_payload) values($1,$2,$3,'2026-01-01T15:00:00Z','Recebimento antigo',30,'credit','{}')",[tx,i.tenant,s.bank]);
 await withLegacyReceiptSeed(db,()=>db.query("insert into receivables_payments(id,tenant_id,receivable_id,amount,received_at,bank_account_id,method,bank_transaction_id,created_by) values($1,$2,$3,30,'2026-01-01T15:00:00Z',$4,'pix',$5,$6)",[payment,i.tenant,s.receivable,s.bank,tx,i.operator]));
 return {...s,payment,tx};
}
async function movement(bank:string,date='2026-01-01',direction='in',nature='receipt',amount=5000){
 return (await db.query<{id:string}>("insert into finance_movements(tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,created_by) values($1,$2,$3,$4,$5,$6,'Entrada existente','Cliente QA',$7) returning id",[i.tenant,bank,direction,nature,amount,date,i.operator])).rows[0].id;
}
async function read(payment:string,page=1){return legacyReceivableContextSchema.parse((await operationRpc<{result:unknown}>(db,'select get_finance_legacy_receivable_association($1,$2,$3) result',[i.tenant,payment,page])).rows[0].result);}
async function associate(payment:string,movement_id:string){return (await operationRpc<{result:{link_id:string}}>(db,'select associate_finance_legacy_receivable_payment($1) result',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),payment_id:payment,movement_id,revision:(await read(payment)).revision,existing_receipt_confirmed:true,reason:'Associação do recebimento conferida'}])).rows[0].result;}
async function trace(movement:string,page=1){return movementReceiptTraceSchema.parse((await operationRpc<{result:unknown}>(db,'select get_finance_movement_receipt_trace($1,$2,$3) result',[i.tenant,movement,page])).rows[0].result);}
it('offers only compatible incoming entries and validates whole cents through the UI schema',async()=>{
 const f=await fixture(),good=await movement(f.bank);
 await movement(f.bank,'2026-01-02');await movement(f.bank,'2026-01-01','out','payment');await movement(f.bank,'2026-01-01','in','receipt',2000);
 expect(await read(f.payment)).toMatchObject({eligible:true,issue:null,total:1,rows:[{id:good,remaining_cents:'5000'}],payment:{id:f.payment,receivable_id:f.receivable,received_on:'2026-01-01',amount_cents:'3000',bank_transaction_id:f.tx}});
});
it('preserves manual history and payment after reversing and re-associating',async()=>{
 const f=await fixture(),m=await movement(f.bank),first=await associate(f.payment,m);
 expect(await read(f.payment)).toMatchObject({eligible:false,active_link:first.link_id,total:0,history_total:1,history:[{actor_id:i.operator,origin:'legacy_adoption'}]});
 await operationRpc(db,'select reverse_finance_legacy_receivable_association($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),link_id:first.link_id,reason:'Corrigir somente o vínculo antigo'}]);
 expect(await read(f.payment)).toMatchObject({eligible:true,active_link:null,history:[{reversal:{actor_id:i.operator}}]});
 const second=await associate(f.payment,m);expect(await read(f.payment)).toMatchObject({active_link:second.link_id,history_total:2,payment:{id:f.payment,amount_cents:'3000'}});
 const history=await trace(m);expect(history.total).toBe(2);
 expect(history.rows).toEqual(expect.arrayContaining([expect.objectContaining({origin:'legacy_adoption',link_id:first.link_id,command_id:null,correction:null,reversal_id:null,association_reversal:expect.objectContaining({actor_id:i.operator})}),expect.objectContaining({link_id:second.link_id,association_reversal:null,association:expect.objectContaining({existing_receipt_confirmed:true})})]));
});
it('paginates candidates without dropping the total',async()=>{
 const f=await fixture();for(let n=0;n<21;n++)await movement(f.bank);
 expect(await read(f.payment)).toMatchObject({total:21});expect((await read(f.payment)).rows).toHaveLength(20);expect((await read(f.payment,2)).rows).toHaveLength(1);
});
it('uses remaining capacity shared by historical receipts',async()=>{
 const f=await fixture(),m=await movement(f.bank),other=randomUUID();
 await withLegacyReceiptSeed(db,()=>db.query("insert into receivables_payments(id,tenant_id,receivable_id,amount,received_at,bank_account_id,method,created_by) values($1,$2,$3,25,'2026-01-01T15:00:00Z',$4,'pix',$5)",[other,i.tenant,f.receivable,f.bank,i.operator]));
 await associate(other,m);expect((await read(f.payment)).rows).toEqual([]);
});
it('denies invalid pages, missing payments and driver access',async()=>{
 const f=await fixture();await expect(read(f.payment,0)).rejects.toThrow('finance_invalid_filters');await expect(read(randomUUID())).rejects.toThrow('finance_payment_not_found');
 await db.query('insert into drivers(id,tenant_id,user_id,active) values(gen_random_uuid(),$1,$2,true)',[i.tenant,i.operator]);await expect(read(f.payment)).rejects.toThrow('finance_access_denied');
});
it('keeps invalid legacy dates visible as a diagnostic without offering entries',async()=>{
 const f=await fixture(),invalid=randomUUID();
 await withLegacyReceiptSeed(db,()=>db.query("insert into receivables_payments(id,tenant_id,receivable_id,amount,received_at,bank_account_id,method,created_by) values($1,$2,$3,5,'infinity',$4,'pix',$5)",[invalid,i.tenant,f.receivable,f.bank,i.operator]));
 expect(await read(invalid)).toMatchObject({eligible:false,issue:'finance_legacy_receipt_date_invalid',payment:{received_on:null,amount_cents:'500'},rows:[]});
});
it('paginates canonical and legacy trace together with distinct identities',async()=>{
 const f=await createFinancialScenario(db),m=await movement(f.bank);
 for(let n=0;n<20;n++)await financialCommand(db,await financialPayload(db,f.receivable,{effective_date:'2026-01-01',amount_cents:1,movement_id:m,bank_account_id:f.bank}));
 const payment=randomUUID();
 await db.exec('set constraints all immediate');
 await withLegacyReceiptSeed(db,()=>db.query("insert into receivables_payments(id,tenant_id,receivable_id,amount,received_at,bank_account_id,method,created_by) values($1,$2,$3,30,'2026-01-01T15:00:00Z',$4,'pix',$5)",[payment,i.tenant,f.receivable,f.bank,i.operator]));
 await associate(payment,m);
 const first=await trace(m),second=await trace(m,2);expect(first.total).toBe(21);expect(first.rows).toHaveLength(20);expect(second.rows).toHaveLength(1);
 const rows=[...first.rows,...second.rows];expect(new Set(rows.map(row=>row.origin+row.link_id)).size).toBe(21);
 expect(rows.filter(row=>row.origin==='canonical')).toHaveLength(20);expect(rows.filter(row=>row.origin==='legacy_adoption')).toHaveLength(1);
});
