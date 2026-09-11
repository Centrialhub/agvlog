-- Purpose-built filters for the operational receipt workspace. These are
-- intentionally independent from CT-e and resolve trip/load/client context
-- from the delivery stop and all of its linked documents.

create or replace function public.list_delivery_receipts_v1(
  _tenant_id uuid,
  _filters jsonb default '{}'::jsonb,
  _limit integer default 50,
  _offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'delivery_receipt_not_authorized' using errcode='42501';
  end if;
  if _filters is null or jsonb_typeof(_filters)<>'object' or _limit not between 1 and 100 or _offset<0
    or (_filters-array[
      'search','date_from','date_to','digital_status','physical_status','email_status','scan_mode',
      'supplier_id','driver_id','vehicle_id','document_kind','has_pdf','trip_id','load_id','client_id',
      'destination_city','destination_state','receiver'
    ])<>'{}'::jsonb then
    raise exception 'invalid_delivery_receipt_filters' using errcode='22023';
  end if;
  if coalesce(_filters->>'date_from','')<>'' and (_filters->>'date_from')!~'^\d{4}-\d{2}-\d{2}$'
    or coalesce(_filters->>'date_to','')<>'' and (_filters->>'date_to')!~'^\d{4}-\d{2}-\d{2}$'
    or exists(
      select 1 from jsonb_each_text(_filters) entry
      where entry.key in('supplier_id','driver_id','vehicle_id','trip_id','load_id','client_id')
        and entry.value<>'' and entry.value!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    or nullif(_filters->>'digital_status','') is not null and _filters->>'digital_status' not in('pending_upload','uploaded','pending_validation','validated','rejected','superseded')
    or nullif(_filters->>'physical_status','') is not null and _filters->>'physical_status' not in('pending_return','received','missing','waived')
    or nullif(_filters->>'email_status','') is not null and _filters->>'email_status' not in('not_sent','queued','sent','delivered','bounced','failed')
    or nullif(_filters->>'scan_mode','') is not null and _filters->>'scan_mode' not in('document_scan','native_document_scan','manual_crop','legacy_photo','operator_replacement')
    or nullif(_filters->>'document_kind','') is not null and _filters->>'document_kind' not in('nfe','nfse','cte','other_fiscal','operational_reference')
    or _filters?'has_pdf' and jsonb_typeof(_filters->'has_pdf')<>'boolean'
    or length(coalesce(_filters->>'destination_city',''))>120
    or nullif(_filters->>'destination_state','') is not null and btrim(_filters->>'destination_state')!~*'^[a-z]{2}$'
    or length(coalesce(_filters->>'receiver',''))>200 then
    raise exception 'invalid_delivery_receipt_filters' using errcode='22023';
  end if;

  with filtered as (
    select receipt.id,receipt.delivered_at
    from public.delivery_receipts receipt
    left join public.drivers driver on driver.id=receipt.driver_id and driver.tenant_id=receipt.tenant_id
    left join public.vehicles vehicle on vehicle.id=receipt.vehicle_id and vehicle.tenant_id=receipt.tenant_id
    left join public.dispatch_stops stop on stop.id=receipt.dispatch_stop_id and stop.tenant_id=receipt.tenant_id
    left join public.clients client on client.id=stop.client_id and client.tenant_id=receipt.tenant_id
    where receipt.tenant_id=_tenant_id and receipt.is_active
      and (nullif(_filters->>'digital_status','') is null or receipt.digital_status=_filters->>'digital_status')
      and (nullif(_filters->>'physical_status','') is null or receipt.physical_status=_filters->>'physical_status')
      and (nullif(_filters->>'email_status','') is null or receipt.email_status=_filters->>'email_status')
      and (nullif(_filters->>'scan_mode','') is null or receipt.scan_mode=_filters->>'scan_mode')
      and (nullif(_filters->>'driver_id','') is null or receipt.driver_id=(_filters->>'driver_id')::uuid)
      and (nullif(_filters->>'vehicle_id','') is null or receipt.vehicle_id=(_filters->>'vehicle_id')::uuid)
      and (nullif(_filters->>'trip_id','') is null or receipt.dispatch_trip_id=(_filters->>'trip_id')::uuid)
      and (nullif(_filters->>'client_id','') is null or stop.client_id=(_filters->>'client_id')::uuid)
      and (nullif(btrim(_filters->>'destination_city'),'') is null or client.address_city ilike btrim(_filters->>'destination_city'))
      and (nullif(btrim(_filters->>'destination_state'),'') is null or upper(client.address_state)=upper(btrim(_filters->>'destination_state')))
      and (nullif(btrim(_filters->>'receiver'),'') is null or receipt.receiver_name ilike '%'||btrim(_filters->>'receiver')||'%')
      and (not (_filters?'has_pdf') or (receipt.pdf_path is not null)=(_filters->>'has_pdf')::boolean)
      and (nullif(_filters->>'date_from','') is null or receipt.delivered_at>=(_filters->>'date_from')::date)
      and (nullif(_filters->>'date_to','') is null or receipt.delivered_at<((_filters->>'date_to')::date+1))
      and (nullif(_filters->>'load_id','') is null or exists(
        select 1 from public.dispatch_trip_loads trip_load
        where trip_load.tenant_id=receipt.tenant_id and trip_load.dispatch_trip_id=receipt.dispatch_trip_id
          and trip_load.load_id=(_filters->>'load_id')::uuid
        union all
        select 1 from public.dispatch_trips trip
        where trip.tenant_id=receipt.tenant_id and trip.id=receipt.dispatch_trip_id
          and trip.load_id=(_filters->>'load_id')::uuid
        union all
        select 1 from public.dispatch_stop_documents stop_document
        where stop_document.tenant_id=receipt.tenant_id and stop_document.dispatch_stop_id=receipt.dispatch_stop_id
          and stop_document.load_id=(_filters->>'load_id')::uuid
      ))
      and (nullif(_filters->>'supplier_id','') is null or exists(
        select 1 from public.delivery_receipt_documents link
        join public.delivery_document_references reference on reference.id=link.document_reference_id
        where link.receipt_id=receipt.id and link.tenant_id=receipt.tenant_id
          and reference.supplier_id=(_filters->>'supplier_id')::uuid
      ))
      and (nullif(_filters->>'document_kind','') is null or exists(
        select 1 from public.delivery_receipt_documents link
        join public.delivery_document_references reference on reference.id=link.document_reference_id
        where link.receipt_id=receipt.id and link.tenant_id=receipt.tenant_id
          and reference.document_kind=_filters->>'document_kind'
      ))
      and (nullif(btrim(_filters->>'search'),'') is null
        or concat_ws(' ',driver.name,vehicle.plate,stop.destination,receipt.receiver_name,client.company_name,client.trade_name) ilike '%'||btrim(_filters->>'search')||'%'
        or exists(
          select 1 from public.delivery_receipt_documents link
          join public.delivery_document_references reference on reference.id=link.document_reference_id
          where link.receipt_id=receipt.id and link.tenant_id=receipt.tenant_id
            and concat_ws(' ',reference.document_number,reference.access_key,reference.issuer_name,reference.issuer_tax_id,
              reference.recipient_name,reference.operational_reference) ilike '%'||btrim(_filters->>'search')||'%'
        )
      )
  ), page as (
    select id,delivered_at from filtered order by delivered_at desc,id desc limit _limit offset _offset
  ), serialized as (
    select receipt.delivered_at,receipt.id,jsonb_build_object(
      'id',receipt.id,'delivery_event_id',receipt.delivery_event_id,
      'trip_id',receipt.dispatch_trip_id,'stop_id',receipt.dispatch_stop_id,
      'previous_receipt_id',receipt.previous_receipt_id,'version',receipt.version,
      'delivered_at',receipt.delivered_at,'captured_at',receipt.captured_at,
      'digital_status',receipt.digital_status,'physical_status',receipt.physical_status,
      'email_status',receipt.email_status,'scan_mode',receipt.scan_mode,
      'rejection_reason',receipt.rejection_reason,
      'has_original',receipt.original_path is not null,'has_processed',receipt.processed_path is not null,
      'has_pdf',receipt.pdf_path is not null,'receiver_name',receipt.receiver_name,
      'driver',case when driver.id is null then null else jsonb_build_object('id',driver.id,'name',driver.name) end,
      'vehicle',case when vehicle.id is null then null else jsonb_build_object('id',vehicle.id,'plate',vehicle.plate) end,
      'client',case when client.id is null then null else jsonb_build_object(
        'id',client.id,'name',coalesce(nullif(client.trade_name,''),client.company_name),
        'city',client.address_city,'state',client.address_state
      ) end,
      'destination',stop.destination,
      'load_ids',coalesce((
        select jsonb_agg(load_context.load_id order by load_context.load_id)
        from (
          select trip_load.load_id from public.dispatch_trip_loads trip_load
          where trip_load.tenant_id=receipt.tenant_id and trip_load.dispatch_trip_id=receipt.dispatch_trip_id
          union
          select trip.load_id from public.dispatch_trips trip
          where trip.tenant_id=receipt.tenant_id and trip.id=receipt.dispatch_trip_id and trip.load_id is not null
          union
          select stop_document.load_id from public.dispatch_stop_documents stop_document
          where stop_document.tenant_id=receipt.tenant_id and stop_document.dispatch_stop_id=receipt.dispatch_stop_id
            and stop_document.load_id is not null
        ) load_context
      ),'[]'::jsonb),
      'documents',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',reference.id,'kind',reference.document_kind,'number',reference.document_number,
          'series',reference.document_series,'access_key',reference.access_key,'issue_date',reference.issue_date,
          'issuer_name',reference.issuer_name,'issuer_tax_id',reference.issuer_tax_id,
          'recipient_name',reference.recipient_name,'supplier_id',reference.supplier_id,
          'operational_reference',reference.operational_reference
        ) order by reference.document_kind,reference.document_number,reference.id)
        from public.delivery_receipt_documents link
        join public.delivery_document_references reference on reference.id=link.document_reference_id
        where link.receipt_id=receipt.id and link.tenant_id=receipt.tenant_id
      ),'[]'::jsonb),
      'updated_at',receipt.updated_at
    ) row_json
    from page
    join public.delivery_receipts receipt on receipt.id=page.id and receipt.tenant_id=_tenant_id
    left join public.drivers driver on driver.id=receipt.driver_id and driver.tenant_id=receipt.tenant_id
    left join public.vehicles vehicle on vehicle.id=receipt.vehicle_id and vehicle.tenant_id=receipt.tenant_id
    left join public.dispatch_stops stop on stop.id=receipt.dispatch_stop_id and stop.tenant_id=receipt.tenant_id
    left join public.clients client on client.id=stop.client_id and client.tenant_id=receipt.tenant_id
  )
  select jsonb_build_object(
    'version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),
    'rows',coalesce((select jsonb_agg(row_json order by delivered_at desc,id desc) from serialized),'[]'::jsonb),
    'total',(select count(*)::integer from filtered),'limit',_limit,'offset',_offset
  ) into v_result;
  return v_result;
end;
$function$;

revoke all on function public.list_delivery_receipts_v1(uuid,jsonb,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.list_delivery_receipts_v1(uuid,jsonb,integer,integer) to authenticated;

comment on function public.list_delivery_receipts_v1(uuid,jsonb,integer,integer) is
  'Lists canonical delivery receipts with explicit trip, load, client, city, state and receiver filters.';
