create or replace function public.read_ort_candidates_v1(_tenant_id uuid, _filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_nf_from date := nullif(_filters->>'nfFrom', '')::date;
  v_nf_to date := nullif(_filters->>'nfTo', '')::date;
  v_load_from date := nullif(_filters->>'cargFrom', '')::date;
  v_load_to date := nullif(_filters->>'cargTo', '')::date;
  v_result jsonb;
begin
  if auth.uid() is null
     or not private.is_request_tenant_member(_tenant_id)
     or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'ort_candidates_not_authorized' using errcode = '42501';
  end if;
  if v_nf_from is not null and v_nf_to is not null and v_nf_from > v_nf_to then
    raise exception 'ort_candidates_invalid_issue_period' using errcode = '22023';
  end if;
  if v_load_from is not null and v_load_to is not null and v_load_from > v_load_to then
    raise exception 'ort_candidates_invalid_load_period' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(row_payload order by issue_date desc nulls last, created_at desc, id), '[]'::jsonb)
  into v_result
  from (
    select
      document.id,
      document.issue_date,
      document.created_at,
      jsonb_build_object(
        'id', document.id,
        'invoice_number', document.invoice_number,
        'issue_date', document.issue_date,
        'value', document.value,
        'pallet_count', document.pallet_count,
        'weight_kg', document.weight_kg,
        'remitter', document.remitter,
        'recipient', document.recipient,
        'client_id', document.client_id,
        'clients', case when client.id is null then null else jsonb_build_object('company_name', client.company_name) end,
        'load_id', document.load_id
      ) as row_payload
    from public.fiscal_documents document
    left join public.clients client
      on client.id = document.client_id and client.tenant_id = document.tenant_id
    left join public.loads load
      on load.id = document.load_id and load.tenant_id = document.tenant_id
    left join public.vehicles vehicle
      on vehicle.id = load.vehicle_id and vehicle.tenant_id = document.tenant_id
    where document.tenant_id = _tenant_id
      and document.document_type = 'inbound'
      and document.pickup_order_id is null
      and document.deleted_at is null
      and lower(coalesce(document.status, '')) not in ('cancelled', 'deleted')
      and (nullif(btrim(_filters->>'nota'), '') is null or position(lower(btrim(_filters->>'nota')) in lower(coalesce(document.invoice_number, ''))) > 0)
      and (nullif(_filters->>'clientId', '') is null or document.client_id = (_filters->>'clientId')::uuid)
      and (nullif(btrim(_filters->>'fornecedor'), '') is null or position(lower(btrim(_filters->>'fornecedor')) in lower(coalesce(document.remitter, ''))) > 0)
      and (v_nf_from is null or document.issue_date >= v_nf_from)
      and (v_nf_to is null or document.issue_date <= v_nf_to)
      and (nullif(btrim(_filters->>'loteDinamico'), '') is null or position(lower(btrim(_filters->>'loteDinamico')) in lower(coalesce(document.dynamic_lot, ''))) > 0)
      and (nullif(btrim(_filters->>'loteControle'), '') is null or position(lower(btrim(_filters->>'loteControle')) in lower(coalesce(document.control_lot, ''))) > 0)
      and (nullif(btrim(_filters->>'referencia'), '') is null or position(lower(btrim(_filters->>'referencia')) in lower(coalesce(document.reference_number, ''))) > 0)
      and (
        nullif(regexp_replace(coalesce(_filters->>'cnpj', ''), '\D', '', 'g'), '') is null
        or position(regexp_replace(_filters->>'cnpj', '\D', '', 'g') in regexp_replace(coalesce(document.recipient_cnpj, ''), '\D', '', 'g')) > 0
        or position(regexp_replace(_filters->>'cnpj', '\D', '', 'g') in regexp_replace(coalesce(document.remitter_cnpj, ''), '\D', '', 'g')) > 0
      )
      and (nullif(btrim(_filters->>'osNumber'), '') is null or position(lower(btrim(_filters->>'osNumber')) in lower(coalesce(load.os_number, ''))) > 0)
      and (nullif(btrim(_filters->>'ordemColeta'), '') is null or position(lower(btrim(_filters->>'ordemColeta')) in lower(coalesce(load.load_number, ''))) > 0)
      and (nullif(btrim(_filters->>'romaneioFornecedor'), '') is null or position(lower(btrim(_filters->>'romaneioFornecedor')) in lower(coalesce(load.supplier_manifest, ''))) > 0)
      and (nullif(btrim(_filters->>'romaneioDistribuicao'), '') is null or position(lower(btrim(_filters->>'romaneioDistribuicao')) in lower(coalesce(load.distribution_manifest, ''))) > 0)
      and (nullif(btrim(_filters->>'romexpOrigem'), '') is null or position(lower(btrim(_filters->>'romexpOrigem')) in lower(coalesce(load.origin_manifest, ''))) > 0)
      and (nullif(btrim(_filters->>'romaneioExpedicao'), '') is null or position(lower(btrim(_filters->>'romaneioExpedicao')) in lower(coalesce(load.shipment_manifest, ''))) > 0)
      and (
        coalesce(_filters->>'statusCarga', 'all') = 'all'
        or (_filters->>'statusCarga' = 'no_load' and document.load_id is null)
        or (_filters->>'statusCarga' = 'with_load' and document.load_id is not null)
      )
      and (
        nullif(regexp_replace(coalesce(_filters->>'placa', ''), '[^[:alnum:]]', '', 'g'), '') is null
        or position(lower(regexp_replace(_filters->>'placa', '[^[:alnum:]]', '', 'g')) in lower(regexp_replace(coalesce(vehicle.plate, ''), '[^[:alnum:]]', '', 'g'))) > 0
      )
      and (v_load_from is null or coalesce(load.actual_load_at, load.scheduled_load_at)::date >= v_load_from)
      and (v_load_to is null or coalesce(load.actual_load_at, load.scheduled_load_at)::date <= v_load_to)
      and (
        jsonb_array_length(coalesce(_filters->'operacao', '[]'::jsonb)) = 0
        or exists (
          select 1 from jsonb_array_elements_text(coalesce(_filters->'operacao', '[]'::jsonb)) selected(label)
          where (selected.label = 'Filial' and coalesce(load.operation_type, document.operation_type)::text = 'filial')
             or (selected.label = 'Armazenagem' and coalesce(load.operation_type, document.operation_type)::text = 'armazenagem')
             or (selected.label = 'Frota' and coalesce(load.operation_type, document.operation_type)::text = 'frota')
             or (selected.label = 'Distribuição' and (coalesce(load.operation_type, document.operation_type)::text in ('viagem_direta','retira','transferencia','devolucao','redespacho') or coalesce(load.operation_type, document.operation_type) is null))
        )
      )
      and (
        coalesce((_filters->>'todosRomaneio')::boolean, true)
        or exists (
          select 1 from jsonb_array_elements_text(coalesce(_filters->'romaneio', '[]'::jsonb)) selected(label)
          where (selected.label = 'Entrega/Coleta' and coalesce(load.operation_type, document.operation_type) is null)
             or (selected.label = 'Viagem Direta' and coalesce(load.operation_type, document.operation_type)::text = 'viagem_direta')
             or (selected.label = 'Retira' and coalesce(load.operation_type, document.operation_type)::text = 'retira')
             or (selected.label = 'Transferência' and coalesce(load.operation_type, document.operation_type)::text = 'transferencia')
             or (selected.label = 'Devolução' and coalesce(load.operation_type, document.operation_type)::text = 'devolucao')
             or (selected.label = 'Redespacho/Sub' and coalesce(load.operation_type, document.operation_type)::text = 'redespacho')
        )
      )
  ) candidates;

  return v_result;
