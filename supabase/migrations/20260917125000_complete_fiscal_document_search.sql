create or replace function public.get_fiscal_documents_page_v1(
  _tenant_id uuid,
  _page_offset integer,
  _page_limit integer,
  _search text default null,
  _document_type text default null,
  _status text default null,
  _load_filter text default null
) returns table(items jsonb, total_count bigint)
language plpgsql
stable
security invoker
set search_path to ''
as $function$
begin
  if _tenant_id is null or _page_offset < 0 or _page_limit < 1 or _page_limit > 200 then
    raise exception 'invalid_fiscal_document_page' using errcode = '22023';
  end if;
  if _load_filter is not null and _load_filter not in ('no_load', 'with_load') then
    raise exception 'invalid_fiscal_document_load_filter' using errcode = '22023';
  end if;

  return query
  with filtered as materialized (
    select f.*
    from public.fiscal_documents f
    left join public.clients c on c.id = f.client_id and c.tenant_id = f.tenant_id
    where f.tenant_id = _tenant_id
      and f.deleted_at is null
      and (_document_type is null or f.document_type = _document_type)
      and (_status is null or f.status = _status)
      and (_load_filter is null
        or (_load_filter = 'no_load' and f.load_id is null)
        or (_load_filter = 'with_load' and f.load_id is not null))
      and (nullif(btrim(_search), '') is null
        or f.invoice_number ilike '%' || btrim(_search) || '%'
        or f.remitter ilike '%' || btrim(_search) || '%'
        or f.recipient ilike '%' || btrim(_search) || '%'
        or f.access_key ilike '%' || btrim(_search) || '%'
        or c.company_name ilike '%' || btrim(_search) || '%')
  ), page_rows as (
    select f.*,
      c.company_name as client_company_name,
      l.load_number as related_load_number,
      o.order_number as related_order_number
    from filtered f
    left join public.clients c on c.id = f.client_id and c.tenant_id = f.tenant_id
    left join public.loads l on l.id = f.load_id and l.tenant_id = f.tenant_id
    left join public.orders o on o.id = f.order_id and o.tenant_id = f.tenant_id
    order by f.created_at desc, f.id desc
    offset _page_offset limit _page_limit
  )
  select coalesce(jsonb_agg(
      (to_jsonb(p) - 'client_company_name' - 'related_load_number' - 'related_order_number')
      || jsonb_build_object(
        'clients', case when p.client_company_name is null then null else jsonb_build_object('company_name', p.client_company_name) end,
        'loads', case when p.related_load_number is null then null else jsonb_build_object('load_number', p.related_load_number) end,
        'orders', case when p.related_order_number is null then null else jsonb_build_object('order_number', p.related_order_number) end
      ) order by p.created_at desc, p.id desc
    ), '[]'::jsonb),
    (select count(*) from filtered)
  from page_rows p;
end;
$function$;

revoke all on function public.get_fiscal_documents_page_v1(uuid,integer,integer,text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_fiscal_documents_page_v1(uuid,integer,integer,text,text,text,text)
  to authenticated, service_role;

comment on function public.get_fiscal_documents_page_v1(uuid,integer,integer,text,text,text,text) is
  'Returns a complete paged fiscal-document search, including client-name matches without a capped client-id prequery.';
