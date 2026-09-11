// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createFinanceLedgerDatabase,financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:Awaited<ReturnType<typeof createFinanceLedgerDatabase>>;
beforeAll(async()=>{db=await createFinanceLedgerDatabase();await db.exec(readFileSync('supabase/migrations/20260910182541_finance_movement_correction_foundation.sql','utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');});
afterEach(async()=>{await db.exec('rollback');});
afterAll(async()=>{await db?.close();});
async function movement(){
 const request=randomUUID();
 const result=await financeAs<{v:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1) v',[{version:1,tenant_id:i.tenant,request_id:request,bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:50000,occurred_on:'2026-08-15',description:'Registro original de saída',beneficiary_name:'Favorecido QA',reason:'Registro para teste da infraestrutura'}]);
 return {id:result.rows[0].v.movement_id,request};
}
// Owner inserts exercise only storage invariants, not a product correction RPC.
async function correction(source:Awaited<ReturnType<typeof movement>>,kind='void',duplicate:string|null=null,replacement:string|null=null){
 const request=randomUUID();
 await db.query("insert into finance_commands(tenant_id,request_id,actor_id,action,payload,result) values($1,$2,$3,'qa_storage_only','{}','{}')",[i.tenant,request,i.operator]);
 return db.query<{id:string}>(`insert into finance_movement_voids(tenant_id,movement_id,original_request_id,request_id,kind,duplicate_of_movement_id,replacement_movement_id,actor_id,actor_name,reason,revision,source_snapshot)
 values($1,$2,$3,$4,$5,$6,$7,$8,'Financeiro QA','Registro duplicado conferido',md5('qa storage'),jsonb_build_object('movement_id',$2::uuid::text)) returning id`,[i.tenant,source.id,source.request,request,kind,duplicate,replacement,i.operator]);
}
async function rejectsStorage(work:()=>Promise<unknown>,message:string){
 await db.exec('savepoint expected_failure');
 try{await expect(work()).rejects.toThrow(message);}finally{await db.exec('rollback to savepoint expected_failure;release savepoint expected_failure');}
}
it('preserves two original outflows while the private active projection excludes one duplicate, without inflow',async()=>{
 const a=await movement(),b=await movement();await correction(b,'duplicate',a.id);
 expect((await db.query('select count(*)::int n,sum(amount_cents)::text cents from finance_movements')).rows[0]).toEqual({n:2,cents:'100000'});
 expect((await db.query('select count(*)::int n,sum(amount_cents)::text cents from finance_private.active_movements')).rows[0]).toEqual({n:1,cents:'50000'});
 expect((await db.query("select count(*)::int n from finance_movements where direction='in'")).rows[0]).toEqual({n:0});
 await rejectsStorage(()=>db.query('delete from finance_movement_voids'),'finance_immutable_record');
 await rejectsStorage(()=>db.query("update finance_movement_voids set reason='Outro motivo'"),'finance_immutable_record');
 await rejectsStorage(()=>db.query('delete from finance_movements'),'finance_immutable_record');
});
it('requires a single correction, distinct same-tenant references and one correction kind',async()=>{
 const a=await movement(),b=await movement();
 await rejectsStorage(()=>correction(a,'duplicate',a.id),'check constraint');
 await rejectsStorage(()=>correction(a,'replacement',b.id,b.id),'check constraint');
 await rejectsStorage(()=>correction(a,'duplicate',randomUUID()),'foreign key constraint');
 const foreign=randomUUID();
 await db.query("insert into finance_movements(id,tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,created_by) values($1,$2,$3,'out','payment',50000,'2026-08-15','Outra empresa','Outro favorecido',$4)",[foreign,i.otherTenant,i.otherAccount,i.operator]);
 await rejectsStorage(()=>correction(a,'duplicate',foreign),'foreign key constraint');
 await correction(a,'replacement',null,b.id);
 await rejectsStorage(()=>correction(a),'unique constraint');
});
it('exposes neither a write capability nor the private projection to application roles',async()=>{
 const a=await movement();await correction(a);
 for(const role of ['authenticated','anon','service_role']){
  const privileges=(await db.query<{r:boolean;w:boolean;v:boolean}>("select has_table_privilege($1,'public.finance_movement_voids','SELECT') r,has_table_privilege($1,'public.finance_movement_voids','INSERT') w,has_table_privilege($1,'finance_private.active_movements','SELECT') v",[role])).rows[0];
  expect(privileges).toEqual({r:false,w:false,v:false});
 }
 await expect(financeAs(db,i.operator,'select * from finance_private.active_movements')).rejects.toThrow('permission denied');
 // Verify defense-in-depth RLS independently of the intentionally absent grant.
 await db.exec('grant select on finance_movement_voids to authenticated');
 expect((await financeAs(db,i.operator,'select * from finance_movement_voids')).rows).toHaveLength(1);
 expect((await financeAs(db,i.driverUser,'select * from finance_movement_voids')).rows).toHaveLength(0);
 await db.query("update tenant_memberships set role='admin' where user_id=$1",[i.driverUser]);
 expect((await financeAs(db,i.driverUser,'select * from finance_movement_voids')).rows).toHaveLength(0);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);
 await db.query('update tenant_memberships set tenant_id=$1 where user_id=$2',[i.otherTenant,i.operator]);
 expect((await financeAs(db,i.operator,'select * from finance_movement_voids')).rows).toHaveLength(0);
});
