set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $preflight$
begin
  if to_regclass('public.geofences') is null
    or to_regclass('public.canonical_addresses') is null
    or to_regclass('public.address_resolution_queue') is null
    or to_regprocedure('public.ack_address_resolution_queue_item_v2(jsonb)') is null
    or to_regprocedure('public.upsert_geofence_v4(jsonb)') is null then
    raise exception 'finalize_geofence_automation_prerequisites_missing';
  end if;
end;
$preflight$;

alter table public.geofences
  add column if not exists auto_sync_address boolean not null default false;

alter table public.geofences
  drop constraint if exists geofences_auto_sync_address_check,
  add constraint geofences_auto_sync_address_check check (
    not auto_sync_address or (
      scope_kind='fleet' and category='client' and client_id is not null
      and dispatch_stop_id is null and shape_kind='circle'
    )
  );

create index if not exists idx_geofences_auto_client_address
  on public.geofences(tenant_id,client_id,canonical_address_id)
  where auto_sync_address and scope_kind='fleet';

create or replace function private.sync_fleet_geofences_for_canonical_v1(
  _tenant_id uuid,
  _canonical_address_id uuid
) returns integer
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_address public.canonical_addresses%rowtype;
  v_updated integer:=0;
begin
  select * into v_address
  from public.canonical_addresses
  where tenant_id=_tenant_id and id=_canonical_address_id;
  if not found then return 0; end if;

  if v_address.status='verified' and v_address.latitude is not null and v_address.longitude is not null then
    update public.geofences g set
      source_kind='address_geocoded',
      source_address=v_address.normalized_address,
      center_lat=v_address.latitude,
      center_lng=v_address.longitude,
      geometry=extensions.st_buffer(
        extensions.st_setsrid(extensions.st_makepoint(v_address.longitude,v_address.latitude),4326)::extensions.geography,
        g.radius_m
      )::extensions.geometry,
      location_provider=v_address.provider,
      location_accuracy_m=v_address.accuracy_m,
      location_confidence=v_address.confidence,
      location_resolved_at=coalesce(v_address.resolved_at,clock_timestamp()),
      location_resolved_by=v_address.resolved_by,
      location_audit=coalesce(g.location_audit,'{}'::jsonb)||jsonb_build_object(
        'automatic_client_address_sync',true,
        'canonical_address_id',v_address.id,
        'canonical_address_hash',v_address.address_hash,
        'synced_at',clock_timestamp()
      )
    where g.tenant_id=_tenant_id and g.canonical_address_id=_canonical_address_id
      and g.scope_kind='fleet' and g.auto_sync_address and g.shape_kind='circle' and g.radius_m is not null;
  else
    update public.geofences g set
      source_kind='legacy_coordinates',
      source_address=v_address.normalized_address,
      center_lat=null,
      center_lng=null,
      geometry=null,
      location_provider=null,
      location_accuracy_m=null,
      location_confidence=null,
      location_resolved_at=null,
      location_resolved_by=null,
      location_audit=coalesce(g.location_audit,'{}'::jsonb)||jsonb_build_object(
        'automatic_client_address_sync',true,
        'canonical_address_id',v_address.id,
        'canonical_address_hash',v_address.address_hash,
        'sync_pending_since',clock_timestamp()
      )
    where g.tenant_id=_tenant_id and g.canonical_address_id=_canonical_address_id
      and g.scope_kind='fleet' and g.auto_sync_address;
  end if;
  get diagnostics v_updated=row_count;
  return v_updated;
