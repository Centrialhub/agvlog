// @vitest-environment node
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {it,expect} from 'vitest';
import {expenseMfaDatabase} from './helpers/expenseMfaDatabase';import {installSettlementAdjustmentFixture} from './helpers/settlementAdjustmentDatabase';import {operationIds as ids} from './helpers/operationOutcomeDatabase';
const read=(p:string)=>readFileSync(p,'utf8');const m=(p:string)=>read('supabase/migrations/'+p);
const base=m('20260909212104_finance_ledger_foundation.sql');const foundation=base.slice(0,base.indexOf('create table public.finance_movements'));
const actualAccess=foundation.slice(foundation.indexOf('create function finance_private.can_access'),foundation.indexOf('revoke all on function')).replace('create function','create or replace function');
const orig=m('20260831164442_remove_authenticator_requirement.sql');const st=orig.indexOf('create or replace function public.is_tenant_operator_or_admin(');const helper=orig.slice(st,orig.indexOf('$function$;',st)+11);
const release=read('supabase/rollouts/20260910230055_finance_internal_expense_adjustment_release.sql');const releaseHash='0b9a45d6a90cb304f870c865585624b33b10d7926d62ccbbe938839b8004cd8b';
async function fixture(){const {db}=await expenseMfaDatabase(false);await installSettlementAdjustmentFixture(db);await db.exec(helper);await db.exec(foundation);await db.exec("create or replace function finance_private.can_access(_tenant uuid) returns boolean language sql stable security definer set search_path='' as $$select false;$$;");const receipt=m('20260909220941_finance_receipt_evidence.sql');await db.exec(receipt.slice(0,receipt.indexOf('create policy')));return db;}
it('staged gate denies even admin; actual final access permits only internal non-driver identities',async()=>{const db=await fixture();try{
 expect(createHash('sha256').update(release).digest('hex')).toBe(releaseHash);await db.transaction(async tx=>{await tx.exec(release);});
 await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims','{\"aal\":\"aal1\"}',false)",[ids.operator]);await db.query("update tenant_memberships set role='admin',active=true where tenant_id=$1 and user_id=$2",[ids.tenant,ids.operator]);
 await expect(db.query('select expense_creation_private.require_session($1,$2)',[ids.tenant,ids.operator])).rejects.toThrow('finance_access_denied');await expect(db.query('select settlement_adjustment_private.authorize($1)',[ids.tenant])).rejects.toThrow('finance_access_denied');expect((await db.query<{ok:boolean}>('select expense_creation_private.session_allowed($1) ok',[ids.tenant])).rows[0].ok).toBe(false);
 await expect(db.query('select list_driver_expenses_for_review($1)',[ids.tenant])).rejects.toThrow('finance_access_denied');await expect(db.query('select get_driver_expense_review_context($1,$2)',[ids.tenant,ids.driver])).rejects.toThrow('finance_access_denied');
 await db.exec('set role authenticated');
 for(const call of [
  "select get_expense_creation_context($1,'settlement',$2)",
  "select get_expense_receipt_status($1,$2,'settlement',$2,'{}'::jsonb)",
  "select inspect_expense_receipt_upload($1,$2,$2,'settlement',$2,'{}'::jsonb)",
  "select list_driver_expenses($1,0)",
  "select list_driver_expense_sources($1,0)",
  "select recalculate_manual_expense_settlement($1,$2)"
 ])await expect(db.query(call,call.includes('$2')?[ids.tenant,ids.operator]:[ids.tenant])).rejects.toThrow('finance_access_denied');
 await expect(db.query('select create_driver_expense_command($1::jsonb)',[JSON.stringify({tenant_id:ids.tenant})])).rejects.toThrow('finance_access_denied');
 await expect(db.query('select apply_driver_settlement_adjustment($1::jsonb)',[JSON.stringify({tenant_id:ids.tenant})])).rejects.toThrow('finance_access_denied');
 await db.exec('reset role');
 await db.exec(actualAccess);
 for(const role of ['owner','admin','operator']){await db.query('update tenant_memberships set role=$1 where tenant_id=$2 and user_id=$3',[role,ids.tenant,ids.operator]);await db.query('select expense_creation_private.require_session($1,$2),settlement_adjustment_private.authorize($1)',[ids.tenant,ids.operator]);}
 await db.query("update tenant_memberships set role='driver' where tenant_id=$1 and user_id=$2",[ids.tenant,ids.operator]);await expect(db.query('select expense_creation_private.require_session($1,$2)',[ids.tenant,ids.operator])).rejects.toThrow('finance_access_denied');
 await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[ids.tenant,ids.operator]);await db.query('update drivers set user_id=$1,active=true where id=$2',[ids.operator,ids.driver]);await expect(db.query('select settlement_adjustment_private.authorize($1)',[ids.tenant])).rejects.toThrow('finance_access_denied');expect((await db.query<{ok:boolean}>('select expense_creation_private.session_allowed($1) ok',[ids.tenant])).rows[0].ok).toBe(false);
 await expect(db.query('select list_driver_expenses_for_review($1)',[ids.tenant])).rejects.toThrow('finance_access_denied');await expect(db.query('select get_driver_expense_review_context($1,$2)',[ids.tenant,ids.driver])).rejects.toThrow('finance_access_denied');
 await expect(db.query('select expense_creation_private.require_session($1,$2)',['20000000-0000-4000-8000-000000000099',ids.operator])).rejects.toThrow('finance_access_denied');
 }finally{await db.close();}},60000);
it('later dependency failure rolls back exact atomic file and intermediate MFA',async()=>{const db=await fixture();try{await db.exec("alter function public._preserve_closing_creation() rename to qa_missing_closing_guard;");const before=(await db.query("select oid,pronamespace,proname,prosrc,proacl from pg_proc order by oid")).rows;await expect(db.transaction(async tx=>{await tx.exec(release);})).rejects.toThrow('Settlement adjustment dependency changed');expect((await db.query("select oid,pronamespace,proname,prosrc,proacl from pg_proc order by oid")).rows).toEqual(before);}finally{await db.close();}},60000);
