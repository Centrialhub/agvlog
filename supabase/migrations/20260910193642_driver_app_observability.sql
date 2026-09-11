set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $preflight$
begin
  if pg_catalog.to_regprocedure('private.is_request_tenant_member(uuid)') is null
    or pg_catalog.to_regprocedure('public.has_tenant_role(uuid,public.app_role)') is null
    or pg_catalog.to_regprocedure('public.is_tenant_operator_or_admin(uuid)') is null
    or pg_catalog.to_regclass('public.ssx_position_quarantine') is null
    or pg_catalog.to_regclass('public.address_resolution_queue') is null then
    raise exception 'driver_app_observability_prerequisites_missing';
  end if;
end;
$preflight$;

create table public.driver_app_observability_snapshots (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  installation_id uuid not null,
  app_version text not null check(length(app_version) between 1 and 50),
  build_hash text not null check(build_hash ~ '^[a-f0-9]{16,64}$'),
  last_successful_sync_at timestamptz,
  outbox_total integer not null check(outbox_total between 0 and 999999),
  outbox_by_state jsonb not null check(jsonb_typeof(outbox_by_state)='object'),
  outbox_by_kind jsonb not null check(jsonb_typeof(outbox_by_kind)='object'),
  document_conflicts integer not null check(document_conflicts between 0 and 999999),
  upload_failures jsonb not null check(jsonb_typeof(upload_failures)='object'),
  geofence_errors jsonb not null check(jsonb_typeof(geofence_errors)='object'),
  seen_at timestamptz not null default clock_timestamp(),
  primary key(tenant_id,actor_id,installation_id)
);

comment on table public.driver_app_observability_snapshots is
  'Opt-in, aggregate-only device heartbeat. It must never contain files, document/delivery IDs, coordinates, free text, or raw errors.';
create index driver_app_observability_recent_idx
  on public.driver_app_observability_snapshots(tenant_id,seen_at desc);

alter table public.driver_app_observability_snapshots enable row level security;
revoke all on table public.driver_app_observability_snapshots from public,anon,authenticated,service_role;
grant select,insert,update,delete on table public.driver_app_observability_snapshots to service_role;

create policy driver_app_observability_self_read
on public.driver_app_observability_snapshots for select to authenticated
using(actor_id=auth.uid() and private.is_request_tenant_member(tenant_id));
create policy driver_app_observability_operational_read
on public.driver_app_observability_snapshots for select to authenticated
using(public.is_tenant_operator_or_admin(tenant_id) and private.is_request_tenant_member(tenant_id));

