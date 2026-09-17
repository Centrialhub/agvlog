import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

export async function runCostCenterNative({query,contested,literal:q}){
  const migration='supabase/migrations/20260915023321_finance_cost_center_canonical_identity.sql';
  const migrationSql=readFileSync(migration,'utf8');
  const migrationHash=createHash('sha256').update(migrationSql).digest('hex');
  const database='cost_center_qa';
  const tenant='10000000-0000-4000-8000-000000000001';
  const otherTenant='10000000-0000-4000-8000-000000000002';
  const actor='20000000-0000-4000-8000-000000000001';
  await query(`create database ${database}`);
  const run=sql=>query(sql,database);

  await run(`
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
    create table public.tenant_memberships(tenant_id uuid not null,user_id uuid not null,role text not null,active boolean not null,primary key(tenant_id,user_id));
    create table public.cost_centers(
      id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),name text not null,
      active boolean not null default true,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
      constraint cost_centers_tenant_id_name_key unique(tenant_id,name)
    );
    create table public.finance_expense_items(
      id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),cost_center_id uuid,
      constraint finance_expense_items_cost_center_id_fkey foreign key(cost_center_id) references public.cost_centers(id)
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
    create function public.is_tenant_operator_or_admin(_tenant_id uuid)
    returns boolean language sql stable security definer set search_path=''
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
    create function private.is_request_tenant_member(_tenant_id uuid) returns boolean language sql stable security definer set search_path=''
      as $$select private.request_tenant_id()=_tenant_id and exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant_id and m.user_id=auth.uid() and m.active)$$;
    alter table public.cost_centers enable row level security;
    create policy agvlog_active_tenant_context on public.cost_centers as restrictive for all to authenticated
      using(private.is_request_tenant_member(tenant_id)) with check(private.is_request_tenant_member(tenant_id));
    create policy agvlog_select_authenticated on public.cost_centers for select to authenticated using(public.is_tenant_operator_or_admin(tenant_id));
    create policy agvlog_insert_authenticated on public.cost_centers for insert to authenticated with check(public.is_tenant_operator_or_admin(tenant_id));
    create policy agvlog_update_authenticated on public.cost_centers for update to authenticated using(public.is_tenant_operator_or_admin(tenant_id)) with check(public.is_tenant_operator_or_admin(tenant_id));
    create policy agvlog_delete_authenticated on public.cost_centers for delete to authenticated using(public.is_tenant_operator_or_admin(tenant_id));
    grant usage on schema public,auth,private to authenticated,anon;
    grant execute on function auth.uid(),auth.jwt(),private.request_tenant_id(),private.is_request_tenant_member(uuid),public.is_tenant_operator_or_admin(uuid) to authenticated;
    grant select,insert,update,delete on public.cost_centers to authenticated;
    insert into public.tenants values(${q(tenant)}),(${q(otherTenant)});
    insert into public.tenant_memberships values(${q(tenant)},${q(actor)},'admin',true),(${q(otherTenant)},${q(actor)},'admin',true);
    begin;${migrationSql}commit;
  `);

  const auth=currentTenant=>`select set_config('request.jwt.claim.sub',${q(actor)},false);select set_config('request.headers',${q(JSON.stringify({'x-agvlog-tenant-id':currentTenant}))},false);set role authenticated;`;
  const call=(tenantId,name)=>`${auth(tenantId)}select public.create_or_reactivate_cost_center_v1(${q(tenantId)},${q(name)});`;
  let passed=0;
  const pass=label=>{console.log(`PASS ${label}`);passed++;};

  let result=await contested(call(tenant,'Operações'),call(tenant,'operações'),{database,driver:false});
  assert.match(result.output,/already_active/);
  assert.equal(await run(`select count(*) from public.cost_centers where tenant_id=${q(tenant)} and lower(private.normalize_cost_center_name(name))=lower('operações')`),'1');
  pass('concurrent canonical RPC calls serialize and preserve one row');

  result=await contested(
    `select pg_advisory_xact_lock(hashtextextended(${q(tenant+':cost-centers')},0))`,
    call(tenant,'Acesso revogado'),
    {database,driver:false,waiterSucceeds:false,holderAfterBlocked:`update public.tenant_memberships set active=false where tenant_id=${q(tenant)} and user_id=${q(actor)}`},
  );
  assert.match(result.error,/42501[\s\S]*finance_cost_center_not_authorized/);
  assert.equal(await run(`select count(*) from public.cost_centers where tenant_id=${q(tenant)} and name='Acesso revogado'`),'0');
  await run(`update public.tenant_memberships set active=true where tenant_id=${q(tenant)} and user_id=${q(actor)}`);
  pass('membership revoked during the lock wait prevents the write');

  result=await contested(
    `select pg_advisory_xact_lock(hashtextextended(${q(tenant+':cost-centers')},0))`,
    call(otherTenant,'Outro tenant'),
    {database,driver:false,waitForBlocking:false},
  );
  assert.match(result.output,/created/);
  pass('a tenant lock does not block another tenant');

  result=await contested(
    `insert into public.cost_centers(tenant_id,name) values(${q(tenant)},'Frota')`,
    `insert into public.cost_centers(tenant_id,name) values(${q(tenant)},'frota')`,
    {database,driver:false,waiterSucceeds:false},
  );
  assert.match(result.error,/23505/);
  assert.equal(await run(`select count(*) from public.cost_centers where tenant_id=${q(tenant)} and lower(name)='frota'`),'1');
  pass('the unique index rejects concurrent direct case variants');

  assert.equal(await run("select has_function_privilege('authenticated','public.create_or_reactivate_cost_center_v1(uuid,text)','execute')"),'t');
  assert.equal(await run("select has_function_privilege('anon','public.create_or_reactivate_cost_center_v1(uuid,text)','execute')"),'f');
  console.log(`CORE SHA256 ${migrationHash}`);
  return {passed,findings:0};
}
