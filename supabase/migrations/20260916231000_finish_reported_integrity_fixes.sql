-- Final reported integrity fixes: validation, atomic health/fiscal commits and load creation.

alter table public.stock_items
  add constraint stock_items_min_quantity_nonnegative check (min_quantity is null or min_quantity >= 0) not valid;
alter table public.assets
  add constraint assets_acquisition_cost_nonnegative check (acquisition_cost is null or acquisition_cost >= 0) not valid;
alter table public.loads
  add constraint loads_cash_to_receive_nonnegative check (cash_to_receive >= 0) not valid,
  add constraint loads_pix_to_receive_nonnegative check (pix_to_receive >= 0) not valid;
alter table public.driver_settlements
  add constraint driver_settlement_km_values_valid check (
    (km_start is null or km_start >= 0) and (km_end is null or km_end >= 0) and
    (audited_km is null or audited_km >= 0) and
    (km_start is null or km_end is null or km_end >= km_start) and
    (coalesce(km_review_status,'pending') = 'pending' or audited_km is not null)
  ) not valid;
alter table public.alert_rules
  add constraint alert_rules_positive_thresholds check (
    (rule_type not in ('offline','long_stop') or coalesce((params->>'threshold_minutes')::numeric,0) > 0) and
    (rule_type <> 'overspeed' or coalesce((params->>'speed_limit_kmh')::numeric,0) > 0) and
    (rule_type <> 'geofence' or nullif(params->>'geofence_id','') is not null)
  ) not valid;

create unique index if not exists fiscal_documents_new_load_request_uidx
  on public.fiscal_documents(tenant_id, (delivery_meta->>'new_load_request_id'))
  where nullif(delivery_meta->>'new_load_request_id','') is not null;

