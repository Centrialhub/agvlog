create or replace function public.read_product_history_v1(
  _tenant_id uuid,
  _product text,
  _from date default null,
  _to date default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_product text := nullif(btrim(_product), '');
  v_result jsonb;
begin
  if auth.uid() is null or not private.is_request_tenant_member(_tenant_id) then
    raise exception 'product_history_not_authorized' using errcode = '42501';
  end if;
  if v_product is null then
    raise exception 'product_history_product_required' using errcode = '22023';
  end if;
  if _from is not null and _to is not null and _from > _to then
    raise exception 'product_history_invalid_period' using errcode = '22023';
  end if;

  with matched_items as materialized (
    select
      item.id,
      item.item_description,
      item.quantity,
      item.pallet_count,
      item.weight_kg,
      item.created_at as item_created_at,
      item.fiscal_document_id,
      item.load_id,
      document.document_type,
      document.invoice_number,
      document.issue_date,
      document.created_at as document_created_at,
      document.remitter,
      document.recipient,
      document.recipient_city,
      document.recipient_state,
      document.value as document_value,
      document.pickup_order_id,
      load.load_number,
      load.status as load_status,
      load.destination as load_destination,
      load.actual_load_at,
      load.scheduled_load_at,
      driver.name as driver_name,
      vehicle.plate as vehicle_plate
    from public.load_items item
    left join public.fiscal_documents document
      on document.id = item.fiscal_document_id
     and document.tenant_id = item.tenant_id
     and document.deleted_at is null
    left join public.loads load
      on load.id = item.load_id
     and load.tenant_id = item.tenant_id
    left join public.drivers driver
      on driver.id = load.driver_id
     and driver.tenant_id = item.tenant_id
    left join public.vehicles vehicle
      on vehicle.id = load.vehicle_id
     and vehicle.tenant_id = item.tenant_id
    where item.tenant_id = _tenant_id
      and position(lower(v_product) in lower(coalesce(item.item_description, ''))) > 0
  ),
  relevant_stops as materialized (
    select distinct
      stop.id,
      stop.stop_order,
      stop.destination,
      stop.planned_arrival_at,
      stop.actual_arrival_at,
      stop.actual_departure_at,
      stop.status
    from public.dispatch_stop_documents link
    join public.dispatch_stops stop
      on stop.id = link.dispatch_stop_id
     and stop.tenant_id = link.tenant_id
    join matched_items item
      on item.fiscal_document_id = link.fiscal_document_id
     and (link.load_id is null or item.load_id = link.load_id)
    where link.tenant_id = _tenant_id
  ),
  document_events as (
    select
      'document:' || item.fiscal_document_id::text as event_key,
      case
        when item.issue_date is not null then item.issue_date::text
        else to_char(min(item.document_created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      end as at,
      item.issue_date is not null as date_only,
      coalesce(item.issue_date, (min(item.document_created_at) at time zone 'America/Sao_Paulo')::date) as event_day,
      min(item.document_created_at) as sort_at,
      case when item.document_type = 'outbound' then 'outbound' else 'inbound' end as kind,
      case
        when item.document_type = 'outbound' then 'CT-e ' || coalesce(item.invoice_number, '—')
        else 'NF ' || coalesce(item.invoice_number, '—') || ' — ' || coalesce(item.remitter, 'Fornecedor')
      end as title,
      min(item.item_description) as description,
      case when item.document_type = 'inbound' then item.remitter else null end as responsible,
      case
        when item.document_type = 'outbound' then concat_ws(' • ', item.recipient, item.recipient_city, item.recipient_state)
        else item.recipient
      end as destination,
      item.invoice_number as reference,
      jsonb_strip_nulls(jsonb_build_object(
        'quantity', sum(item.quantity),
        'weight', sum(item.weight_kg),
        'pallets', sum(item.pallet_count),
        'value', max(item.document_value)
      )) as meta
    from matched_items item
    where item.fiscal_document_id is not null
    group by item.fiscal_document_id, item.issue_date, item.document_type, item.invoice_number,
      item.remitter, item.recipient, item.recipient_city, item.recipient_state
  ),
  load_events as (
    select
      'load:' || item.load_id::text as event_key,
      to_char(coalesce(max(item.actual_load_at), max(item.scheduled_load_at), min(item.item_created_at)) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at,
      false as date_only,
      (coalesce(max(item.actual_load_at), max(item.scheduled_load_at), min(item.item_created_at)) at time zone 'America/Sao_Paulo')::date as event_day,
      coalesce(max(item.actual_load_at), max(item.scheduled_load_at), min(item.item_created_at)) as sort_at,
      'load'::text as kind,
      'Carga ' || coalesce(item.load_number, '—') || ' • ' || coalesce(item.load_status, 'sem status') as title,
      min(item.item_description) as description,
      nullif(concat_ws(' • ', item.driver_name, item.vehicle_plate), '') as responsible,
      max(item.load_destination) as destination,
      item.load_number as reference,
      jsonb_strip_nulls(jsonb_build_object(
        'quantity', sum(item.quantity),
        'weight', sum(item.weight_kg),
        'pallets', sum(item.pallet_count)
      )) as meta
    from matched_items item
    where item.load_id is not null
    group by item.load_id, item.load_number, item.load_status, item.driver_name, item.vehicle_plate
  ),
  pickup_events as (
    select distinct on (pickup.id)
      'pickup:' || pickup.id::text as event_key,
      to_char(pickup.pickup_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at,
      false as date_only,
      (pickup.pickup_at at time zone 'America/Sao_Paulo')::date as event_day,
      pickup.pickup_at as sort_at,
      'pickup'::text as kind,
      'Coleta ' || pickup.pickup_number || ' • ' || pickup.status as title,
      case when pickup.remitter_name is not null then 'Remetente: ' || pickup.remitter_name end as description,
      nullif(concat_ws(' • ', pickup.driver_name_snapshot, pickup.vehicle_plate_snapshot), '') as responsible,
      pickup.recipient_name as destination,
      pickup.pickup_number as reference,
      null::jsonb as meta
    from public.pickup_orders pickup
    join matched_items item on item.pickup_order_id = pickup.id
    where pickup.tenant_id = _tenant_id and pickup.pickup_at is not null
    order by pickup.id
  ),
  stop_events as (
    select
      'stop:' || stop.id::text as event_key,
      to_char(coalesce(stop.actual_arrival_at, stop.planned_arrival_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at,
      false as date_only,
      (coalesce(stop.actual_arrival_at, stop.planned_arrival_at) at time zone 'America/Sao_Paulo')::date as event_day,
      coalesce(stop.actual_arrival_at, stop.planned_arrival_at) as sort_at,
      'stop'::text as kind,
      'Parada ' || stop.stop_order::text || ' — ' || coalesce(stop.status, 'planejada') as title,
      case when stop.actual_departure_at is not null then 'Saída: ' || to_char(stop.actual_departure_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') end as description,
      null::text as responsible,
      stop.destination,
      null::text as reference,
      null::jsonb as meta
    from relevant_stops stop
    where coalesce(stop.actual_arrival_at, stop.planned_arrival_at) is not null
  ),
  operational_events as (
    select
      'event:' || event.id::text as event_key,
      to_char(event.event_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at,
      false as date_only,
      (event.event_at at time zone 'America/Sao_Paulo')::date as event_day,
      event.event_at as sort_at,
      'event'::text as kind,
      event.event_type as title,
      event.notes as description,
      null::text as responsible,
      stop.destination,
      null::text as reference,
      null::jsonb as meta
    from public.dispatch_events event
    join relevant_stops stop on stop.id = event.dispatch_stop_id
    where event.tenant_id = _tenant_id
  ),
  all_events as (
    select * from document_events
    union all select * from load_events
    union all select * from pickup_events
    union all select * from stop_events
    union all select * from operational_events
  ),
  filtered_events as (
    select *
    from all_events
    where (_from is null or event_day >= _from)
      and (_to is null or event_day <= _to)
  )
  select coalesce(jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'key', event_key,
      'at', at,
      'dateOnly', date_only,
      'kind', kind,
      'title', title,
      'description', description,
      'responsible', responsible,
      'destination', destination,
      'reference', reference,
      'meta', meta
    ))
    order by event_day, case when date_only then 0 else 1 end, sort_at, event_key
  ), '[]'::jsonb)
  into v_result
  from filtered_events;

  return v_result;
end;
$function$;

revoke all on function public.read_product_history_v1(uuid, text, date, date) from public, anon;
grant execute on function public.read_product_history_v1(uuid, text, date, date) to authenticated, service_role;

comment on function public.read_product_history_v1(uuid, text, date, date) is
  'Builds a tenant-scoped, deduplicated product timeline with server-side date filtering and document-linked stops/events.';
