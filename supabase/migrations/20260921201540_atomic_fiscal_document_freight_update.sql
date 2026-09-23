create or replace function public.update_fiscal_document_with_freight_v1(
  _tenant_id uuid,
  _document_id uuid,
  _expected_updated_at timestamptz,
  _document_patch jsonb,
  _freight_patch jsonb,
  _breakdown jsonb
) returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_keys text[];
  v_assignments text;
  v_result jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'fiscal_document_update_not_authorized' using errcode='42501';
  end if;
  if _document_id is null or _expected_updated_at is null
    or jsonb_typeof(_document_patch) is distinct from 'object'
    or jsonb_typeof(_freight_patch) is distinct from 'object'
    or jsonb_typeof(_breakdown) is distinct from 'object' then
    raise exception 'invalid_fiscal_document_freight_update' using errcode='22023';
  end if;

  select array_agg(key order by key) into v_keys from jsonb_object_keys(_document_patch) key;
  if v_keys&&array['id','tenant_id','status','created_at','created_by','updated_at',
    'freight_value','freight_value_original','freight_table_id','freight_breakdown','value',
    'cbs_base','cbs_rate','cbs_value','ibs_base','ibs_rate','ibs_value']::text[]
    or exists(
      select 1 from unnest(v_keys) key
      where not exists(select 1 from pg_attribute attribute
        where attribute.attrelid='public.fiscal_documents'::regclass and attribute.attname=key
          and attribute.attnum>0 and not attribute.attisdropped)
    ) then
    raise exception 'unsupported_fiscal_document_patch' using errcode='22023';
  end if;
  select coalesce(string_agg(format('%1$I=patch.%1$I',key),',')||',','') into v_assignments from unnest(v_keys) key;

  execute format($sql$
    update public.fiscal_documents target set %s
      freight_value=nullif($2->>'freight_value','')::numeric,
      freight_value_original=nullif($2->>'freight_value_original','')::numeric,
      value=nullif($2->>'value','')::numeric,
      freight_table_id=nullif($2->>'freight_table_id','')::uuid,
      freight_breakdown=$2->'freight_breakdown',
      cbs_base=nullif($2->>'cbs_base','')::numeric,cbs_rate=nullif($2->>'cbs_rate','')::numeric,
      cbs_value=nullif($2->>'cbs_value','')::numeric,ibs_base=nullif($2->>'ibs_base','')::numeric,
      ibs_rate=nullif($2->>'ibs_rate','')::numeric,ibs_value=nullif($2->>'ibs_value','')::numeric,
      updated_at=clock_timestamp()
    from (select (jsonb_populate_record(null::public.fiscal_documents,$1)).*) patch
    where target.tenant_id=$3 and target.id=$4 and target.updated_at=$5
      and target.document_type='outbound' and not target.freight_overridden
    returning to_jsonb(target)
  $sql$,v_assignments) into v_result
  using _document_patch,_freight_patch,_tenant_id,_document_id,_expected_updated_at;
  if v_result is null then raise exception 'fiscal_document_changed' using errcode='40001';end if;

  insert into public.freight_calculation_log(
    tenant_id,entity_type,entity_id,region_id,region_name,freight_table_id,freight_table_name,
    matched_criteria,ignored_criteria,components,base_value,final_value,is_override,
    fallback_used,fallback_reason,created_by
  ) values (
    _tenant_id,'cte',_document_id,nullif(_breakdown->>'regionId','')::uuid,_breakdown->>'regionName',
    nullif(_breakdown->>'tableId','')::uuid,_breakdown->>'tableName',coalesce(_breakdown->'matchedCriteria','[]'::jsonb),
    coalesce(_breakdown->'ignoredCriteria','[]'::jsonb),coalesce(_breakdown->'components','{}'::jsonb),
    nullif(_breakdown->>'baseValue','')::numeric,nullif(_breakdown->>'finalValue','')::numeric,false,
    coalesce((_breakdown->>'fallbackUsed')::boolean,false),_breakdown->>'fallbackReason',auth.uid()
  ) on conflict(tenant_id,entity_type,entity_id) do update set
    region_id=excluded.region_id,region_name=excluded.region_name,freight_table_id=excluded.freight_table_id,
    freight_table_name=excluded.freight_table_name,matched_criteria=excluded.matched_criteria,
    ignored_criteria=excluded.ignored_criteria,components=excluded.components,base_value=excluded.base_value,
    final_value=excluded.final_value,is_override=false,fallback_used=excluded.fallback_used,
    fallback_reason=excluded.fallback_reason,created_at=clock_timestamp(),created_by=excluded.created_by;
  return v_result;
end;
$function$;

