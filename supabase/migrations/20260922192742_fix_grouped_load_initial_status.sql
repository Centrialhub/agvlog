create or replace function public.create_grouped_load_v1(_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' set row_security='on' as $$
declare v_tenant uuid:=(_payload->>'tenant_id')::uuid; v_vehicle uuid:=nullif(_payload->'changes'->>'vehicle_id','')::uuid;
  v_ids uuid[]; v_pallets numeric; v_capacity numeric; v_result jsonb; v_load uuid; v_changes jsonb := coalesce(_payload->'changes','{}'::jsonb);
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
  -- Older open browser sessions send the server-owned initial status.
  -- Accept only that exact default; all other fields/states remain validated.
  if v_changes->'status' = '"planned"'::jsonb then
    v_changes := v_changes - 'status';
  end if;
  v_result:=public.apply_load_aggregate_command(jsonb_build_object('schema_version',1,'tenant_id',v_tenant,'request_id',(_payload->>'request_id')::uuid,'action','create','changes',v_changes));
  v_load:=(v_result->>'load_id')::uuid;
  perform public.assign_fiscal_documents_to_load_v2(v_tenant,v_load,v_ids);
  return v_result||jsonb_build_object('document_count',cardinality(v_ids),'pallet_count',v_pallets);
end $$;
revoke all on function public.create_grouped_load_v1(jsonb) from public,anon;
grant execute on function public.create_grouped_load_v1(jsonb) to authenticated;