create or replace function private.driver_observability_valid_counts(_value jsonb,_allowed text[])
returns boolean language sql immutable security invoker set search_path=''
as $function$
  select jsonb_typeof(_value)='object'
    and not exists(
      select 1 from jsonb_each(_value) item
      where not(item.key=any(_allowed))
        or jsonb_typeof(item.value)<>'number'
        or not((item.value#>>'{}') ~ '^\d{1,6}$')
    )
$function$;
revoke all on function private.driver_observability_valid_counts(jsonb,text[]) from public,anon,authenticated,service_role;

create or replace function public.publish_driver_app_observability_v1(_payload jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_tenant uuid;v_installation uuid;v_app_version text;v_build_hash text;v_last_sync timestamptz;
  v_outbox jsonb;v_states jsonb;v_kinds jsonb;v_upload jsonb;v_upload_kinds jsonb;v_geofence jsonb;
  v_total integer;v_document_conflicts integer;v_upload_total integer;v_upload_items integer;
  v_normalized_states jsonb;v_normalized_kinds jsonb;v_normalized_upload_kinds jsonb;v_normalized_upload jsonb;v_normalized_geofence jsonb;
begin
  if auth.uid() is null or jsonb_typeof(_payload)<>'object' or (_payload->>'version')<>'1' then
    raise exception 'driver_observability_invalid_payload' using errcode='22023';
  end if;
  begin
    v_tenant:=(_payload->>'tenant_id')::uuid;v_installation:=(_payload->>'installation_id')::uuid;
  exception when invalid_text_representation then
    raise exception 'driver_observability_invalid_scope' using errcode='22023';
  end;
  if not private.is_request_tenant_member(v_tenant) or not public.has_tenant_role(v_tenant,'driver'::public.app_role) then
    raise exception 'driver_observability_not_authorized' using errcode='42501';
  end if;
  v_app_version:=btrim(_payload->>'app_version');v_build_hash:=lower(btrim(_payload->>'build_hash'));
  if length(v_app_version) not between 1 and 50 or v_build_hash!~'^[a-f0-9]{16,64}$' then
    raise exception 'driver_observability_invalid_build' using errcode='22023';
  end if;
  if nullif(_payload->>'last_successful_sync_at','') is not null then
    begin v_last_sync:=(_payload->>'last_successful_sync_at')::timestamptz;
    exception when invalid_datetime_format then raise exception 'driver_observability_invalid_sync_time' using errcode='22007';end;
    if v_last_sync>clock_timestamp()+interval '5 minutes' then
      raise exception 'driver_observability_future_sync_time' using errcode='22007';
    end if;
  end if;
  v_outbox:=_payload->'outbox';v_states:=v_outbox->'by_state';v_kinds:=v_outbox->'by_kind';
  -- Older installed PWAs do not have this optional aggregate yet. Normalize
  -- their heartbeat to zero so rollout order never blocks trip operations.
  v_upload:=coalesce(_payload->'upload_failures',jsonb_build_object('total',0,'affected_items',0,'by_kind','{}'::jsonb));
  v_upload_kinds:=v_upload->'by_kind';v_geofence:=_payload->'geofence_errors';
  if not private.driver_observability_valid_counts(v_states,array['queued','syncing','needs_attention'])
    or not private.driver_observability_valid_counts(v_kinds,array['delivery','expense','arrival','departure','journey','checklist','occurrence','cargo'])
    or not private.driver_observability_valid_counts(v_upload_kinds,array['delivery','expense','arrival','departure','journey','checklist','occurrence','cargo'])
    or not private.driver_observability_valid_counts(v_geofence,array['permission_denied','location_unavailable','low_accuracy','outside_geofence','server_rejection'])
    or coalesce(v_outbox->>'total','')!~'^\d{1,6}$'
    or coalesce(v_upload->>'total','')!~'^\d{1,6}$'
    or coalesce(v_upload->>'affected_items','')!~'^\d{1,6}$'
    or coalesce(_payload->>'document_conflicts','')!~'^\d{1,6}$' then
    raise exception 'driver_observability_invalid_counts' using errcode='22023';
  end if;
  v_total:=(v_outbox->>'total')::integer;v_document_conflicts:=(_payload->>'document_conflicts')::integer;
  v_upload_total:=(v_upload->>'total')::integer;v_upload_items:=(v_upload->>'affected_items')::integer;
  v_normalized_states:=jsonb_build_object('queued',coalesce((v_states->>'queued')::integer,0),'syncing',coalesce((v_states->>'syncing')::integer,0),
    'needs_attention',coalesce((v_states->>'needs_attention')::integer,0));
  v_normalized_kinds:=jsonb_build_object('delivery',coalesce((v_kinds->>'delivery')::integer,0),'expense',coalesce((v_kinds->>'expense')::integer,0),
    'arrival',coalesce((v_kinds->>'arrival')::integer,0),'departure',coalesce((v_kinds->>'departure')::integer,0),
    'journey',coalesce((v_kinds->>'journey')::integer,0),'checklist',coalesce((v_kinds->>'checklist')::integer,0),
    'occurrence',coalesce((v_kinds->>'occurrence')::integer,0),'cargo',coalesce((v_kinds->>'cargo')::integer,0));
  v_normalized_upload_kinds:=jsonb_build_object('delivery',coalesce((v_upload_kinds->>'delivery')::integer,0),'expense',coalesce((v_upload_kinds->>'expense')::integer,0),
    'arrival',coalesce((v_upload_kinds->>'arrival')::integer,0),'departure',coalesce((v_upload_kinds->>'departure')::integer,0),
    'journey',coalesce((v_upload_kinds->>'journey')::integer,0),'checklist',coalesce((v_upload_kinds->>'checklist')::integer,0),
    'occurrence',coalesce((v_upload_kinds->>'occurrence')::integer,0),'cargo',coalesce((v_upload_kinds->>'cargo')::integer,0));
  v_normalized_upload:=jsonb_build_object('total',v_upload_total,'affected_items',v_upload_items,'by_kind',v_normalized_upload_kinds);
  v_normalized_geofence:=jsonb_build_object('permission_denied',coalesce((v_geofence->>'permission_denied')::integer,0),
    'location_unavailable',coalesce((v_geofence->>'location_unavailable')::integer,0),'low_accuracy',coalesce((v_geofence->>'low_accuracy')::integer,0),
    'outside_geofence',coalesce((v_geofence->>'outside_geofence')::integer,0),'server_rejection',coalesce((v_geofence->>'server_rejection')::integer,0));
  if v_total<>(select sum(value::integer) from jsonb_each_text(v_normalized_states))
    or v_total<>(select sum(value::integer) from jsonb_each_text(v_normalized_kinds))
    or v_upload_total<>(select sum(value::integer) from jsonb_each_text(v_normalized_upload_kinds))
    or v_upload_items>v_total or v_document_conflicts>v_total then
    raise exception 'driver_observability_inconsistent_counts' using errcode='22023';
  end if;

  insert into public.driver_app_observability_snapshots(tenant_id,actor_id,installation_id,app_version,build_hash,
    last_successful_sync_at,outbox_total,outbox_by_state,outbox_by_kind,document_conflicts,upload_failures,geofence_errors,seen_at)
  values(v_tenant,auth.uid(),v_installation,v_app_version,v_build_hash,v_last_sync,v_total,v_normalized_states,
    v_normalized_kinds,v_document_conflicts,v_normalized_upload,v_normalized_geofence,clock_timestamp())
  on conflict(tenant_id,actor_id,installation_id) do update set app_version=excluded.app_version,build_hash=excluded.build_hash,
    last_successful_sync_at=excluded.last_successful_sync_at,outbox_total=excluded.outbox_total,
    outbox_by_state=excluded.outbox_by_state,outbox_by_kind=excluded.outbox_by_kind,
    document_conflicts=excluded.document_conflicts,upload_failures=excluded.upload_failures,
    geofence_errors=excluded.geofence_errors,seen_at=excluded.seen_at;
  delete from public.driver_app_observability_snapshots where tenant_id=v_tenant and actor_id=auth.uid()
    and seen_at<clock_timestamp()-interval '30 days';
  return jsonb_build_object('version',1,'accepted',true,'seen_at',clock_timestamp());
end;
$function$;
revoke all on function public.publish_driver_app_observability_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.publish_driver_app_observability_v1(jsonb) to authenticated;

create or replace function public.disable_driver_app_observability_v1(_tenant_id uuid,_installation_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_removed integer;
begin
  if auth.uid() is null or not private.is_request_tenant_member(_tenant_id) then
    raise exception 'driver_observability_not_authorized' using errcode='42501';
  end if;
  delete from public.driver_app_observability_snapshots where tenant_id=_tenant_id and actor_id=auth.uid() and installation_id=_installation_id;
  get diagnostics v_removed=row_count;
  return jsonb_build_object('version',1,'removed',v_removed);
end;
$function$;
revoke all on function public.disable_driver_app_observability_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.disable_driver_app_observability_v1(uuid,uuid) to authenticated;

create or replace function public.get_driver_app_observability_v1(_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_devices jsonb;v_total integer;v_active integer;v_errors jsonb;
begin
  if auth.uid() is null or not private.is_request_tenant_member(_tenant_id) or not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'driver_observability_not_authorized' using errcode='42501';
  end if;
  select count(*),count(*) filter(where seen_at>=clock_timestamp()-interval '24 hours') into v_total,v_active
  from public.driver_app_observability_snapshots where tenant_id=_tenant_id and seen_at>=clock_timestamp()-interval '30 days';
  select coalesce(jsonb_agg(jsonb_build_object('installation_code',left(installation_id::text,8),'actor_code',left(actor_id::text,8),
    'app_version',app_version,'build_hash',build_hash,'last_successful_sync_at',last_successful_sync_at,
    'outbox',jsonb_build_object('total',outbox_total,'by_state',outbox_by_state,'by_kind',outbox_by_kind),
    'document_conflicts',document_conflicts,'upload_failures',upload_failures,
    'geofence_errors',geofence_errors,'seen_at',seen_at) order by seen_at desc),'[]'::jsonb)
  into v_devices from (select * from public.driver_app_observability_snapshots where tenant_id=_tenant_id
    and seen_at>=clock_timestamp()-interval '30 days' order by seen_at desc limit 200) recent;
  select jsonb_build_object(
    'invalid_position',coalesce((select sum(occurrence_count) from public.ssx_position_quarantine where tenant_id=_tenant_id and status='open'
      and reason in('invalid_gps','invalid_coordinates') and last_seen_at>=clock_timestamp()-interval '7 days'),0),
    'tracker_identity',coalesce((select sum(occurrence_count) from public.ssx_position_quarantine where tenant_id=_tenant_id and status='open'
      and reason in('missing_identity','unmatched_unit','ambiguous_unit','unsupported_unit_type') and last_seen_at>=clock_timestamp()-interval '7 days'),0),
    'temporal_binding',coalesce((select sum(occurrence_count) from public.ssx_position_quarantine where tenant_id=_tenant_id and status='open'
      and reason in('invalid_timestamp','outside_binding_window') and last_seen_at>=clock_timestamp()-interval '7 days'),0),
    'address_resolution',(select count(*) from public.address_resolution_queue where tenant_id=_tenant_id and status in('ambiguous','error')),
    'processing',(select count(*) from public.vehicle_processing_queue where tenant_id=_tenant_id and last_error is not null and processed_at is null)
  ) into v_errors;
  return jsonb_build_object('version',1,'generated_at',clock_timestamp(),'total_devices',v_total,'active_24h',v_active,
    'geofence_errors',v_errors,'devices',v_devices);
end;
$function$;
revoke all on function public.get_driver_app_observability_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_driver_app_observability_v1(uuid) to authenticated;

do $postcondition$
begin
  if not (select relrowsecurity from pg_class where oid='public.driver_app_observability_snapshots'::regclass)
    or pg_catalog.has_table_privilege('authenticated','public.driver_app_observability_snapshots','select')
    or pg_catalog.has_function_privilege('anon','public.publish_driver_app_observability_v1(jsonb)','execute')
    or not pg_catalog.has_function_privilege('authenticated','public.get_driver_app_observability_v1(uuid)','execute') then
    raise exception 'driver_app_observability_postcondition_failed';
  end if;
end;
$postcondition$;
