// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';

const tenantA='10000000-0000-4000-8000-000000000001';
const tenantB='10000000-0000-4000-8000-000000000002';
const workspace='30000000-0000-4000-8000-000000000001';
const verifySql=readFileSync('supabase/verify/multi_tenant_release.sql','utf8');
const consolidatedRlsSql=readFileSync(
  'supabase/migrations/20260910233503_reassert_active_tenant_rls_after_consolidation.sql',
  'utf8',
);
let db:PGlite;

beforeEach(async()=>{
  db=new PGlite();
  await db.exec(`
    create role authenticated;
    create schema private;
    create table public.workspaces(id uuid primary key);
    create table public.tenants(id uuid primary key,workspace_id uuid not null references public.workspaces(id));
    create table public.parent_records(id uuid primary key,tenant_id uuid not null references public.tenants(id));
    create table public.child_records(id uuid primary key,tenant_id uuid not null references public.tenants(id),parent_id uuid not null references public.parent_records(id));
    create table public.integration_accounts(id uuid primary key,tenant_id uuid not null references public.tenants(id),workspace_id uuid not null references public.workspaces(id),provider text not null);
    create table public.workspace_ssx_accounts(workspace_id uuid primary key references public.workspaces(id),integration_account_id uuid not null unique references public.integration_accounts(id),migration_state text not null);
    create table public.workspace_parties(id uuid primary key,workspace_id uuid not null references public.workspaces(id));
    create table public.workspace_people(id uuid primary key,workspace_id uuid not null references public.workspaces(id));
    create table public.workspace_vehicles(id uuid primary key,workspace_id uuid not null references public.workspaces(id));
    create function private.is_request_tenant_member(uuid) returns boolean language sql stable as $$select true$$;
    alter table public.parent_records enable row level security;
    create policy agvlog_active_tenant_context on public.parent_records as restrictive for all to authenticated using(private.is_request_tenant_member(tenant_id)) with check(private.is_request_tenant_member(tenant_id));
    alter table public.child_records enable row level security;
    create policy agvlog_active_tenant_context on public.child_records as restrictive for all to authenticated using(private.is_request_tenant_member(tenant_id)) with check(private.is_request_tenant_member(tenant_id));
    alter table public.integration_accounts enable row level security;
    create policy agvlog_active_tenant_context on public.integration_accounts as restrictive for all to authenticated using(private.is_request_tenant_member(tenant_id)) with check(private.is_request_tenant_member(tenant_id));
    insert into public.workspaces values('${workspace}');
    insert into public.tenants values('${tenantA}','${workspace}'),('${tenantB}','${workspace}');
    insert into public.parent_records values('40000000-0000-4000-8000-000000000001','${tenantA}');
    insert into public.child_records values('50000000-0000-4000-8000-000000000001','${tenantA}','40000000-0000-4000-8000-000000000001');
    insert into public.integration_accounts values('60000000-0000-4000-8000-000000000001','${tenantA}','${workspace}','SSX');
    insert into public.workspace_ssx_accounts values('${workspace}','60000000-0000-4000-8000-000000000001','ready');
  `);
});

afterEach(async()=>db?.close());

async function expectGateFailure(fragment:string){
  await expect(db.exec(verifySql)).rejects.toThrow(fragment);
  await db.exec('rollback');
}

describe('multi-tenant deployment verification gate',()=>{
  it('passes a consistent isolated database',async()=>{
    await expect(db.exec(verifySql)).resolves.toBeDefined();
  });

  it('detects an existing cross-tenant foreign reference',async()=>{
    await db.query(`update public.child_records set tenant_id='${tenantB}'`);
    await expectGateFailure('multi_tenant_cross_tenant_references');
  });

  it('detects an ambiguous workspace SSX registration',async()=>{
    await db.query(`insert into public.integration_accounts values(gen_random_uuid(),'${tenantB}','${workspace}','ssx')`);
    await expectGateFailure('multi_tenant_invalid_workspace_ssx');
  });

  it('detects tenant-scoped tables without the restrictive active context',async()=>{
    await db.query(`create table public.unprotected_records(id uuid primary key,tenant_id uuid not null references public.tenants(id))`);
    await expectGateFailure('multi_tenant_missing_active_rls');
  });

  it('repairs tenant-scoped tables introduced by consolidated workstreams',async()=>{
    await db.query(`create table public.late_finance_records(id uuid primary key,tenant_id uuid not null references public.tenants(id))`);
    await db.exec(consolidatedRlsSql);
    await expect(db.exec(verifySql)).resolves.toBeDefined();
    const policies=(await db.query<{relrowsecurity:boolean;polpermissive:boolean}>(`
      select c.relrowsecurity,p.polpermissive
      from pg_class c
      join pg_policy p on p.polrelid=c.oid
      where c.oid='public.late_finance_records'::regclass
        and p.polname='agvlog_active_tenant_context'
    `)).rows;
    expect(policies).toEqual([{relrowsecurity:true,polpermissive:false}]);
  });
});
