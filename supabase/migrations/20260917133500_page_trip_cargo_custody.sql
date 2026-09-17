-- Bound custody reads by page while preserving the full dossier through a
-- collection reader. Also make divergence review a one-way pending transition.

create or replace function private.assert_trip_cargo_reader(_tenant_id uuid, _trip_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_trip public.dispatch_trips%rowtype;
begin
  if auth.uid() is null or private.request_tenant_id() is distinct from _tenant_id then
    raise exception 'trip_cargo_not_authorized' using errcode = '42501';
  end if;
  select * into v_trip
  from public.dispatch_trips
  where id = _trip_id and tenant_id = _tenant_id;
  if not found then
    raise exception 'trip_cargo_trip_not_found' using errcode = 'P0002';
  end if;
  if not (
    exists (
      select 1 from public.drivers driver
      where driver.id = v_trip.driver_id
        and driver.tenant_id = _tenant_id
        and driver.user_id = auth.uid()
        and driver.active
    )
    or exists (
      select 1 from public.tenant_memberships membership
      where membership.tenant_id = _tenant_id
        and membership.user_id = auth.uid()
        and membership.active
        and membership.role in ('owner', 'admin', 'operator')
    )
  ) then
    raise exception 'trip_cargo_not_authorized' using errcode = '42501';
  end if;
end;
$function$;

revoke all on function private.assert_trip_cargo_reader(uuid,uuid)
from public, anon, authenticated, service_role;

create or replace function public.get_trip_cargo_control_v2(_tenant_id uuid, _trip_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_trip public.dispatch_trips%rowtype;
  v_control public.trip_cargo_controls%rowtype;
begin
  perform private.assert_trip_cargo_reader(_tenant_id, _trip_id);
  select * into v_trip from public.dispatch_trips where id = _trip_id and tenant_id = _tenant_id;
  select * into v_control from public.trip_cargo_controls where tenant_id = _tenant_id and dispatch_trip_id = _trip_id;
  if not found then
    return jsonb_build_object(
      'version', 2, 'available', false, 'tenant_id', _tenant_id, 'trip_id', _trip_id,
      'trip_status', v_trip.status, 'driver_id', v_trip.driver_id, 'vehicle_id', v_trip.vehicle_id
    );
  end if;
  return jsonb_build_object(
    'version', 2,
    'available', true,
    'tenant_id', _tenant_id,
    'trip_id', _trip_id,
    'trip_status', v_trip.status,
    'control', to_jsonb(v_control),
    'collection_counts', jsonb_build_object(
      'loads', (select count(*) from public.trip_cargo_load_checks row where row.control_id = v_control.id),
      'documents', (select count(*) from public.trip_cargo_document_checks row where row.control_id = v_control.id),
      'seals', (select count(*) from public.trip_cargo_seals row where row.control_id = v_control.id),
      'evidence', (select count(*) from public.trip_cargo_evidence row where row.control_id = v_control.id),
      'divergences', (select count(*) from public.trip_cargo_divergences row where row.control_id = v_control.id)
    ),
    'physical_receipts', jsonb_build_object(
      'required_count', (select count(*) from public.delivery_receipts receipt where receipt.tenant_id = _tenant_id and receipt.dispatch_trip_id = _trip_id and receipt.is_active),
      'pending_count', (select count(*) from public.delivery_receipts receipt where receipt.tenant_id = _tenant_id and receipt.dispatch_trip_id = _trip_id and receipt.is_active and receipt.physical_status <> 'received'),
      'missing_count', (select count(*) from public.dispatch_stops stop where stop.tenant_id = _tenant_id and stop.dispatch_trip_id = _trip_id
        and stop.status in ('delivered', 'partial_delivery') and not exists (
          select 1 from public.delivery_receipts receipt
          where receipt.tenant_id = _tenant_id and receipt.dispatch_stop_id = stop.id and receipt.is_active
        ))
    )
  );
end;
$function$;

create or replace function public.get_trip_cargo_collection_page_v1(
  _tenant_id uuid,
  _trip_id uuid,
  _collection text,
  _page integer default 1,
  _page_size integer default 500
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_control_id uuid;
  v_page integer := greatest(coalesce(_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(_page_size, 500), 1), 500);
  v_offset integer;
  v_total integer;
  v_items jsonb;
begin
  perform private.assert_trip_cargo_reader(_tenant_id, _trip_id);
  if _collection not in ('loads', 'documents', 'seals', 'evidence', 'divergences') then
    raise exception 'trip_cargo_collection_invalid' using errcode = '22023';
  end if;
  select id into v_control_id
  from public.trip_cargo_controls
  where tenant_id = _tenant_id and dispatch_trip_id = _trip_id;
  if v_control_id is null then
    raise exception 'trip_cargo_control_not_found' using errcode = 'P0002';
  end if;
  v_offset := (v_page - 1) * v_page_size;

  if _collection = 'loads' then
    select count(*)::integer into v_total from public.trip_cargo_load_checks row where row.control_id = v_control_id;
    select coalesce(jsonb_agg(to_jsonb(row) order by row.load_id, row.id), '[]'::jsonb) into v_items
    from (select * from public.trip_cargo_load_checks where control_id = v_control_id order by load_id, id limit v_page_size offset v_offset) row;
  elsif _collection = 'documents' then
    select count(*)::integer into v_total from public.trip_cargo_document_checks row where row.control_id = v_control_id;
    select coalesce(jsonb_agg(to_jsonb(row) order by row.source_kind, row.reference_number, row.id), '[]'::jsonb) into v_items
    from (select * from public.trip_cargo_document_checks where control_id = v_control_id order by source_kind, reference_number, id limit v_page_size offset v_offset) row;
  elsif _collection = 'seals' then
    select count(*)::integer into v_total from public.trip_cargo_seals row where row.control_id = v_control_id;
    select coalesce(jsonb_agg(to_jsonb(row) order by row.installed_at, row.id), '[]'::jsonb) into v_items
    from (select * from public.trip_cargo_seals where control_id = v_control_id order by installed_at, id limit v_page_size offset v_offset) row;
  elsif _collection = 'evidence' then
    select count(*)::integer into v_total from public.trip_cargo_evidence row where row.control_id = v_control_id;
    select coalesce(jsonb_agg(to_jsonb(row) order by row.captured_at, row.id), '[]'::jsonb) into v_items
    from (select * from public.trip_cargo_evidence where control_id = v_control_id order by captured_at, id limit v_page_size offset v_offset) row;
  else
    select count(*)::integer into v_total from public.trip_cargo_divergences row where row.control_id = v_control_id;
    select coalesce(jsonb_agg(to_jsonb(row) order by row.reported_at, row.id), '[]'::jsonb) into v_items
    from (select * from public.trip_cargo_divergences where control_id = v_control_id order by reported_at, id limit v_page_size offset v_offset) row;
  end if;

  return jsonb_build_object(
    'version', 1, 'tenant_id', _tenant_id, 'trip_id', _trip_id,
    'collection', _collection, 'page', v_page, 'page_size', v_page_size,
    'total_count', coalesce(v_total, 0), 'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$function$;

create or replace function public.list_trip_cargo_controls_v2(
  _tenant_id uuid,
  _status text default null,
  _page integer default 1,
  _page_size integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_page integer := greatest(coalesce(_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(_page_size, 50), 1), 100);
  v_total integer;
  v_items jsonb;
begin
  if auth.uid() is null or private.request_tenant_id() is distinct from _tenant_id
    or not exists (
      select 1 from public.tenant_memberships membership
      where membership.tenant_id = _tenant_id and membership.user_id = auth.uid()
        and membership.active and membership.role in ('owner', 'admin', 'operator')
    ) then
    raise exception 'trip_cargo_not_authorized' using errcode = '42501';
  end if;
  if _status is not null and _status not in ('pending_acceptance', 'accepted', 'loading', 'ready_to_depart', 'departed', 'returned', 'closed') then
    raise exception 'trip_cargo_status_invalid' using errcode = '22023';
  end if;

  select count(*)::integer into v_total
  from public.trip_cargo_controls control
  where control.tenant_id = _tenant_id and (_status is null or control.status = _status);

  select coalesce(jsonb_agg(to_jsonb(row) order by row.updated_at desc, row.id desc), '[]'::jsonb)
  into v_items
  from (
    select
      control.id, control.dispatch_trip_id as trip_id, control.driver_id, control.vehicle_id,
      control.status, control.updated_at,
      (select count(*) from public.trip_cargo_divergences divergence where divergence.control_id = control.id and divergence.status in ('pending', 'rejected')) as pending_divergences,
      (select count(*) from public.delivery_receipts receipt where receipt.tenant_id = _tenant_id
        and receipt.dispatch_trip_id = control.dispatch_trip_id and receipt.is_active and receipt.physical_status <> 'received') as pending_physical_receipts
    from public.trip_cargo_controls control
    where control.tenant_id = _tenant_id and (_status is null or control.status = _status)
    order by control.updated_at desc, control.id desc
    limit v_page_size offset ((v_page - 1) * v_page_size)
  ) row;

  return jsonb_build_object(
    'version', 2, 'tenant_id', _tenant_id, 'items', v_items,
    'total_count', v_total, 'page', v_page, 'page_size', v_page_size
  );
end;
$function$;

create or replace function private.review_trip_cargo_divergence(
  _tenant_id uuid, _divergence_id uuid, _status text, _reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.trip_cargo_divergences%rowtype;
  v_trip uuid;
  v_control_status text;
begin
  if _status not in ('approved', 'rejected', 'resolved') or length(btrim(coalesce(_reason, ''))) < 5 then
    raise exception 'trip_cargo_review_invalid' using errcode = '22023';
  end if;
  select divergence.* into v_row
  from public.trip_cargo_divergences divergence
  where divergence.id = _divergence_id and divergence.tenant_id = _tenant_id
  for update;
  if not found then
    raise exception 'trip_cargo_divergence_not_found' using errcode = 'P0002';
  end if;
  select control.dispatch_trip_id, control.status into v_trip, v_control_status
  from public.trip_cargo_controls control
  where control.id = v_row.control_id and control.tenant_id = _tenant_id
  for update;
  perform private.require_trip_cargo_actor(_tenant_id, v_trip, true);
  if v_control_status in ('departed', 'returned', 'closed') then
    raise exception 'trip_cargo_review_control_closed' using errcode = '55000';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'trip_cargo_divergence_already_reviewed' using errcode = '55000';
  end if;

  update public.trip_cargo_divergences
  set status = _status, review_reason = btrim(_reason), reviewed_at = clock_timestamp(),
    reviewed_by = auth.uid(), updated_at = clock_timestamp()
  where id = v_row.id and status = 'pending'
  returning * into v_row;
  if not found then
    raise exception 'trip_cargo_divergence_already_reviewed' using errcode = '55000';
  end if;

  if not exists (select 1 from public.trip_cargo_divergences where control_id = v_row.control_id and status in ('pending', 'rejected'))
    and not exists (select 1 from public.trip_cargo_load_checks where control_id = v_row.control_id and confirmed_at is null)
    and not exists (select 1 from public.trip_cargo_document_checks where control_id = v_row.control_id and not driver_confirmed) then
    update public.trip_cargo_controls set status = 'ready_to_depart', updated_at = clock_timestamp()
    where id = v_row.control_id and status = 'loading'
    returning status into v_control_status;
  end if;
  perform public._log_entity_audit(_tenant_id, 'trip_cargo_divergence', v_row.id, 'review', null, to_jsonb(v_row), 'operational');
  return jsonb_build_object(
    'version', 1, 'confirmed', true, 'id', v_row.id, 'status', v_row.status,
    'control_status', coalesce(v_control_status, (select status from public.trip_cargo_controls where id = v_row.control_id)),
    'updated_at', v_row.updated_at
  );
end;
$function$;

revoke all on function public.get_trip_cargo_control_v2(uuid,uuid),
  public.get_trip_cargo_collection_page_v1(uuid,uuid,text,integer,integer),
  public.list_trip_cargo_controls_v2(uuid,text,integer,integer)
from public, anon, authenticated, service_role;
grant execute on function public.get_trip_cargo_control_v2(uuid,uuid),
  public.get_trip_cargo_collection_page_v1(uuid,uuid,text,integer,integer),
  public.list_trip_cargo_controls_v2(uuid,text,integer,integer)
to authenticated, service_role;

revoke all on function private.review_trip_cargo_divergence(uuid,uuid,text,text)
from public, anon, authenticated, service_role;
grant execute on function private.review_trip_cargo_divergence(uuid,uuid,text,text)
to authenticated;
