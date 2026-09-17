-- Client portal fiscal bundle and financial titles.
-- The public functions are unprivileged Data API wrappers. All elevated reads
-- live in the private schema and re-check the authenticated user, tenant,
-- client/document scope and the corresponding portal permission.

set local lock_timeout = '3s';
set local statement_timeout = '30s';

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.portal_read_fiscal_bundle(
  _tenant_id uuid,
  _fiscal_document_id uuid,
  _document_kind text default null,
  _document_id uuid default null,
  _format text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_can_download boolean := false;
  v_can_financial boolean := false;
  v_allowed boolean := false;
  v_documents jsonb := '[]'::jsonb;
  v_url text;
  v_content text;
  v_number text;
  v_filename text;
begin
  if v_actor_id is null or _tenant_id is null or _fiscal_document_id is null then
    raise sqlstate '42501' using message = 'not_authorized';
  end if;

  if not exists (
    select 1
    from public.fiscal_documents fd
    where fd.id = _fiscal_document_id
      and fd.tenant_id = _tenant_id
      and fd.deleted_at is null
  ) or not public.portal_user_can_access_fiscal_document(_tenant_id, _fiscal_document_id) then
    raise sqlstate '42501' using message = 'not_authorized';
  end if;

  v_can_download := public.portal_user_can_download_fiscal_document(
    _tenant_id,
    _fiscal_document_id
  );
  v_can_financial := public.portal_user_can_view_financial(
    _tenant_id,
    _fiscal_document_id
  );

  with linked_ctes as (
    select c.*
    from public.cte_documents c
    where c.tenant_id = _tenant_id
      and c.status = 'authorized'
      and c.cancelled_at is null
      and c.is_voided = false
      and coalesce(c.fiscal_document_ids, '{}'::uuid[]) @> array[_fiscal_document_id]
  ), catalog as (
    select
      1 as kind_order,
      c.issued_at as sort_at,
      jsonb_build_object(
        'kind', 'cte',
        'id', c.id,
        'number', coalesce(c.cte_number, c.reference_number, c.internal_number),
        'series', c.cte_series,
        'issued_at', c.issued_at,
        'status', c.status,
        'issuer', c.remitter,
        'recipient', c.recipient,
        'amount', case when v_can_financial then c.freight_value end,
        'available_files', jsonb_build_object(
          'pdf', coalesce(nullif(btrim(c.pdf_url), '') ~* '^https://[^[:space:]/@]+(:[0-9]{1,5})?(/|$)', false),
          'xml', coalesce(nullif(btrim(c.xml_url), '') ~* '^https://[^[:space:]/@]+(:[0-9]{1,5})?(/|$)', false)
            or nullif(btrim(c.xml_content), '') is not null
        )
      ) as document
    from linked_ctes c

    union all

    select
      2,
      coalesce(n.authorization_date, n.issue_date::timestamptz),
      jsonb_build_object(
        'kind', 'nfse',
        'id', n.id,
        'number', coalesce(n.nfse_number, n.invoice_number, n.rps_number),
        'series', n.series,
        'issued_at', coalesce(n.authorization_date, n.issue_date::timestamptz),
        'status', n.status,
        'issuer', n.prestador_cnpj,
        'recipient', n.cliente_nome,
        'amount', case when v_can_financial then n.valor_total end,
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
        coalesce(n.fiscal_document_ids, '{}'::uuid[]) @> array[_fiscal_document_id]
        or exists (
          select 1
          from linked_ctes c
          where coalesce(n.related_cte_ids, '{}'::uuid[]) @> array[c.id]
        )
      )
  )
  select coalesce(
    jsonb_agg(catalog.document order by catalog.sort_at desc nulls last, catalog.kind_order, catalog.document->>'number'),
    '[]'::jsonb
  )
  into v_documents
  from catalog;

  if _document_kind is null and _document_id is null and _format is null then
    return jsonb_build_object(
      'context', jsonb_build_object(
        'tenant_id', _tenant_id,
        'actor_id', v_actor_id,
        'document_id', _fiscal_document_id
      ),
      'can_download_documents', v_can_download,
      'documents', v_documents
    );
  end if;

  if not v_can_download then
    raise sqlstate '42501' using message = 'download_not_allowed';
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

  v_filename := _document_kind || '-' || regexp_replace(
    coalesce(nullif(v_number, ''), _document_id::text),
    '[^A-Za-z0-9._-]',
    '-',
    'g'
  ) || '.' || _format;

  return jsonb_strip_nulls(jsonb_build_object(
    'context', jsonb_build_object(
      'tenant_id', _tenant_id,
      'actor_id', v_actor_id,
      'document_id', _fiscal_document_id
    ),
    'kind', _document_kind,
    'fiscal_document_id', _fiscal_document_id,
    'document_id', _document_id,
    'format', _format,
    'source', case when v_url is not null then 'url' else 'inline' end,
    'filename', v_filename,
    'url', v_url,
    'content', v_content
  ));
end;
$function$;

revoke all privileges on function private.portal_read_fiscal_bundle(uuid, uuid, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function private.portal_read_fiscal_bundle(uuid, uuid, text, uuid, text)
  to authenticated;

create or replace function public.portal_list_fiscal_bundle(
  _tenant_id uuid,
  _fiscal_document_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
set row_security = on
as $function$
  select private.portal_read_fiscal_bundle(
    _tenant_id,
    _fiscal_document_id,
    null,
    null,
    null
  );
$function$;

create or replace function public.portal_get_fiscal_file(
  _tenant_id uuid,
  _fiscal_document_id uuid,
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
  select private.portal_read_fiscal_bundle(
    _tenant_id,
    _fiscal_document_id,
    _document_kind,
    _document_id,
    _format
  );
$function$;

revoke all privileges on function public.portal_list_fiscal_bundle(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.portal_list_fiscal_bundle(uuid, uuid) to authenticated;

revoke all privileges on function public.portal_get_fiscal_file(uuid, uuid, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.portal_get_fiscal_file(uuid, uuid, text, uuid, text) to authenticated;

create or replace function private.portal_read_financial_titles(
  _tenant_id uuid,
  _client_id uuid default null,
  _status text[] default null,
  _limit integer default 50,
  _offset integer default 0,
  _title_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_rows jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_url text;
  v_number text;
begin
  if v_actor_id is null or _tenant_id is null then
    raise sqlstate '42501' using message = 'not_authorized';
  end if;
  if _limit < 1 or _limit > 100 or _offset < 0 then
    raise sqlstate '22023' using message = 'invalid_pagination';
  end if;

  if _title_id is not null then
    select nullif(btrim(ci.pdf_url), ''), coalesce(ci.invoice_number, r.invoice_number, r.id::text)
    into v_url, v_number
    from public.receivables r
    left join public.client_invoices ci
      on ci.tenant_id = r.tenant_id
     and (ci.id = r.client_invoice_id or ci.receivable_id = r.id)
    where r.id = _title_id
      and r.tenant_id = _tenant_id
      and exists (
        select 1
        from public.client_portal_access cpa
        where cpa.tenant_id = r.tenant_id
          and cpa.user_id = v_actor_id
          and cpa.client_id = r.client_id
          and cpa.active = true
          and cpa.can_view_financial = true
          and cpa.can_download_documents = true
      )
    order by (ci.id = r.client_invoice_id) desc
    limit 1;

    if v_url is null or not (v_url ~* '^https://[^[:space:]/@]+(:[0-9]{1,5})?(/|$)') then
      raise sqlstate '22023' using message = 'file_not_available';
    end if;

    return jsonb_build_object(
      'context', jsonb_build_object('tenant_id', _tenant_id, 'actor_id', v_actor_id, 'title_id', _title_id),
      'source', 'url',
      'filename', 'titulo-' || regexp_replace(v_number, '[^A-Za-z0-9._-]', '-', 'g') || '.pdf',
      'url', v_url
    );
  end if;

  with scoped as materialized (
    select
      r.id,
      r.client_id,
      c.company_name as client_name,
      r.fiscal_document_id,
      r.load_id,
      r.description,
      coalesce(ci.invoice_number, r.invoice_number) as invoice_number,
      r.amount,
      coalesce(r.received_amount, 0) as received_amount,
      greatest(r.amount - coalesce(r.received_amount, 0), 0) as outstanding_amount,
      coalesce(ci.due_date, r.due_date) as due_date,
      r.status,
      r.received_at,
      r.client_invoice_id,
      ci.issue_date as billing_issue_date,
      ci.status as billing_status,
      coalesce(ci.total_amount, r.amount) as billing_total_amount,
      coalesce(nullif(btrim(ci.pdf_url), '') ~* '^https://[^[:space:]/@]+(:[0-9]{1,5})?(/|$)', false) as has_pdf,
      exists (
        select 1
        from public.client_portal_access download_access
        where download_access.tenant_id = r.tenant_id
          and download_access.user_id = v_actor_id
          and download_access.client_id = r.client_id
          and download_access.active = true
          and download_access.can_view_financial = true
          and download_access.can_download_documents = true
      ) as can_download
    from public.receivables r
    join public.clients c on c.id = r.client_id and c.tenant_id = r.tenant_id
    left join lateral (
      select invoice.*
      from public.client_invoices invoice
      where invoice.tenant_id = r.tenant_id
        and (invoice.id = r.client_invoice_id or invoice.receivable_id = r.id)
      order by (invoice.id = r.client_invoice_id) desc, invoice.created_at desc
      limit 1
    ) ci on true
    where r.tenant_id = _tenant_id
      and (_client_id is null or r.client_id = _client_id)
      and (_status is null or r.status = any(_status))
      and exists (
        select 1
        from public.client_portal_access cpa
        where cpa.tenant_id = r.tenant_id
          and cpa.user_id = v_actor_id
          and cpa.client_id = r.client_id
          and cpa.active = true
          and cpa.can_view_financial = true
      )
  ), page as (
    select *
    from scoped
    order by due_date asc nulls last, id
    limit _limit offset _offset
  )
  select
    coalesce(jsonb_agg(to_jsonb(page) order by due_date asc nulls last, id), '[]'::jsonb),
    (select count(*)::integer from scoped)
  into v_rows, v_total
  from page;

  return jsonb_build_object(
    'context', jsonb_build_object('tenant_id', _tenant_id, 'actor_id', v_actor_id, 'client_id', _client_id),
    'rows', v_rows,
    'total', v_total
  );
end;
$function$;

revoke all privileges on function private.portal_read_financial_titles(uuid, uuid, text[], integer, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.portal_read_financial_titles(uuid, uuid, text[], integer, integer, uuid)
  to authenticated;

create or replace function public.portal_list_financial_titles(
  _tenant_id uuid,
  _client_id uuid default null,
  _status text[] default null,
  _limit integer default 50,
  _offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
set row_security = on
as $function$
  select private.portal_read_financial_titles(
    _tenant_id,
    _client_id,
    _status,
    _limit,
    _offset,
    null
  );
$function$;

create or replace function public.portal_get_financial_title_file(
  _tenant_id uuid,
  _title_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
set row_security = on
as $function$
  select private.portal_read_financial_titles(
    _tenant_id,
    null,
    null,
    1,
    0,
    _title_id
  );
$function$;

revoke all privileges on function public.portal_list_financial_titles(uuid, uuid, text[], integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.portal_list_financial_titles(uuid, uuid, text[], integer, integer)
  to authenticated;

revoke all privileges on function public.portal_get_financial_title_file(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.portal_get_financial_title_file(uuid, uuid)
  to authenticated;

comment on function public.portal_list_fiscal_bundle(uuid, uuid) is
  'Lists authorized CT-e and NFS-e documents linked to one portal-visible NF without exposing provider payloads or file URLs.';
comment on function public.portal_get_fiscal_file(uuid, uuid, text, uuid, text) is
  'Returns one authorized stored CT-e or NFS-e file for a portal-visible NF.';
comment on function public.portal_list_financial_titles(uuid, uuid, text[], integer, integer) is
  'Lists financial titles only for client grants with can_view_financial enabled.';
comment on function public.portal_get_financial_title_file(uuid, uuid) is
  'Returns the PDF URL for one authorized financial title when document downloads are enabled.';
