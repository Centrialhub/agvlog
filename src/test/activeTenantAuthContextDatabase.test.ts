// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';

const tenantA='10000000-0000-4000-8000-000000000001';
const tenantB='10000000-0000-4000-8000-000000000002';
const strangerTenant='10000000-0000-4000-8000-000000000003';
const workspace='30000000-0000-4000-8000-000000000001';
const user='20000000-0000-4000-8000-000000000001';
let db:PGlite;

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create role supabase_auth_admin;
    create schema auth;
    create schema private;
    create type public.app_role as enum ('owner','admin','operator','client','driver');
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable
      as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid(),auth.jwt() to authenticated;
    create function public.update_updated_at_column() returns trigger language plpgsql
      as $$begin new.updated_at=now();return new;end$$;
    create table auth.users(id uuid primary key);
    create table public.tenants(
      id uuid primary key,name text not null,plan_key text not null default 'free',
      timezone text not null default 'America/Sao_Paulo',settings jsonb default '{}'::jsonb,
      created_at timestamptz not null default now(),updated_at timestamptz not null default now()
    );
    create table public.tenant_memberships(
      id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
      user_id uuid not null references auth.users(id),role public.app_role not null,active boolean not null default true,
      created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(tenant_id,user_id)
    );
    create table public.client_portal_access(
      id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
      user_id uuid not null references auth.users(id),active boolean not null default true,created_at timestamptz not null default now()
    );
    create table public.scoped_records(
      id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),label text not null
    );
    alter table public.scoped_records enable row level security;
    create policy scoped_records_existing_domain_access on public.scoped_records
      for all to authenticated using (true) with check (true);
    grant select,insert,update,delete on public.scoped_records to authenticated;
    grant all on public.scoped_records to service_role;
    create function public.create_tenant_with_owner(text) returns uuid language sql as $$select gen_random_uuid()$$;
    insert into auth.users(id) values ('${user}');
    insert into public.tenants(id,name) values ('${tenantA}','Empresa A'),('${tenantB}','Empresa B'),('${strangerTenant}','Empresa C');
    insert into public.tenant_memberships(tenant_id,user_id,role) values
      ('${tenantA}','${user}','owner'),('${tenantB}','${user}','operator');
  `);
  await db.exec(readFileSync('supabase/migrations/20260910125751_workspace_tenant_foundation.sql','utf8'));
  await db.query(`insert into public.workspaces(id,name) values ('${workspace}','Grupo AB')`);
  await db.query(`update public.tenants set workspace_id='${workspace}' where id in ('${tenantA}','${tenantB}')`);
  await db.exec(readFileSync('supabase/migrations/20260910131125_active_tenant_auth_context.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260910132033_enforce_active_tenant_rls.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260910140823_require_matching_active_tenant_claim.sql','utf8'));
  // Simulates a tenant-scoped feature table introduced later in the release.
  await db.exec(`
    create table public.late_scoped_records(
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references public.tenants(id),
      label text not null
    );
    alter table public.late_scoped_records enable row level security;
    create policy late_scoped_records_existing_domain_access on public.late_scoped_records
      for all to authenticated using (true) with check (true);
    grant select,insert,update,delete on public.late_scoped_records to authenticated;
  `);
  await db.exec(readFileSync('supabase/migrations/20260910144948_finalize_active_tenant_rls_coverage.sql','utf8'));
  await db.exec(`
    create table public.concurrent_late_scoped_records(
      id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),label text not null
    );
    alter table public.concurrent_late_scoped_records enable row level security;
    create policy concurrent_late_domain_access on public.concurrent_late_scoped_records
      for all to authenticated using (true) with check (true);
    grant select,insert,update,delete on public.concurrent_late_scoped_records to authenticated;
  `);
  await db.exec(readFileSync('supabase/migrations/20260910151622_reassert_active_tenant_rls_release_gate.sql','utf8'));
  await db.query(`insert into public.scoped_records(tenant_id,label) values ('${tenantA}','A'),('${tenantB}','B')`);
  await db.query(`insert into public.late_scoped_records(tenant_id,label) values ('${tenantA}','late A'),('${tenantB}','late B')`);
  await db.query(`insert into public.concurrent_late_scoped_records(tenant_id,label) values ('${tenantA}','concurrent A'),('${tenantB}','concurrent B')`);
},30_000);

afterAll(async()=>db?.close());

async function signedIn<T>(action:()=>Promise<T>){
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${user}';set request.jwt.claims='{}'`);
  try{return await action();}finally{await db.exec('reset role;reset request.jwt.claim.sub;reset request.jwt.claims;reset request.headers');}
}

