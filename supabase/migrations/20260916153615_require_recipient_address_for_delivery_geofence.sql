set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function private.bind_dispatch_stop_canonical_address_v1()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare
  v_address text;
  v_canonical public.canonical_addresses%rowtype;
  v_client public.clients%rowtype;
begin
  v_address:=private.normalized_address_text(nullif(new.location_address,''));
  if length(v_address) between 8 and 1000 then
    new.canonical_address_id:=private.ensure_canonical_address_v1(new.tenant_id,v_address);
  elsif new.client_id is not null then
    select * into v_client from public.clients
      where tenant_id=new.tenant_id and id=new.client_id;
    if not found then raise exception 'dispatch_stop_client_tenant_mismatch' using errcode='23514';end if;
    new.canonical_address_id:=v_client.canonical_address_id;
  else
    -- destination is an operational label and may represent many recipients;
    -- it is never an address source of truth.
    new.canonical_address_id:=null;
  end if;

  if new.canonical_address_id is not null and new.location_source='address_geocoded'
    and new.latitude between -90 and 90 and new.longitude between -180 and 180 then
    update public.canonical_addresses set status='verified',latitude=new.latitude,longitude=new.longitude,
      provider=new.location_provider,accuracy_m=new.location_accuracy_m,confidence=new.location_confidence,
      resolved_at=coalesce(new.location_resolved_at,clock_timestamp()),resolved_by=new.location_resolved_by,
      updated_at=clock_timestamp()
    where tenant_id=new.tenant_id and id=new.canonical_address_id;
  elsif new.canonical_address_id is not null and new.location_source<>'map_selected' then
    select * into v_canonical from public.canonical_addresses
      where tenant_id=new.tenant_id and id=new.canonical_address_id;
    if found and v_canonical.status='verified' and v_canonical.latitude is not null and v_canonical.longitude is not null then
      new.latitude:=v_canonical.latitude;new.longitude:=v_canonical.longitude;
      new.location_source:='address_geocoded';new.location_address:=v_canonical.normalized_address;
      new.location_provider:=v_canonical.provider;new.location_accuracy_m:=v_canonical.accuracy_m;
      new.location_confidence:=v_canonical.confidence;new.location_resolved_at:=v_canonical.resolved_at;
      new.location_resolved_by:=v_canonical.resolved_by;new.location_verification_status:='verified';
      new.location_invalidated_at:=null;new.location_audit:=coalesce(new.location_audit,'{}'::jsonb)
        ||jsonb_build_object('selection','reused_canonical_recipient_address','canonical_address_id',v_canonical.id,
          'address_hash',v_canonical.address_hash);
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function private.bind_dispatch_stop_canonical_address_v1()
  from public,anon,authenticated,service_role;
drop trigger if exists bind_dispatch_stop_canonical_address on public.dispatch_stops;
create trigger bind_dispatch_stop_canonical_address
  before insert or update of client_id,location_address on public.dispatch_stops
  for each row execute function private.bind_dispatch_stop_canonical_address_v1();

-- Recover legacy stops only when every linked fiscal document points to the
-- same registered recipient. Ambiguous multi-recipient stops must be replanned.
with unambiguous_recipient as (
  select s.tenant_id,s.id,(array_agg(distinct fd.client_id order by fd.client_id))[1] client_id
  from public.dispatch_stops s
  join public.dispatch_stop_documents d on d.tenant_id=s.tenant_id and d.dispatch_stop_id=s.id
  join public.fiscal_documents fd on fd.tenant_id=d.tenant_id and fd.id=d.fiscal_document_id
  where s.client_id is null and s.location_address is null and fd.client_id is not null
    and not(s.status=any(public.stop_terminal_statuses()))
  group by s.tenant_id,s.id
  having count(distinct fd.client_id)=1
)
update public.dispatch_stops s set client_id=u.client_id,updated_at=clock_timestamp()
from unambiguous_recipient u where s.tenant_id=u.tenant_id and s.id=u.id;