revoke all on function public.update_fiscal_document_with_freight_v1(uuid,uuid,timestamptz,jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.update_fiscal_document_with_freight_v1(uuid,uuid,timestamptz,jsonb,jsonb,jsonb)
  to authenticated,service_role;

create or replace function public.create_fiscal_document_with_freight_v1(
  _tenant_id uuid,
  _document jsonb,
  _breakdown jsonb
) returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_keys text[];
  v_columns text;
  v_values text;
  v_result jsonb;
  v_document_id uuid;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'fiscal_document_create_not_authorized' using errcode='42501';
  end if;
  if jsonb_typeof(_document) is distinct from 'object'
    or jsonb_typeof(_breakdown) is distinct from 'object'
    or _document->>'document_type' is distinct from 'outbound' then
    raise exception 'invalid_fiscal_document_freight_create' using errcode='22023';
  end if;

  select array_agg(key order by key) into v_keys from jsonb_object_keys(_document) key;
  if v_keys is null or v_keys&&array['id','tenant_id','created_at','created_by','updated_at']::text[]
    or exists(
      select 1 from unnest(v_keys) key
      where not exists(select 1 from pg_attribute attribute
        where attribute.attrelid='public.fiscal_documents'::regclass and attribute.attname=key
          and attribute.attnum>0 and not attribute.attisdropped and attribute.attgenerated='')
    ) then
    raise exception 'unsupported_fiscal_document_create' using errcode='22023';
  end if;
  select string_agg(format('%I',key),','),string_agg(format('payload.%I',key),',')
    into v_columns,v_values from unnest(v_keys) key;

  execute format($sql$
    insert into public.fiscal_documents as created(tenant_id,created_by,%s)
    select $1,auth.uid(),%s
    from (select (jsonb_populate_record(null::public.fiscal_documents,$2)).*) payload
    returning created.id,to_jsonb(created)
  $sql$,v_columns,v_values) into v_document_id,v_result using _tenant_id,_document;

  insert into public.freight_calculation_log(
    tenant_id,entity_type,entity_id,region_id,region_name,freight_table_id,freight_table_name,
    matched_criteria,ignored_criteria,components,base_value,final_value,is_override,
    fallback_used,fallback_reason,created_by
  ) values (
    _tenant_id,'cte',v_document_id,nullif(_breakdown->>'regionId','')::uuid,_breakdown->>'regionName',
    nullif(_breakdown->>'tableId','')::uuid,_breakdown->>'tableName',coalesce(_breakdown->'matchedCriteria','[]'::jsonb),
    coalesce(_breakdown->'ignoredCriteria','[]'::jsonb),coalesce(_breakdown->'components','{}'::jsonb),
    nullif(_breakdown->>'baseValue','')::numeric,nullif(_breakdown->>'finalValue','')::numeric,false,
    coalesce((_breakdown->>'fallbackUsed')::boolean,false),_breakdown->>'fallbackReason',auth.uid()
  );
  return v_result;
end;
$function$;

revoke all on function public.create_fiscal_document_with_freight_v1(uuid,jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.create_fiscal_document_with_freight_v1(uuid,jsonb,jsonb)
  to authenticated,service_role;

create or replace function public.get_load_freight_context_v1(_tenant_id uuid,_load_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'load_freight_context_not_authorized' using errcode='42501';
  end if;
  if not exists(select 1 from public.loads where id=_load_id and tenant_id=_tenant_id) then
    raise exception 'load_not_found' using errcode='P0002';
  end if;

  with active_documents as (
    select f.* from public.fiscal_documents f
    where f.tenant_id=_tenant_id and f.load_id=_load_id and f.document_type='inbound'
      and f.status<>'cancelled'
      and exists(select 1 from public.current_load_items i where i.tenant_id=_tenant_id
        and i.load_id=_load_id and i.fiscal_document_id=f.id)
  ), active_items as (
    select i.* from public.current_load_items i
    where i.tenant_id=_tenant_id and i.load_id=_load_id
      and (i.fiscal_document_id is null or exists(select 1 from active_documents d where d.id=i.fiscal_document_id))
  )
  select jsonb_build_object(
    'documents',coalesce((select jsonb_agg(jsonb_build_object(
      'id',d.id,'issue_date',d.issue_date,'value',d.value,'client_id',d.client_id,
      'recipient_state',d.recipient_state,'recipient_city',d.recipient_city,
      'recipient_neighborhood',d.recipient_neighborhood,'recipient',d.recipient,
      'recipient_cnpj',d.recipient_cnpj) order by d.issue_date,d.id) from active_documents d),'[]'::jsonb),
    'item_descriptions',coalesce((select jsonb_agg(i.item_description order by i.id)
      filter(where i.item_description is not null and btrim(i.item_description)<>'') from active_items i),'[]'::jsonb),
    'order_names',coalesce((select jsonb_agg(coalesce(o.order_number,c.company_name,'Pedido') order by lo.id)
      from public.load_orders lo join public.orders o on o.id=lo.order_id and o.tenant_id=_tenant_id
      left join public.clients c on c.id=o.client_id and c.tenant_id=_tenant_id
      where lo.load_id=_load_id and lo.tenant_id=_tenant_id),'[]'::jsonb),
    'total_pallets',coalesce((select sum(coalesce(i.pallet_count,0)) from active_items i),0),
    'total_weight',coalesce((select sum(coalesce(i.weight_kg,0)) from active_items i),0)
  ) into v_result;
  return v_result;
end;
$function$;

revoke all on function public.get_load_freight_context_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_load_freight_context_v1(uuid,uuid) to authenticated,service_role;