create or replace function public.merge_tenant_pipeline_health_v1(_tenant_id uuid, _patch jsonb, _increment_success boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_settings jsonb; v_health jsonb; v_now text:=clock_timestamp()::text;
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  select coalesce(settings,'{}'::jsonb) into v_settings from public.tenants where id=_tenant_id for update;
  if not found then raise exception 'tenant_not_found'; end if;
  v_health:=coalesce(v_settings->'pipeline_health','{}'::jsonb)||coalesce(_patch,'{}'::jsonb);
  if _increment_success then
    v_health:=v_health||jsonb_build_object(
      'first_successful_run_at',coalesce(v_settings->'pipeline_health'->>'first_successful_run_at',_patch->>'first_successful_run_at',v_now),
      'successful_run_count',coalesce((v_settings->'pipeline_health'->>'successful_run_count')::bigint,0)+1
    );
  end if;
  update public.tenants set settings=v_settings||jsonb_build_object('pipeline_health',v_health),updated_at=clock_timestamp() where id=_tenant_id;
  return v_health;
end $$;
revoke all on function public.merge_tenant_pipeline_health_v1(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.merge_tenant_pipeline_health_v1(uuid,jsonb,boolean) to service_role;

create or replace function public.commit_legacy_fiscal_poll_v1(_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_tenant uuid:=(_payload->>'tenant_id')::uuid; v_document uuid:=(_payload->>'document_id')::uuid;
  v_emission uuid:=(_payload->>'emission_id')::uuid; v_kind text:=_payload->>'document_kind';
  v_ep jsonb:=coalesce(_payload->'emission_patch','{}'::jsonb); v_dp jsonb:=coalesce(_payload->'document_patch','{}'::jsonb);
  v_event jsonb:=_payload->'event'; v_release boolean:=coalesce((_payload->>'release_sources')::boolean,false);
begin
  if auth.role()<>'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  update public.hub_fiscal_emissions set
    status=coalesce(v_ep->>'status',status), plugnotas_status=coalesce(v_ep->>'plugnotas_status',plugnotas_status),
    access_key=coalesce(v_ep->>'access_key',access_key), authorization_protocol=coalesce(v_ep->>'authorization_protocol',authorization_protocol),
    number=coalesce(v_ep->>'number',number), series=coalesce(v_ep->>'series',series),
    c_stat=coalesce((v_ep->>'c_stat')::integer,c_stat), message=coalesce(v_ep->>'message',message),
    last_response=coalesce(v_ep->'last_response',last_response), last_synced_at=coalesce((v_ep->>'last_synced_at')::timestamptz,last_synced_at)
  where id=v_emission and tenant_id=v_tenant;
  if not found then raise exception 'emission_not_found'; end if;

  if v_kind='cte' then
    if v_release then update public.fiscal_documents set cte_emitted_at=null,cte_emitted_outbound_id=null where tenant_id=v_tenant and cte_emitted_outbound_id=v_document; end if;
    update public.fiscal_documents set
      last_status_check_at=coalesce((v_dp->>'last_status_check_at')::timestamptz,last_status_check_at),
      status_check_attempts=coalesce((v_dp->>'status_check_attempts')::integer,status_check_attempts),
      last_status_response=coalesce(v_dp->'last_status_response',last_status_response),status=coalesce(v_dp->>'status',status),
      sefaz_status=coalesce(v_dp->>'sefaz_status',sefaz_status),access_key=coalesce(v_dp->>'access_key',access_key),
      sefaz_protocol=coalesce(v_dp->>'sefaz_protocol',sefaz_protocol),sefaz_message=coalesce(v_dp->>'sefaz_message',sefaz_message),updated_at=clock_timestamp()
    where id=v_document and tenant_id=v_tenant;
    if not found then raise exception 'document_not_found'; end if;
    if v_event is not null then
      insert into public.vehicle_events(tenant_id,document_id,event_type,message,payload)
      values(v_tenant,v_document,v_event->>'event_type',v_event->>'message',coalesce(v_event->'payload','{}'::jsonb));
    end if;
  elsif v_kind='nfse' then
    if v_release then update public.fiscal_documents set nfse_emitted_at=null,nfse_emitted_document_id=null where tenant_id=v_tenant and nfse_emitted_document_id=v_document; end if;
    update public.nfse_documents set
      last_status_check_at=coalesce((v_dp->>'last_status_check_at')::timestamptz,last_status_check_at),
      status_check_attempts=coalesce((v_dp->>'status_check_attempts')::integer,status_check_attempts),
      last_status_response=coalesce(v_dp->'last_status_response',last_status_response),status=coalesce(v_dp->>'status',status),
      nfse_number=coalesce(v_dp->>'nfse_number',nfse_number),protocol_number=coalesce(v_dp->>'protocol_number',protocol_number),
      verification_code=coalesce(v_dp->>'verification_code',verification_code),pdf_url=coalesce(v_dp->>'pdf_url',pdf_url),xml_url=coalesce(v_dp->>'xml_url',xml_url),
      authorization_date=coalesce((v_dp->>'authorization_date')::timestamptz,authorization_date),
      rejection_messages=case when v_dp?'rejection_messages' then v_dp->'rejection_messages' else rejection_messages end,
      cancelled=coalesce((v_dp->>'cancelled')::boolean,cancelled),cancellation_date=coalesce((v_dp->>'cancellation_date')::timestamptz,cancellation_date),updated_at=clock_timestamp()
    where id=v_document and tenant_id=v_tenant;
    if not found then raise exception 'document_not_found'; end if;
    if v_event is not null then
      insert into public.nfse_events(tenant_id,nfse_id,event_type,message,payload)
      values(v_tenant,v_document,v_event->>'event_type',v_event->>'message',coalesce(v_event->'payload','{}'::jsonb));
    end if;
  else raise exception 'invalid_document_kind'; end if;
  return jsonb_build_object('committed',true,'document_id',v_document);
end $$;
revoke all on function public.commit_legacy_fiscal_poll_v1(jsonb) from public,anon,authenticated;
grant execute on function public.commit_legacy_fiscal_poll_v1(jsonb) to service_role;

alter function public.update_driver_settlement_km_review(uuid,numeric,text,text,numeric,numeric,text,text)
  rename to update_driver_settlement_km_review_unchecked_v1;
create function public.update_driver_settlement_km_review(_settlement_id uuid,_audited_km numeric,_km_status text,_notes text,_km_start numeric default null,_km_end numeric default null,_audited_start_location text default null,_audited_end_location text default null)
returns public.driver_settlements language plpgsql security definer set search_path='public' as $$
begin
  if (_audited_km is not null and _audited_km<0) or (_km_start is not null and _km_start<0) or (_km_end is not null and _km_end<0) then raise exception 'invalid_km_value'; end if;
  if _km_start is not null and _km_end is not null and _km_end<_km_start then raise exception 'km_end_before_start'; end if;
  if _km_status<>'pending' and _audited_km is null then raise exception 'audited_km_required'; end if;
  return public.update_driver_settlement_km_review_unchecked_v1(_settlement_id,_audited_km,_km_status,_notes,_km_start,_km_end,_audited_start_location,_audited_end_location);
end $$;
revoke all on function public.update_driver_settlement_km_review_unchecked_v1(uuid,numeric,text,text,numeric,numeric,text,text) from public,anon,authenticated;
grant execute on function public.update_driver_settlement_km_review(uuid,numeric,text,text,numeric,numeric,text,text) to authenticated,service_role;

alter function public.update_driver_settlement_status(uuid,text,text,boolean)
  rename to update_driver_settlement_status_unchecked_v1;
create function public.update_driver_settlement_status(_settlement_id uuid,_new_status text,_reason text default null,_allow_exceptions boolean default false)
returns public.driver_settlements language plpgsql security definer set search_path='public' as $$
begin
  if _allow_exceptions and length(btrim(coalesce(_reason,'')))=0 then raise exception 'reason_required'; end if;
  return public.update_driver_settlement_status_unchecked_v1(_settlement_id,_new_status,nullif(btrim(_reason),''),_allow_exceptions);
end $$;
revoke all on function public.update_driver_settlement_status_unchecked_v1(uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.update_driver_settlement_status(uuid,text,text,boolean) to authenticated,service_role;

alter function public.create_manual_driver_settlement(uuid,uuid,uuid,date,uuid[])
  rename to create_manual_driver_settlement_unchecked_v1;
create function public.create_manual_driver_settlement(_tenant_id uuid,_driver_id uuid,_vehicle_id uuid,_reference_date date,_load_ids uuid[])
returns uuid language plpgsql security definer set search_path='public' as $$
begin
  if exists(select 1 from unnest(_load_ids) x left join public.loads l on l.id=x and l.tenant_id=_tenant_id where l.id is null or l.driver_id is distinct from _driver_id) then
    raise exception 'load_driver_mismatch';
  end if;
  return public.create_manual_driver_settlement_unchecked_v1(_tenant_id,_driver_id,_vehicle_id,_reference_date,_load_ids);
end $$;
revoke all on function public.create_manual_driver_settlement_unchecked_v1(uuid,uuid,uuid,date,uuid[]) from public,anon,authenticated;
grant execute on function public.create_manual_driver_settlement(uuid,uuid,uuid,date,uuid[]) to authenticated,service_role;

create or replace function public.create_load_with_documents_v1(_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' set row_security='on' as $$
declare
  v_tenant uuid:=(_payload->>'tenant_id')::uuid; v_request uuid:=(_payload->>'request_id')::uuid;
  v_result jsonb; v_load uuid; v_manual uuid; v_ids uuid[]:=array[]::uuid[]; v_doc jsonb; v_audit jsonb;
begin
  if auth.uid() is null or not public.is_tenant_operator_or_admin(v_tenant) then raise exception 'operator_required'; end if;
  v_result:=public.apply_load_aggregate_command(jsonb_build_object('schema_version',1,'tenant_id',v_tenant,'request_id',v_request,'action','create','changes',coalesce(_payload->'changes','{}'::jsonb)));
  v_load:=(v_result->>'load_id')::uuid;
  if jsonb_array_length(coalesce(_payload->'selected_document_ids','[]'::jsonb))=1 and _payload?'single_document_patch' then
    update public.fiscal_documents set
      invoice_number=case when _payload->'single_document_patch'?'invoice_number' then nullif(_payload->'single_document_patch'->>'invoice_number','') else invoice_number end,
      client_id=case when _payload->'single_document_patch'?'client_id' then nullif(_payload->'single_document_patch'->>'client_id','')::uuid else client_id end,
      recipient=case when _payload->'single_document_patch'?'recipient' then nullif(_payload->'single_document_patch'->>'recipient','') else recipient end,
      recipient_neighborhood=case when _payload->'single_document_patch'?'recipient_neighborhood' then nullif(_payload->'single_document_patch'->>'recipient_neighborhood','') else recipient_neighborhood end,
      recipient_city=case when _payload->'single_document_patch'?'recipient_city' then nullif(_payload->'single_document_patch'->>'recipient_city','') else recipient_city end,
      updated_at=clock_timestamp()
    where id=(_payload->'selected_document_ids'->>0)::uuid and tenant_id=v_tenant and document_type='inbound';
    if not found then raise exception 'selected_document_not_found'; end if;
  end if;
  for v_doc in select value from jsonb_array_elements(coalesce(_payload->'selected_document_ids','[]'::jsonb)) loop v_ids:=array_append(v_ids,(v_doc#>>'{}')::uuid); end loop;
  if _payload?'manual_document' and nullif(_payload->'manual_document'->>'invoice_number','') is not null then
    select id into v_manual from public.fiscal_documents where tenant_id=v_tenant and delivery_meta->>'new_load_request_id'=v_request::text;
    if v_manual is null then
      insert into public.fiscal_documents(tenant_id,created_by,document_type,invoice_number,client_id,recipient,remitter,recipient_neighborhood,recipient_city,status,delivery_meta)
      values(v_tenant,auth.uid(),'inbound',_payload->'manual_document'->>'invoice_number',nullif(_payload->'manual_document'->>'client_id','')::uuid,
        nullif(_payload->'manual_document'->>'recipient',''),nullif(_payload->'manual_document'->>'remitter',''),nullif(_payload->'manual_document'->>'recipient_neighborhood',''),
        nullif(_payload->'manual_document'->>'recipient_city',''),'confirmed',jsonb_build_object('new_load_request_id',v_request)) returning id into v_manual;
    end if;
    v_ids:=array_append(v_ids,v_manual);
  end if;
  if cardinality(v_ids)>0 then perform public.assign_fiscal_documents_to_load_v2(v_tenant,v_load,v_ids); end if;
  for v_audit in select value from jsonb_array_elements(coalesce(_payload->'audit_events','[]'::jsonb)) loop
    if not exists(select 1 from public.load_note_audit_events e where e.tenant_id=v_tenant and e.load_id=v_load and e.fiscal_document_id=(v_audit->>'fiscal_document_id')::uuid and e.details->>'request_id'=v_request::text) then
      insert into public.load_note_audit_events(tenant_id,load_id,fiscal_document_id,previous_load_id,created_by,action_type,invoice_number,client_name,supplier_name,neighborhood,route_destination,details)
      values(v_tenant,v_load,(v_audit->>'fiscal_document_id')::uuid,nullif(v_audit->>'previous_load_id','')::uuid,auth.uid(),'selected_for_load',
        nullif(v_audit->>'invoice_number',''),nullif(v_audit->>'client_name',''),nullif(v_audit->>'supplier_name',''),nullif(v_audit->>'neighborhood',''),nullif(v_audit->>'route_destination',''),
        coalesce(v_audit->'details','{}'::jsonb)||jsonb_build_object('request_id',v_request));
    end if;
  end loop;
  return v_result||jsonb_build_object('manual_document_id',v_manual,'document_count',cardinality(v_ids));
end $$;
revoke all on function public.create_load_with_documents_v1(jsonb) from public,anon;
grant execute on function public.create_load_with_documents_v1(jsonb) to authenticated;
