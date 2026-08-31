-- Product decision: email/password is sufficient for every role.
-- Forward-only: preserve identity, tenant, role, RLS, grants, business
-- validation and idempotency checks. No user, factor, session or audit data
-- is deleted. Deploy together with the frontend and affected Edge Functions.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create or replace function public.get_user_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select membership.tenant_id
  from public.tenant_memberships membership
  where membership.user_id = auth.uid()
    and membership.active;
$function$;

create or replace function public.has_tenant_role(_tenant_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.tenant_memberships membership
    where membership.user_id = auth.uid()
      and membership.tenant_id = _tenant_id
      and membership.role = _role
      and membership.active
  );
$function$;

create or replace function public.is_tenant_member(_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.tenant_memberships membership
    where membership.user_id = auth.uid()
      and membership.tenant_id = _tenant_id
      and membership.active
  );
$function$;

create or replace function public.is_tenant_admin(_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.tenant_memberships membership
    where membership.user_id = auth.uid()
      and membership.tenant_id = _tenant_id
      and membership.role::text in ('owner', 'admin')
      and membership.active
  );
$function$;

create or replace function public.is_tenant_operator_or_admin(_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
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

create or replace function public.get_user_portal_tenants()
returns table(id uuid, name text, plan_key text, timezone text)
language sql
stable
security definer
set search_path = ''
as $function$
  select distinct tenant.id, tenant.name, tenant.plan_key, tenant.timezone
  from public.tenants tenant
  where tenant.id in (
    select membership.tenant_id
    from public.tenant_memberships membership
    where membership.user_id = auth.uid() and membership.active
    union
    select access.tenant_id
    from public.client_portal_access access
    where access.user_id = auth.uid() and access.active
  );
$function$;

create or replace function public.is_user_internal_role(_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select public.is_tenant_operator_or_admin(_tenant_id);
$function$;

create or replace function public.get_active_trips_live(_tenant_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $function$
declare _result jsonb; _tracking boolean; _read_at timestamptz := statement_timestamp();
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select exists(select 1 from public.tenant_feature_policy p where p.tenant_id=_tenant_id
      and p.feature_key='ssx_enabled' and p.enabled)
    and not exists(select 1 from public.tenant_feature_policy p where p.tenant_id=_tenant_id
      and p.feature_key='ssx_kill_switch' and p.enabled) into _tracking;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.trip_id),'[]'::jsonb) into _result
  from (
    select dt.id trip_id, dt.tenant_id, dt.status trip_status, dt.actual_start_at,
      coalesce(ld.items->0->>'code',dt.id::text) trip_code,
      dt.vehicle_id,v.plate vehicle_plate,v.nickname vehicle_name,
      dt.driver_id,d.name driver_name,d.phone driver_phone,
      _tracking tracking_enabled,
      case when pos.fresh then pl.lat end lat,case when pos.fresh then pl.lng end lng,
      case when pos.fresh then pl.speed end speed_kmh,case when pos.fresh then pl.heading end heading,
      case when dt.status not in ('in_transit','in_progress') then 'planned'
        when not _tracking then 'tracking_disabled'
        when not coalesce(pos.fresh,false) then 'no_signal'
        when tls.trip_id is null then 'unknown' else tls.state end state,
      case when dt.status not in ('in_transit','in_progress') or not _tracking then 'info'
        when not coalesce(pos.fresh,false) then 'danger'
        when tls.trip_id is null then 'info' else tls.severity end severity,
      case when dt.status not in ('in_transit','in_progress') then 'Viagem ainda não iniciada'
        when not _tracking then 'SSX desativado; dados operacionais disponíveis'
        when not coalesce(pos.fresh,false) then 'Sem posição recente válida'
        when tls.trip_id is null then 'Aguardando avaliação da posição atual' else tls.message end status_message,
      tr.geometry_geojson route_geometry_geojson,
      tls.distance_from_route_meters,tls.delay_minutes,tls.stopped_minutes,
      tls.average_speed_kmh,tls.eta_next_stop_at,
      pl.captured_at last_signal_at,
      case when pl.captured_at <= _read_at then extract(epoch from _read_at-pl.captured_at)::integer end last_signal_age_seconds,
      pl.captured_at position_captured_at,
      pending.items->0 next_stop, previous.items previous_stops,pending.items pending_stops,ld.items loads
    from public.dispatch_trips dt
    left join public.vehicles v on v.id=dt.vehicle_id and v.tenant_id=dt.tenant_id
    left join public.drivers d on d.id=dt.driver_id and d.tenant_id=dt.tenant_id
    left join public.positions_last pl on pl.vehicle_id=dt.vehicle_id and pl.tenant_id=dt.tenant_id and _tracking
    cross join lateral (select coalesce(_tracking and pl.captured_at between _read_at-interval '15 minutes' and _read_at
      and pl.lat between -90 and 90 and pl.lng between -180 and 180,false) fresh) pos
    left join public.trip_live_status tls on tls.trip_id=dt.id and tls.tenant_id=dt.tenant_id
      and tls.vehicle_id=dt.vehicle_id and pos.fresh and dt.status in ('in_transit','in_progress')
      and tls.last_signal_at=pl.captured_at and tls.updated_at>=pl.captured_at
      and tls.updated_at between _read_at-interval '15 minutes' and _read_at
      and tls.metadata->>'context_revision'=control_tower_private.context_revision(dt.tenant_id,dt.id)
    left join public.trip_routes tr on tr.trip_id=dt.id and tr.tenant_id=dt.tenant_id and tr.provider='osrm' and tr.plan_revision=control_tower_private.route_plan_revision(dt.tenant_id,dt.id)
    cross join lateral (
      select coalesce(jsonb_agg(to_jsonb(s) order by s.sequence,s.id),'[]'::jsonb) items from (
        select s.id,s.stop_order sequence,s.destination client_name,s.status,
          s.planned_arrival_at,s.actual_arrival_at,s.actual_departure_at,s.latitude,s.longitude
        from public.dispatch_stops s where s.dispatch_trip_id=dt.id and s.tenant_id=dt.tenant_id
          and not (s.status=any(public.stop_terminal_statuses()))
      ) s
    ) pending
    cross join lateral (
      select coalesce(jsonb_agg(to_jsonb(s) order by s.sequence,s.id),'[]'::jsonb) items from (
        select s.id,s.stop_order sequence,s.destination client_name,s.status,
          s.planned_arrival_at,s.actual_arrival_at,s.actual_departure_at,s.latitude,s.longitude
        from public.dispatch_stops s where s.dispatch_trip_id=dt.id and s.tenant_id=dt.tenant_id
          and s.status=any(public.stop_terminal_statuses())
      ) s
    ) previous
    cross join lateral (
      select coalesce(jsonb_agg(to_jsonb(l) order by l.code,l.id),'[]'::jsonb) items from (
        select lo.id,lo.load_number code,lo.total_weight_kg total_weight,lo.status,
          (select count(distinct li.fiscal_document_id) from public.load_items li
            where li.load_id=lo.id and li.tenant_id=dt.tenant_id) documents_count
        from public.loads lo where lo.tenant_id=dt.tenant_id and exists (
          select 1 from public.dispatch_trip_loads dtl where dtl.dispatch_trip_id=dt.id
            and dtl.tenant_id=dt.tenant_id and dtl.load_id=lo.id)
      ) l
    ) ld
    where dt.tenant_id=_tenant_id and dt.status in ('planned','loading','dispatched','in_progress','in_transit')
  ) t;
  return _result;
end;
$function$;

create or replace function driver_chat_private.can_read(_tenant uuid,_driver uuid,_recipient uuid) returns boolean
 language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from public.tenant_memberships m join public.drivers d on d.tenant_id=m.tenant_id
  where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and d.id=_driver and
   (m.role::text in('owner','admin','operator')
    or (m.role::text='driver' and d.active and d.user_id=auth.uid() and _recipient=auth.uid())));
