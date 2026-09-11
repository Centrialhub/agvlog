// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';

const tenantId='10000000-0000-4000-8000-000000000001';
const userId='20000000-0000-4000-8000-000000000001';
const otherTenantId='10000000-0000-4000-8000-000000000002';
const otherUserId='20000000-0000-4000-8000-000000000002';
const migration='supabase/migrations/20260910125751_workspace_tenant_foundation.sql';

let db:PGlite;

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema private;

    create type public.app_role as enum ('owner','admin','operator','client','driver');

    create function auth.uid() returns uuid
    language sql stable
    as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;

    create function public.update_updated_at_column() returns trigger
    language plpgsql set search_path='public'
    as $$begin new.updated_at=now();return new;end$$;

    create table auth.users(id uuid primary key);
    create table public.tenants(
      id uuid primary key default gen_random_uuid(),
      name text not null,
      plan_key text not null default 'free',
      timezone text not null default 'America/Sao_Paulo',
      settings jsonb default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.tenant_memberships(
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references public.tenants(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade,
      role public.app_role not null default 'operator',
      active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(tenant_id,user_id)
    );
    create function public.create_tenant_with_owner(text) returns uuid
    language sql security definer set search_path=''
    as $$select gen_random_uuid()$$;

    grant select on public.tenants,public.tenant_memberships to authenticated;

    insert into auth.users(id) values ('${userId}'),('${otherUserId}');
    insert into public.tenants(id,name) values ('${tenantId}','Empresa A');
    insert into public.tenant_memberships(tenant_id,user_id,role)
    values ('${tenantId}','${userId}','owner');
  `);
  await db.exec(readFileSync(migration,'utf8'));
},30_000);

afterAll(async()=>db?.close());

async function asUser(id:string,tenant:string|null,run:()=>Promise<void>){
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${id}'`);
  if(tenant){
    await db.exec(`set request.headers='{"x-agvlog-tenant-id":"${tenant}"}'`);
  }else{
    await db.exec("set request.headers='{}'");
  }
  try{await run();}finally{await db.exec('reset role;reset request.jwt.claim.sub;reset request.headers');}
}

describe('workspace/tenant foundation in PostgreSQL',()=>{
  it('backfills one workspace and its membership without losing the tenant',async()=>{
    const rows=(await db.query<{workspace_id:string;workspace_name:string;role:string}>(`
      select t.workspace_id,w.name workspace_name,wm.role::text role
      from public.tenants t
      join public.workspaces w on w.id=t.workspace_id
      join public.workspace_memberships wm on wm.workspace_id=w.id
      where t.id='${tenantId}' and wm.user_id='${userId}'
    `)).rows;
    expect(rows).toEqual([{workspace_id:tenantId,workspace_name:'Empresa A',role:'owner'}]);
  });

  it('requires a valid request tenant and its active membership',async()=>{
    await asUser(userId,tenantId,async()=>{
      expect((await db.query<{allowed:boolean}>(`select private.is_request_tenant_member('${tenantId}') allowed`)).rows[0].allowed).toBe(true);
    });
    await asUser(userId,null,async()=>{
      await expect(db.query(`select private.is_request_tenant_member('${tenantId}')`)).rejects.toMatchObject({code:'22023'});
    });
    await asUser(otherUserId,tenantId,async()=>{
      expect((await db.query<{allowed:boolean}>(`select private.is_request_tenant_member('${tenantId}') allowed`)).rows[0].allowed).toBe(false);
    });
  });

  it('shares the workspace while keeping tenant request authorization separate',async()=>{
    await db.exec(`
      insert into public.tenants(id,workspace_id,name) values ('${otherTenantId}','${tenantId}','Empresa B');
      insert into public.tenant_memberships(tenant_id,user_id,role)
      values ('${otherTenantId}','${otherUserId}','operator');
    `);
    await asUser(otherUserId,otherTenantId,async()=>{
      expect((await db.query('select id from public.workspaces')).rows).toHaveLength(1);
      expect((await db.query<{allowed:boolean}>(`select private.is_request_tenant_member('${tenantId}') allowed`)).rows[0].allowed).toBe(false);
      expect((await db.query<{allowed:boolean}>(`select private.is_request_tenant_member('${otherTenantId}') allowed`)).rows[0].allowed).toBe(true);
    });
  });

  it('provisions workspace and both owner memberships atomically',async()=>{
    const newUser='20000000-0000-4000-8000-000000000003';
    await db.query(`insert into auth.users(id) values ('${newUser}')`);
    await asUser(newUser,null,async()=>{
      const created=(await db.query<{tenant_id:string}>("select public.create_tenant_with_owner(' Empresa C ') tenant_id")).rows[0].tenant_id;
      const result=(await db.query<{name:string;tenant_role:string;workspace_role:string}>(`
        select w.name,tm.role::text tenant_role,wm.role::text workspace_role
        from public.tenants t
        join public.workspaces w on w.id=t.workspace_id
        join public.tenant_memberships tm on tm.tenant_id=t.id and tm.user_id='${newUser}'
        join public.workspace_memberships wm on wm.workspace_id=w.id and wm.user_id='${newUser}'
        where t.id='${created}'
      `)).rows[0];
      expect(result).toEqual({name:'Empresa C',tenant_role:'owner',workspace_role:'owner'});
    });
  });
});
