-- Atomic/paginated bulk workflows reported in bugs 60, 62, 64 and 74.

create or replace function public.list_available_loads_for_settlement_v2(
  _tenant_id uuid,_driver_id uuid default null,_search text default null,
  _include_settlement_id uuid default null,_page integer default 1,_page_size integer default 100
) returns jsonb language plpgsql stable security definer set search_path='public' as $$
declare v_page integer:=greatest(coalesce(_page,1),1); v_size integer:=greatest(1,least(coalesce(_page_size,100),200)); v_total bigint; v_rows jsonb;
begin
  if not public.is_tenant_operator_or_admin(_tenant_id) then raise exception 'permission_denied' using errcode='42501'; end if;
  with eligible as (
    select l.id,l.load_number,l.origin,l.destination,l.status,l.total_weight_kg,l.total_pallet_count,l.gross_cargo_value,l.freight_amount,
      l.invoice_count,l.load_date,l.driver_id,d.name driver_name,v.plate vehicle_plate,l.created_at
    from public.loads l left join public.drivers d on d.id=l.driver_id left join public.vehicles v on v.id=l.vehicle_id
    where l.tenant_id=_tenant_id and l.driver_id is not null and (_driver_id is null or l.driver_id=_driver_id)
      and (nullif(btrim(_search),'') is null or l.load_number ilike '%'||_search||'%' or l.origin ilike '%'||_search||'%' or l.destination ilike '%'||_search||'%' or l.external_load_number ilike '%'||_search||'%')
      and public._load_available_for_settlement(_tenant_id,l.id,_include_settlement_id)
  ) select count(*) into v_total from eligible;
  with eligible as (
    select l.id,l.load_number,l.origin,l.destination,l.status,l.total_weight_kg,l.total_pallet_count,l.gross_cargo_value,l.freight_amount,
      l.invoice_count,l.load_date,l.driver_id,d.name driver_name,v.plate vehicle_plate,l.created_at
    from public.loads l left join public.drivers d on d.id=l.driver_id left join public.vehicles v on v.id=l.vehicle_id
    where l.tenant_id=_tenant_id and l.driver_id is not null and (_driver_id is null or l.driver_id=_driver_id)
      and (nullif(btrim(_search),'') is null or l.load_number ilike '%'||_search||'%' or l.origin ilike '%'||_search||'%' or l.destination ilike '%'||_search||'%' or l.external_load_number ilike '%'||_search||'%')
      and public._load_available_for_settlement(_tenant_id,l.id,_include_settlement_id)
  ) select coalesce(jsonb_agg(to_jsonb(x)-'created_at'),'[]'::jsonb) into v_rows from (
    select * from eligible order by load_date desc nulls last,created_at desc,id limit v_size offset (v_page-1)*v_size
  ) x;
  return jsonb_build_object('rows',v_rows,'total',v_total,'page',v_page,'page_size',v_size);
end $$;
revoke all on function public.list_available_loads_for_settlement_v2(uuid,uuid,text,uuid,integer,integer) from public,anon;
grant execute on function public.list_available_loads_for_settlement_v2(uuid,uuid,text,uuid,integer,integer) to authenticated,service_role;

