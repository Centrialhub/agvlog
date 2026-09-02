do $preflight$
declare
  v_relation regclass;
  v_policy_names text[];
begin
  if exists (
    select 1
    from pg_catalog.pg_roles r
    where r.rolname = 'authenticated'
      and (r.rolsuper or r.rolbypassrls)
  ) then
    raise exception 'Driver fiscal readers require authenticated to be subject to RLS';
  end if;

  foreach v_relation in array array[
    'public.tenant_memberships'::regclass,
    'public.drivers'::regclass,
    'public.loads'::regclass,
    'public.dispatch_trips'::regclass,
    'public.dispatch_trip_loads'::regclass,
    'public.fiscal_documents'::regclass,
    'public.cte_documents'::regclass,
    'public.nfse_documents'::regclass
  ]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class c
      where c.oid = v_relation
        and c.relrowsecurity
    ) then
      raise exception 'Driver fiscal readers require RLS on %', v_relation;
    end if;

    if not pg_catalog.has_table_privilege('authenticated', v_relation, 'SELECT') then
      raise exception 'Driver fiscal readers require authenticated SELECT on %', v_relation;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_policy p
      where p.polrelid = v_relation
        and p.polpermissive
        and p.polcmd in ('r', '*')
        and (
          0::oid = any(p.polroles)
          or (select r.oid from pg_catalog.pg_roles r where r.rolname = 'authenticated') = any(p.polroles)
        )
    ) then
      raise exception 'Driver fiscal readers require an authenticated SELECT policy on %', v_relation;
    end if;
  end loop;

  if to_regprocedure('public.is_user_internal_role(uuid)') is null
     or to_regprocedure('public.is_tenant_admin(uuid)') is null
     or not pg_catalog.has_function_privilege('authenticated', 'public.is_user_internal_role(uuid)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('authenticated', 'public.is_tenant_admin(uuid)', 'EXECUTE') then
    raise exception 'Driver fiscal readers require the internal/admin role helpers';
  end if;

  foreach v_relation in array array[
    'public.cte_documents'::regclass,
    'public.nfse_documents'::regclass
  ]
  loop
    select array_agg(p.polname::text order by p.polname::text)
      into v_policy_names
    from pg_catalog.pg_policy p
    where p.polrelid = v_relation;

    if v_policy_names is distinct from array[
      'agvlog_delete_anon',
      'agvlog_delete_authenticated',
      'agvlog_insert_anon',
      'agvlog_insert_authenticated',
      'agvlog_select_anon',
      'agvlog_select_authenticated',
      'agvlog_update_anon',
      'agvlog_update_authenticated'
    ]::text[] then
      raise exception 'Unexpected fiscal document policy set on %', v_relation;
    end if;
  end loop;
end;
$preflight$;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

drop policy agvlog_delete_anon on public.cte_documents;
drop policy agvlog_insert_anon on public.cte_documents;
drop policy agvlog_select_anon on public.cte_documents;
drop policy agvlog_update_anon on public.cte_documents;
drop policy agvlog_delete_authenticated on public.cte_documents;
drop policy agvlog_insert_authenticated on public.cte_documents;
drop policy agvlog_select_authenticated on public.cte_documents;
drop policy agvlog_update_authenticated on public.cte_documents;

create policy fiscal_internal_select
  on public.cte_documents for select to authenticated
  using ((select public.is_user_internal_role(tenant_id)));
create policy fiscal_internal_insert
  on public.cte_documents for insert to authenticated
  with check ((select public.is_user_internal_role(tenant_id)));
create policy fiscal_internal_update
  on public.cte_documents for update to authenticated
  using ((select public.is_user_internal_role(tenant_id)))
  with check ((select public.is_user_internal_role(tenant_id)));
create policy fiscal_admin_delete
  on public.cte_documents for delete to authenticated
  using ((select public.is_tenant_admin(tenant_id)));

drop policy agvlog_delete_anon on public.nfse_documents;
drop policy agvlog_insert_anon on public.nfse_documents;
drop policy agvlog_select_anon on public.nfse_documents;
drop policy agvlog_update_anon on public.nfse_documents;
drop policy agvlog_delete_authenticated on public.nfse_documents;
drop policy agvlog_insert_authenticated on public.nfse_documents;
drop policy agvlog_select_authenticated on public.nfse_documents;
drop policy agvlog_update_authenticated on public.nfse_documents;

create policy fiscal_internal_select
  on public.nfse_documents for select to authenticated
  using ((select public.is_user_internal_role(tenant_id)));
create policy fiscal_internal_insert
  on public.nfse_documents for insert to authenticated
  with check ((select public.is_user_internal_role(tenant_id)));
create policy fiscal_internal_update
  on public.nfse_documents for update to authenticated
  using ((select public.is_user_internal_role(tenant_id)))
  with check ((select public.is_user_internal_role(tenant_id)));
create policy fiscal_admin_delete
  on public.nfse_documents for delete to authenticated
  using ((select public.is_tenant_admin(tenant_id)));

revoke all privileges on table public.cte_documents, public.nfse_documents
  from public, anon;

-- Keep this migration independently deployable. The earlier catalog draft is
-- intentionally not required because it exposed a SECURITY DEFINER RPC during
-- the transition.
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

create or replace function private.driver_read_load_fiscal(
  _tenant_id uuid,
  _load_id uuid,
  _document_kind text,
  _document_id uuid,
  _format text
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
  v_allowed boolean := false;
  v_url text;
  v_content text;
  v_number text;
  v_source text;
  v_filename text;
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
        'pallet_count', fd.pallet_count,
        'available_files', jsonb_build_object('pdf', false, 'xml', false)
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
        'pallet_count', c.pallet_count,
        'available_files', jsonb_build_object(
          'pdf', coalesce(nullif(btrim(c.pdf_url), '') ~* '^https://[^[:space:]/@]+(:[0-9]{1,5})?(/|$)', false),
          'xml', coalesce(nullif(btrim(c.xml_url), '') ~* '^https://[^[:space:]/@]+(:[0-9]{1,5})?(/|$)', false)
            or nullif(btrim(c.xml_content), '') is not null
        )
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
        'pallet_count', null,
        'available_files', jsonb_build_object(
          'pdf', coalesce(nullif(btrim(n.pdf_url), '') ~* '^https://[^[:space:]/@]+(:[0-9]{1,5})?(/|$)', false),
          'xml', coalesce(nullif(btrim(n.xml_url), '') ~* '^https://[^[:space:]/@]+(:[0-9]{1,5})?(/|$)', false)
        )
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

  if _document_kind is null and _document_id is null and _format is null then
    return jsonb_build_object(
      'load_id', _load_id,
      'documents', v_documents
    );
  end if;

  if _document_kind not in ('cte', 'nfse')
     or _document_id is null
     or _format not in ('pdf', 'xml') then
    raise sqlstate '22023' using message = 'invalid_file_request';
  end if;

  select exists (
    select 1
    from jsonb_array_elements(v_documents) as document
    where document->>'kind' = _document_kind
      and document->>'id' = _document_id::text
      and coalesce((document->'available_files'->>_format)::boolean, false)
  ) into v_allowed;

  if not v_allowed then
    raise sqlstate '42501' using message = 'not_authorized';
  end if;

  if _document_kind = 'cte' then
    select
      case
        when _format = 'pdf' and coalesce(nullif(btrim(c.pdf_url), '') ~* '^https://[^[:space:]/@]+(:[0-9]{1,5})?(/|$)', false) then btrim(c.pdf_url)
        when _format = 'xml' and coalesce(nullif(btrim(c.xml_url), '') ~* '^https://[^[:space:]/@]+(:[0-9]{1,5})?(/|$)', false) then btrim(c.xml_url)
      end,
      case
        when _format = 'xml'
          and not coalesce(nullif(btrim(c.xml_url), '') ~* '^https://[^[:space:]/@]+(:[0-9]{1,5})?(/|$)', false)
          and nullif(btrim(c.xml_content), '') is not null
        then c.xml_content
      end,
      coalesce(c.cte_number, c.reference_number, c.internal_number)
      into v_url, v_content, v_number
    from public.cte_documents c
    where c.id = _document_id
      and c.tenant_id = _tenant_id
      and c.status = 'authorized'
      and c.cancelled_at is null
      and c.is_voided = false;
  else
    select
      case
        when _format = 'pdf' and coalesce(nullif(btrim(n.pdf_url), '') ~* '^https://[^[:space:]/@]+(:[0-9]{1,5})?(/|$)', false) then btrim(n.pdf_url)
        when _format = 'xml' and coalesce(nullif(btrim(n.xml_url), '') ~* '^https://[^[:space:]/@]+(:[0-9]{1,5})?(/|$)', false) then btrim(n.xml_url)
      end,
      null::text,
      coalesce(n.nfse_number, n.invoice_number, n.rps_number)
      into v_url, v_content, v_number
    from public.nfse_documents n
    where n.id = _document_id
      and n.tenant_id = _tenant_id
      and n.status = 'issued'
      and n.cancelled = false
      and n.is_preview = false;
  end if;

  if v_url is null and v_content is null then
    raise sqlstate '22023' using message = 'file_not_available';
  end if;

  if v_content is not null and octet_length(v_content) > 10485760 then
    raise sqlstate '54000' using message = 'file_too_large';
  end if;

  v_source := case when v_url is not null then 'url' else 'inline' end;
  v_filename := _document_kind || '-' || regexp_replace(
    coalesce(nullif(v_number, ''), _document_id::text),
    '[^A-Za-z0-9._-]',
    '-',
    'g'
  ) || '.' || _format;

  return jsonb_strip_nulls(jsonb_build_object(
    'load_id', _load_id,
    'kind', _document_kind,
    'document_id', _document_id,
    'format', _format,
    'source', v_source,
    'filename', v_filename,
    'url', v_url,
    'content', v_content
  ));
end;
$function$;

revoke all privileges on function private.driver_read_load_fiscal(uuid, uuid, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function private.driver_read_load_fiscal(uuid, uuid, text, uuid, text)
  to authenticated;

comment on function private.driver_read_load_fiscal(uuid, uuid, text, uuid, text) is
  'Single privileged fiscal reader hidden from the Data API. It authenticates one active driver/load graph and returns only the safe catalog or one authorized stored CT-e/NFS-e file; it performs no provider calls or fiscal mutations.';

create or replace function public.driver_list_load_fiscal_catalog(
  _tenant_id uuid,
  _load_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
set row_security = on
as $function$
  select private.driver_read_load_fiscal(_tenant_id, _load_id, null, null, null);
$function$;

revoke all privileges on function public.driver_list_load_fiscal_catalog(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.driver_list_load_fiscal_catalog(uuid, uuid)
  to authenticated;

comment on function public.driver_list_load_fiscal_catalog(uuid, uuid) is
  'Unprivileged Data API wrapper for a safe driver load fiscal projection. Performs no provider calls or fiscal mutations.';

-- Final public file endpoint is an unprivileged wrapper. Keeping all elevated
-- reads in one private helper avoids a second exposed SECURITY DEFINER surface.
create or replace function public.driver_get_load_fiscal_file(
  _tenant_id uuid,
  _load_id uuid,
  _document_kind text,
  _document_id uuid,
  _format text
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
set row_security = on
as $function$
  select private.driver_read_load_fiscal(
    _tenant_id,
    _load_id,
    _document_kind,
    _document_id,
    _format
  );
$function$;

revoke all privileges on function public.driver_get_load_fiscal_file(uuid, uuid, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.driver_get_load_fiscal_file(uuid, uuid, text, uuid, text)
  to authenticated;

comment on function public.driver_get_load_fiscal_file(uuid, uuid, text, uuid, text) is
  'Unprivileged Data API wrapper for one authorized stored CT-e/NFS-e file. Performs no provider calls or fiscal mutations.';