$fn$;

create or replace function driver_chat_private.context(_tenant uuid,_driver uuid) returns jsonb
 language plpgsql stable security definer set search_path='' as $fn$
declare v_actor uuid:=auth.uid();v_role text;d public.drivers%rowtype;v_name text;v_revision text;v_recipient_active boolean;
begin
 select m.role::text into v_role from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=v_actor and m.active;
 select * into d from public.drivers where tenant_id=_tenant and id=_driver;
 if v_actor is null or v_role is null or d.id is null or not (v_role in('owner','admin','operator') or (v_role='driver' and d.user_id=v_actor and d.active)) then
  raise exception 'driver_chat_not_authorized' using errcode='42501';end if;

 if v_role='driver' then v_name:=d.name;else select full_name into v_name from public.profiles where id=v_actor;end if;
 v_name:=coalesce(nullif(btrim(v_name),''),case when v_role='driver' then 'Motorista' else 'Operação' end);
 v_recipient_active:=exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=d.user_id and m.active and m.role::text='driver');
 v_revision:=md5(jsonb_build_object('driver_id',d.id,'tenant_id',d.tenant_id,'driver_user',d.user_id,'active',d.active,'recipient_active',v_recipient_active,'role',v_role,'actor',v_actor,'sender_name',v_name)::text);
 return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',v_actor,'driver_id',_driver,'driver_name',d.name,
  'conversation_user_id',d.user_id,'sender_role',v_role,'sender_name',v_name,'can_send',coalesce(d.active and d.user_id is not null and v_recipient_active,false),'revision',v_revision);