const hookEvent=()=>JSON.stringify({user_id:user,claims:{sub:user,role:'authenticated',aud:'authenticated'}});

describe('active tenant Auth context in PostgreSQL',()=>{
  it('refuses a tenant outside the signed-in user access set',async()=>{
    await signedIn(async()=>{
      await expect(db.query(`select public.set_active_tenant_context_v1('${strangerTenant}')`)).rejects.toMatchObject({code:'42501'});
    });
  });

  it('persists a valid selection and signs tenant/workspace into the next token',async()=>{
    await signedIn(async()=>{
      await db.query(`select public.set_active_tenant_context_v1('${tenantB}')`);
    });
    const claims=(await db.query<{result:{claims:Record<string,string>}}>(
      `select public.custom_access_token_hook($1::jsonb) result`,[hookEvent()],
    )).rows[0].result.claims;
    expect(claims).toMatchObject({active_tenant_id:tenantB,active_workspace_id:workspace});
  });

  it('uses the signed claim for Realtime and rejects a mismatched REST header',async()=>{
    await signedIn(async()=>{
      await db.exec(`set request.jwt.claims='{"role":"authenticated","active_tenant_id":"${tenantB}"}'`);
      expect((await db.query<{id:string}>('select private.request_tenant_id() id')).rows[0].id).toBe(tenantB);
      await db.exec(`set request.headers='{"x-agvlog-tenant-id":"${tenantA}"}'`);
      await expect(db.query('select private.request_tenant_id()')).rejects.toMatchObject({code:'42501'});
    });
  });

  it('fails closed when neither transport supplies tenant context',async()=>{
    await signedIn(async()=>{
      await expect(db.query('select private.request_tenant_id()')).rejects.toMatchObject({code:'22023'});
    });
  });

  it('composes with existing policies and returns only the active tenant rows',async()=>{
    await signedIn(async()=>{
      await db.exec(`set request.jwt.claims='{"role":"authenticated","active_tenant_id":"${tenantA}"}'`);
      expect((await db.query<{label:string}>('select label from public.scoped_records order by label')).rows).toEqual([{label:'A'}]);
      await db.exec(`set request.jwt.claims='{"role":"authenticated","active_tenant_id":"${tenantB}"}'`);
      await db.exec(`set request.headers='{"x-agvlog-tenant-id":"${tenantB}"}'`);
      expect((await db.query<{label:string}>('select label from public.scoped_records order by label')).rows).toEqual([{label:'B'}]);
    });
  });

  it('blocks cross-tenant inserts and tenant reassignment',async()=>{
    await signedIn(async()=>{
      await db.exec(`set request.jwt.claims='{"role":"authenticated","active_tenant_id":"${tenantA}"}'`);
      await db.exec(`set request.headers='{"x-agvlog-tenant-id":"${tenantA}"}'`);
      await expect(db.query(`insert into public.scoped_records(tenant_id,label) values ('${tenantB}','blocked')`)).rejects.toMatchObject({code:'42501'});
      await expect(db.query(`update public.scoped_records set tenant_id='${tenantB}' where tenant_id='${tenantA}'`)).rejects.toMatchObject({code:'42501'});
    });
  });

  it('also isolates tenant tables created after the foundation sweep',async()=>{
    await signedIn(async()=>{
      await db.exec(`set request.jwt.claims='{"role":"authenticated","active_tenant_id":"${tenantB}"}'`);
      await db.exec(`set request.headers='{"x-agvlog-tenant-id":"${tenantB}"}'`);
      expect((await db.query<{label:string}>('select label from public.late_scoped_records')).rows)
        .toEqual([{label:'late B'}]);
      expect((await db.query<{label:string}>('select label from public.concurrent_late_scoped_records')).rows)
        .toEqual([{label:'concurrent B'}]);
    });
  });

  it('installs the restrictive policy on every tenant-scoped public table',async()=>{
    const missing=(await db.query(`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      join pg_attribute a on a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped
      where n.nspname='public' and c.relkind in ('r','p')
        and not exists(select 1 from pg_policy p where p.polrelid=c.oid and p.polname='agvlog_active_tenant_context' and not p.polpermissive)
    `)).rows;
    expect(missing).toEqual([]);
  });
});
