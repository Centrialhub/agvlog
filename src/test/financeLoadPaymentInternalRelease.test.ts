// @vitest-environment node
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createFinanceForwardBlockDatabase} from './helpers/financeForwardBlockDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {seedLoadPayment,loadPaymentPayload,applyLoadPayment} from './helpers/loadPaymentDatabase';
const sql=readFileSync('supabase/rollouts/finance_load_payment_internal_release.sql','utf8');
it('atomic load payment release denies staged, driver, mixed and foreign calls with unchanged original ACL',async()=>{
 const {db}=await createFinanceForwardBlockDatabase('20260910140011',true,false);
 try{
 await db.exec('begin');await db.exec(sql);
 const definition=(await db.query<{v:string}>("select pg_get_functiondef('finance_private.can_access(uuid)'::regprocedure) v")).rows[0].v;
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);
 const invoke=(tenant=i.tenant)=>operationRpc(db,'select apply_load_payment_command($1::jsonb)',[JSON.stringify({tenant_id:tenant})]);
 await db.exec("create or replace function finance_private.can_access(_tenant uuid) returns boolean language sql stable security definer set search_path='' as 'select false'");
 await expect(invoke()).rejects.toThrow('finance_access_denied');await db.exec(definition);
 await expect(invoke()).rejects.toThrow('load_payment_invalid_command');
 await expect(invoke(i.otherTenant)).rejects.toThrow('finance_access_denied');
 await db.query("insert into drivers(id,tenant_id,user_id,active,name) values($1,$2,$3,true,'Mixed QA')",[randomUUID(),i.tenant,i.operator]);
 await expect(invoke()).rejects.toThrow('finance_access_denied');
 await db.query("update tenant_memberships set role='driver' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);await expect(invoke()).rejects.toThrow('finance_access_denied');
 expect((await db.query<{a:boolean;n:boolean;s:boolean}>("select has_function_privilege('authenticated','public.apply_load_payment_command(jsonb)','execute') a,has_function_privilege('anon','public.apply_load_payment_command(jsonb)','execute') n,has_function_privilege('service_role','public.apply_load_payment_command(jsonb)','execute') s")).rows[0]).toEqual({a:true,n:false,s:false});
 expect((await db.query('select * from load_payments')).rows).toHaveLength(0);await db.exec('rollback');
 }finally{await db.close();}
},120000);
it('late boundary dependency failure rolls back original load schema and RPC atomically',async()=>{
 const {db}=await createFinanceForwardBlockDatabase('20260910140011',true,false);
 try{await db.exec('alter function finance_private.require_access(uuid) rename to require_access_saved');await db.exec('begin');await expect(db.exec(sql)).rejects.toThrow('finance_load_boundary_dependency_missing');await db.exec('rollback');
 expect((await db.query<{v:boolean}>("select to_regprocedure('public.apply_load_payment_command(jsonb)') is null and to_regclass('private.load_payment_commands') is null and not exists(select 1 from information_schema.columns where table_name='load_payments' and column_name='bank_transaction_id') v")).rows[0].v).toBe(true);
 }finally{await db.close();}
},120000);

it('real load command remains recoverable after the complete current finance predecessor chain',async()=>{
 const {db}=await createFinanceForwardBlockDatabase('20260910140011',true,false);
 try{await db.exec('begin');await db.exec(sql);await seedLoadPayment(db);const payload=await loadPaymentPayload(db);const result=await applyLoadPayment(db,payload);expect(await applyLoadPayment(db,payload)).toEqual(result);expect((await db.query('select * from load_payments')).rows).toHaveLength(1);await db.exec('set constraints all immediate');await db.exec('rollback');}finally{await db.close();}
},120000);
