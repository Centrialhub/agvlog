// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {createFinanceLedgerDatabase,financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {settlementMovementOptionsSchema} from '@/lib/financial/settlementMovementContract';
let db:PGlite;const settlement=randomUUID(),payment=randomUUID();
beforeAll(async()=>{
 db=await createFinanceLedgerDatabase();
 await db.exec(`create table driver_settlements(id uuid primary key,tenant_id uuid,driver_id uuid);
 create table driver_settlement_payments(id uuid primary key,tenant_id uuid,settlement_id uuid,amount numeric,paid_at timestamptz);
 create table finance_expense_allocations(tenant_id uuid,movement_id uuid,amount_cents bigint);
 create table finance_payable_movement_links(id uuid,tenant_id uuid,movement_id uuid,amount_cents bigint);
 create table finance_payable_link_reversals(tenant_id uuid,link_id uuid);
 create table finance_statement_imports(id uuid,tenant_id uuid,file_name text);
 create table finance_statement_rows(id uuid,tenant_id uuid,source_row integer);`);
 await db.exec(readFileSync('supabase/migrations/20260909233625_finance_audit_queries.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910130540_finance_settlement_movement_links.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910130921_finance_settlement_movement_options.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910131149_finance_settlement_link_audit.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910132411_finance_settlement_link_reversals.sql','utf8'));
});
afterAll(()=>db.close());beforeEach(async()=>{await db.exec('begin');await db.query('insert into driver_settlements values($1,$2,$3)',[settlement,i.tenant,i.driver]);await db.query("insert into driver_settlement_payments values($1,$2,$3,100,'2026-01-01T20:00:00Z')",[payment,i.tenant,settlement]);});afterEach(()=>db.exec('rollback'));
async function movement(description='Saída',date='2026-01-01',amount=10000,driver:string|null=i.driver){
 const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:amount,occurred_on:date,description,beneficiary_name:'Motorista QA',driver_id:driver,reason:'Conferido pelo setor financeiro'};
 const response=await financeAs<{r:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1::jsonb) r',[JSON.stringify(payload)]);return response.rows[0].r.movement_id;
}
async function options(actor=i.operator,tenant=i.tenant,page=1){const r=await financeAs<{r:unknown}>(db,actor,'select get_finance_settlement_payment_movements($1,$2,$3) r',[tenant,payment,page]);return settlementMovementOptionsSchema.parse(r.rows[0].r);}
it('lists only same driver/date and sufficient shared capacity, then displays immutable authorship',async()=>{
 const eligible=await movement();await movement('Outro dia','2026-01-02');await movement('Sem motorista','2026-01-01',10000,null);
 const allocated=await movement('Já utilizado');await db.query('insert into finance_expense_allocations values($1,$2,1)',[i.tenant,allocated]);
 expect((await options()).rows.map(r=>r.id)).toEqual([eligible]);
 await financeAs(db,i.operator,'select link_finance_settlement_payment($1::jsonb)',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),payment_id:payment,movement_id:eligible,reason:'Conferido pelo financeiro'})]);
 const after=await options();expect(after.rows).toHaveLength(0);expect(after.link).toMatchObject({movement_id:eligible,amount_cents:10000,created_by:i.operator,actor_name:'Financeiro QA',reason:'Conferido pelo financeiro'});
 expect((await db.query('select * from driver_settlement_payments')).rows).toHaveLength(1);
});
it('paginates eligible movements with exact total',async()=>{for(let n=0;n<21;n++)await movement(`Saída ${n}`);expect(await options()).toMatchObject({total:21,page:1});expect((await options(i.operator,i.tenant,2)).rows).toHaveLength(1);});
it('rejects drivers including mixed profiles and foreign tenant',async()=>{
 await expect(options(i.driverUser)).rejects.toThrow('finance_access_denied');
 await db.query("insert into tenant_memberships values($1,$2,'operator',true)",[i.tenant,i.driverUser]);await expect(options(i.driverUser)).rejects.toThrow('finance_access_denied');
 await expect(options(i.operator,i.otherTenant)).rejects.toThrow('finance_access_denied');
});
it('explains missing driver and invalid payment dates rather than showing an empty eligible list',async()=>{
 await db.query('update driver_settlements set driver_id=null where id=$1',[settlement]);await expect(options()).rejects.toThrow('Acerto sem motorista');
 await db.query('update driver_settlements set driver_id=$1 where id=$2',[i.driver,settlement]);await db.query('update driver_settlement_payments set paid_at=null where id=$1',[payment]);await expect(options()).rejects.toThrow('Pagamento com valor ou data inválidos');
});
async function link(movementId:string){
 const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),payment_id:payment,movement_id:movementId,reason:'Conferido pelo financeiro'};
 return (await financeAs<{r:{link_id:string}}>(db,i.operator,'select link_finance_settlement_payment($1::jsonb) r',[JSON.stringify(payload)])).rows[0].r;
}
async function reverse(payload:Record<string,unknown>,actor=i.operator){return (await financeAs<{r:Record<string,unknown>}>(db,actor,'select reverse_finance_settlement_link($1::jsonb) r',[JSON.stringify(payload)])).rows[0].r;}
it('corrects a link without changing payment or money, preserves history and allows exactly one new active link',async()=>{
 const first=await movement('Saída incorreta'),second=await movement('Saída correta');const linked=await link(first);
 const before=(await db.query('select * from driver_settlement_payments')).rows;
 const cashBefore=(await db.query('select * from finance_movements order by id')).rows;
 const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),link_id:linked.link_id,reason:'Saída escolhida incorretamente na conferência'};
 const result=await reverse(payload);expect(result).toMatchObject({confirmed:true,cash_changed:false,link_id:linked.link_id});
 expect(await reverse(payload)).toEqual(result);
 await expect(reverse({...payload,request_id:randomUUID()})).rejects.toThrow('finance_settlement_link_already_reversed');
 await expect(reverse({...payload,reason:'Outra justificativa para mesmo pedido'})).rejects.toThrow('finance_request_conflict');
 const after=await options();expect(after.link).toBeNull();expect(after.rows).toHaveLength(2);
 expect(after.history).toHaveLength(1);expect(after.history[0]).toMatchObject({id:linked.link_id,reversal:{actor_id:i.operator,actor_name:'Financeiro QA',reason:payload.reason}});
 const replacement=await link(second);expect((await options()).link?.id).toBe(replacement.link_id);
 await expect(link(first)).rejects.toThrow('finance_settlement_payment_already_linked');
 expect((await options()).history).toHaveLength(2);
 expect((await db.query('select * from driver_settlement_payments')).rows).toEqual(before);
 expect((await db.query('select * from finance_movements order by id')).rows).toEqual(cashBefore);
 const audit=(await financeAs<{r:{rows:{action:string;manual_intervention:boolean;actor_id:string}[]}}>(db,i.operator,'select list_finance_audit_events($1,$2::jsonb) r',[i.tenant,JSON.stringify({manual_only:true})])).rows[0].r;
 expect(audit.rows).toEqual(expect.arrayContaining([expect.objectContaining({action:'settlement_link_reversed',manual_intervention:true,actor_id:i.operator})]));
});
it('denies foreign and driver corrections and retains immutable original payment after unlinking',async()=>{
 const linked=await link(await movement());const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),link_id:linked.link_id,reason:'Vínculo revisado pelo financeiro'};
 await expect(reverse(payload,i.driverUser)).rejects.toThrow('finance_access_denied');
 await expect(reverse({...payload,tenant_id:i.otherTenant})).rejects.toThrow('finance_access_denied');
 await expect(reverse({...payload,link_id:randomUUID()})).rejects.toThrow('finance_settlement_link_not_found');
 await expect(reverse({...payload,reason:'curto'})).rejects.toThrow('finance_invalid_payload');
 const result=await reverse(payload);
 await expect(financeAs(db,i.operator,'delete from finance_settlement_link_reversals where id=$1',[result.reversal_id])).rejects.toThrow('permission denied');
 expect((await financeAs(db,i.driverUser,'select * from finance_settlement_link_reversals')).rows).toHaveLength(0);
 await db.exec('savepoint immutable_check');
 await expect(db.query('delete from driver_settlement_payments where id=$1',[payment])).rejects.toThrow('finance_linked_payment_requires_audited_correction');
 await db.exec('rollback to savepoint immutable_check; release savepoint immutable_check');
 await db.exec('savepoint immutable_check');
 await expect(db.query('update finance_settlement_link_reversals set reason=$1 where id=$2',['Tentativa de apagar evidência',result.reversal_id])).rejects.toThrow();
 await db.exec('rollback to savepoint immutable_check; release savepoint immutable_check');
});
it('enforces one active link at the table boundary after removing the historical unique constraint',async()=>{
 const first=await movement(),second=await movement();await link(first);
 await db.exec('savepoint guard_check');
 await expect(db.query('insert into finance_settlement_movement_links(tenant_id,settlement_id,payment_id,movement_id,amount_cents,created_by) values($1,$2,$3,$4,10000,$5)',[i.tenant,settlement,payment,second,i.operator])).rejects.toThrow('finance_settlement_payment_already_linked');
 await db.exec('rollback to savepoint guard_check; release savepoint guard_check');
 expect((await options()).history).toHaveLength(1);
});
