// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {expenseMfaDatabase} from './helpers/expenseMfaDatabase';
import {installSettlementAdjustmentFixture} from './helpers/settlementAdjustmentDatabase';
import {operationIds as ids} from './helpers/operationOutcomeDatabase';
const release=readFileSync('supabase/rollouts/20260910225611_finance_expense_adjustment_production_release.sql','utf8').replace(/\r\n/g,'\n');
const original=readFileSync('supabase/migrations/20260831164442_remove_authenticator_requirement.sql','utf8');
const start=original.indexOf('create or replace function public.is_tenant_operator_or_admin(');const helper=original.slice(start,original.indexOf('$function$;',start)+11);
async function fixture(){const {db}=await expenseMfaDatabase(false);await installSettlementAdjustmentFixture(db);await db.exec(helper);return db;}
it('installs complete release in one transaction with final password policy and preserved global authorization',async()=>{
 expect(createHash('sha256').update(release).digest('hex')).toBe('ca160ab888064e33b1af908a92db8793277fb24f54dee904f237aeff7ebda56f');
 const db=await fixture();try{
 const before=(await db.query("select prosrc,proacl from pg_proc where oid='public.is_tenant_operator_or_admin(uuid)'::regprocedure")).rows;
 await db.transaction(async tx=>{await tx.exec(release);});
 expect((await db.query("select prosrc,proacl from pg_proc where oid='public.is_tenant_operator_or_admin(uuid)'::regprocedure")).rows).toEqual(before);
 await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims','{\"aal\":\"aal1\"}',false)",[ids.operator]);await db.query("update tenant_memberships set role='admin',active=true where tenant_id=$1 and user_id=$2",[ids.tenant,ids.operator]);
 await db.query('select expense_creation_private.require_session($1,$2),settlement_adjustment_private.authorize($1)',[ids.tenant,ids.operator]);
 const acl=(await db.query<{auth:boolean;service:boolean;anon:boolean}>("select has_function_privilege('authenticated','public.inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb)','execute') auth,has_function_privilege('service_role','public.inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb)','execute') service,has_function_privilege('anon','public.inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb)','execute') anon")).rows[0];expect(acl).toEqual({auth:true,service:false,anon:false});
 }finally{await db.close();}
},60000);
it('later adjustment mismatch rolls back the earlier MFA schema, function moves and grants',async()=>{const db=await fixture();try{
 await db.exec("comment on function public._log_settlement_event(uuid,text,text,text,text,jsonb) is 'not body change';create or replace function public._preserve_closing_creation() returns trigger language plpgsql security invoker set search_path='' as $$begin raise exception 'unexpected predecessor';end;$$;");
 const before=(await db.query("select oid,pronamespace,proname,prosrc,proacl,proconfig from pg_proc where pronamespace='public'::regnamespace order by oid")).rows;
 await expect(db.transaction(async tx=>{await tx.exec(release);})).rejects.toThrow('Settlement adjustment dependency changed');
 expect((await db.query("select oid,pronamespace,proname,prosrc,proacl,proconfig from pg_proc where pronamespace='public'::regnamespace order by oid")).rows).toEqual(before);
 expect((await db.query<{absent:boolean}>("select to_regnamespace('expense_creation_private') is null and to_regnamespace('settlement_adjustment_private') is null and to_regclass('public.driver_settlement_adjustments') is null absent")).rows[0].absent).toBe(true);
 }finally{await db.close();}},60000);
