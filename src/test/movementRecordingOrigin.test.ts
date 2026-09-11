// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createFinanceLedgerDatabase,financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:Awaited<ReturnType<typeof createFinanceLedgerDatabase>>;
beforeAll(async()=>{db=await createFinanceLedgerDatabase();await db.exec(readFileSync('supabase/migrations/20260910185517_finance_movement_recording_origin.sql','utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function record(){const request=randomUUID();const result=(await financeAs<{v:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1) v',[{version:1,tenant_id:i.tenant,request_id:request.toUpperCase(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:'005000',occurred_on:'2026-01-20',description:'  Despesa conferida  ',beneficiary_name:'  Favorecido QA ',beneficiary_document:' ',bank_reference:' ref-QA ',reason:'  Registro original conferido  '}])).rows[0].v;return{id:result.movement_id,request};}
async function origin(id:string,tenant=i.tenant){return(await db.query<{v:{verified:boolean;issue:string|null;revision:string;original_request_id:string|null;snapshot:{movement:{id:string};recording_commands:unknown[];recording_events:unknown[]}}}>('select finance_private.movement_recording_origin($1,$2) v',[tenant,id])).rows[0].v;}
async function ownerMovement(){return(await db.query<{id:string}>("insert into finance_movements(tenant_id,bank_account_id,direction,nature,amount_cents,occurred_on,description,beneficiary_name,created_by) values($1,$2,'out','payment',5000,'2026-01-20','Origem não comprovada','Favorecido QA',$3) returning id",[i.tenant,i.account,i.operator])).rows[0].id;}
it('proves real command, normalized fields, event and original actor without equating IDs',async()=>{
 const m=await record(),v=await origin(m.id);expect(v).toMatchObject({verified:true,issue:null,original_request_id:m.request,snapshot:{movement:{id:m.id}}});expect(m.request).not.toBe(m.id);expect(v.snapshot.recording_commands).toHaveLength(1);expect(v.snapshot.recording_events).toHaveLength(1);
 expect(await origin(m.id)).toEqual(v);
});
it('refuses to infer manual origin from a raw row or a merely existing unrelated command',async()=>{
 const id=await ownerMovement();expect(await origin(id)).toMatchObject({verified:false,issue:'recording_origin_unproven',original_request_id:null});
 await db.query("insert into finance_commands(tenant_id,request_id,actor_id,action,payload,result) values($1,$2,$3,'receive','{}',jsonb_build_object('movement_id',$4::uuid))",[i.tenant,randomUUID(),i.operator,id]);
 expect(await origin(id)).toMatchObject({verified:false,issue:'recording_origin_unproven'});
});
it('rejects competing original commands and changes revision while preserving all evidence',async()=>{
 const m=await record(),before=await origin(m.id),request=randomUUID();
 await db.query("insert into finance_commands(tenant_id,request_id,actor_id,action,payload,result) select tenant_id,$1,actor_id,action,jsonb_set(payload,'{request_id}',to_jsonb($1::uuid)),result||jsonb_build_object('request_id',$1::uuid,'movement_id',upper(result->>'movement_id')) from finance_commands where tenant_id=$2 and request_id=$3",[request,i.tenant,m.request]);
 const after=await origin(m.id);expect(after).toMatchObject({verified:false,issue:'recording_origin_ambiguous',original_request_id:null});expect(after.revision).not.toBe(before.revision);expect(after.snapshot.recording_commands).toHaveLength(2);
});
it('rejects a command that points to money with different financial fields',async()=>{
 const original=await record(),id=await ownerMovement(),request=randomUUID();
 await db.query("insert into finance_commands(tenant_id,request_id,actor_id,action,payload,result) select tenant_id,$1,actor_id,action,jsonb_set(payload,'{request_id}',to_jsonb($1::uuid)),result||jsonb_build_object('request_id',$1::uuid,'movement_id',$2::uuid) from finance_commands where tenant_id=$3 and request_id=$4",[request,id,i.tenant,original.request]);
 expect(await origin(id)).toMatchObject({verified:false,issue:'recording_origin_mismatch'});
});
it('requires matching audit evidence even when the command and movement fields agree',async()=>{
 const id=await ownerMovement(),request=randomUUID();
 await db.query(`insert into finance_commands(tenant_id,request_id,actor_id,action,payload,result)
 select tenant_id,$1,created_by,'record_movement',jsonb_build_object('version',1,'tenant_id',tenant_id,'request_id',$1::uuid,'bank_account_id',bank_account_id,'direction',direction,'nature',nature,'amount_cents',amount_cents,'occurred_on',occurred_on,'description',description,'beneficiary_name',beneficiary_name,'reason','Registro conferido'),
 jsonb_build_object('version',1,'tenant_id',tenant_id,'request_id',$1::uuid,'movement_id',id,'confirmed',true) from finance_movements where id=$2`,[request,id]);
 expect(await origin(id)).toMatchObject({verified:false,issue:'recording_event_unproven'});
 await db.query("insert into finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data) select tenant_id,'movement',id,'recorded',created_by,'Financeiro QA','Registro conferido',to_jsonb(m)||jsonb_build_object('amount_cents',6000) from finance_movements m where id=$1",[id]);
 expect(await origin(id)).toMatchObject({verified:false,issue:'recording_event_mismatch'});
});
it('rejects unsupported payload fields even with matching money and audit evidence',async()=>{
 const id=await ownerMovement(),request=randomUUID();
 await db.query(`insert into finance_commands(tenant_id,request_id,actor_id,action,payload,result)
 select tenant_id,$1,created_by,'record_movement',jsonb_build_object('version',1,'tenant_id',tenant_id,'request_id',$1::uuid,'bank_account_id',bank_account_id,'direction',direction,'nature',nature,'amount_cents',amount_cents,'occurred_on',occurred_on,'description',description,'beneficiary_name',beneficiary_name,'reason','Registro conferido','unsupported',true),
 jsonb_build_object('version',1,'tenant_id',tenant_id,'request_id',$1::uuid,'movement_id',id,'confirmed',true) from finance_movements where id=$2`,[request,id]);
 await db.query("insert into finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data) select tenant_id,'movement',id,'recorded',created_by,'Financeiro QA','Registro conferido',to_jsonb(m) from finance_movements m where id=$1",[id]);
 expect(await origin(id)).toMatchObject({verified:false,issue:'recording_origin_mismatch'});
});
it('keeps the helper private and enforces tenant and mixed-driver checks internally',async()=>{
 const m=await record();await expect(financeAs(db,i.operator,'select finance_private.movement_recording_origin($1,$2)',[i.tenant,m.id])).rejects.toThrow('permission denied');
 await db.exec('savepoint denied');await expect(origin(m.id,i.otherTenant)).rejects.toThrow('finance_access_denied');await db.exec('rollback to savepoint denied');
 await db.query("insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'driver',true)",[i.tenant,i.operator]);await expect(origin(m.id)).rejects.toThrow('finance_access_denied');await db.exec('rollback to savepoint denied');
});