end;$fn$;

create or replace function driver_chat_private.event_can_access(_tenant uuid,_event uuid) returns boolean
 language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from public.tenant_memberships m join public.operational_events e on e.tenant_id=m.tenant_id
  where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and e.id=_event and
   (m.role::text in('owner','admin','operator')
    or (m.role::text='driver' and exists(select 1 from public.drivers d where d.tenant_id=_tenant and d.id=(driver_chat_private.event_binding(_tenant,_event)->>'driver_id')::uuid and d.user_id=auth.uid() and d.active))));
$fn$;

create or replace function driver_chat_private.event_context(_tenant uuid,_event uuid) returns jsonb
 language plpgsql stable security definer set search_path='' as $fn$
declare v_actor uuid:=auth.uid();v_role text;v_binding jsonb;v_driver uuid;d public.drivers%rowtype;v_name text;v_recipient_active boolean;v_can_send boolean;
begin
 select role::text into v_role from public.tenant_memberships where tenant_id=_tenant and user_id=v_actor and active;
 if v_actor is null or v_role is null or not exists(select 1 from public.operational_events where tenant_id=_tenant and id=_event) then raise exception 'driver_chat_not_authorized' using errcode='42501';end if;

 if not driver_chat_private.event_can_access(_tenant,_event) then raise exception 'driver_chat_not_authorized' using errcode='42501';end if;
 v_binding:=driver_chat_private.event_binding(_tenant,_event);if v_binding is null then raise exception 'event_chat_invalid_binding' using errcode='23514';end if;
 v_driver:=(v_binding->>'driver_id')::uuid;select * into d from public.drivers where tenant_id=_tenant and id=v_driver;
 if v_role='driver' then v_name:=d.name;else select full_name into v_name from public.profiles where id=v_actor;end if;
 v_name:=coalesce(nullif(btrim(v_name),''),case when v_role='driver' then 'Motorista' else 'Operação' end);
 v_recipient_active:=exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=d.user_id and m.active and m.role::text='driver');
 v_can_send:=v_driver is null or coalesce(d.active and d.user_id is not null and v_recipient_active,false);
 return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',v_actor,'event_id',_event,'driver_id',v_driver,
  'driver_name',coalesce(d.name,'Sem motorista vinculado'),'conversation_user_id',d.user_id,'sender_role',v_role,'sender_name',v_name,
  'audience',case when v_driver is null then 'operation' else 'driver' end,'can_send',v_can_send,
  'revision',md5(jsonb_build_object('binding',v_binding,'driver_user',d.user_id,'active',d.active,'recipient_active',v_recipient_active,'role',v_role,'actor',v_actor,'sender_name',v_name)::text));