end;
$function$;

create or replace function public.create_ort_pickup_v1(_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant uuid := nullif(_payload->>'tenant_id', '')::uuid;
  v_request uuid := nullif(_payload->>'request_id', '')::uuid;
  v_document_ids uuid[];
  v_pickup jsonb;
  v_pickup_id uuid;
  v_count integer;
  v_linked integer;
begin
  if auth.uid() is null or v_tenant is null
     or not private.is_request_tenant_member(v_tenant)
     or not coalesce(public.is_tenant_operator_or_admin(v_tenant), false) then
    raise exception 'ort_generation_not_authorized' using errcode = '42501';
  end if;
  if v_request is null then
    raise exception 'request_id_required' using errcode = '22023';
  end if;
  if jsonb_typeof(_payload->'document_ids') is distinct from 'array' or jsonb_array_length(_payload->'document_ids') = 0 then
    raise exception 'ort_documents_required' using errcode = '22023';
  end if;

  select array_agg(value::uuid order by value::uuid), count(*)
  into v_document_ids, v_count
  from (select distinct value from jsonb_array_elements_text(_payload->'document_ids')) ids;
  if v_count <> jsonb_array_length(_payload->'document_ids') then
    raise exception 'ort_documents_duplicated' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':ort:' || array_to_string(v_document_ids, ','), 0));
  v_pickup := public.create_pickup_order_v1(_payload - 'document_ids');
  v_pickup_id := nullif(v_pickup->>'id', '')::uuid;
  if v_pickup_id is null then
    raise exception 'ort_pickup_not_confirmed';
  end if;

  perform 1
  from public.fiscal_documents document
  where document.id = any(v_document_ids) and document.tenant_id = v_tenant
  order by document.id
  for update;

  select count(*) into v_count
  from public.fiscal_documents document
  where document.id = any(v_document_ids)
    and document.tenant_id = v_tenant
    and document.document_type = 'inbound'
    and document.deleted_at is null
    and lower(coalesce(document.status, '')) not in ('cancelled', 'deleted')
    and (document.pickup_order_id is null or document.pickup_order_id = v_pickup_id);
  if v_count <> cardinality(v_document_ids) then
    raise exception 'ort_documents_changed_or_ineligible' using errcode = '40001';
  end if;

  update public.fiscal_documents
  set pickup_order_id = v_pickup_id, updated_at = clock_timestamp()
  where tenant_id = v_tenant and id = any(v_document_ids) and pickup_order_id is null;

  select count(*) into v_linked
  from public.fiscal_documents
  where tenant_id = v_tenant and id = any(v_document_ids) and pickup_order_id = v_pickup_id;
  if v_linked <> cardinality(v_document_ids) then
    raise exception 'ort_documents_link_not_confirmed' using errcode = '40001';
  end if;

  return v_pickup || jsonb_build_object('linked_count', v_linked, 'document_ids', to_jsonb(v_document_ids));
end;
$function$;

revoke all on function public.read_ort_candidates_v1(uuid, jsonb), public.create_ort_pickup_v1(jsonb) from public, anon;
grant execute on function public.read_ort_candidates_v1(uuid, jsonb), public.create_ort_pickup_v1(jsonb) to authenticated, service_role;

comment on function public.read_ort_candidates_v1(uuid, jsonb) is
  'Returns the complete eligible ORT candidate set with all generation filters applied server-side.';
comment on function public.create_ort_pickup_v1(jsonb) is
  'Atomically creates an idempotent pickup order and links a locked, still-eligible set of fiscal documents.';
