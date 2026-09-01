create index if not exists idx_cte_documents_driver_catalog_load_ids
  on public.cte_documents using gin (load_ids)
  where status = 'authorized' and cancelled_at is null and is_voided = false;

create index if not exists idx_cte_documents_driver_catalog_fiscal_ids
  on public.cte_documents using gin (fiscal_document_ids)
  where status = 'authorized' and cancelled_at is null and is_voided = false;

create index if not exists idx_nfse_documents_driver_catalog_trip
  on public.nfse_documents (tenant_id, trip_id)
  where status = 'issued' and cancelled = false and is_preview = false and trip_id is not null;

create index if not exists idx_nfse_documents_driver_catalog_cte_ids
  on public.nfse_documents using gin (related_cte_ids)
  where status = 'issued' and cancelled = false and is_preview = false;

create or replace function public.driver_list_load_fiscal_catalog(
  _tenant_id uuid,
  _load_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_driver_id uuid;
  v_driver_count integer;
  v_owns_load boolean := false;
  v_documents jsonb := '[]'::jsonb;
begin
  if v_actor_id is null or _tenant_id is null or _load_id is null then
    raise sqlstate '42501' using message = 'not_authorized';
  end if;

  select count(*)::integer, (array_agg(d.id order by d.id))[1]
    into v_driver_count, v_driver_id
  from public.drivers d
  where d.tenant_id = _tenant_id
    and d.user_id = v_actor_id
    and d.active = true
    and exists (
      select 1
      from public.tenant_memberships tm
      where tm.tenant_id = _tenant_id
        and tm.user_id = v_actor_id
        and tm.active = true
    );

  if v_driver_count <> 1 or v_driver_id is null then
    raise sqlstate '42501' using message = 'not_authorized';
  end if;

  select exists (
    select 1
    from public.loads l
    where l.id = _load_id
      and l.tenant_id = _tenant_id
      and l.on_hold = false
      and (l.driver_id is null or l.driver_id = v_driver_id)
      and (
        l.driver_id = v_driver_id
        or exists (
          select 1
          from public.dispatch_trip_loads dtl
          join public.dispatch_trips dt
            on dt.id = dtl.dispatch_trip_id
           and dt.tenant_id = _tenant_id
           and dt.driver_id = v_driver_id
          where dtl.load_id = l.id
            and dtl.tenant_id = _tenant_id
        )
        or exists (
          select 1
          from public.dispatch_trips dt
          where dt.id = l.trip_id
            and dt.tenant_id = _tenant_id
            and dt.driver_id = v_driver_id
        )
      )
      and (
        l.trip_id is null
        or exists (
          select 1
          from public.dispatch_trips dt
          where dt.id = l.trip_id
            and dt.tenant_id = _tenant_id
            and dt.driver_id = v_driver_id
        )
      )
      and not exists (
        select 1
        from public.dispatch_trip_loads dtl
        left join public.dispatch_trips dt on dt.id = dtl.dispatch_trip_id
        where dtl.load_id = l.id
          and (
            dtl.tenant_id is distinct from _tenant_id
            or dt.id is null
            or dt.tenant_id is distinct from _tenant_id
            or dt.driver_id is distinct from v_driver_id
          )
      )
  ) into v_owns_load;

  if not v_owns_load then
    raise sqlstate '42501' using message = 'not_authorized';
  end if;

  with load_notes as (
    select fd.id
    from public.fiscal_documents fd
    where fd.tenant_id = _tenant_id
      and fd.load_id = _load_id
      and fd.document_type = 'inbound'
      and fd.deleted_at is null
      and fd.status not in ('deleted', 'cancelled')
  ),
  authorized_ctes as (
    select c.id
    from public.cte_documents c
    where c.tenant_id = _tenant_id
      and c.status = 'authorized'
      and c.cancelled_at is null
      and c.is_voided = false
      and (
        coalesce(c.load_ids, '{}'::uuid[]) @> array[_load_id]
        or exists (
          select 1
          from load_notes ln
          where coalesce(c.fiscal_document_ids, '{}'::uuid[]) @> array[ln.id]
        )
      )
  ),
  catalog as (
    select
      1 as kind_order,
      fd.issue_date::text as sort_date,
      jsonb_build_object(
        'kind', 'nfe',
        'id', fd.id,
        'number', fd.invoice_number,
        'series', fd.invoice_series,
        'issued_at', fd.issue_date,
        'issuer', fd.remitter,
        'recipient', fd.recipient,
        'destination_city', fd.recipient_city,
        'destination_state', fd.recipient_state,
        'amount', fd.value,
        'weight_kg', fd.weight_kg,
        'volume_count', fd.volume_count,
        'pallet_count', fd.pallet_count
      ) as document
    from public.fiscal_documents fd
    join load_notes ln on ln.id = fd.id

    union all

    select
      2,
      c.issued_at::text,
      jsonb_build_object(
        'kind', 'cte',
        'id', c.id,
        'number', coalesce(c.cte_number, c.reference_number, c.internal_number),
        'series', c.cte_series,
        'issued_at', c.issued_at,
        'issuer', c.remitter,
        'recipient', c.recipient,
        'destination_city', c.recipient_city,
        'destination_state', c.recipient_state,
        'amount', c.freight_value,
        'weight_kg', c.weight_kg,
        'volume_count', null,
        'pallet_count', c.pallet_count
      )
    from public.cte_documents c
    join authorized_ctes ac on ac.id = c.id

    union all

    select
      3,
      coalesce(n.authorization_date::text, n.issue_date::text),
      jsonb_build_object(
        'kind', 'nfse',
        'id', n.id,
        'number', coalesce(n.nfse_number, n.invoice_number, n.rps_number),
        'series', n.series,
        'issued_at', coalesce(n.authorization_date::date, n.issue_date),
        'issuer', null,
        'recipient', n.cliente_nome,
        'destination_city', n.cliente_municipio,
        'destination_state', n.cliente_uf,
        'amount', n.valor_total,
        'weight_kg', null,
        'volume_count', null,
        'pallet_count', null
      )
    from public.nfse_documents n
    where n.tenant_id = _tenant_id
      and n.status = 'issued'
      and n.cancelled = false
      and n.is_preview = false
      and (
        n.load_id = _load_id
        or exists (
          select 1
          from public.dispatch_trip_loads dtl
          join public.dispatch_trips dt
            on dt.id = dtl.dispatch_trip_id
           and dt.tenant_id = _tenant_id
           and dt.driver_id = v_driver_id
          where dtl.tenant_id = _tenant_id
            and dtl.load_id = _load_id
            and dt.id = n.trip_id
        )
        or exists (
          select 1
          from load_notes ln
          where coalesce(n.fiscal_document_ids, '{}'::uuid[]) @> array[ln.id]
        )
        or exists (
          select 1
          from authorized_ctes ac
          where coalesce(n.related_cte_ids, '{}'::uuid[]) @> array[ac.id]
        )
      )
  )
  select coalesce(
    jsonb_agg(catalog.document order by catalog.sort_date desc nulls last, catalog.kind_order, catalog.document->>'number'),
    '[]'::jsonb
  )
  into v_documents
  from catalog;

  return jsonb_build_object(
    'load_id', _load_id,
    'documents', v_documents
  );
end;
$function$;

revoke all privileges on function public.driver_list_load_fiscal_catalog(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.driver_list_load_fiscal_catalog(uuid, uuid)
  to authenticated;

comment on function public.driver_list_load_fiscal_catalog(uuid, uuid) is
  'Read-only driver catalog for safe load NF-e metadata and already-authorized CT-e/NFS-e. Performs no provider calls or fiscal mutations.';
