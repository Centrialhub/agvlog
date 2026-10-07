-- Restore the published RPC only when its signature is absent. Existing definitions and ACLs stay intact.
do $restore$
declare
  v_missing_columns text;
begin
  if to_regprocedure('public.list_client_mdfe_documents_v1(uuid,uuid,text,date,date,integer,integer)') is not null then
    return;
  end if;
  if to_regclass('public.load_manifests') is null
    or to_regclass('public.fiscal_documents') is null
    or to_regprocedure('public._portal_assert_client_access(uuid,uuid)') is null
    or to_regprocedure('public._portal_user_client_ids(uuid)') is null
    or to_regrole('anon') is null
    or to_regrole('authenticated') is null
    or to_regrole('service_role') is null then
    raise exception '20260926191456_restore_client_mdfe_documents_v1.sql_dependency_missing';
  end if;
  select string_agg(format('%I.%I', required.relation_name, required.column_name), ', '
                    order by required.relation_name, required.column_name)
    into v_missing_columns
  from (values
      ('load_manifests', 'id'),
      ('load_manifests', 'tenant_id'),
      ('load_manifests', 'external_id'),
      ('load_manifests', 'fiscal_document_ids'),
      ('load_manifests', 'load_id'),
      ('load_manifests', 'issued_at'),
      ('load_manifests', 'created_at'),
      ('load_manifests', 'document_number'),
      ('load_manifests', 'manifest_number'),
      ('load_manifests', 'access_key'),
      ('load_manifests', 'responsible_name'),
      ('load_manifests', 'destination'),
      ('load_manifests', 'status'),
      ('fiscal_documents', 'id'),
      ('fiscal_documents', 'tenant_id'),
      ('fiscal_documents', 'client_id'),
      ('fiscal_documents', 'load_id')
  ) as required(relation_name, column_name)
  where not exists (
    select 1 from pg_attribute a
    where a.attrelid = to_regclass('public.' || required.relation_name)
      and a.attname = required.column_name and a.attnum > 0 and not a.attisdropped
  );
  if v_missing_columns is not null then
    raise exception '20260926191456_restore_client_mdfe_documents_v1.sql_column_missing: %', v_missing_columns;
  end if;

  execute $definition$
create function public.list_client_mdfe_documents_v1(
  _tenant_id uuid,
  _client_id uuid default null,
  _search text default null,
  _start_date date default null,
  _end_date date default null,
  _limit integer default 50,
  _offset integer default 0
)
returns table(
  id uuid,
  document_type text,
  invoice_number text,
  access_key text,
  issue_date date,
  remitter text,
  recipient text,
  recipient_city text,
  recipient_state text,
  value numeric,
  weight_kg numeric,
  status text,
  load_id uuid,
  client_id uuid,
  has_pod boolean
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_search text := nullif(btrim(_search), '');
begin
  if _limit is null or _limit not between 1 and 200
     or _offset is null or _offset not between 0 and 1000000 then
    raise exception using message = 'portal_invalid_pagination', errcode = '22023';
  end if;
  perform public._portal_assert_client_access(_tenant_id, _client_id);

  return query
  with allowed as materialized (
    select unnest(public._portal_user_client_ids(_tenant_id)) as id
  )
  select
    m.id,
    'mdfe'::text,
    coalesce(m.document_number, m.manifest_number),
    m.access_key,
    coalesce(m.issued_at, m.created_at)::date,
    m.responsible_name,
    m.destination,
    null::text,
    null::text,
    null::numeric,
    null::numeric,
    m.status,
    m.load_id,
    _client_id,
    false
  from public.load_manifests m
  where m.tenant_id = _tenant_id
    and m.external_id is not null
    and exists (
      select 1
      from public.fiscal_documents fd
      where fd.tenant_id = _tenant_id
        and fd.client_id in (select allowed.id from allowed)
        and (_client_id is null or fd.client_id = _client_id)
        and (fd.id = any(m.fiscal_document_ids) or fd.load_id = m.load_id)
    )
    and (_start_date is null or coalesce(m.issued_at, m.created_at)::date >= _start_date)
    and (_end_date is null or coalesce(m.issued_at, m.created_at)::date <= _end_date)
    and (
      v_search is null
      or position(lower(v_search) in lower(coalesce(m.document_number, m.manifest_number, ''))) > 0
      or position(lower(v_search) in lower(coalesce(m.access_key, ''))) > 0
      or position(lower(v_search) in lower(coalesce(m.responsible_name, ''))) > 0
      or position(lower(v_search) in lower(coalesce(m.destination, ''))) > 0
    )
  order by coalesce(m.issued_at, m.created_at) desc, m.id desc
  limit _limit offset _offset;
end;
$function$;
$definition$;
  revoke all on function public.list_client_mdfe_documents_v1(uuid,uuid,text,date,date,integer,integer) from public, anon, authenticated, service_role;
  grant execute on function public.list_client_mdfe_documents_v1(uuid,uuid,text,date,date,integer,integer) to authenticated, service_role;
end;
$restore$;
