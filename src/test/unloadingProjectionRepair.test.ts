// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {createUnloadingProjectionRepairDatabase,seedUnloadingRepairSource} from './helpers/unloadingProjectionRepairDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:Awaited<ReturnType<typeof createUnloadingProjectionRepairDatabase>>;
beforeAll(async()=>{db=await createUnloadingProjectionRepairDatabase();},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Conferência integrada de descarga e banco'});
async function rpc<T>(name:string,args:unknown[]){return(await financeAs<{v:T}>(db,i.operator,`select ${name}(${args.map((_,index)=>'$'+(index+1)).join(',')}) v`,args)).rows[0].v;}
async function receive(title:string,cents:number,movement:string){
 const context=await rpc<{revision:string}>('get_receivable_financial_context',[i.tenant,title]);
 return rpc('apply_receivable_financial_command',[{...base(),actor_id:i.operator,receivable_id:title,expected_revision:context.revision,action:'receive',amount_cents:cents,effective_date:'2026-08-10',bank_account_id:i.account,method:'pix',movement_id:movement}]);
}
async function charge(withCost=false){return seedUnloadingRepairSource(db,withCost);}
async function install(){for(const name of ['20260910205941_finance_unloading_receivable_source_guard','20260910210433_finance_unloading_receivable_context','20260910211156_finance_unloading_projection_repair'])await db.exec(readFileSync('supabase/migrations/'+name+'.sql','utf8'));}
async function ctx(charge:string){return(await db.query<{v:Record<string,unknown>}>('select finance_private.unloading_projection_repair_context($1,$2) v',[i.tenant,charge])).rows[0].v;}
async function execute(payload:unknown){await db.exec('savepoint repair');try{const result=(await db.query<{v:Record<string,unknown>}>('select finance_private.repair_unloading_projection($1) v',[payload])).rows[0].v;await db.exec('release savepoint repair');return result;}catch(e){await db.exec('rollback to savepoint repair;release savepoint repair');throw e;}}
it('repairs the original amount without a new charge or money and replays idempotently',async()=>{
 const c=await charge();await db.query('update receivables set amount=170 where id=$1',[c.receivable_id]);await install();const preview=await ctx(c.charge_id);expect(preview.blockers).toEqual([]);expect(preview.eligible).toBe(true);
 const payload={...base(),charge_id:c.charge_id,revision:preview.revision};const result=await execute(payload);expect(await execute(payload)).toEqual(result);
 expect((await db.query<{n:number}>('select count(*)::int n from finance_unloading_charges')).rows[0].n).toBe(1);expect((await db.query<{n:number}>('select count(*)::int n from finance_movements')).rows[0].n).toBe(0);
 const r=(await db.query<{amount:string;updated_by:string}>('select amount,updated_by from receivables where id=$1',[c.receivable_id])).rows[0];expect(Number(r.amount)).toBe(150);expect(r.updated_by).toBe(i.operator);
 expect((await db.query<{n:number}>('select count(*)::int n from finance_unloading_projection_repairs')).rows[0].n).toBe(1);
});
it('repairs a real batch unloading without changing its cost or payable',async()=>{
 const c=await charge(true);const costs=(await db.query('select to_jsonb(e) v from finance_expense_items e')).rows;const payables=(await db.query('select to_jsonb(p) v from payables p')).rows;
 await db.query('update receivables set amount=180 where id=$1',[c.receivable_id]);await install();const preview=await ctx(c.charge_id);expect(preview.blockers).toEqual([]);
 await execute({...base(),charge_id:c.charge_id,revision:preview.revision});expect((await db.query('select to_jsonb(e) v from finance_expense_items e')).rows).toEqual(costs);expect((await db.query('select to_jsonb(p) v from payables p')).rows).toEqual(payables);
});
it('rejects financial history even when the title was corrupted before its real receipt',async()=>{
 const c=await charge();await db.query('update receivables set amount=170 where id=$1',[c.receivable_id]);const movement=await rpc<{movement_id:string}>('record_finance_movement',[{...base(),bank_account_id:i.account,direction:'in',nature:'receipt',amount_cents:1000,occurred_on:'2026-08-10',description:'Recebimento anterior',beneficiary_name:'Fornecedor'}]);await receive(c.receivable_id,1000,movement.movement_id);await install();
 const preview=await ctx(c.charge_id);expect(preview.eligible).toBe(false);expect(JSON.stringify(preview.blockers)).toContain('receivables_payments');await expect(execute({...base(),charge_id:c.charge_id,revision:preview.revision})).rejects.toThrow('finance_unloading_repair_blocked');
});
it('requires current revision, preserves direct-write denial and denies private ACL',async()=>{
 const c=await charge();await db.query('update receivables set amount=170 where id=$1',[c.receivable_id]);await install();const preview=await ctx(c.charge_id);
 await db.query("update receivables set description='Descrição posterior à revisão' where id=$1",[c.receivable_id]);await expect(execute({...base(),charge_id:c.charge_id,revision:preview.revision})).rejects.toThrow('finance_unloading_repair_changed');
 await expect(financeAs(db,i.operator,'select finance_private.repair_unloading_projection($1)',[{...base(),charge_id:c.charge_id,revision:(await ctx(c.charge_id)).revision}])).rejects.toThrow('permission denied');
 await db.exec('savepoint direct');await expect(db.query('update receivables set amount=150 where id=$1',[c.receivable_id])).rejects.toThrow('finance_unloading_source_immutable');await db.exec('rollback to savepoint direct;release savepoint direct');
 expect((await db.query<{n:number}>('select count(*)::int n from finance_private.unloading_repair_tickets')).rows[0].n).toBe(0);
});
it('rolls back the title and consumed ticket when audit insertion fails',async()=>{
 const c=await charge();await db.query('update receivables set amount=170 where id=$1',[c.receivable_id]);await install();const preview=await ctx(c.charge_id);
 await db.exec(`create function public.fail_repair_audit() returns trigger language plpgsql as $$begin if new.action='unloading_projection_repaired' then raise exception 'forced_audit_failure';end if;return new;end$$;create trigger fail_repair_audit before insert on finance_events for each row execute function public.fail_repair_audit();`);
 await expect(execute({...base(),charge_id:c.charge_id,revision:preview.revision})).rejects.toThrow('forced_audit_failure');expect(Number((await db.query<{amount:string}>('select amount from receivables where id=$1',[c.receivable_id])).rows[0].amount)).toBe(170);
 expect((await db.query<{n:number}>('select count(*)::int n from finance_unloading_projection_repairs')).rows[0].n).toBe(0);expect((await db.query<{n:number}>('select count(*)::int n from finance_private.unloading_repair_tickets')).rows[0].n).toBe(0);
});
it('marks the repair as permanent manual audit and denies replay after revocation',async()=>{
 const c=await charge();await db.query('update receivables set amount=170 where id=$1',[c.receivable_id]);await install();const payload={...base(),charge_id:c.charge_id,revision:(await ctx(c.charge_id)).revision};await execute(payload);
 const audit=await rpc<{rows:{action:string;actor_id:string;reason:string}[]}>('list_finance_audit_events',[i.tenant,{manual_only:true}]);expect(audit.rows).toContainEqual(expect.objectContaining({action:'unloading_projection_repaired',actor_id:i.operator,reason:payload.reason}));
 await db.query('update tenant_memberships set active=false where tenant_id=$1 and user_id=$2',[i.tenant,i.operator]);await expect(execute(payload)).rejects.toThrow('finance_access_denied');
});
it('allows financial preview but reserves repair for administrators and excludes mixed drivers',async()=>{
 const c=await charge();await db.query('update receivables set amount=170 where id=$1',[c.receivable_id]);await install();await db.query("update tenant_memberships set role='operator' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
 const preview=await ctx(c.charge_id);expect(preview.eligible).toBe(true);expect(preview.can_repair).toBe(false);await expect(execute({...base(),charge_id:c.charge_id,revision:preview.revision})).rejects.toThrow('finance_access_denied');
 await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);await db.query('insert into drivers(id,tenant_id,user_id,active) values($1,$2,$3,true)',[randomUUID(),i.tenant,i.operator]);
 await expect(ctx(c.charge_id)).rejects.toThrow('finance_access_denied');
});
