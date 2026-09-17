// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {afterEach,expect,it} from 'vitest';
import {createFinanceLedgerDatabase,financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
const artifact=readFileSync('supabase/rollouts/20260911030716_finance_active_company_final_activation.sql','utf8');
const checkpoint=readFileSync('docs/qa/finance-final-activation-catalog-checkpoint.sql','utf8');
const read=(name:string)=>readFileSync('supabase/migrations/'+name+'.sql','utf8');
const opened:Array<Awaited<ReturnType<typeof createFinanceLedgerDatabase>>>=[];
async function fixture(){const db=await createFinanceLedgerDatabase();opened.push(db);await db.exec('begin');
 await db.exec(`create schema private;create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;create table client_portal_access(user_id uuid,tenant_id uuid,active boolean);
 create table ssx_activation_scope_probe(id uuid,tenant_id uuid);alter table bank_accounts enable row level security;grant select,insert,update on bank_accounts to authenticated;create policy qa_existing_member_access on bank_accounts for all to authenticated using(true) with check(true);`);
 const context=read('20260910131125_active_tenant_auth_context');for(const name of ['user_can_access_tenant','request_tenant_id','is_request_tenant_member']){const start=context.indexOf('create or replace function private.'+name+'(');await db.exec(context.slice(start,context.indexOf('$function$;',start)+11));}
 await db.exec(read('20260910140823_require_matching_active_tenant_claim'));const boundary=read('20260909235237_finance_legacy_rpc_boundary');await db.exec(boundary.slice(0,boundary.indexOf('-- Wrap')));
 await db.query("insert into tenant_memberships values($1,$2,'admin',true)",[i.otherTenant,i.operator]);
 await db.exec("create or replace function finance_private.can_access(_tenant uuid) returns boolean language sql stable security definer set search_path='' as $$ select false; $$;");
 await claim(db,i.tenant);return db;}
async function claim(db:typeof opened[number],tenant:string|null,header=tenant){await db.query("select set_config('request.jwt.claims',$1,true),set_config('request.headers',$2,true)",[JSON.stringify({role:'authenticated',...(tenant?{active_tenant_id:tenant}:{})}),JSON.stringify(header?{'x-agvlog-tenant-id':header}:{})]);}
async function localCandidate(db:typeof opened[number]){const hash=(await db.query<{catalog_revision:string}>(checkpoint)).rows[0].catalog_revision;return artifact.replace('__FINAL_REVIEWED_CATALOG_REQUIRED__',hash);}
afterEach(async()=>{for(const db of opened.splice(0)){await db.exec('rollback');await db.close();}});
it('is unarmed in the checked-in artifact and rolls back catalog drift before changes',async()=>{const db=await fixture();await db.exec('savepoint attempt');await expect(db.exec(artifact)).rejects.toThrow('finance_activation_checkpoint_not_approved');await db.exec('rollback to savepoint attempt');const candidate=await localCandidate(db);await db.exec('create table finance_unreviewed_change(id uuid,tenant_id uuid);savepoint changed');await expect(db.exec(candidate)).rejects.toThrow('finance_activation_catalog_changed');await db.exec('rollback to savepoint changed');expect((await db.query("select prosrc from pg_proc where oid='finance_private.can_access(uuid)'::regprocedure")).rows[0]).toEqual({prosrc:' select false; '});expect((await db.query("select count(*)::int n from pg_policy where polname='finance_active_company_boundary'")).rows[0]).toEqual({n:0});});
it('activates only the reviewed local fixture and restricts existing permissive table access by company',async()=>{const db=await fixture();const ssxBefore=await db.query("select relrowsecurity,relacl::text from pg_class where oid='ssx_activation_scope_probe'::regclass");await db.exec(await localCandidate(db));
 const rows=()=>financeAs<{id:string}>(db,i.operator,'select id from bank_accounts order by id');expect((await rows()).rows).toEqual([{id:i.account}]);await claim(db,i.otherTenant);expect((await rows()).rows).toEqual([{id:i.otherAccount}]);
 await expect(financeAs(db,i.operator,'insert into bank_accounts(id,tenant_id,active) values($1,$2,true)',[randomUUID(),i.tenant])).rejects.toMatchObject({code:'42501'});
 expect((await db.query("select relrowsecurity,relacl::text from pg_class where oid='ssx_activation_scope_probe'::regclass")).rows).toEqual(ssxBefore.rows);
});
it('rejects missing/stale company claims and both forms of mixed driver identity',async()=>{const db=await fixture();await db.exec(await localCandidate(db));const rows=()=>financeAs(db,i.operator,'select id from bank_accounts');
 await claim(db,i.tenant,i.otherTenant);await expect(rows()).rejects.toMatchObject({code:'42501'});await claim(db,null,i.tenant);expect((await rows()).rows).toEqual([]);
 await claim(db,i.tenant);await db.query("insert into tenant_memberships values($1,$2,'driver',true)",[i.tenant,i.operator]);expect((await rows()).rows).toEqual([]);await db.query("delete from tenant_memberships where user_id=$1 and role='driver'",[i.operator]);await db.query('update drivers set user_id=$1 where id=$2',[i.operator,i.driver]);expect((await rows()).rows).toEqual([]);
 await db.query('update drivers set user_id=$1 where id=$2',[i.driverUser,i.driver]);await db.query('update tenant_memberships set active=false where user_id=$1 and tenant_id=$2',[i.operator,i.tenant]);expect((await rows()).rows).toEqual([]);
});
it('keeps real recording gated to the selected company after activation',async()=>{const db=await fixture();await db.exec(await localCandidate(db));const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'driver_advance',driver_id:i.driver,amount_cents:50000,occurred_on:'2026-01-01',description:'QA local activation',beneficiary_name:'Motorista QA',reason:'Prova isolada sem transferência bancária'};const call=()=>financeAs<{result:{confirmed:boolean}}>(db,i.operator,'select record_finance_movement($1::jsonb) result',[JSON.stringify(payload)]);
 expect((await call()).rows[0].result.confirmed).toBe(true);await claim(db,i.otherTenant);await expect(call()).rejects.toMatchObject({code:'42501'});expect((await db.query('select count(*)::int n from finance_movements')).rows[0]).toEqual({n:1});
});
it('rejects a falsely approved fixture if its gate is not the exact staged body',async()=>{const db=await fixture();await db.exec("create or replace function finance_private.can_access(_tenant uuid) returns boolean language sql stable security definer set search_path='' as $$select false;$$");const candidate=await localCandidate(db);await db.exec('savepoint wrong_gate');await expect(db.exec(candidate)).rejects.toThrow('finance_activation_staged_gate_contract_changed');await db.exec('rollback to savepoint wrong_gate');});
