// @vitest-environment node
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createLegacyPayableAssociationDatabase} from './helpers/legacyPayableAssociationDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:PGlite;
beforeAll(async()=>{db=await createLegacyPayableAssociationDatabase();},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Associação por identificadores originais conferidos'});
async function fixture(bank=true){
 const title=randomUUID(),payment=randomUUID(),tx=bank?randomUUID():null,movement=randomUUID();
 await db.query("insert into payables(id,tenant_id,supplier_name,category,description,amount,due_date,status,driver_id) values($1,$2,'Fornecedor antigo','other','Pagamento histórico',300,'2026-01-01','approved',$3)",[title,i.tenant,i.driver]);
 if(tx)await db.query("insert into bank_transactions(id,tenant_id,bank_account_id,posted_at,amount,transaction_type,raw_payload) values($1,$2,$3,'2026-01-02T01:00:00Z',300,'debit','{}')",[tx,i.tenant,i.account]);
 await db.query("insert into payables_payments(id,tenant_id,payable_id,amount,paid_at,bank_account_id,method,bank_transaction_id,attachment_url,created_by) values($1,$2,$3,300,'2026-01-02T01:00:00Z',$4,'pix',$5,'recibo-legado',$6)",[payment,i.tenant,title,i.account,tx,i.operator]);
 await db.query("insert into finance_movements(id,tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,driver_id,created_by) values($1,$2,$3,'out','payment',50000,'2026-01-01','Saída real','Motorista',$4,$5)",[movement,i.tenant,i.account,i.driver,i.operator]);
 return {title,payment,tx,movement,payload:{...base(),payment_id:payment,movement_id:movement,revision:await sourceRevision(payment)}};
}
async function sourceRevision(payment:string){return (await db.query<{revision:string}>('select finance_private.legacy_payable_source_revision($1,$2) revision',[i.tenant,payment])).rows[0].revision;}
async function associate(p:unknown,actor=i.operator){return (await financeAs<{result:{link_id:string;payment_id:string}}>(db,actor,'select associate_finance_legacy_payable_payment($1) result',[p])).rows[0].result;}
async function reverse(link:string){return (await financeAs<{result:unknown}>(db,i.operator,'select reverse_finance_legacy_payable_association($1) result',[{...base(),link_id:link}])).rows[0].result;}
async function snapshot(f:Awaited<ReturnType<typeof fixture>>){return (await db.query("select jsonb_build_object('payment',(select to_jsonb(p) from payables_payments p where id=$1),'title',(select to_jsonb(p) from payables p where id=$2),'bank',(select to_jsonb(b) from bank_transactions b where id=$3),'movement',(select to_jsonb(m) from finance_movements m where id=$4)) result",[f.payment,f.title,f.tx,f.movement])).rows[0];}
async function inventory(){return (await financeAs<{result:{rows:{source_id:string}[]}}>(db,i.operator,'select get_finance_legacy_adoption_inventory($1,$2,$3,$4,1) result',[i.tenant,i.account,'2026-01-01','2026-01-31'])).rows[0].result;}
it('associates exact source preserving bank transaction receipt payment title and movement',async()=>{
 const f=await fixture(),before=await snapshot(f);expect((await inventory()).rows.some(r=>r.source_id===f.payment)).toBe(true);const saved=await associate(f.payload);
 expect(saved).toMatchObject({origin:'legacy_adoption',bank_transaction_id:f.tx,amount_cents:'30000',cash_created:false,payment_created:false,confirmed:true});expect(await snapshot(f)).toEqual(before);
 expect((await inventory()).rows.some(r=>r.source_id===f.payment)).toBe(false);expect((await db.query('select finance_private.movement_used_cents($1,$2)::text used',[i.tenant,f.movement])).rows[0]).toEqual({used:'30000'});
});
it('replays exactly once and records permanent manual actor and source snapshot',async()=>{
 const f=await fixture(),saved=await associate(f.payload);expect(await associate(f.payload)).toEqual(saved);await expect(associate({...f.payload,reason:'Outra finalidade para mesma chave'})).rejects.toThrow('finance_request_conflict');
 expect((await db.query('select origin,created_by,reason,actor_name,source_snapshot from finance_payable_movement_links')).rows[0]).toMatchObject({origin:'legacy_adoption',created_by:i.operator,reason:f.payload.reason,source_snapshot:{payment:{id:f.payment,bank_transaction_id:f.tx,attachment_url:'recibo-legado'}}});
 expect((await db.query("select * from finance_events where action='legacy_payable_associated'")).rows).toHaveLength(1);
});
it('association reversal preserves payment and payroll aggregate then permits reassociation without duplicate history rows',async()=>{
 const f=await fixture(),before=await snapshot(f),saved=await associate(f.payload);await reverse(saved.link_id);expect(await snapshot(f)).toEqual(before);
 expect((await db.query('select * from finance_private.active_payable_payments where id=$1',[f.payment])).rows).toHaveLength(1);expect((await inventory()).rows.some(r=>r.source_id===f.payment)).toBe(true);
 expect((await db.query('select finance_private.movement_used_cents($1,$2)::text used',[i.tenant,f.movement])).rows[0]).toEqual({used:'0'});
 const second=await associate({...f.payload,request_id:randomUUID()});expect(second.link_id).not.toBe(saved.link_id);
 const history=(await financeAs<{result:{total:number;rows:unknown[]}}>(db,i.operator,'select get_finance_payable_payment_history($1,$2,1) result',[i.tenant,f.title])).rows[0].result;expect(history.total).toBe(1);expect(history.rows).toHaveLength(1);expect(history.rows[0]).toMatchObject({link_id:second.link_id,link_origin:'legacy_adoption',reversal:null});
});
it('refuses canonical reversal of legacy association and legacy reversal of canonical allocation',async()=>{
 const f=await fixture(),saved=await associate(f.payload);await expect(financeAs(db,i.operator,'select reverse_finance_payable_link($1)',[{...base(),link_id:saved.link_id}])).rejects.toThrow('finance_legacy_association_requires_own_reversal');
 await expect(reverse(randomUUID())).rejects.toThrow('finance_legacy_association_not_found');expect((await db.query('select * from finance_payable_link_reversals')).rows).toHaveLength(0);
});
it('preserves null bank source and paid money for cancelled titles',async()=>{
 const f=await fixture(false);await db.query("update payables set status='cancelled' where id=$1",[f.title]);const before=await snapshot(f),saved=await associate({...f.payload,revision:await sourceRevision(f.payment)});await reverse(saved.link_id);expect(await snapshot(f)).toEqual(before);expect(saved).toMatchObject({bank_transaction_id:null});
});
it('denies drivers mixed roles foreign tenant and unknown payment',async()=>{
 const f=await fixture();await expect(associate(f.payload,i.driverUser)).rejects.toThrow('finance_access_denied');await db.query("insert into tenant_memberships values($1,$2,'operator',true)",[i.tenant,i.driverUser]);await expect(associate(f.payload,i.driverUser)).rejects.toThrow('finance_access_denied');await expect(associate({...f.payload,tenant_id:i.otherTenant})).rejects.toThrow('finance_access_denied');await expect(associate({...f.payload,payment_id:randomUUID()})).rejects.toThrow('finance_legacy_payment_not_found');
});
it('requires exact bank account direction date amount and driver while preserving original paid day in Sao Paulo',async()=>{
 const f=await fixture();await db.query("update bank_transactions set amount=299 where id=$1",[f.tx]);await expect(associate({...f.payload,revision:await sourceRevision(f.payment)})).rejects.toThrow('finance_legacy_bank_source_mismatch');await db.query("update bank_transactions set amount=300 where id=$1",[f.tx]);
 const wrong=randomUUID();await db.query("insert into finance_movements(id,tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,driver_id,created_by) values($1,$2,$3,'out','payment',30000,'2026-01-02','Dia UTC errado','Motorista',$4,$5)",[wrong,i.tenant,i.account,i.driver,i.operator]);await expect(associate({...f.payload,movement_id:wrong})).rejects.toThrow('finance_legacy_movement_mismatch');
 await associate(f.payload);
});
it('keeps legacy bank and payment immutable after association and its reversal',async()=>{
 const f=await fixture(),saved=await associate(f.payload);await reverse(saved.link_id);
 for(const sql of ["update bank_transactions set amount=299 where id='"+f.tx+"'","delete from bank_transactions where id='"+f.tx+"'","update payables_payments set amount=299 where id='"+f.payment+"'"]){await db.exec('savepoint protected');await expect(db.exec(sql)).rejects.toThrow(/immutable|linked/);await db.exec('rollback to savepoint protected');}
});
it('does not adopt canonical payment after its canonical reversal',async()=>{
 const f=await fixture();const title=randomUUID();await db.query("insert into payables(id,tenant_id,supplier_name,category,description,amount,due_date,status,driver_id) values($1,$2,'Novo','other','Título novo',200,'2026-01-01','approved',$3)",[title,i.tenant,i.driver]);
 const canonical=(await financeAs<{result:{payment_id:string;link_id:string}}>(db,i.operator,'select apply_finance_payable_movement($1) result',[{...base(),payable_id:title,movement_id:f.movement,amount_cents:20000,method:'pix'}])).rows[0].result;
 await expect(reverse(canonical.link_id)).rejects.toThrow('finance_legacy_association_not_found');await financeAs(db,i.operator,'select reverse_finance_payable_link($1)',[{...base(),link_id:canonical.link_id}]);
 await expect(associate({...f.payload,payment_id:canonical.payment_id,revision:await sourceRevision(canonical.payment_id)})).rejects.toThrow('finance_legacy_payment_not_eligible');expect((await db.query('select * from finance_private.active_payable_payments where id=$1',[canonical.payment_id])).rows).toHaveLength(0);
});
it('rolls back association if audit fails and rejects client supplied amount',async()=>{
 const f=await fixture();await expect(associate({...f.payload,amount_cents:1})).rejects.toThrow('finance_invalid_payload');await db.exec(`create function public.qa_fail_legacy_audit() returns trigger language plpgsql as $$begin if new.action='legacy_payable_associated' then raise exception 'forced_failure';end if;return new;end$$;create trigger qa_fail_legacy_audit before insert on finance_events for each row execute function public.qa_fail_legacy_audit();`);
 await expect(associate(f.payload)).rejects.toThrow('forced_failure');expect((await db.query('select * from finance_payable_movement_links')).rows).toHaveLength(0);expect((await db.query('select * from finance_commands')).rows).toHaveLength(0);
});
it('rejects representable invalid historical payment amounts before cents conversion',async()=>{
 const f=await fixture(false);
 for(const amount of ['NaN','0','-1']){
  await db.exec('savepoint invalid_amount');await db.query('update payables_payments set amount=$1::numeric where id=$2',[amount,f.payment]);await expect(associate({...f.payload,revision:await sourceRevision(f.payment)})).rejects.toThrow('finance_legacy_payment_amount_invalid');await db.exec('rollback to savepoint invalid_amount');
 }
});
it('rejects two old payment IDs claiming the same bank source without heuristic split',async()=>{
 const f=await fixture(),other=await fixture(false);await db.query('update payables_payments set bank_transaction_id=$1 where id=$2',[f.tx,other.payment]);await expect(associate(f.payload)).rejects.toThrow('finance_legacy_bank_source_ambiguous');
});
it('keeps advance payment evidence counted after reversing only its historical association',async()=>{
 const f=await fixture(),advance=randomUUID();await db.query("insert into employee_advances(id,tenant_id,employee_id,amount,advance_date,status,payable_id) values($1,$2,$3,300,'2026-01-01','paid',$4)",[advance,i.tenant,randomUUID(),f.title]);
 const saved=await associate(f.payload);await reverse(saved.link_id);
 const result=(await financeAs<{result:{unknown_account:{rows:{source_id:string}[]}}}>(db,i.operator,'select get_finance_legacy_adoption_inventory($1,$2,$3,$4,1) result',[i.tenant,i.account,'2026-01-01','2026-01-31'])).rows[0].result;expect(result.unknown_account.rows.some(r=>r.source_id===advance)).toBe(false);
});


it('rejects a changed source after preview without reserving money or creating partial audit',async()=>{
 const f=await fixture();await db.query("update bank_transactions set description='Correção posterior à revisão' where id=$1",[f.tx]);await expect(associate(f.payload)).rejects.toThrow('finance_legacy_payment_changed');
 expect((await db.query('select * from finance_payable_movement_links')).rows).toHaveLength(0);expect((await db.query('select * from finance_commands')).rows).toHaveLength(0);
 await associate({...f.payload,revision:await sourceRevision(f.payment)});
});
it('refuses bank source also referenced by receipts refunds or load receipts',async()=>{
 const f=await fixture();
 for(const sql of [
  `insert into receivables_payments(tenant_id,receivable_id,amount,received_at,bank_account_id,bank_transaction_id) values('${i.tenant}','${randomUUID()}',300,'2026-01-01','${i.account}','${f.tx}')`,
  `insert into receivable_payment_reversals(tenant_id,receivable_id,payment_id,financial_command_id,bank_transaction_id,amount,effective_at,created_by,reason) values('${i.tenant}','${randomUUID()}','${randomUUID()}','${randomUUID()}','${f.tx}',300,'2026-01-01','${i.operator}','Devolução documentada no legado')`,
  `insert into load_payments(tenant_id,load_id,amount,payment_date,bank_transaction_id) values('${i.tenant}','${randomUUID()}',300,'2026-01-01','${f.tx}')`
 ]){await db.exec('savepoint shared_source');await db.exec(sql);await expect(associate(f.payload)).rejects.toThrow('finance_legacy_bank_source_ambiguous');await db.exec('rollback to savepoint shared_source');}
});
