create or replace function delivery_private.validate_driver_delivery_dispatch_evidence_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_details jsonb;
  v_latitude double precision;
  v_longitude double precision;
  v_accuracy double precision;
  v_prefix text;
  v_original text;
  v_processed text;
  v_signature text;
  v_items jsonb;
  v_affected_documents jsonb;
begin
  if coalesce(new.payload->>'source','') <> 'driver_app' then return new; end if;
  v_details := new.payload->'delivery_request'->'details';
  if jsonb_typeof(v_details) <> 'object' then v_details := new.payload; end if;
  v_prefix := format('%s/deliveries/%s/%s/',new.tenant_id,new.dispatch_trip_id,new.dispatch_stop_id);

  if new.event_type in ('stop_returned','stop_refused') then
    if jsonb_typeof(v_details->'photo_paths') <> 'array'
      or jsonb_array_length(v_details->'photo_paths') = 0 then
      raise exception 'driver_refusal_photo_required' using errcode = '22023';
    end if;
    if exists(
      select 1 from jsonb_array_elements_text(v_details->'photo_paths') as path(value)
      where path.value not like v_prefix || '%'
        or not exists(select 1 from storage.objects where bucket_id='receipts' and name=path.value)
    ) then
      raise exception 'driver_refusal_photo_invalid' using errcode = '22023';
    end if;

    v_items := v_details->'returned_items';
    if exists(select 1 from public._delivery_items_for_stop(new.dispatch_stop_id) as item
      where item.tenant_id=new.tenant_id) then
      if jsonb_typeof(v_items) <> 'object' or v_items = '{}'::jsonb
        or exists(select 1 from public._delivery_items_for_stop(new.dispatch_stop_id) as item
          where item.tenant_id=new.tenant_id and not (v_items ? item.id::text)) then
        raise exception 'driver_returned_items_required' using errcode = '22023';
      end if;
    end if;
    select coalesce(jsonb_agg(document_id order by document_id),'[]'::jsonb)
      into v_affected_documents
    from (select distinct link.fiscal_document_id::text as document_id
      from public.dispatch_stop_documents as link
      where link.tenant_id=new.tenant_id and link.dispatch_stop_id=new.dispatch_stop_id) as documents;
    new.payload := jsonb_set(new.payload,'{affected_document_ids}',v_affected_documents,true);
  end if;

  if new.event_type in ('delivery_delivered','stop_partial_delivery') then
    v_original := nullif(v_details->>'receipt_original_path','');
    v_processed := nullif(v_details->>'receipt_processed_path','');
    v_signature := nullif(v_details->>'signature_path','');
    if v_original is null or v_processed is null or v_signature is null
      or v_original not like v_prefix || 'receipt/original/%'
      or v_processed not like v_prefix || 'receipt/processed/%'
      or v_signature not like v_prefix || 'signatures/%' then
      raise exception 'driver_delivery_scan_required' using errcode = '22023';
    end if;
    if coalesce(v_details->>'receipt_original_hash','') !~ '^[a-f0-9]{64}$'
      or coalesce(v_details->>'receipt_processed_hash','') !~ '^[a-f0-9]{64}$' then
      raise exception 'driver_delivery_scan_hash_invalid' using errcode = '22023';
    end if;
    if coalesce(v_details->>'receipt_scan_mode','') not in ('document_scan','native_document_scan','manual_crop') then
      raise exception 'driver_delivery_scan_mode_invalid' using errcode = '22023';
    end if;
    if jsonb_typeof(v_details->'receipt_scan_quality') <> 'object'
      or (v_details->'receipt_scan_quality'->'accepted') is distinct from 'true'::jsonb
      or (v_details->'receipt_quality_confirmed') is distinct from 'true'::jsonb then
      raise exception 'driver_delivery_scan_quality_required' using errcode = '22023';
    end if;
    if not exists(select 1 from storage.objects where bucket_id='receipts' and name=v_original)
      or not exists(select 1 from storage.objects where bucket_id='receipts' and name=v_processed)
      or not exists(select 1 from storage.objects where bucket_id='receipts' and name=v_signature) then
      raise exception 'driver_delivery_scan_object_missing' using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(v_details->'latitude'),'null') <> 'number'
      or coalesce(jsonb_typeof(v_details->'longitude'),'null') <> 'number'
      or coalesce(jsonb_typeof(v_details->'accuracy_m'),'null') <> 'number' then
      raise exception 'driver_delivery_gps_required' using errcode = '22023';
    end if;
    v_latitude := (v_details->>'latitude')::double precision;
    v_longitude := (v_details->>'longitude')::double precision;
    v_accuracy := (v_details->>'accuracy_m')::double precision;
    if v_latitude not between -90 and 90 or v_longitude not between -180 and 180
      or v_accuracy < 0 or v_accuracy > 150 then
      raise exception 'driver_delivery_gps_invalid' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function delivery_private.validate_driver_delivery_dispatch_evidence_v1()
  from public, anon, authenticated, service_role;

comment on function delivery_private.validate_driver_delivery_dispatch_evidence_v1() is
  'Authoritative driver evidence boundary: document scan, signature, GPS and stored objects for deliveries; stored photos and complete affected items for refusals.';
