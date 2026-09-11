// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {afterAll,afterEach,beforeAll,beforeEach,it,expect} from 'vitest';
import {createAccountPeriodCloseDatabase} from './helpers/accountPeriodCloseDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:Awaited<ReturnType<typeof createAccountPeriodCloseDatabase>>;
beforeAll(async()=>{db=await createAccountPeriodCloseDatabase(true);for(const name of ['20260910182541_finance_movement_correction_foundation','20260910182830_finance_movement_correction_history','20260910184213_finance_movement_active_reference'])await db.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
const payload=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:5000,occurred_on:'2026-08-15',description:'Pagamento para conferir',beneficiary_name:'Fornecedor QA',bank_reference:'same-reference',reason:'Registro de saída para conferência'});
async function record(p:ReturnType<typeof payload>){return (await financeAs<{v:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1) v',[p])).rows[0].v;}
async function voidOwner(m:string,original:string){const request=randomUUID();await db.query("insert into finance_commands(tenant_id,request_id,actor_id,action,payload,result) values($1,$2,$3,'qa_void_storage','{}','{}')",[i.tenant,request,i.operator]);await db.query("insert into finance_movement_voids(tenant_id,movement_id,original_request_id,request_id,kind,actor_id,actor_name,reason,revision,source_snapshot) values($1,$2,$3,$4,'void',$5,'QA','Representação invalidada na fixture',md5('qa'),jsonb_build_object('id',$2::uuid::text))",[i.tenant,m,original,request,i.operator]);}
it('allows a new real record only after owner-fixture invalidation and preserves original replay',async()=>{
 const p=payload(),first=await record(p);await expect(record(payload())).rejects.toThrow('finance_reference_already_recorded');
 const snapshot=(await db.query<{v:unknown}>('select to_jsonb(m) v from finance_movements m where id=$1',[first.movement_id])).rows[0].v;
 await voidOwner(first.movement_id,p.request_id);const second=await record(payload());expect(second.movement_id).not.toBe(first.movement_id);
 expect(await record(p)).toEqual(first);await expect(record(payload())).rejects.toThrow('finance_reference_already_recorded');
 expect((await db.query<{n:number;cents:string}>('select count(*)::int n,sum(amount_cents)::text cents from finance_private.active_movements')).rows[0]).toEqual({n:1,cents:'5000'});
 expect((await db.query<{n:number}>('select count(*)::int n from finance_movements')).rows[0].n).toBe(2);
 expect((await db.query<{v:unknown}>('select to_jsonb(m) v from finance_movements m where id=$1',[first.movement_id])).rows[0].v).toEqual(snapshot);
 await db.exec('savepoint expected');await expect(db.exec("update finance_movements set description='Alterado'")).rejects.toThrow('finance_immutable_record');await db.exec('rollback to savepoint expected');
});
it('keeps payload-conflict replay, revoked access and account validation',async()=>{
 const p=payload(),first=await record(p);await voidOwner(first.movement_id,p.request_id);
 await expect(record({...p,amount_cents:1})).rejects.toThrow('finance_request_conflict');
 await expect(record({...payload(),bank_account_id:i.otherAccount})).rejects.toThrow('finance_invalid_account');
 await db.query('update tenant_memberships set active=false where user_id=$1',[i.operator]);await expect(record(p)).rejects.toThrow('finance_access_denied');
});
it('retains post-lock authorization and closed-period source triggers',async()=>{
 const definition=(await db.query<{v:string}>("select pg_get_functiondef('finance_private.record_movement(jsonb)'::regprocedure) v")).rows[0].v;
 expect(definition.indexOf('if not finance_private.can_access(t)',definition.indexOf('perform pg_advisory_xact_lock'))).toBeGreaterThan(definition.indexOf('perform pg_advisory_xact_lock'));
 expect((await db.query<{n:number}>("select count(*)::int n from pg_trigger where tgrelid='finance_movements'::regclass and tgname='finance_closed_period_source' and not tgisinternal")).rows[0].n).toBe(1);
 await expect(record({...payload(),nature:'transfer'})).rejects.toThrow();
});

// Historical fixture proves the real INSERT guard, not eligibility of a new closure.
async function historicalClose(){const opening=randomUUID(),closure=randomUUID(),request=randomUUID();
 await db.query("insert into finance_account_openings(id,tenant_id,bank_account_id,effective_from,balance_cents,evidence_to,evidence,actor_id,actor_name,reason) values($1,$2,$3,'2026-08-01',10000,'2026-07-31','{}',$4,'QA','Abertura histórica fixture')",[opening,i.tenant,i.account,i.operator]);
 await db.query("insert into finance_private.account_close_write_tickets values(txid_current(),$1,$2,$3,'finance_account_period_closures')",[i.tenant,request,i.operator]);
 await db.query("insert into finance_account_period_closures(id,tenant_id,account_id,period_start,period_end,opening_id,snapshot,snapshot_revision,actor_id,actor_name,reason,request_id) values($1,$2,$3,'2026-08-01','2026-08-31',$4,$5,$6,$7,'QA','Fechamento histórico fixture',$8)",[closure,i.tenant,i.account,opening,{balances:{closing_cents:'10000'}},'a'.repeat(32),i.operator,request]);return{opening,closure};}

it('still blocks new money in a closed period after invalidating the old reference',async()=>{
 const p=payload(),old=await record(p);await voidOwner(old.movement_id,p.request_id);await db.query("update tenant_memberships set role='admin' where user_id=$1",[i.operator]);await historicalClose();
 await expect(record(payload())).rejects.toThrow('finance_account_period_closed');
 expect(await record(p)).toEqual(old);
 expect((await db.query<{n:number}>('select count(*)::int n from finance_movements')).rows[0].n).toBe(1);
});
