create or replace function private.delivery_receipt_filter_options(
  _tenant_id uuid,
  _kind text
)
returns table(value text,label text)
language plpgsql
stable
security definer
set search_path=''
as $function$
begin
  if _kind='driver' then
    return query
    select distinct driver.id::text,driver.name
    from public.delivery_receipts receipt
    join public.drivers driver on driver.id=receipt.driver_id and driver.tenant_id=receipt.tenant_id
    where receipt.tenant_id=_tenant_id and receipt.is_active;
  elsif _kind='vehicle' then
    return query
    select distinct vehicle.id::text,vehicle.plate
    from public.delivery_receipts receipt
    join public.vehicles vehicle on vehicle.id=receipt.vehicle_id and vehicle.tenant_id=receipt.tenant_id
    where receipt.tenant_id=_tenant_id and receipt.is_active;
  elsif _kind='supplier' then
    return query
    select reference.supplier_id::text,
      min(coalesce(nullif(btrim(reference.issuer_name),''),'Fornecedor sem nome'))
    from public.delivery_receipts receipt
    join public.delivery_receipt_documents link
      on link.receipt_id=receipt.id and link.tenant_id=receipt.tenant_id
    join public.delivery_document_references reference on reference.id=link.document_reference_id
    where receipt.tenant_id=_tenant_id and receipt.is_active and reference.supplier_id is not null
    group by reference.supplier_id;
  elsif _kind='trip' then
    return query
    select distinct receipt.dispatch_trip_id::text,'Viagem '||left(receipt.dispatch_trip_id::text,8)
    from public.delivery_receipts receipt
    where receipt.tenant_id=_tenant_id and receipt.is_active and receipt.dispatch_trip_id is not null;
  elsif _kind='load' then
    return query
    select distinct context.load_id::text,'Carga '||left(context.load_id::text,8)
    from public.delivery_receipts receipt
    cross join lateral (
      select trip_load.load_id
      from public.dispatch_trip_loads trip_load
      where trip_load.tenant_id=receipt.tenant_id and trip_load.dispatch_trip_id=receipt.dispatch_trip_id
      union
      select trip.load_id
      from public.dispatch_trips trip
      where trip.tenant_id=receipt.tenant_id and trip.id=receipt.dispatch_trip_id and trip.load_id is not null
      union
      select stop_document.load_id
      from public.dispatch_stop_documents stop_document
      where stop_document.tenant_id=receipt.tenant_id
        and stop_document.dispatch_stop_id=receipt.dispatch_stop_id
        and stop_document.load_id is not null
    ) context
    where receipt.tenant_id=_tenant_id and receipt.is_active;
  elsif _kind='client' then
    return query
    select distinct client.id::text,coalesce(nullif(btrim(client.trade_name),''),client.company_name)
    from public.delivery_receipts receipt
    join public.dispatch_stops stop on stop.id=receipt.dispatch_stop_id and stop.tenant_id=receipt.tenant_id
    join public.clients client on client.id=stop.client_id and client.tenant_id=receipt.tenant_id
    where receipt.tenant_id=_tenant_id and receipt.is_active;
  elsif _kind='city' then
    return query
    select distinct btrim(client.address_city),btrim(client.address_city)
    from public.delivery_receipts receipt
    join public.dispatch_stops stop on stop.id=receipt.dispatch_stop_id and stop.tenant_id=receipt.tenant_id
    join public.clients client on client.id=stop.client_id and client.tenant_id=receipt.tenant_id
    where receipt.tenant_id=_tenant_id and receipt.is_active
      and nullif(btrim(client.address_city),'') is not null;
  elsif _kind='state' then
    return query
    select distinct upper(btrim(client.address_state)),upper(btrim(client.address_state))
    from public.delivery_receipts receipt
    join public.dispatch_stops stop on stop.id=receipt.dispatch_stop_id and stop.tenant_id=receipt.tenant_id
    join public.clients client on client.id=stop.client_id and client.tenant_id=receipt.tenant_id
    where receipt.tenant_id=_tenant_id and receipt.is_active
      and nullif(btrim(client.address_state),'') is not null;
  else
    raise exception 'invalid_delivery_receipt_filter_kind' using errcode='22023';
  end if;
end;
$function$;
revoke all on function private.delivery_receipt_filter_options(uuid,text)
from public,anon,authenticated,service_role;

