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
  v_today date := (statement_timestamp() at time zone 'America/Sao_Paulo')::date;
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

  with candidates as materialized (
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
      case
        when r.status in ('pending', 'invoiced', 'partial')
         and isfinite(coalesce(ci.due_date, r.due_date))
         and coalesce(ci.due_date, r.due_date) < v_today
         and greatest(r.amount - coalesce(r.received_amount, 0), 0) > 0
        then 'overdue'
        else r.status
      end as status,
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
      and exists (
        select 1
        from public.client_portal_access cpa
        where cpa.tenant_id = r.tenant_id
          and cpa.user_id = v_actor_id
          and cpa.client_id = r.client_id
          and cpa.active = true
          and cpa.can_view_financial = true
      )
  ), scoped as materialized (
    select *
    from candidates
    where _status is null or status = any(_status)
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

comment on function private.portal_read_financial_titles(uuid, uuid, text[], integer, integer, uuid) is
  'Reads authorized portal financial titles and derives overdue status from local due date and outstanding balance.';
