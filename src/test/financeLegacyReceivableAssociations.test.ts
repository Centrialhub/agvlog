// @vitest-environment node

import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createLegacyReceivableAssociationDatabase,withLegacyReceiptSeed} from './helpers/legacyReceivableAssociationDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {createFinancialScenario} from './helpers/receivableFinancialDatabase';


let db:PGlite;
beforeAll(async()=>{db=await createLegacyReceivableAssociationDatabase();},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function fixture(bankAmount=30){
 const s=await createFinancialScenario(db),payment=randomUUID(),tx=randomUUID();
 await db.query("insert into bank_transactions(id,tenant_id,bank_account_id,posted_at,description,amount,transaction_type,raw_payload) values($1,$2,$3,'2026-01-01T15:00:00Z','Recebimento antigo',$4,'credit','{}')",[tx,i.tenant,s.bank,bankAmount]);
 await withLegacyReceiptSeed(db,()=>db.query("insert into receivables_payments(id,tenant_id,receivable_id,amount,received_at,bank_account_id,method,bank_transaction_id,created_by) values($1,$2,$3,30,'2026-01-01T15:00:00Z',$4,'pix',$5,$6)",[payment,i.tenant,s.receivable,s.bank,tx,i.operator]));
 return {...s,payment,tx};
}
async function movement(bank:string,date='2026-01-01',direction='in',nature='receipt',amount=5000){
 return (await db.query<{id:string}>("insert into finance_movements(tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,created_by) values($1,$2,$3,$4,$5,$6,'Entrada existente','Cliente QA',$7) returning id",[i.tenant,bank,direction,nature,amount,date,i.operator])).rows[0].id;
}

const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Conferência do recebimento antigo com entrada identificada'});
async function revision(payment:string){return (await db.query<{revision:string}>('select finance_private.legacy_receivable_source_revision($1,$2) revision',[i.tenant,payment])).rows[0].revision;}
async function payload(payment:string,movement_id:string){return {...base(),payment_id:payment,movement_id,revision:await revision(payment),existing_receipt_confirmed:true};}
async function associate(p:unknown){return (await operationRpc<{result:{link_id:string}}>(db,'select associate_finance_legacy_receivable_payment($1) result',[p])).rows[0].result;}
async function reverse(link_id:string){return (await operationRpc<{result:unknown}>(db,'select reverse_finance_legacy_receivable_association($1) result',[{...base(),link_id}])).rows[0].result;}
async function source(f:Awaited<ReturnType<typeof fixture>>){return (await db.query('select jsonb_build_object(\'payment\',(select to_jsonb(p) from receivables_payments p where id=$1),\'receivable\',(select to_jsonb(r) from receivables r where id=$2),\'bank\',(select to_jsonb(b) from bank_transactions b where id=$3)) snapshot',[f.payment,f.receivable,f.tx])).rows[0];}
async function used(id:string){return (await db.query<{value:string}>('select finance_private.receipt_movement_used_cents($1,$2)::text value',[i.tenant,id])).rows[0].value;}
it('associates explicit old receipt without changing source or creating money or canonical commands',async()=>{
 const f=await fixture(),m=await movement(f.bank),before=await source(f),p=await payload(f.payment,m),saved=await associate(p);
 expect(saved).toMatchObject({payment_id:f.payment,receivable_id:f.receivable,movement_id:m,amount_cents:'3000',bank_transaction_id:f.tx,cash_created:false,payment_created:false,confirmed:true});expect(await source(f)).toEqual(before);expect(await used(m)).toBe('3000');expect(await associate(p)).toEqual(saved);
 expect((await db.query('select * from finance_receivable_movement_links')).rows).toHaveLength(0);expect((await db.query('select * from receivable_financial_commands')).rows).toHaveLength(0);expect((await db.query('select source_snapshot from finance_legacy_receipt_movement_links')).rows[0]).toMatchObject({source_snapshot:{existing_receipt_confirmed:true,payment:{id:f.payment}}});
});
it('reverses only association and permits reassociation preserving amount received and old bank record',async()=>{
 const f=await fixture(),m=await movement(f.bank),before=await source(f),a=await associate(await payload(f.payment,m));await reverse(a.link_id);expect(await used(m)).toBe('0');expect(await source(f)).toEqual(before);await associate(await payload(f.payment,m));expect(await used(m)).toBe('3000');expect((await db.query('select * from finance_legacy_receipt_movement_links')).rows).toHaveLength(2);
});
it('requires reviewed snapshot and literal confirmation before reserving capacity',async()=>{
 const f=await fixture(),m=await movement(f.bank),p=await payload(f.payment,m);await expect(associate({...p,existing_receipt_confirmed:'true'})).rejects.toThrow('finance_invalid_receipt_declaration');await expect(associate({...p,amount_cents:1})).rejects.toThrow('finance_invalid_payload');await db.query("update bank_transactions set description='Fonte atualizada' where id=$1",[f.tx]);await expect(associate(p)).rejects.toThrow('finance_legacy_receipt_changed');expect(await used(m)).toBe('0');
});
it('rejects incompatible account date direction and insufficient incoming capacity',async()=>{
 const f=await fixture();for(const m of [await movement(f.bank,'2026-01-02'),await movement(f.bank,'2026-01-01','out'),await movement(f.bank,'2026-01-01','in','transfer')])await expect(associate(await payload(f.payment,m))).rejects.toThrow('finance_receipt_movement_incompatible');
 await expect(associate(await payload(f.payment,await movement(f.bank,'2026-01-01','in','receipt',2999)))).rejects.toThrow('finance_receipt_movement_capacity_exceeded');
});
it('protects original receipt and bank after association reversal',async()=>{
 const f=await fixture(),a=await associate(await payload(f.payment,await movement(f.bank)));await reverse(a.link_id);
 for(const sql of [`update receivables_payments set amount=29 where id='${f.payment}'`,`delete from receivables_payments where id='${f.payment}'`,`update bank_transactions set description='Alteração' where id='${f.tx}'`]){await db.exec('savepoint protected');await expect(db.exec(sql)).rejects.toThrow(/immutable|history|append|preserv|versioned/);await db.exec('rollback to savepoint protected');}
});
it('accepts only exact load payment alias by receipt ID account day and amount',async()=>{
 const f=await fixture(),m=await movement(f.bank),load=randomUUID();await db.query("insert into load_payments(id,tenant_id,load_id,amount,payment_date,bank_account_id,bank_transaction_id,receivable_payment_id) values($1,$2,$3,30,'2026-01-01',$4,$5,$6)",[load,i.tenant,randomUUID(),f.bank,f.tx,f.payment]);
 const p=await payload(f.payment,m);await db.query('update load_payments set amount=29 where id=$1',[load]);await expect(associate(p)).rejects.toThrow('finance_legacy_receipt_changed');await expect(associate(await payload(f.payment,m))).rejects.toThrow('finance_legacy_receipt_bank_ambiguous');await db.query('update load_payments set amount=30 where id=$1',[load]);await associate(await payload(f.payment,m));expect(await used(m)).toBe('3000');
});
it('denies mixed driver, and failure in event rolls back the whole association',async()=>{
 const f=await fixture(),m=await movement(f.bank),p=await payload(f.payment,m),driver=randomUUID();await db.query('insert into drivers(id,tenant_id,user_id,active) values($1,$2,$3,true)',[driver,i.tenant,i.operator]);await expect(associate(p)).rejects.toThrow('finance_access_denied');await db.query('delete from drivers where id=$1',[driver]);
 await db.exec(`create function public.qa_receipt_audit_failure() returns trigger language plpgsql as $$begin if new.action='legacy_receivable_associated' then raise exception 'forced_failure';end if;return new;end$$;create trigger qa_receipt_audit_failure before insert on finance_events for each row execute function public.qa_receipt_audit_failure();`);await expect(associate(p)).rejects.toThrow('forced_failure');expect(await used(m)).toBe('0');expect((await db.query('select * from finance_commands')).rows).toHaveLength(0);
});

it('does not let canonical allocation correction replace association reversal',async()=>{
 const f=await fixture(),m=await movement(f.bank);await associate(await payload(f.payment,m));await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
 await expect(operationRpc(db,'select correct_finance_receipt_allocation($1)',[{...base(),payment_id:f.payment,expected_revision:'irrelevant'}])).rejects.toThrow('finance_legacy_receipt_requires_association_reversal');expect(await used(m)).toBe('3000');expect((await db.query('select * from finance_receipt_allocation_corrections')).rows).toHaveLength(0);
});
it('denies foreign tenant and bank source amount mismatch without any association',async()=>{
 const f=await fixture(29),m=await movement(f.bank),p=await payload(f.payment,m);await expect(associate({...p,tenant_id:i.otherTenant})).rejects.toThrow('finance_access_denied');
 await expect(associate(await payload(f.payment,m))).rejects.toThrow('finance_legacy_receipt_bank_mismatch');expect(await used(m)).toBe('0');
});