-- Retire queue entries that were incorrectly created from the display label.
update public.address_resolution_queue q set
  status='ignored',last_error='recipient_address_missing',processed_at=coalesce(processed_at,clock_timestamp()),
  lease_token=null,lease_expires_at=null,resolution_kind=null,
  resolution_details=coalesce(resolution_details,'{}'::jsonb)||jsonb_build_object(
    'ignored_reason','destination_is_not_an_address_source','ignored_at',clock_timestamp()),
  updated_at=clock_timestamp()
from public.dispatch_stops s
where q.tenant_id=s.tenant_id and q.entity_type='dispatch_stop' and q.entity_id=s.id
  and s.location_address is null and s.client_id is null
  and q.status in ('pending','ambiguous','error');

update public.dispatch_stops s set
  canonical_address_id=null,
  location_verification_status='pending',
  location_audit=coalesce(location_audit,'{}'::jsonb)||jsonb_build_object(
    'recipient_address_required',true,'invalidated_destination_label_at',clock_timestamp()),
  updated_at=clock_timestamp()
where s.location_address is null and s.client_id is null and s.canonical_address_id is not null
  and not(s.status=any(public.stop_terminal_statuses()));

create or replace function private.enqueue_dispatch_stop_geocode_v1()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_canonical public.canonical_addresses%rowtype;
begin
  if new.canonical_address_id is null or new.location_source='map_selected'
    or (new.location_address is null and new.client_id is null) then return null;end if;
  select * into v_canonical from public.canonical_addresses
    where tenant_id=new.tenant_id and id=new.canonical_address_id;
  if found and v_canonical.status<>'verified' then
    insert into public.address_resolution_queue(tenant_id,entity_type,entity_id,canonical_address_id,address_snapshot,
      address_hash,status,candidates,attempts,last_error,resolved_at,resolved_by,invalidated_at,updated_at,
      processed_at,next_attempt_at,resolution_kind,resolution_details)
    values(new.tenant_id,'dispatch_stop',new.id,v_canonical.id,v_canonical.normalized_address,
      v_canonical.address_hash,'pending','[]'::jsonb,0,null,null,null,
      case when tg_op='UPDATE' then clock_timestamp() else null end,clock_timestamp(),null,clock_timestamp(),null,'{}'::jsonb)
    on conflict(tenant_id,entity_type,entity_id) do update set canonical_address_id=excluded.canonical_address_id,
      address_snapshot=excluded.address_snapshot,address_hash=excluded.address_hash,status='pending',candidates='[]'::jsonb,
      attempts=0,last_error=null,resolved_lat=null,resolved_lng=null,resolved_provider=null,resolved_accuracy_m=null,
      resolved_confidence=null,resolved_at=null,resolved_by=null,invalidated_at=excluded.invalidated_at,
      processed_at=null,next_attempt_at=clock_timestamp(),lease_token=null,lease_expires_at=null,
      resolution_kind=null,resolution_details='{}'::jsonb,updated_at=clock_timestamp();
  end if;
  return null;
end;
$function$;
revoke all on function private.enqueue_dispatch_stop_geocode_v1()
  from public,anon,authenticated,service_role;
drop trigger if exists enqueue_dispatch_stop_geocode on public.dispatch_stops;
create trigger enqueue_dispatch_stop_geocode
  after insert or update of canonical_address_id,client_id,location_address,latitude,longitude,location_source
  on public.dispatch_stops for each row execute function private.enqueue_dispatch_stop_geocode_v1();

do $postcondition$
begin
  if position('new.destination' in pg_get_functiondef(
      'private.bind_dispatch_stop_canonical_address_v1()'::regprocedure))>0
    or not exists(select 1 from pg_trigger where tgrelid='public.dispatch_stops'::regclass
      and tgname='bind_dispatch_stop_canonical_address' and not tgisinternal) then
    raise exception 'recipient_address_delivery_geofence_postcondition_failed';
  end if;
end;
$postcondition$;
