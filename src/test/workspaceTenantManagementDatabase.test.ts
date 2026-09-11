// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = 'supabase/migrations/20260911010415_manage_workspace_tenants_and_emitters.sql';
const employeeAccessMigration = 'supabase/migrations/20260911020515_sync_workspace_employee_tenant_access.sql';
const selectorLabelsMigration = 'supabase/migrations/20260911021750_distinguish_duplicate_tenant_selector_labels.sql';
const workspace = '10000000-0000-4000-8000-000000000001';
const sourceTenant = '20000000-0000-4000-8000-000000000001';
const owner = '30000000-0000-4000-8000-000000000001';
const admin = '30000000-0000-4000-8000-000000000002';
const operator = '30000000-0000-4000-8000-000000000003';
const driver = '30000000-0000-4000-8000-000000000004';
const client = '30000000-0000-4000-8000-000000000005';

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema private;
    create type public.app_role as enum ('owner','admin','operator','client','driver');
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function private.request_tenant_id() returns uuid language sql stable
      as $$select (nullif(current_setting('request.headers',true),'')::jsonb->>'x-agvlog-tenant-id')::uuid$$;

    create table auth.users(id uuid primary key);
    create table public.workspaces(id uuid primary key default gen_random_uuid(),name text not null,active boolean not null default true);
    create table public.tenants(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),
      name text not null,plan_key text not null default 'free',timezone text not null default 'America/Sao_Paulo',
      settings jsonb default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
    );
    create table public.workspace_memberships(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null,user_id uuid not null,
      role public.app_role not null,active boolean not null default true,
      created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
      unique(workspace_id,user_id)
    );
    create table public.tenant_memberships(
      id uuid primary key default gen_random_uuid(),tenant_id uuid not null,user_id uuid not null,
      role public.app_role not null,active boolean not null default true,updated_at timestamptz not null default now(),
      unique(tenant_id,user_id)
    );
    create table public.tenant_emitters(
      id uuid primary key default gen_random_uuid(),tenant_id uuid not null,branch_code text not null default 'MATRIZ',
      cnpj text not null,razao_social text not null,nome_fantasia text,ie text,im text,regime_tributario text,
      city_code text,endereco jsonb not null default '{}'::jsonb,active boolean not null default true,
      is_default boolean not null default false,unique(tenant_id,cnpj)
    );
    create unique index uq_tenant_emitters_default on public.tenant_emitters(tenant_id) where is_default;
    create table public.entity_audit_log(
      id uuid primary key default gen_random_uuid(),tenant_id uuid not null,entity_type text not null,entity_id uuid not null,
      action text not null,old_data jsonb,new_data jsonb,actor_user_id uuid,actor_role text,source text,request_id text,
      created_at timestamptz not null default now()
    );

    create function public.is_tenant_admin(_tenant_id uuid) returns boolean language sql stable security definer set search_path=''
      as $$select exists(select 1 from public.tenant_memberships where tenant_id=_tenant_id and user_id=auth.uid() and active and role in ('owner','admin'))$$;
    create function private.is_workspace_admin(_workspace_id uuid) returns boolean language sql stable security definer set search_path=''
      as $$select exists(select 1 from public.workspace_memberships where workspace_id=_workspace_id and user_id=auth.uid() and active and role in ('owner','admin'))$$;

    insert into auth.users values ('${owner}'),('${admin}'),('${operator}'),('${driver}'),('${client}');
    insert into public.workspaces(id,name) values ('${workspace}','Grupo QA');
    insert into public.tenants(id,workspace_id,name,settings) values
      ('${sourceTenant}','${workspace}','Empresa A','{"company":{"legal_name":"Empresa A Ltda","trade_name":"B","tax_id":"11111111000111"}}');
    insert into public.workspace_memberships(workspace_id,user_id,role) values
      ('${workspace}','${owner}','owner'),('${workspace}','${admin}','admin'),('${workspace}','${operator}','operator');
    insert into public.tenant_memberships(tenant_id,user_id,role) values
      ('${sourceTenant}','${owner}','owner'),('${sourceTenant}','${admin}','admin'),
      ('${sourceTenant}','${operator}','operator'),('${sourceTenant}','${client}','client');
  `);
  await db.exec(readFileSync(migration, 'utf8'));
  await db.exec(readFileSync(employeeAccessMigration, 'utf8'));
  await db.exec(readFileSync(selectorLabelsMigration, 'utf8'));
}, 30_000);

afterAll(async () => db?.close());

async function asOwner<T>(run: () => Promise<T>) {
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${owner}';set request.headers='{"x-agvlog-tenant-id":"${sourceTenant}"}'`);
  try { return await run(); }
  finally { await db.exec('reset role;reset request.jwt.claim.sub;reset request.headers'); }
}

