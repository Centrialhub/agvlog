create or replace function private.portal_financial_titles_revision(
  _tenant_id uuid,
  _client_id uuid default null,
  _status text[] default null
)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  with candidates as (
    select
      r.id,
      coalesce(ci.due_date, r.due_date) as due_date,
      case
        when r.status in ('pending', 'invoiced', 'partial')
         and isfinite(coalesce(ci.due_date, r.due_date))
         and coalesce(ci.due_date, r.due_date) < (statement_timestamp() at time zone 'America/Sao_Paulo')::date
         and greatest(r.amount - coalesce(r.received_amount, 0), 0) > 0
        then 'overdue'
        else r.status
      end as effective_status
    from public.receivables r
    left join lateral (
      select invoice.due_date
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
          and cpa.user_id = auth.uid()
          and cpa.client_id = r.client_id
          and cpa.active = true
          and cpa.can_view_financial = true
      )
  )
  select md5(coalesce(string_agg(
    id::text || ':' || coalesce(due_date::text, '') || ':' || effective_status,
    '|' order by due_date asc nulls last, id
  ) filter (where _status is null or effective_status = any(_status)), ''))
  from candidates;
$function$;

revoke all privileges on function private.portal_financial_titles_revision(uuid, uuid, text[])
  from public, anon, authenticated, service_role;
grant execute on function private.portal_financial_titles_revision(uuid, uuid, text[])
  to authenticated;

create or replace function public.portal_list_financial_titles_v2(
  _tenant_id uuid,
  _client_id uuid default null,
  _status text[] default null,
  _limit integer default 50,
  _offset integer default 0,
  _revision text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set row_security = on
as $function$
declare
  v_revision text;
  v_result jsonb;
begin
  v_revision := private.portal_financial_titles_revision(_tenant_id, _client_id, _status);

  if _revision is not null and _revision <> v_revision then
    raise sqlstate '40001' using message = 'financial_titles_revision_changed';
  end if;

  v_result := private.portal_read_financial_titles(
    _tenant_id,
    _client_id,
    _status,
    _limit,
    _offset,
    null
  );

  return v_result || jsonb_build_object('revision', v_revision);
end;
$function$;

revoke all privileges on function public.portal_list_financial_titles_v2(uuid, uuid, text[], integer, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.portal_list_financial_titles_v2(uuid, uuid, text[], integer, integer, text)
  to authenticated;

comment on function public.portal_list_financial_titles_v2(uuid, uuid, text[], integer, integer, text) is
  'Lists portal financial titles and rejects offset pagination when the ordered result-set revision changed.';