end;$fn$;

create or replace function expense_creation_private.require_session(_tenant uuid,_actor uuid) returns void
language plpgsql stable security invoker set search_path='' as $fn$
declare v_role text;
begin
 if auth.uid() is null or _actor is distinct from auth.uid() then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
 select role::text into v_role from public.tenant_memberships where tenant_id=_tenant and user_id=_actor and active;
 if v_role is null or v_role not in('owner','admin','operator','driver') then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;

end;$fn$;

create or replace function expense_creation_private.session_allowed(_tenant uuid) returns boolean
language sql stable security definer set search_path='' as $fn$
 select auth.uid() is not null and exists(select 1 from public.tenant_memberships m
  where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and m.role::text in('owner','admin','operator','driver'));
$fn$;

create or replace function settlement_adjustment_private.authorize(_tenant uuid) returns void
language plpgsql stable security invoker set search_path='' as $fn$
declare v_role text;
begin
 if auth.uid() is null then raise exception 'settlement_adjustment_not_authorized' using errcode='42501';end if;
 select role::text into v_role from public.tenant_memberships where tenant_id=_tenant and user_id=auth.uid() and active;
 if v_role is null or v_role not in('owner','admin','operator') then raise exception 'settlement_adjustment_not_authorized' using errcode='42501';end if;

end;$fn$;

create or replace function control_tower_private.assert_evaluator(_tenant_id uuid)
returns void language plpgsql volatile security invoker set search_path=''
as $function$
declare _role public.app_role;
begin
 if auth.uid() is null then raise exception 'Forbidden' using errcode='42501';end if;
 select m.role into _role from public.tenant_memberships m where m.tenant_id=_tenant_id and m.user_id=auth.uid() and m.active;
 if _role is null or _role not in ('owner','admin','operator') then raise exception 'Forbidden' using errcode='42501';end if;

 if not exists(select 1 from public.tenant_feature_policy p where p.tenant_id=_tenant_id and p.feature_key='ssx_enabled' and p.enabled)
   or exists(select 1 from public.tenant_feature_policy p where p.tenant_id=_tenant_id and p.feature_key='ssx_kill_switch' and p.enabled) then
   raise exception 'SSX disabled' using errcode='42501';
 end if;
end;
$function$;

create or replace function control_tower_private.assert_route_actor(_tenant_id uuid)
returns void language plpgsql volatile security invoker set search_path=''
as $function$
declare _role public.app_role;
begin
 if auth.uid() is null then raise exception 'Forbidden' using errcode='42501';end if;
 select role into _role from public.tenant_memberships where tenant_id=_tenant_id and user_id=auth.uid() and active;
 if _role is null or _role not in ('operator','owner','admin') then raise exception 'Forbidden' using errcode='42501';end if;

end;
$function$;

drop function if exists public.session_has_privileged_mfa_v1(uuid);
comment on function public.get_current_memberships_v1()
  is 'Returns the current user active memberships for authenticated tenant and role discovery.';

-- Keep metadata aligned with the current password-based authorization policy.
comment on function public.get_open_trip_alerts(uuid)
  is 'Control Tower: caller identity, active tenant membership and internal role; read-only.';
comment on function public.get_active_trips_live(uuid)
  is 'Control Tower: caller identity, active tenant membership and internal role; read-only live view.';

-- Refuse a partial removal if a later/custom application function still requires
-- a second factor. This check does not inspect or change Supabase Auth internals.
do $check$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'expense_creation_private', 'settlement_adjustment_private',
      'driver_chat_private', 'control_tower_private')
      and (p.prosrc ~* 'aal2' or p.prosrc like '%session_has_privileged_mfa_v1%')
  ) then
    raise exception 'An application function still requires MFA; review before releasing.';
  end if;
end;
$check$;