describe('workspace tenant and fiscal emitter management', () => {
  it('creates a tenant and its initial default emitter atomically', async () => {
    const created = await asOwner(async () => (await db.query<{ result: { tenant_id: string; default_emitter_id: string } }>(`
      select public.create_workspace_tenant_v1(
        '${sourceTenant}','Empresa B',
        '{"legal_name":"Empresa B Ltda","trade_name":"B","tax_id":"22222222000122"}',
        'America/Sao_Paulo',
        '{"cnpj":"22222222000122","razao_social":"Empresa B Ltda","nome_fantasia":"B"}'
      ) result
    `)).rows[0].result);

    const tenant = (await db.query<{ workspace_id: string; tax_id: string }>(`
      select workspace_id,settings->'company'->>'tax_id' tax_id from public.tenants where id='${created.tenant_id}'
    `)).rows[0];
    expect(tenant).toEqual({ workspace_id: workspace, tax_id: '22222222000122' });

    const emitter = (await db.query<{ tenant_id: string; is_default: boolean }>(`
      select tenant_id,is_default from public.tenant_emitters where id='${created.default_emitter_id}'
    `)).rows[0];
    expect(emitter).toEqual({ tenant_id: created.tenant_id, is_default: true });

    const memberships = (await db.query<{ user_id: string; role: string }>(`
      select user_id,role::text role from public.tenant_memberships where tenant_id='${created.tenant_id}' order by user_id
    `)).rows;
    expect(memberships).toEqual([
      { user_id: owner, role: 'owner' },
      { user_id: admin, role: 'admin' },
      { user_id: operator, role: 'operator' },
    ]);
  });

  it('keeps clients tenant-specific and synchronizes employee changes across the workspace', async () => {
    const tenantB = (await db.query<{ id: string }>(
      "select id from public.tenants where name='Empresa B'",
    )).rows[0].id;

    expect((await db.query<{ tenant_id: string }>(`
      select tenant_id from public.tenant_memberships
      where user_id='${client}' and active order by tenant_id
    `)).rows).toEqual([{ tenant_id: sourceTenant }]);

    await db.query(`
      insert into public.tenant_memberships(tenant_id,user_id,role)
      values ('${sourceTenant}','${driver}','driver')
    `);
    expect((await db.query<{ tenant_id: string; role: string }>(`
      select membership.tenant_id,membership.role::text role
      from public.tenant_memberships membership
      join public.tenants tenant on tenant.id=membership.tenant_id
      where membership.user_id='${driver}' and membership.active
      order by tenant.name
    `)).rows).toEqual([
      { tenant_id: sourceTenant, role: 'driver' },
      { tenant_id: tenantB, role: 'driver' },
    ]);

    await db.query(`
      update public.tenant_memberships set role='operator'
      where tenant_id='${tenantB}' and user_id='${driver}'
    `);
    expect((await db.query<{ role: string }>(`
      select distinct role::text role from public.tenant_memberships where user_id='${driver}'
    `)).rows).toEqual([{ role: 'operator' }]);
  });

  it('uses the registered company name in the footer selector', async () => {
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${operator}'`);
    try {
      expect((await db.query<{ tenant_name: string }>(
        'select tenant_name from public.get_current_memberships_v1() order by tenant_name',
      )).rows).toEqual([
        { tenant_name: 'B · Empresa 1' },
        { tenant_name: 'B · Empresa 2' },
      ]);
    } finally {
      await db.exec('reset role;reset request.jwt.claim.sub');
    }
  });

  it('lists every tenant and its safe emitter choices for group administration', async () => {
    const result = await asOwner(async () => (await db.query<{ result: Array<{ name: string; emitters: unknown[] }> }>(
      `select public.list_workspace_tenants_v1('${sourceTenant}') result`,
    )).rows[0].result);
    expect(result.map((tenant) => tenant.name)).toEqual(['Empresa A', 'Empresa B']);
    expect(result.find((tenant) => tenant.name === 'Empresa B')?.emitters).toHaveLength(1);
  });

  it('changes the default only to an active emitter of the target tenant', async () => {
    const tenant = (await db.query<{ id: string }>("select id from public.tenants where name='Empresa B'")).rows[0].id;
    const second = (await db.query<{ id: string }>(`
      insert into public.tenant_emitters(tenant_id,cnpj,razao_social) values('${tenant}','33333333000133','Filial B') returning id
    `)).rows[0].id;
    await asOwner(() => db.query(`select public.set_workspace_tenant_default_emitter_v1('${sourceTenant}','${tenant}','${second}')`));
    const defaults = (await db.query<{ id: string }>(`select id from public.tenant_emitters where tenant_id='${tenant}' and is_default`)).rows;
    expect(defaults).toEqual([{ id: second }]);

    const foreignEmitter = (await db.query<{ id: string }>(`
      insert into public.tenant_emitters(tenant_id,cnpj,razao_social) values('${sourceTenant}','44444444000144','Empresa A Filial') returning id
    `)).rows[0].id;
    await expect(asOwner(() => db.query(
      `select public.set_workspace_tenant_default_emitter_v1('${sourceTenant}','${tenant}','${foreignEmitter}')`,
    ))).rejects.toMatchObject({ code: '22023' });
  });

  it('blocks duplicate legal CNPJ inside the workspace', async () => {
    await expect(asOwner(() => db.query(`
      select public.create_workspace_tenant_v1('${sourceTenant}','Duplicada','{"legal_name":"Duplicada","tax_id":"11111111000111"}')
    `))).rejects.toMatchObject({ code: '23505' });
  });
});
