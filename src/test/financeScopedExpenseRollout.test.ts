// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {settlementAdjustmentDatabase} from './helpers/settlementAdjustmentDatabase';
import {operationIds as ids} from './helpers/operationOutcomeDatabase';
const candidate=readFileSync('supabase/rollouts/finance_settlement_adjustments_current_auth.sql','utf8');
const policy=readFileSync('supabase/rollouts/finance_expense_adjustment_password_policy.sql','utf8');
const original=readFileSync('supabase/migrations/20260831164442_remove_authenticator_requirement.sql','utf8');
const start=original.indexOf('create or replace function public.is_tenant_operator_or_admin(');const helper=original.slice(start,original.indexOf('$function$;',start)+11);
describe('scoped production expense rollout',()=>{
 it('accepts exact current authorizer, preserves globals/ACL and uses current identity/roles without MFA',async()=>{
  const {db}=await settlementAdjustmentDatabase(false);try{
   await db.exec(helper);expect((await db.query<{hash:string}>("select md5(replace(pg_get_functiondef('public.is_tenant_operator_or_admin(uuid)'::regprocedure),E'\\r\\n',E'\\n')) hash")).rows[0].hash).toBe('682f66029dc9bb798f9f329b4e8f95aa');
   await db.exec(candidate);
   const before=(await db.query("select oid,proacl,prosrc from pg_proc where pronamespace='public'::regnamespace order by oid")).rows;
   await db.exec(policy);expect((await db.query("select oid,proacl,prosrc from pg_proc where pronamespace='public'::regnamespace order by oid")).rows).toEqual(before);
   await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims','{\"aal\":\"aal1\"}',false)",[ids.operator]);
   for(const role of ['owner','admin','operator']){await db.query('update tenant_memberships set role=$1,active=true where tenant_id=$2 and user_id=$3',[role,ids.tenant,ids.operator]);await db.query('select expense_creation_private.require_session($1,$2),settlement_adjustment_private.authorize($1)',[ids.tenant,ids.operator]);}
   await db.query("update tenant_memberships set role='driver' where tenant_id=$1 and user_id=$2",[ids.tenant,ids.operator]);await db.query('select expense_creation_private.require_session($1,$2)',[ids.tenant,ids.operator]);await expect(db.query('select settlement_adjustment_private.authorize($1)',[ids.tenant])).rejects.toThrow('settlement_adjustment_not_authorized');
   await expect(db.query('select expense_creation_private.require_session($1,$2)',[ids.tenant,'11111111-1111-4111-8111-111111111111'])).rejects.toThrow('expense_creation_not_authorized');
   await db.query('update tenant_memberships set active=false where tenant_id=$1 and user_id=$2',[ids.tenant,ids.operator]);await expect(db.query('select expense_creation_private.require_session($1,$2)',[ids.tenant,ids.operator])).rejects.toThrow('expense_creation_not_authorized');
   await expect(db.exec(policy)).rejects.toThrow('password policy predecessor changed');
  }finally{await db.close();}
 },60000);
 it('rejects altered authorizer before installing adjustment objects',async()=>{const {db}=await settlementAdjustmentDatabase(false);try{await db.exec(helper.replace("'owner', 'admin', 'operator'","'owner', 'admin', 'operator', 'driver'"));await expect(db.exec(candidate)).rejects.toThrow('Settlement adjustment dependency changed');await db.exec(helper);await db.exec('revoke execute on function public.is_tenant_operator_or_admin(uuid) from authenticated');await expect(db.exec(candidate)).rejects.toThrow('Settlement adjustment dependency changed');await db.exec('alter function public.is_tenant_operator_or_admin(uuid) rename to qa_removed_authorizer');await expect(db.exec(candidate)).rejects.toThrow('Settlement adjustment dependency changed');expect((await db.query<{absent:boolean}>("select to_regnamespace('settlement_adjustment_private') is null absent")).rows[0].absent).toBe(true);}finally{await db.close();}},60000);
});
