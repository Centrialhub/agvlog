// @vitest-environment node
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';

const ids={
  tenant:'10000000-0000-4000-8000-000000000001',
  otherTenant:'10000000-0000-4000-8000-000000000002',
  actor:'20000000-0000-4000-8000-000000000001',
};
const migration=readFileSync('supabase/migrations/20260915023321_finance_cost_center_canonical_identity.sql','utf8');

let db:PGlite;

async function authenticate(tenant=ids.tenant){
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false),set_config('request.headers',$2,false)",
    [ids.actor,JSON.stringify({'x-agvlog-tenant-id':tenant})],
  );
}

async function asAuthenticated<T>(sql:string,params:unknown[]=[]){
  await db.exec('savepoint authenticated_call;set role authenticated');
  try{
    const result=await db.query<T>(sql,params);
    await db.exec('reset role;release savepoint authenticated_call');
    return result;
  }catch(error){
    await db.exec('rollback to savepoint authenticated_call;release savepoint authenticated_call');
    throw error;
  }
}

describe('cost-center canonical identity migration',()=>{
  beforeAll(async()=>{
    db=new PGlite();
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create schema private;
      create function auth.uid() returns uuid language sql stable
        as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable
        as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
      create table public.tenants(id uuid primary key);
      create table public.tenant_memberships(
        tenant_id uuid not null,
        user_id uuid not null,
        role text not null,
        active boolean not null,
        primary key(tenant_id,user_id)
      );
      create table public.cost_centers(
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references public.tenants(id),
        name text not null,
        active boolean not null default true,
        created_at timestamptz not null default clock_timestamp(),
        updated_at timestamptz not null default clock_timestamp(),
        constraint cost_centers_tenant_id_name_key unique(tenant_id,name)
      );
      create table public.finance_expense_items(
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references public.tenants(id),
        cost_center_id uuid,
        constraint finance_expense_items_cost_center_id_fkey
          foreign key(cost_center_id) references public.cost_centers(id)
      );
      create function private.request_tenant_id()
      returns uuid
      language plpgsql
      stable
      security invoker
      set search_path = ''
      as $function$
declare
  v_headers jsonb;
  v_header_raw text;
  v_claim_raw text;
  v_raw text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception
    when invalid_text_representation then
      raise exception 'tenant_context_invalid_headers' using errcode = '22023';
  end;

  v_header_raw := nullif(btrim(v_headers ->> 'x-agvlog-tenant-id'), '');
  v_claim_raw := nullif(btrim(auth.jwt() ->> 'active_tenant_id'), '');

  if v_header_raw is not null and v_claim_raw is not null and v_header_raw <> v_claim_raw then
    raise exception 'tenant_context_claim_mismatch' using errcode = '42501';
  end if;

  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated' and v_claim_raw is null then
    raise exception 'tenant_context_claim_required' using errcode = '42501';
  end if;

  v_raw := coalesce(v_header_raw, v_claim_raw);
  if v_raw is null then
    raise exception 'tenant_context_required' using errcode = '22023';
  end if;

  begin
    return v_raw::uuid;
  exception
    when invalid_text_representation then
      raise exception 'tenant_context_invalid' using errcode = '22023';
  end;
end;
$function$;
      create function public.is_tenant_operator_or_admin(_tenant_id uuid) returns boolean
        language sql stable security definer set search_path=''
        as $function$
  select exists (
    select 1
    from public.tenant_memberships membership
    where membership.user_id = auth.uid()
      and membership.tenant_id = _tenant_id
      and membership.active
      and membership.role::text in ('owner', 'admin', 'operator')
  );
$function$;
      create function private.is_request_tenant_member(_tenant_id uuid) returns boolean
        language sql stable security definer set search_path=''
        as $$select private.request_tenant_id()=_tenant_id and exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant_id and m.user_id=auth.uid() and m.active)$$;
      alter table public.cost_centers enable row level security;
      create policy agvlog_active_tenant_context on public.cost_centers as restrictive for all to authenticated
        using(private.is_request_tenant_member(tenant_id))
        with check(private.is_request_tenant_member(tenant_id));
      create policy agvlog_select_authenticated on public.cost_centers for select to authenticated
        using(public.is_tenant_operator_or_admin(tenant_id));
      create policy agvlog_insert_authenticated on public.cost_centers for insert to authenticated
        with check(public.is_tenant_operator_or_admin(tenant_id));
      create policy agvlog_update_authenticated on public.cost_centers for update to authenticated
        using(public.is_tenant_operator_or_admin(tenant_id))
        with check(public.is_tenant_operator_or_admin(tenant_id));
      create policy agvlog_delete_authenticated on public.cost_centers for delete to authenticated
        using(public.is_tenant_operator_or_admin(tenant_id));
      grant usage on schema public,auth,private to authenticated,anon;
      grant execute on function auth.uid(),auth.jwt(),private.request_tenant_id(),private.is_request_tenant_member(uuid),public.is_tenant_operator_or_admin(uuid) to authenticated;
      grant select,insert,update,delete on public.cost_centers to authenticated;
    `);
    await db.query('insert into public.tenants values($1),($2)',[ids.tenant,ids.otherTenant]);
    await db.query("insert into public.tenant_memberships values($1,$3,'admin',true),($2,$3,'admin',true)",[ids.tenant,ids.otherTenant,ids.actor]);
    await db.exec(migration);
    await db.exec('begin');
    await authenticate();
  },30000);

  afterAll(async()=>{
    await db?.exec('rollback');
    await db?.close();
  });

  it('installs an invoker RPC with an explicit authenticated-only grant',async()=>{
    const routine=(await db.query<{security_definer:boolean;search_path:string[]|null;body:string}>(`
      select p.prosecdef security_definer,p.proconfig search_path,p.prosrc body
      from pg_proc p
      where p.oid='public.create_or_reactivate_cost_center_v1(uuid,text)'::regprocedure
    `)).rows[0];
    expect(routine).toMatchObject({security_definer:false,search_path:['search_path=""']});
    const lock=routine.body.indexOf('perform pg_advisory_xact_lock');
    const reauthorization=routine.body.indexOf('auth.uid() is distinct from v_actor',lock);
    const firstRead=routine.body.indexOf('select center.*',lock);
    expect(lock).toBeGreaterThan(-1);
    expect(reauthorization).toBeGreaterThan(lock);
    expect(reauthorization).toBeLessThan(firstRead);
    const grants=(await db.query<{authenticated:boolean;anon:boolean;service:boolean;everyone:boolean}>(`
      select
        has_function_privilege('authenticated','public.create_or_reactivate_cost_center_v1(uuid,text)','execute') authenticated,
        has_function_privilege('anon','public.create_or_reactivate_cost_center_v1(uuid,text)','execute') anon,
        has_function_privilege('service_role','public.create_or_reactivate_cost_center_v1(uuid,text)','execute') service,
        has_function_privilege('public','public.create_or_reactivate_cost_center_v1(uuid,text)','execute') everyone
    `)).rows[0];
    expect(grants).toEqual({authenticated:true,anon:false,service:false,everyone:false});
  });

  it('trims names, prevents canonical duplicates and reactivates the same row',async()=>{
    const create=await asAuthenticated<{result:{status:string;cost_center:{id:string;name:string}}}>(
      'select public.create_or_reactivate_cost_center_v1($1,$2) result',[ids.tenant,'\u00a0\t Operacional \u3000'],
    );
    expect(create.rows[0].result).toMatchObject({status:'created',cost_center:{name:'Operacional'}});
    const id=create.rows[0].result.cost_center.id;

    const duplicate=await asAuthenticated<{result:{status:string;cost_center:{id:string}}}>(
      'select public.create_or_reactivate_cost_center_v1($1,$2) result',[ids.tenant,'operacional'],
    );
    expect(duplicate.rows[0].result).toMatchObject({status:'already_active',cost_center:{id}});

    await asAuthenticated('update public.cost_centers set active=false where tenant_id=$1 and id=$2',[ids.tenant,id]);
    const reactivated=await asAuthenticated<{result:{status:string;cost_center:{id:string;active:boolean}}}>(
      'select public.create_or_reactivate_cost_center_v1($1,$2) result',[ids.tenant,'OPERACIONAL'],
    );
    expect(reactivated.rows[0].result).toMatchObject({status:'reactivated',cost_center:{id,active:true}});
    expect((await db.query<{count:number}>('select count(*)::int count from public.cost_centers where tenant_id=$1',[ids.tenant])).rows[0].count).toBe(1);
  });

  it('rejects invalid names and a tenant different from the active request',async()=>{
    await expect(asAuthenticated('select public.create_or_reactivate_cost_center_v1($1,$2)',[ids.tenant,'\u00a0\u3000\t'])).rejects.toMatchObject({code:'22023'});
    await db.exec('savepoint noncanonical_direct_write');
    await expect(asAuthenticated('insert into public.cost_centers(tenant_id,name) values($1,$2)',[ids.tenant,'\tDireto\t'])).rejects.toMatchObject({code:'23514'});
    await db.exec('rollback to savepoint noncanonical_direct_write;release savepoint noncanonical_direct_write');
    await authenticate(ids.otherTenant);
    await expect(asAuthenticated('select public.create_or_reactivate_cost_center_v1($1,$2)',[ids.tenant,'Pedágio'])).rejects.toMatchObject({code:'42501'});
    await authenticate();
  });

  it('enforces tenant-safe links and protects referenced centers from deletion',async()=>{
    const center=(await db.query<{id:string}>('select id from public.cost_centers where tenant_id=$1',[ids.tenant])).rows[0];
    await db.exec('savepoint cross_tenant_link');
    await expect(db.query('insert into public.finance_expense_items(tenant_id,cost_center_id) values($1,$2)',[ids.otherTenant,center.id])).rejects.toMatchObject({code:'23503'});
    await db.exec('rollback to savepoint cross_tenant_link;release savepoint cross_tenant_link');
    await db.query('insert into public.finance_expense_items(tenant_id,cost_center_id) values($1,$2)',[ids.tenant,center.id]);
    await expect(asAuthenticated('delete from public.cost_centers where tenant_id=$1 and id=$2',[ids.tenant,center.id])).rejects.toMatchObject({code:'23001'});
  });

  it('allows the same canonical name in a different tenant',async()=>{
    await authenticate(ids.otherTenant);
    const result=await asAuthenticated<{result:{status:string;tenant_id:string}}>(
      'select public.create_or_reactivate_cost_center_v1($1,$2) result',[ids.otherTenant,'operacional'],
    );
    expect(result.rows[0].result).toMatchObject({status:'created',tenant_id:ids.otherTenant});
  });

  it('fails closed before target DDL when an authorization dependency drifts',async()=>{
    await db.exec('savepoint dependency_drift');
    try{
      await db.exec(`
        create or replace function public.is_tenant_operator_or_admin(_tenant_id uuid)
        returns boolean language sql stable security definer set search_path=''
        as $$select true$$;
      `);
      await expect(db.exec(migration)).rejects.toMatchObject({
        code:'55000',
        message:'finance_cost_center_dependency_changed',
      });
    }finally{
      await db.exec('rollback to savepoint dependency_drift;release savepoint dependency_drift');
    }
  });
});
