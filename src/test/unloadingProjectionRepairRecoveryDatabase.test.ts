// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {createUnloadingProjectionRepairDatabase,seedUnloadingRepairSource} from './helpers/unloadingProjectionRepairDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {createUnloadingProjectionRepairOutbox,pendingUnloadingProjectionRepair} from '@/lib/financial/unloadingProjectionRepairOutbox';
import {unloadingProjectionRepairContextSchema} from '@/lib/financial/unloadingProjectionRepairContract';
let db:Awaited<ReturnType<typeof createUnloadingProjectionRepairDatabase>>;
beforeAll(async()=>{db=await createUnloadingProjectionRepairDatabase();},30000);
afterAll(async()=>{await db?.close();});
async function rpc(sql:string,args:unknown[]){
 await db.exec('begin');
 try{const result=(await financeAs<{v:unknown}>(db,i.operator,sql,args)).rows[0].v;await db.exec('commit');return result;}
 catch(error){await db.exec('rollback');throw error;}
}
it('recovers a committed repair after losing its response without a second event or money',async()=>{
 await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);
 await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
 const source=await seedUnloadingRepairSource(db,true);
 await db.query('update receivables set amount=170 where id=$1',[source.receivable_id]);
 for(const name of ['20260910205941_finance_unloading_receivable_source_guard','20260910210433_finance_unloading_receivable_context','20260910211156_finance_unloading_projection_repair','20260910211740_finance_unloading_projection_repair_preview','20260910212550_finance_public_unloading_projection_repair'])await db.exec(readFileSync('supabase/migrations/'+name+'.sql','utf8'));
 await db.exec('commit');
 const before=unloadingProjectionRepairContextSchema.parse(await rpc('select get_finance_unloading_projection_repair_context($1,$2) v',[i.tenant,source.charge_id]));
 expect(before.can_execute).toBe(true);
 const costs=(await db.query('select to_jsonb(e) v from finance_expense_items e order by id')).rows;
 const payables=(await db.query('select to_jsonb(p) v from payables p order by id')).rows;
 const records=new Map<string,string>(),storage={getItem:(key:string)=>records.get(key)??null,setItem:(key:string,value:string)=>{records.set(key,value);},removeItem:(key:string)=>{records.delete(key);}};
 const sent:string[]=[];
 const outbox=createUnloadingProjectionRepairOutbox({storage,uuid:randomUUID,assertContext:(tenant,actor)=>{expect([tenant,actor]).toEqual([i.tenant,i.operator]);},changed:()=>{},lock:async(_key,work)=>work(),send:async command=>{
  sent.push(JSON.stringify(command));const data=await rpc('select repair_finance_unloading_projection($1) v',[command]);
  return sent.length===1?{data:null,error:{message:'Resposta perdida depois do commit'}}:{data,error:null};
 }});
 await expect(outbox.submit(i.tenant,i.operator,{chargeId:source.charge_id,receivableId:source.receivable_id,revision:before.revision,reason:'Restaurar título conforme a descarga original'})).rejects.toMatchObject({message:'Resposta perdida depois do commit'});
 expect(pendingUnloadingProjectionRepair(storage,i.tenant,i.operator)).not.toBeNull();
 const after=unloadingProjectionRepairContextSchema.parse(await rpc('select get_finance_unloading_projection_repair_context($1,$2) v',[i.tenant,source.charge_id]));
 expect(after.can_execute).toBe(false);expect(after.revision).not.toBe(before.revision);
 const result=await outbox.recover(i.tenant,i.operator);
 expect(result.receivable_id).toBe(source.receivable_id);expect(sent).toHaveLength(2);expect(sent[1]).toBe(sent[0]);expect(records.size).toBe(0);
 expect((await db.query<{n:number}>('select count(*)::int n from finance_unloading_projection_repairs')).rows[0].n).toBe(1);
 expect((await db.query<{n:number}>('select count(*)::int n from finance_movements')).rows[0].n).toBe(0);
 expect((await db.query('select to_jsonb(e) v from finance_expense_items e order by id')).rows).toEqual(costs);
 expect((await db.query('select to_jsonb(p) v from payables p order by id')).rows).toEqual(payables);
},30000);
