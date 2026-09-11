// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {createUnloadingProjectionRepairDatabase,seedUnloadingRepairSource} from './helpers/unloadingProjectionRepairDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {unloadingProjectionRepairContextSchema} from '@/lib/financial/unloadingProjectionRepairContract';
import {parseUnloadingProjectionRepairResult} from '@/lib/financial/unloadingProjectionRepairCommandContract';
let db:Awaited<ReturnType<typeof createUnloadingProjectionRepairDatabase>>;let charge:Awaited<ReturnType<typeof seedUnloadingRepairSource>>;
const promotion=()=>db.exec(readFileSync('supabase/migrations/20260910212550_finance_public_unloading_projection_repair.sql','utf8'));
beforeAll(async()=>{db=await createUnloadingProjectionRepairDatabase();},30000);
beforeEach(async()=>{
 await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
 charge=await seedUnloadingRepairSource(db,true);await db.query('update receivables set amount=170 where id=$1',[charge.receivable_id]);
 for(const name of ['20260910205941_finance_unloading_receivable_source_guard','20260910210433_finance_unloading_receivable_context','20260910211156_finance_unloading_projection_repair','20260910211740_finance_unloading_projection_repair_preview'])await db.exec(readFileSync('supabase/migrations/'+name+'.sql','utf8'));
});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function preview(){return unloadingProjectionRepairContextSchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select get_finance_unloading_projection_repair_context($1,$2) v',[i.tenant,charge.charge_id])).rows[0].v);}
it('promotes only dispatch, keeps revision stable and validates public confirmation and replay',async()=>{
 const before=await preview();expect(before.can_execute).toBe(false);await promotion();const context=await preview();expect(context.can_execute).toBe(true);expect(context.revision).toBe(before.revision);
 const payload={version:1 as const,tenant_id:i.tenant,request_id:randomUUID(),charge_id:charge.charge_id,revision:context.revision,reason:'Reparação conferida da projeção original'};
 const send=async()=>parseUnloadingProjectionRepairResult((await financeAs<{v:unknown}>(db,i.operator,'select repair_finance_unloading_projection($1) v',[payload])).rows[0].v,payload,i.operator,charge.receivable_id);
 const first=await send();expect(await send()).toEqual(first);expect((await preview()).can_execute).toBe(false);
 expect((await db.query<{n:number}>('select count(*)::int n from finance_unloading_projection_repairs')).rows[0].n).toBe(1);
});
it('disables confirmation when public or dispatch execution is revoked without losing revision',async()=>{
 await promotion();const before=await preview();for(const fn of ['public.repair_finance_unloading_projection(jsonb)','finance_private.dispatch_unloading_projection_repair(jsonb)']){
  await db.exec(`revoke execute on function ${fn} from authenticated`);const current=await preview();expect(current.can_execute).toBe(false);expect(current.revision).toBe(before.revision);await db.exec(`grant execute on function ${fn} to authenticated`);
 }
 expect((await preview()).can_execute).toBe(true);
});
it('keeps raw implementations private and excludes operator, mixed driver and another company',async()=>{
 await promotion();const acl=(await db.query<{writer:boolean;context:boolean;anon:boolean;service:boolean}>("select has_function_privilege('authenticated','finance_private.repair_unloading_projection(jsonb)','EXECUTE') writer,has_function_privilege('authenticated','finance_private.unloading_projection_repair_context(uuid,uuid)','EXECUTE') context,has_function_privilege('anon','public.repair_finance_unloading_projection(jsonb)','EXECUTE') anon,has_function_privilege('service_role','public.repair_finance_unloading_projection(jsonb)','EXECUTE') service")).rows[0];expect(acl).toEqual({writer:false,context:false,anon:false,service:false});
 await db.query("update tenant_memberships set role='operator' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);const context=await preview();expect(context.can_execute).toBe(false);
 const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),charge_id:charge.charge_id,revision:context.revision,reason:'Tentativa sem privilégio administrativo'};await expect(financeAs(db,i.operator,'select repair_finance_unloading_projection($1)',[payload])).rejects.toThrow('finance_access_denied');
 await expect(financeAs(db,i.operator,'select repair_finance_unloading_projection($1)',[{...payload,tenant_id:i.otherTenant}])).rejects.toThrow('finance_access_denied');
 await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);await db.query('insert into drivers(id,tenant_id,user_id,active) values($1,$2,$3,true)',[randomUUID(),i.tenant,i.operator]);await expect(preview()).rejects.toThrow('finance_access_denied');
});