create or replace function public.get_delivery_receipt_filter_summary_v1(_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'delivery_receipt_not_authorized' using errcode='42501';
  end if;

  select jsonb_build_object(
    'version',1,
    'tenant_id',_tenant_id,
    'actor_id',auth.uid(),
    'total',count(*)::integer,
    'queues',jsonb_build_object(
      'awaiting_sync',count(*) filter(where digital_status='pending_upload'),
      'awaiting_validation',count(*) filter(where digital_status in('uploaded','pending_validation')),
      'rejected',count(*) filter(where digital_status='rejected'),
      'validated',count(*) filter(where digital_status='validated'),
      'physical_pending',count(*) filter(where physical_status in('pending_return','missing')),
      'ready_to_send',count(*) filter(where digital_status='validated' and pdf_path is not null and email_status='not_sent'),
      'sent',count(*) filter(where email_status in('sent','delivered')),
      'send_failures',count(*) filter(where email_status in('failed','bounced'))
    )
  ) into v_result
  from public.delivery_receipts
  where tenant_id=_tenant_id and is_active;
  return v_result;
end;
$function$;

create or replace function public.list_delivery_receipt_filter_options_v1(
  _tenant_id uuid,
  _kind text,
  _search text default null,
  _limit integer default 25,
  _cursor_label text default null,
  _cursor_value text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_result jsonb;
  v_search text:=nullif(btrim(_search),'');
  v_pattern text;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'delivery_receipt_not_authorized' using errcode='42501';
  end if;
  if _kind not in('driver','vehicle','supplier','trip','load','client','city','state')
    or _limit<1 or _limit>50
    or ((_cursor_label is null)<>(_cursor_value is null)) then
    raise exception 'invalid_delivery_receipt_filter_page' using errcode='22023';
  end if;
  if v_search is not null then
    v_pattern:='%'||replace(replace(replace(v_search,chr(92),chr(92)||chr(92)),'%',chr(92)||'%'),'_',chr(92)||'_')||'%';
  end if;

  with matching as materialized (
    select option.value,option.label
    from private.delivery_receipt_filter_options(_tenant_id,_kind) option
    where v_pattern is null or option.label ilike v_pattern escape E'\\'
      or option.value ilike v_pattern escape E'\\'
  ), candidates as materialized (
    select matching.value,matching.label
    from matching
    where _cursor_label is null
      or (lower(matching.label),matching.value)>(lower(_cursor_label),_cursor_value)
    order by lower(matching.label),matching.value
    limit _limit+1
  ), visible as materialized (
    select candidates.value,candidates.label
    from candidates
    order by lower(candidates.label),candidates.value
    limit _limit
  ), continuation as (
    select visible.label,visible.value
    from visible
    order by lower(visible.label) desc,visible.value desc
    limit 1
  )
  select jsonb_build_object(
    'version',1,
    'tenant_id',_tenant_id,
    'actor_id',auth.uid(),
    'kind',_kind,
    'search',coalesce(v_search,''),
    'items',coalesce((select jsonb_agg(jsonb_build_object('value',value,'label',label)
      order by lower(label),value) from visible),'[]'::jsonb),
    'has_more',(select count(*) from candidates)>_limit,
    'next_cursor_label',case when (select count(*) from candidates)>_limit then (select label from continuation) end,
    'next_cursor_value',case when (select count(*) from candidates)>_limit then (select value from continuation) end
  ) into v_result;
  return v_result;
end;
$function$;

revoke all on function public.get_delivery_receipt_filter_catalog_v1(uuid)
from public,anon,authenticated,service_role;
revoke all on function public.get_delivery_receipt_filter_summary_v1(uuid)
from public,anon,authenticated,service_role;
grant execute on function public.get_delivery_receipt_filter_summary_v1(uuid)
to authenticated,service_role;
revoke all on function public.list_delivery_receipt_filter_options_v1(uuid,text,text,integer,text,text)
from public,anon,authenticated,service_role;
grant execute on function public.list_delivery_receipt_filter_options_v1(uuid,text,text,integer,text,text)
to authenticated,service_role;

comment on function public.get_delivery_receipt_filter_summary_v1(uuid) is
  'Returns bounded receipt queue counters without materializing filter option catalogs.';
comment on function public.list_delivery_receipt_filter_options_v1(uuid,text,text,integer,text,text) is
  'Searches and keyset-pages one delivery receipt filter option kind, returning at most 50 options.';