end;
$function$;
revoke all on function private.sync_fleet_geofences_for_canonical_v1(uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function private.sync_fleet_geofences_from_canonical_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  perform private.sync_fleet_geofences_for_canonical_v1(new.tenant_id,new.id);
  return new;
end;
$function$;
revoke all on function private.sync_fleet_geofences_from_canonical_v1()
  from public,anon,authenticated,service_role;
drop trigger if exists sync_fleet_geofences_from_canonical on public.canonical_addresses;
create trigger sync_fleet_geofences_from_canonical
  after update of status,latitude,longitude,provider,accuracy_m,confidence,resolved_at,resolved_by
  on public.canonical_addresses for each row
  when (
    old.status is distinct from new.status
    or old.latitude is distinct from new.latitude
    or old.longitude is distinct from new.longitude
    or old.provider is distinct from new.provider
    or old.accuracy_m is distinct from new.accuracy_m
    or old.confidence is distinct from new.confidence
  )
  execute function private.sync_fleet_geofences_from_canonical_v1();

create or replace function private.sync_client_fleet_geofences_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare v_address public.canonical_addresses%rowtype;
begin
  if new.canonical_address_id is null then return new; end if;
  select * into v_address from public.canonical_addresses
    where tenant_id=new.tenant_id and id=new.canonical_address_id;
  if not found then return new; end if;
  update public.geofences set canonical_address_id=v_address.id,source_address=v_address.normalized_address
  where tenant_id=new.tenant_id and client_id=new.id and scope_kind='fleet' and auto_sync_address
    and canonical_address_id is distinct from v_address.id;
  perform private.sync_fleet_geofences_for_canonical_v1(new.tenant_id,v_address.id);
  return new;
end;
$function$;
revoke all on function private.sync_client_fleet_geofences_v1()
  from public,anon,authenticated,service_role;
drop trigger if exists sync_client_fleet_geofences on public.clients;
create trigger sync_client_fleet_geofences
  after insert or update of canonical_address_id,address_geocode_status,address_lat,address_lng,
    address_geocode_provider,address_geocode_accuracy_m,address_geocode_confidence
  on public.clients for each row
  execute function private.sync_client_fleet_geofences_v1();

create or replace function private.upsert_geofence_v4(_payload jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid;
  v_request uuid:=nullif(_payload->>'request_id','')::uuid;
  v_actor uuid:=auth.uid();
  v_hash text;
  v_id uuid:=nullif(_payload->>'id','')::uuid;
  v_client uuid:=nullif(_payload->>'client_id','')::uuid;
  v_auto boolean:=coalesce(nullif(_payload->>'auto_sync_address','')::boolean,false);
  v_existing public.operator_command_ledger%rowtype;
  v_address public.canonical_addresses%rowtype;
  v_effective jsonb:=_payload-'request_id';
  v_result jsonb;
begin
  if v_actor is null or v_tenant is null or v_request is null
    or private.request_tenant_id() is distinct from v_tenant or not private.is_request_tenant_member(v_tenant)
    or not coalesce(public.is_tenant_admin(v_tenant),false) then
    raise exception 'not_authorized' using errcode='42501';end if;
  if v_auto and (coalesce(_payload->>'category','')<>'client' or v_client is null) then
    raise exception 'automatic_geofence_requires_client' using errcode='22023';end if;
  v_hash:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('operator_command:'||v_tenant::text||':'||v_request::text,0));
  if auth.uid() is distinct from v_actor or v_actor is null
    or private.request_tenant_id() is distinct from v_tenant
    or not private.is_request_tenant_member(v_tenant)
    or not coalesce(public.is_tenant_admin(v_tenant),false) then
    raise exception 'not_authorized' using errcode='42501';end if;
  select * into v_existing from public.operator_command_ledger where tenant_id=v_tenant and request_id=v_request;
  if found then
    if v_existing.actor_id<>v_actor or v_existing.action<>'upsert_geofence' or v_existing.payload_hash<>v_hash then
      raise exception 'operator_request_conflict' using errcode='23505';end if;
    return v_existing.response;
  end if;

  if v_auto then
    select a.* into v_address from public.clients c
    join public.canonical_addresses a on a.tenant_id=c.tenant_id and a.id=c.canonical_address_id
    where c.tenant_id=v_tenant and c.id=v_client and c.active
      and a.status='verified' and a.latitude is not null and a.longitude is not null;
    if not found then raise exception 'client_address_not_verified' using errcode='23514';end if;
    v_effective:=v_effective||jsonb_build_object(
      'scope_kind','fleet','shape_kind','circle','source_kind','address_geocoded',
      'source_address',v_address.normalized_address,'center_lat',v_address.latitude,
      'center_lng',v_address.longitude,'location_provider',v_address.provider,
      'location_accuracy_m',v_address.accuracy_m,'location_confidence',v_address.confidence,
      'location_audit',coalesce(_payload->'location_audit','{}'::jsonb)||jsonb_build_object(
        'automatic_client_address_sync',true,'canonical_address_id',v_address.id,
        'canonical_address_hash',v_address.address_hash
      )
    );
  end if;

  v_id:=public.upsert_geofence_v3(v_effective);
  update public.geofences g set
    client_id=case when g.category='client' then v_client else null end,
    auto_sync_address=v_auto,
    canonical_address_id=case
      when v_auto then v_address.id
      when g.category='client' and v_client is not null then
        (select c.canonical_address_id from public.clients c where c.tenant_id=v_tenant and c.id=v_client)
      else private.ensure_canonical_address_v1(v_tenant,g.source_address)
    end
  where g.tenant_id=v_tenant and g.id=v_id;
  if not found then raise exception 'geofence_not_found' using errcode='P0002';end if;
  if v_auto then perform private.sync_fleet_geofences_for_canonical_v1(v_tenant,v_address.id);end if;
  v_result:=jsonb_build_object('ok',true,'idempotent',false,'request_id',v_request,'geofence_id',v_id,
    'auto_sync_address',v_auto);
  if auth.uid() is distinct from v_actor or v_actor is null
    or private.request_tenant_id() is distinct from v_tenant
    or not private.is_request_tenant_member(v_tenant)
    or not coalesce(public.is_tenant_admin(v_tenant),false) then
    raise exception 'not_authorized' using errcode='42501';end if;
  insert into public.operator_command_ledger(tenant_id,request_id,actor_id,action,entity_type,entity_id,payload_hash,response)
    values(v_tenant,v_request,v_actor,'upsert_geofence','geofence',v_id,v_hash,v_result);
  return v_result;
end;
$function$;
revoke all on function private.upsert_geofence_v4(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.upsert_geofence_v4(jsonb) to authenticated;

create or replace function public.ack_address_resolution_queue_item_v2(_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $function$
declare
  v_id uuid:=nullif(_payload->>'queue_id','')::uuid;
  v_token uuid:=nullif(_payload->>'lease_token','')::uuid;
  v_request text:=nullif(_payload->>'request_key','');
  v_hash text:=nullif(_payload->>'address_hash','');
  v_candidates jsonb:=_payload->'candidates';
  v_candidate jsonb;
  v_item public.address_resolution_queue%rowtype;
  v_error text:=nullif(left(btrim(_payload->>'error'),300),'');
  v_count integer:=0;
  v_retry_ms integer:=greatest(0,least(coalesce(nullif(_payload->>'retry_after_ms','')::integer,0),3600000));
  v_status text;
  v_now timestamptz:=clock_timestamp();
  v_lat double precision;
  v_lng double precision;
  v_provider text;
  v_accuracy double precision;
  v_confidence double precision;
  v_auto_resolve boolean:=false;
begin
  if current_user not in ('service_role','postgres') then raise exception 'not_authorized' using errcode='42501';end if;
  if v_id is null or v_token is null or v_request is null or length(v_request)>500 or v_hash is null then
    raise exception 'invalid_address_queue_ack' using errcode='22023';end if;
  select * into v_item from public.address_resolution_queue where id=v_id for update;
  if not found then raise exception 'address_queue_item_not_found' using errcode='P0002';end if;
  if v_item.address_hash is distinct from v_hash then raise exception 'address_queue_hash_changed' using errcode='40001';end if;
  if v_item.last_worker_request_key=v_request then
    return jsonb_build_object('ok',true,'idempotent',true,'queue_id',v_id,'status',v_item.status);
  end if;
  if v_item.lease_token is distinct from v_token or v_item.lease_expires_at<=v_now then
    raise exception 'address_queue_lease_lost' using errcode='40001';end if;
  if v_candidates is not null and jsonb_typeof(v_candidates)<>'array' then
    raise exception 'invalid_geocoding_candidates' using errcode='22023';end if;
  if v_candidates is not null then v_count:=jsonb_array_length(v_candidates);end if;
  if v_count>5 then raise exception 'too_many_geocoding_candidates' using errcode='22023';end if;

  if v_count=1 then
    v_candidate:=v_candidates->0;
    begin
      v_lat:=nullif(v_candidate->>'latitude','')::double precision;
      v_lng:=nullif(v_candidate->>'longitude','')::double precision;
      v_provider:=nullif(left(btrim(v_candidate->>'provider'),100),'');
      v_accuracy:=nullif(v_candidate->>'accuracy_m','')::double precision;
      v_confidence:=nullif(v_candidate->>'confidence','')::double precision;
      v_auto_resolve:=v_lat between -90 and 90 and v_lng between -180 and 180
        and v_provider is not null and coalesce(v_confidence,0)>=0.4 and coalesce(v_accuracy,100000)<=250;
    exception when invalid_text_representation or numeric_value_out_of_range then
      v_auto_resolve:=false;
    end;
  end if;

  if v_auto_resolve then
    perform pg_advisory_xact_lock(hashtextextended('canonical_address:'||v_item.tenant_id::text||':'||v_item.canonical_address_id::text,0));
    update public.canonical_addresses set status='verified',latitude=v_lat,longitude=v_lng,provider=v_provider,
      accuracy_m=v_accuracy,confidence=v_confidence,resolved_at=v_now,resolved_by=null,updated_at=v_now
    where tenant_id=v_item.tenant_id and id=v_item.canonical_address_id and address_hash=v_item.address_hash;
    if not found then raise exception 'address_changed_during_resolution' using errcode='40001';end if;
    update public.clients set address_lat=v_lat,address_lng=v_lng,address_geocode_status='verified',
      address_geocode_provider=v_provider,address_geocode_accuracy_m=v_accuracy,address_geocode_confidence=v_confidence,
      address_geocoded_at=v_now,address_geocoded_by=null,address_geocode_hash=v_item.address_hash,
      address_geocode_audit=coalesce(address_geocode_audit,'{}'::jsonb)||jsonb_build_object(
        'selection','automatic_unique_candidate','queue_id',v_id,'selected_label',left(v_candidate->>'label',500))
    where tenant_id=v_item.tenant_id and canonical_address_id=v_item.canonical_address_id;
    update public.dispatch_stops set latitude=v_lat,longitude=v_lng,location_source='address_geocoded',
      location_address=(select normalized_address from public.canonical_addresses where id=v_item.canonical_address_id),
      location_provider=v_provider,location_accuracy_m=v_accuracy,location_confidence=v_confidence,
      location_resolved_at=v_now,location_resolved_by=null,location_verification_status='verified',
      location_invalidated_at=null,location_audit=coalesce(location_audit,'{}'::jsonb)||jsonb_build_object(
        'selection','automatic_unique_candidate','queue_id',v_id,'selected_label',left(v_candidate->>'label',500))
    where tenant_id=v_item.tenant_id and canonical_address_id=v_item.canonical_address_id
      and location_source<>'map_selected' and not(status=any(public.stop_terminal_statuses()));
    update public.address_resolution_queue set status='resolved',candidates=v_candidates,attempts=attempts+1,
      last_error=null,resolved_lat=v_lat,resolved_lng=v_lng,resolved_provider=v_provider,
      resolved_accuracy_m=v_accuracy,resolved_confidence=v_confidence,resolved_at=v_now,resolved_by=null,
      processed_at=coalesce(processed_at,v_now),lease_token=null,lease_expires_at=null,
      last_worker_request_key=case when id=v_id then v_request else last_worker_request_key end,
      resolution_kind='auto_candidates',resolution_details=jsonb_build_object(
        'cache',_payload->>'cache','candidate_count',1,'selection','automatic_unique_candidate',
        'selected_label',left(v_candidate->>'label',500)),updated_at=v_now
    where tenant_id=v_item.tenant_id and canonical_address_id=v_item.canonical_address_id
      and status in ('pending','ambiguous','error');
    perform private.sync_fleet_geofences_for_canonical_v1(v_item.tenant_id,v_item.canonical_address_id);
    return jsonb_build_object('ok',true,'idempotent',false,'queue_id',v_id,'status','resolved',
      'candidate_count',1,'automatic',true);
  end if;

  v_status:=case when v_error is not null or v_count=0 then 'error' else 'ambiguous' end;
  update public.address_resolution_queue set status=v_status,candidates=coalesce(v_candidates,'[]'::jsonb),
    attempts=attempts+1,last_error=case when v_status='error' then coalesce(v_error,'no_candidates') else null end,
    processed_at=case when v_status='error' then null else v_now end,
    next_attempt_at=case when v_status='error' then v_now+make_interval(secs=>greatest(
      ceil(v_retry_ms/1000.0)::integer,least(3600,(power(2,least(attempts+1,6))*60)::integer))) else v_now end,
    lease_token=null,lease_expires_at=null,last_worker_request_key=v_request,resolution_kind='auto_candidates',
    resolution_details=jsonb_build_object('cache',_payload->>'cache','candidate_count',v_count,
      'automatic',false,'review_reason',case when v_count=1 then 'low_confidence' else 'multiple_candidates' end),
    updated_at=v_now
  where id=v_id;
  update public.clients set address_geocode_status=v_status
    where tenant_id=v_item.tenant_id and id=v_item.entity_id and address_geocode_hash=v_item.address_hash;
  update public.canonical_addresses set status=v_status,updated_at=v_now
    where tenant_id=v_item.tenant_id and id=v_item.canonical_address_id and status<>'verified' and v_status='ambiguous';
  return jsonb_build_object('ok',true,'idempotent',false,'queue_id',v_id,'status',v_status,
    'candidate_count',v_count,'automatic',false);
end;
$function$;
revoke all on function public.ack_address_resolution_queue_item_v2(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.ack_address_resolution_queue_item_v2(jsonb) to service_role;

-- The former tenant scheduler was intentionally removed when the SSX dispatcher
-- became autonomous. Address resolution now has its own independent worker.
do $schedule$
declare v_job_id bigint;
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null
    or to_regprocedure('cron.unschedule(bigint)') is null
    or to_regclass('cron.job') is null then
    raise notice 'Address resolution worker requires pg_cron.';
    return;
  end if;
  if not exists(select 1 from vault.secrets where name in ('project_url','agvlog_project_url'))
    or not exists(select 1 from vault.secrets where name='agvlog_cron_secret') then
    raise notice 'Address resolution worker requires project_url and agvlog_cron_secret Vault entries.';
    return;
  end if;
  for v_job_id in select jobid from cron.job where jobname='address-resolution-queue-every-minute' loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule(
    'address-resolution-queue-every-minute',
    '* * * * *',
    $job$
      select net.http_post(
        url := rtrim((select decrypted_secret from vault.decrypted_secrets
          where name in ('project_url','agvlog_project_url') order by (name='project_url') desc limit 1),'/')
          || '/functions/v1/process-address-resolution-queue',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-agvlog-cron-secret',(select decrypted_secret from vault.decrypted_secrets
            where name='agvlog_cron_secret' limit 1)
        ),
        body := jsonb_build_object('limit',5),
        timeout_milliseconds := 55000
      ) as request_id;
    $job$
  );
end;
$schedule$;

do $postcondition$
begin
  if not exists(select 1 from information_schema.columns where table_schema='public'
      and table_name='geofences' and column_name='auto_sync_address' and is_nullable='NO')
    or to_regprocedure('private.sync_fleet_geofences_for_canonical_v1(uuid,uuid)') is null
    or to_regprocedure('public.ack_address_resolution_queue_item_v2(jsonb)') is null
    or not exists(select 1 from pg_trigger where tgrelid='public.canonical_addresses'::regclass
      and tgname='sync_fleet_geofences_from_canonical' and not tgisinternal)
    or not exists(select 1 from pg_trigger where tgrelid='public.clients'::regclass
      and tgname='sync_client_fleet_geofences' and not tgisinternal)
    or has_function_privilege('authenticated','private.sync_fleet_geofences_for_canonical_v1(uuid,uuid)','execute') then
    raise exception 'finalize_geofence_automation_postcondition_failed';
  end if;
end;
$postcondition$;
