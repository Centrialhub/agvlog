-- Indexes and a tenant-scoped aggregate used by the first server-paginated
-- high-volume registries. The function remains SECURITY INVOKER so table RLS
-- is authoritative even when a caller supplies another tenant UUID.

create index if not exists idx_clients_tenant_company_name
  on public.clients (tenant_id, company_name);

create index if not exists idx_fiscal_documents_tenant_live_created
  on public.fiscal_documents (tenant_id, created_at desc)
  where deleted_at is null;

create index if not exists idx_loads_tenant_created
  on public.loads (tenant_id, created_at desc);

create or replace function public.get_fiscal_document_summary_v1(_tenant_id uuid)
returns table (
  total_count bigint,
  inbound_count bigint,
  outbound_count bigint,
  pending_count bigint,
  total_value numeric,
  total_weight numeric,
  total_pallets bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with visible_documents as (
    select
      document_type,
      lower(btrim(coalesce(status, ''))) as normalized_status,
      lower(btrim(coalesce(sefaz_status, ''))) as normalized_sefaz_status,
      coalesce(value, 0) as document_value,
      coalesce(freight_value, 0) as freight_value,
      coalesce(weight_kg, 0) as weight_kg,
      coalesce(pallet_count, 0) as pallet_count
    from public.fiscal_documents
    where tenant_id = _tenant_id
      and deleted_at is null
  ), billable_documents as (
    select *,
      normalized_status not in (
        'cancelled', 'canceled', 'cancelada', 'cancelado', 'rejected',
        'rejeitada', 'rejeitado', 'denied', 'denegada', 'denegado',
        'inutilizada', 'error', 'erro', 'failed'
      )
      and normalized_sefaz_status not in (
        'cancelled', 'canceled', 'cancelada', 'cancelado', 'rejected',
        'rejeitada', 'rejeitado', 'denied', 'denegada', 'denegado',
        'inutilizada', 'error', 'erro', 'failed'
      ) as is_billable
    from visible_documents
  )
  select
    count(*)::bigint,
    count(*) filter (where is_billable and document_type = 'inbound')::bigint,
    count(*) filter (where is_billable and document_type = 'outbound')::bigint,
    count(*) filter (where normalized_status = 'pending')::bigint,
    coalesce(sum(
      case
        when not is_billable then 0
        when document_type = 'inbound' then document_value
        when document_type = 'outbound' then coalesce(nullif(freight_value, 0), document_value)
        else 0
      end
    ), 0)::numeric,
    coalesce(sum(case when is_billable then weight_kg else 0 end), 0)::numeric,
    coalesce(sum(case when is_billable then pallet_count else 0 end), 0)::bigint
  from billable_documents;
$$;

revoke execute on function public.get_fiscal_document_summary_v1(uuid)
  from public, anon;
grant execute on function public.get_fiscal_document_summary_v1(uuid)
  to authenticated, service_role;

comment on function public.get_fiscal_document_summary_v1(uuid) is
  'RLS-scoped aggregate for the fiscal document registry summary cards.';

create or replace function public.list_loads_page_v1(
  _tenant_id uuid,
  _filters jsonb default '{}'::jsonb,
  _limit integer default 25,
  _offset integer default 0
)
returns table (items jsonb, total_count bigint, status_counts jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  with filtered_loads as materialized (
    select
      l.*,
      v.plate as joined_vehicle_plate,
      v.nickname as joined_vehicle_nickname,
      d.name as joined_driver_name
    from public.loads l
    left join public.vehicles v
      on v.id = l.vehicle_id and v.tenant_id = l.tenant_id
    left join public.drivers d
      on d.id = l.driver_id and d.tenant_id = l.tenant_id
    where l.tenant_id = _tenant_id
      and (
        nullif(btrim(_filters->>'search'), '') is null
        or l.load_number ilike '%' || btrim(_filters->>'search') || '%'
        or coalesce(v.plate, '') ilike '%' || btrim(_filters->>'search') || '%'
        or coalesce(l.destination, '') ilike '%' || btrim(_filters->>'search') || '%'
      )
      and (coalesce(nullif(_filters->>'statusFilter', ''), 'all') = 'all' or l.status = _filters->>'statusFilter')
      and (
        coalesce(jsonb_array_length(coalesce(_filters->'statuses', '[]'::jsonb)), 0) = 0
        or l.status in (select jsonb_array_elements_text(_filters->'statuses'))
      )
      and (nullif(_filters->>'createdFrom', '') is null or l.created_at >= (_filters->>'createdFrom')::timestamptz)
      and (nullif(_filters->>'createdTo', '') is null or l.created_at <= (_filters->>'createdTo')::timestamptz)
      and (nullif(btrim(_filters->>'loadNumber'), '') is null or l.load_number ilike '%' || btrim(_filters->>'loadNumber') || '%')
      and (nullif(btrim(_filters->>'plate'), '') is null or coalesce(v.plate, '') ilike '%' || btrim(_filters->>'plate') || '%')
      and (nullif(btrim(_filters->>'trailerPlate'), '') is null or coalesce(l.trailer_plate, '') ilike '%' || btrim(_filters->>'trailerPlate') || '%')
      and (coalesce(nullif(_filters->>'driverId', ''), 'all') = 'all' or l.driver_id = (_filters->>'driverId')::uuid)
      and (nullif(_filters->>'cargoType', '') is null or l.operation_type::text = _filters->>'cargoType')
      and (nullif(btrim(_filters->>'monitorResponsible'), '') is null or coalesce(l.monitor_responsible, '') ilike '%' || btrim(_filters->>'monitorResponsible') || '%')
      and (nullif(btrim(_filters->>'driverType'), '') is null or coalesce(l.driver_type, '') ilike '%' || btrim(_filters->>'driverType') || '%')
      and (nullif(btrim(_filters->>'smManager'), '') is null or coalesce(l.sm_manager, '') ilike '%' || btrim(_filters->>'smManager') || '%')
      and (nullif(btrim(_filters->>'smRelease'), '') is null or coalesce(l.sm_release, '') ilike '%' || btrim(_filters->>'smRelease') || '%')
      and (nullif(_filters->>'emissionFrom', '') is null or l.created_at::date >= (_filters->>'emissionFrom')::date)
      and (nullif(_filters->>'emissionTo', '') is null or l.created_at::date <= (_filters->>'emissionTo')::date)
      and (nullif(_filters->>'loadingFrom', '') is null or l.actual_load_at::date >= (_filters->>'loadingFrom')::date)
      and (nullif(_filters->>'loadingTo', '') is null or l.actual_load_at::date <= (_filters->>'loadingTo')::date)
      and (nullif(_filters->>'arrivalEstFrom', '') is null or l.estimated_arrival_at::date >= (_filters->>'arrivalEstFrom')::date)
      and (nullif(_filters->>'arrivalEstTo', '') is null or l.estimated_arrival_at::date <= (_filters->>'arrivalEstTo')::date)
      and (nullif(_filters->>'departureFrom', '') is null or l.gate_departure_at::date >= (_filters->>'departureFrom')::date)
      and (nullif(_filters->>'departureTo', '') is null or l.gate_departure_at::date <= (_filters->>'departureTo')::date)
      and (nullif(_filters->>'arrivalFrom', '') is null or l.arrival_at::date >= (_filters->>'arrivalFrom')::date)
      and (nullif(_filters->>'arrivalTo', '') is null or l.arrival_at::date <= (_filters->>'arrivalTo')::date)
      and (
        coalesce(jsonb_array_length(coalesce(_filters->'romexpTypes', '[]'::jsonb)), 0) = 0
        or exists (
          select 1 from jsonb_array_elements_text(_filters->'romexpTypes') value
          where coalesce(l.operation_type::text, '') ilike '%' || value || '%'
        )
      )
      and (
        coalesce(jsonb_array_length(coalesce(_filters->'romaneioTypes', '[]'::jsonb)), 0) = 0
        or exists (
          select 1 from jsonb_array_elements_text(_filters->'romaneioTypes') value
          where coalesce(l.operation_type::text, '') ilike '%' || value || '%'
        )
      )
      and (
        coalesce(_filters->>'manifest', 'all') = 'all'
        or (coalesce(_filters->>'manifest', 'all') = 'yes' and coalesce(
          nullif(btrim(l.supplier_manifest), ''), nullif(btrim(l.distribution_manifest), ''),
          nullif(btrim(l.shipment_manifest), ''), nullif(btrim(l.origin_manifest), '')
        ) is not null)
        or (coalesce(_filters->>'manifest', 'all') = 'no' and coalesce(
          nullif(btrim(l.supplier_manifest), ''), nullif(btrim(l.distribution_manifest), ''),
          nullif(btrim(l.shipment_manifest), ''), nullif(btrim(l.origin_manifest), '')
        ) is null)
      )
      and (
        coalesce(_filters->>'monitored', 'all') = 'all'
        or coalesce(l.monitored, false) = (coalesce(_filters->>'monitored', 'all') = 'yes')
      )
      and (
        coalesce(_filters->>'dedicated', 'all') = 'all'
        or coalesce(l.dedicated_vehicle, false) = (coalesce(_filters->>'dedicated', 'all') = 'yes')
      )
      and (
        coalesce(_filters->>'ciot', 'all') = 'all'
        or (coalesce(_filters->>'ciot', 'all') = 'yes' and nullif(btrim(coalesce(l.ciot, '')), '') is not null)
        or (coalesce(_filters->>'ciot', 'all') = 'no' and nullif(btrim(coalesce(l.ciot, '')), '') is null)
      )
      and (nullif(_filters->>'valueMin', '') is null or l.merchandise_value >= (_filters->>'valueMin')::numeric)
      and (nullif(_filters->>'valueMax', '') is null or l.merchandise_value <= (_filters->>'valueMax')::numeric)
      and (nullif(btrim(_filters->>'remitter'), '') is null or coalesce(l.origin, '') ilike '%' || btrim(_filters->>'remitter') || '%')
      and (nullif(btrim(_filters->>'client'), '') is null or coalesce(l.destination, '') ilike '%' || btrim(_filters->>'client') || '%')
      and (nullif(btrim(_filters->>'city'), '') is null or coalesce(l.destination, '') ilike '%' || btrim(_filters->>'city') || '%')
      and (nullif(btrim(_filters->>'supplier'), '') is null or coalesce(l.supplier_manifest, '') ilike '%' || btrim(_filters->>'supplier') || '%')
  ), page_items as (
    select
      to_jsonb(filtered_loads)
        - 'joined_vehicle_plate'
        - 'joined_vehicle_nickname'
        - 'joined_driver_name'
        || jsonb_build_object(
          'vehicles', case when joined_vehicle_plate is null then null else jsonb_build_object('plate', joined_vehicle_plate, 'nickname', joined_vehicle_nickname) end,
          'drivers', case when joined_driver_name is null then null else jsonb_build_object('name', joined_driver_name) end
        ) as item,
      created_at,
      id
    from filtered_loads
    order by created_at desc, id
    limit greatest(1, least(coalesce(_limit, 25), 500))
    offset greatest(coalesce(_offset, 0), 0)
  ), tenant_status_counts as (
    select status, count(*)::bigint as row_count
    from public.loads
    where tenant_id = _tenant_id
    group by status
  )
  select
    coalesce((select jsonb_agg(item order by created_at desc, id) from page_items), '[]'::jsonb),
    (select count(*)::bigint from filtered_loads),
    coalesce((select jsonb_object_agg(status, row_count) from tenant_status_counts), '{}'::jsonb);
$$;

revoke execute on function public.list_loads_page_v1(uuid, jsonb, integer, integer)
  from public, anon;
grant execute on function public.list_loads_page_v1(uuid, jsonb, integer, integer)
  to authenticated, service_role;

comment on function public.list_loads_page_v1(uuid, jsonb, integer, integer) is
  'RLS-scoped server pagination and filtering contract for the load registry.';
