set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $preflight$
begin
  if to_regclass('public.geofences') is null
    or to_regclass('public.geofence_radius_policies') is null
    or to_regprocedure('public.upsert_geofence_v2(jsonb)') is null
    or to_regprocedure('public.upsert_geofence_v3(jsonb)') is null then
    raise exception 'harden_fleet_geofence_editing_prerequisites_missing';
  end if;
end;
$preflight$;

create or replace function private.protect_automatic_delivery_geofence()
returns trigger language plpgsql security invoker set search_path=''
as $function$
begin
  if current_user in ('service_role','postgres') then
    if tg_op='DELETE' then return old;end if;
    return new;
  end if;
  if tg_op='DELETE' then
    if old.scope_kind='delivery' or old.dispatch_stop_id is not null then
      raise exception 'delivery_geofences_are_read_only' using errcode='42501';
    end if;
    return old;
  end if;
  if tg_op='UPDATE' and (old.scope_kind='delivery' or old.dispatch_stop_id is not null) then
    raise exception 'delivery_geofences_are_read_only' using errcode='42501';
  end if;
  if new.scope_kind<>'fleet' or new.dispatch_stop_id is not null then
    raise exception 'delivery_geofences_are_generated_from_dispatch_stops' using errcode='22023';
  end if;
  return new;
end;
$function$;
revoke all on function private.protect_automatic_delivery_geofence() from public,anon,authenticated,service_role;

drop trigger if exists protect_automatic_delivery_geofence on public.geofences;
create trigger protect_automatic_delivery_geofence
  before insert or update or delete on public.geofences
  for each row execute function private.protect_automatic_delivery_geofence();

create or replace function public.upsert_geofence_v3(_payload jsonb)
returns uuid language plpgsql security invoker set search_path=''
as $function$
declare
  v_id uuid:=nullif(_payload->>'id','')::uuid;
  v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid;
  v_scope text:=coalesce(nullif(_payload->>'scope_kind',''),'fleet');
  v_category text:=coalesce(nullif(_payload->>'category',''),'general');
  v_existing_scope text;
  v_existing_stop uuid;
  v_policy public.geofence_radius_policies%rowtype;
  v_effective jsonb;
begin
  if jsonb_typeof(_payload) is distinct from 'object' or auth.uid() is null or v_tenant is null
    or not coalesce(public.is_tenant_admin(v_tenant),false) then
    raise exception 'not_authorized' using errcode='42501';
  end if;
  if v_scope<>'fleet' then
    raise exception 'delivery_geofences_are_generated_from_dispatch_stops' using errcode='22023';
  end if;
  if v_id is not null then
    select g.scope_kind,g.dispatch_stop_id into v_existing_scope,v_existing_stop
    from public.geofences g where g.id=v_id and g.tenant_id=v_tenant for update;
    if not found then raise exception 'geofence_not_found' using errcode='P0002';end if;
    if v_existing_scope<>'fleet' or v_existing_stop is not null then
      raise exception 'delivery_geofences_are_read_only' using errcode='42501';
    end if;
  end if;
  select * into v_policy from public.geofence_radius_policies
    where tenant_id=v_tenant and scope_kind='fleet' and category=v_category;
  if not found then
    select * into v_policy from public.geofence_radius_policies
      where tenant_id=v_tenant and scope_kind='fleet' and category='general';
  end if;
  v_effective:=_payload||jsonb_build_object(
    'radius_m',coalesce(nullif(_payload->>'radius_m','')::double precision,v_policy.radius_m,300),
    'enter_margin_m',coalesce(nullif(_payload->>'enter_margin_m','')::double precision,v_policy.enter_margin_m,0),
    'exit_margin_m',coalesce(nullif(_payload->>'exit_margin_m','')::double precision,v_policy.exit_margin_m,30),
    'transition_confirmations',coalesce(nullif(_payload->>'transition_confirmations','')::integer,v_policy.transition_confirmations,2),
    'scope_kind','fleet'
  );
  v_id:=public.upsert_geofence_v2(v_effective);
  update public.geofences set scope_kind='fleet',dispatch_stop_id=null,
    radius_policy_key='fleet:'||v_category where id=v_id and tenant_id=v_tenant;
  return v_id;
end;
$function$;
revoke all on function public.upsert_geofence_v3(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.upsert_geofence_v3(jsonb) to authenticated;

do $postcondition$
begin
  if not exists(select 1 from pg_trigger where tgname='protect_automatic_delivery_geofence' and not tgisinternal)
    or not has_function_privilege('authenticated','public.upsert_geofence_v3(jsonb)','execute')
    or has_function_privilege('anon','public.upsert_geofence_v3(jsonb)','execute') then
    raise exception 'harden_fleet_geofence_editing_postcondition_failed';
  end if;
end;
$postcondition$;