create or replace function public.create_grouped_load_v1(_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' set row_security='on' as $$
declare v_tenant uuid:=(_payload->>'tenant_id')::uuid; v_vehicle uuid:=nullif(_payload->'changes'->>'vehicle_id','')::uuid;
  v_ids uuid[]; v_pallets numeric; v_capacity numeric; v_result jsonb; v_load uuid;
begin
  if auth.uid() is null or not public.is_tenant_operator_or_admin(v_tenant) then raise exception 'operator_required'; end if;
  select coalesce(array_agg(value::text::uuid),array[]::uuid[]) into v_ids from jsonb_array_elements_text(coalesce(_payload->'document_ids','[]'::jsonb));
  if cardinality(v_ids)=0 then raise exception 'documents_required'; end if;
  perform id from public.fiscal_documents where tenant_id=v_tenant and id=any(v_ids) and document_type='inbound' and deleted_at is null order by id for share;
  select coalesce(sum(coalesce(pallet_count,0)),0) into v_pallets from public.fiscal_documents where tenant_id=v_tenant and id=any(v_ids) and document_type='inbound' and deleted_at is null;
  if (select count(*) from public.fiscal_documents where tenant_id=v_tenant and id=any(v_ids) and document_type='inbound' and deleted_at is null)<>cardinality(v_ids) then raise exception 'document_not_found'; end if;
  if v_vehicle is not null then
    select max_pallets into v_capacity from public.vehicles where id=v_vehicle and tenant_id=v_tenant for update;
    if not found then raise exception 'vehicle_not_found'; end if;
    if v_capacity is not null and v_capacity>0 and v_pallets>v_capacity then raise exception 'vehicle_pallet_capacity_exceeded'; end if;
  end if;
  v_result:=public.apply_load_aggregate_command(jsonb_build_object('schema_version',1,'tenant_id',v_tenant,'request_id',(_payload->>'request_id')::uuid,'action','create','changes',coalesce(_payload->'changes','{}'::jsonb)));
  v_load:=(v_result->>'load_id')::uuid;
  perform public.assign_fiscal_documents_to_load_v2(v_tenant,v_load,v_ids);
  return v_result||jsonb_build_object('document_count',cardinality(v_ids),'pallet_count',v_pallets);
end $$;
revoke all on function public.create_grouped_load_v1(jsonb) from public,anon;
grant execute on function public.create_grouped_load_v1(jsonb) to authenticated;

create or replace function public.replace_reimport_batch_v1(_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_tenant uuid:=(_payload->>'tenant_id')::uuid; v_start date:=(_payload->>'start_date')::date; v_end date:=(_payload->>'end_date')::date;
  v_docs jsonb:=coalesce(_payload->'documents','[]'::jsonb); v_doc jsonb; v_clean jsonb; v_count integer:=0;
begin
  if auth.uid() is null or not public.is_tenant_admin(v_tenant) then raise exception 'admin_required'; end if;
  if v_start is null or v_end is null or v_start>v_end then raise exception 'invalid_date_range'; end if;
  if jsonb_typeof(v_docs)<>'array' or jsonb_array_length(v_docs)>10000 then raise exception 'invalid_document_batch'; end if;
  for v_doc in select value from jsonb_array_elements(v_docs) loop
    if nullif(v_doc->>'invoice_number','') is null then raise exception 'invoice_number_required'; end if;
    if nullif(v_doc->>'issue_date','') is not null and (v_doc->>'issue_date')::date not between v_start and v_end then raise exception 'document_outside_range'; end if;
  end loop;
  v_clean:=public.clear_reimport_batch_data(v_tenant,v_start,v_end);
  for v_doc in select value from jsonb_array_elements(v_docs) loop
    insert into public.fiscal_documents(tenant_id,created_by,document_type,invoice_number,invoice_series,fiscal_model,remitter_cnpj,access_key,remitter,recipient,
      recipient_city,recipient_state,recipient_neighborhood,issue_date,client_id,product_summary,pallet_count,weight_kg,value,status)
    values(v_tenant,auth.uid(),'inbound',v_doc->>'invoice_number',nullif(v_doc->>'invoice_series',''),coalesce(nullif(v_doc->>'fiscal_model',''),'55'),
      nullif(v_doc->>'remitter_cnpj',''),nullif(v_doc->>'access_key',''),nullif(v_doc->>'remitter',''),nullif(v_doc->>'recipient',''),
      nullif(v_doc->>'recipient_city',''),nullif(v_doc->>'recipient_state',''),nullif(v_doc->>'recipient_neighborhood',''),nullif(v_doc->>'issue_date','')::date,
      nullif(v_doc->>'client_id','')::uuid,nullif(v_doc->>'product_summary',''),nullif(v_doc->>'pallet_count','')::numeric,
      nullif(v_doc->>'weight_kg','')::numeric,nullif(v_doc->>'value','')::numeric,'confirmed');
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('cleaned',v_clean,'inserted',v_count);
end $$;
revoke all on function public.replace_reimport_batch_v1(jsonb) from public,anon;
grant execute on function public.replace_reimport_batch_v1(jsonb) to authenticated;
