// @vitest-environment node
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createUnloadingProjectionRepairDatabase,seedUnloadingRepairSource} from './helpers/unloadingProjectionRepairDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {unloadingProjectionRepairContextSchema} from '@/lib/financial/unloadingProjectionRepairContract';
let db:Awaited<ReturnType<typeof createUnloadingProjectionRepairDatabase>>;
beforeAll(async()=>{db=await createUnloadingProjectionRepairDatabase();},30000);
afterAll(async()=>{await db?.close();});
it('exposes a validated review without private evidence or permission to invoke the writer',async()=>{
 await db.exec('begin');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);
 await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
 const charge=await seedUnloadingRepairSource(db,true);
 await db.query('update receivables set amount=170 where id=$1',[charge.receivable_id]);
 for(const name of ['20260910205941_finance_unloading_receivable_source_guard','20260910210433_finance_unloading_receivable_context','20260910211156_finance_unloading_projection_repair','20260910211740_finance_unloading_projection_repair_preview'])await db.exec(readFileSync('supabase/migrations/'+name+'.sql','utf8'));
 const raw=(await financeAs<{v:unknown}>(db,i.operator,'select get_finance_unloading_projection_repair_context($1,$2) v',[i.tenant,charge.charge_id])).rows[0].v;
 const result=unloadingProjectionRepairContextSchema.parse(raw);
 expect(result).toMatchObject({eligible:true,can_repair:true,can_execute:false,current:{amount_cents:'17000'},target:{client_id:charge.supplier,amount_cents:'15000'}});
 expect(raw).not.toHaveProperty('_evidence');
 const acl=(await db.query<{writer:boolean;raw:boolean;preview:boolean}>("select has_function_privilege('authenticated','finance_private.repair_unloading_projection(jsonb)','EXECUTE') writer,has_function_privilege('authenticated','finance_private.unloading_projection_repair_context(uuid,uuid)','EXECUTE') raw,has_function_privilege('authenticated','public.get_finance_unloading_projection_repair_context(uuid,uuid)','EXECUTE') preview")).rows[0];
 expect(acl).toEqual({writer:false,raw:false,preview:true});
 await db.query('update tenant_memberships set active=false where tenant_id=$1 and user_id=$2',[i.tenant,i.operator]);
 await expect(financeAs(db,i.operator,'select get_finance_unloading_projection_repair_context($1,$2)',[i.tenant,charge.charge_id])).rejects.toThrow('finance_access_denied');
 await db.exec('rollback');
},30000);
