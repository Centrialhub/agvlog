// @vitest-environment node
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {beforeEach,afterEach,it,expect} from 'vitest';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
const rollout=readFileSync('supabase/rollouts/20260910220257_finance_production_foundation_staged.sql','utf8');
let db:PGlite;
beforeEach(async()=>{db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create table tenants(id uuid primary key);create table tenant_memberships(tenant_id uuid,user_id uuid,role text,active boolean);
 create table drivers(id uuid primary key,tenant_id uuid,user_id uuid,active boolean);
 create table bank_accounts(id uuid primary key,tenant_id uuid,active boolean,name text);
 grant usage on schema auth,public to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
 await db.query('insert into tenants values($1)',[i.tenant]);await db.query("insert into auth.users values($1,'admin@qa.local','{}')",[i.operator]);await db.query("insert into tenant_memberships values($1,$2,'admin',true)",[i.tenant,i.operator]);await db.query("insert into bank_accounts values($1,$2,true,'Conta teste')",[i.account,i.tenant]);});
afterEach(async()=>{await db.close();});
it('commits the three additive tables with authorization closed and no writable financial API',async()=>{
 expect(createHash('sha256').update(rollout).digest('hex')).toBe('5f0b9e2ad6b7da6d0a2a45eb2a2816f2a5f04651436f5e9c54aca52239051113');
 await db.exec('begin;'+rollout+'commit;');await db.exec('begin');
 const access=(await financeAs<{v:boolean}>(db,i.operator,'select finance_private.can_access($1) v',[i.tenant])).rows[0].v;expect(access).toBe(false);
 const tables=(await db.query<{n:number}>("select count(*)::int n from pg_tables where schemaname='public' and tablename in('finance_movements','finance_commands','finance_events')")).rows[0].n;expect(tables).toBe(3);
 await expect(financeAs(db,i.operator,'select record_finance_movement($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:50000,occurred_on:'2026-09-10',description:'Saída não liberada',beneficiary_name:'Fornecedor',reason:'API deve permanecer bloqueada no estágio'}])).rejects.toThrow('finance_access_denied');
 for(const table of ['finance_movements','finance_commands','finance_events'])expect((await db.query<{n:number}>(`select count(*)::int n from ${table}`)).rows[0].n).toBe(0);
 await db.exec('rollback');
});
it('rolls back all newly attempted DDL on an existing table collision, without replacing the existing table',async()=>{
 await db.exec("create table finance_movements(id integer primary key,description text);insert into finance_movements values(7,'Legado preservado');");await db.exec('begin');
 await expect(db.exec(rollout)).rejects.toThrow('already exists');await db.exec('rollback');
 expect((await db.query<{description:string}>('select description from finance_movements where id=7')).rows[0].description).toBe('Legado preservado');
 expect((await db.query<{v:string|null}>("select to_regprocedure('finance_private.can_access(uuid)')::text v")).rows[0].v).toBeNull();
 expect((await db.query<{v:string|null}>("select to_regclass('public.finance_commands')::text v")).rows[0].v).toBeNull();
});
