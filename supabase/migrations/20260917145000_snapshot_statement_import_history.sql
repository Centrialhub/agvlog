-- Freeze a statement history traversal at the server time returned by page 1.
-- This keeps later events from shifting OFFSET positions while the user pages.
drop function if exists public.list_finance_statement_history_v1(uuid,uuid,integer,integer);
drop function if exists finance_private.statement_history(uuid,uuid,integer,integer);

create function finance_private.statement_history(
  _tenant uuid,
  _import uuid,
  _page integer default 1,
  _page_size integer default 30,
  _snapshot_at timestamptz default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  snapshot_at timestamptz := coalesce(_snapshot_at, clock_timestamp());
begin
  if not finance_private.can_access(_tenant) then
    raise exception 'finance_access_denied' using errcode = '42501';
  end if;
  if _page not between 1 and 1000000 or _page_size not between 1 and 100 then
    raise exception 'finance_invalid_statement_history_page' using errcode = '22023';
  end if;
  if _snapshot_at is not null and _snapshot_at > clock_timestamp() then
    raise exception 'finance_invalid_statement_history_snapshot' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.finance_statement_imports
    where tenant_id = _tenant and id = _import
  ) then
    raise exception 'finance_statement_not_found' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'version', 1,
    'tenant_id', _tenant,
    'import_id', _import,
    'page', _page,
    'page_size', _page_size,
    'snapshot_at', snapshot_at,
    'total', (
      select count(*)
      from public.finance_events e
      where e.tenant_id = _tenant
        and e.entity_type = 'statement_import'
        and e.entity_id = _import
        and e.created_at <= snapshot_at
    ),
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'actor_name', e.actor_name,
          'actor_id', e.actor_id,
          'action', e.action,
          'reason', e.reason,
          'created_at', e.created_at
        ) order by e.created_at desc, e.id desc
      )
      from (
        select *
        from public.finance_events
        where tenant_id = _tenant
          and entity_type = 'statement_import'
          and entity_id = _import
          and created_at <= snapshot_at
        order by created_at desc, id desc
        limit _page_size offset (_page - 1) * _page_size
      ) e
    ), '[]'::jsonb)
  );
end
$function$;

revoke all on function finance_private.statement_history(uuid,uuid,integer,integer,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function finance_private.statement_history(uuid,uuid,integer,integer,timestamptz)
  to authenticated;

create function public.list_finance_statement_history_v1(
  _tenant_id uuid,
  _import_id uuid,
  _page integer default 1,
  _page_size integer default 30,
  _snapshot_at timestamptz default null
) returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select finance_private.statement_history(
    _tenant_id, _import_id, _page, _page_size, _snapshot_at
  );
$function$;

revoke all on function public.list_finance_statement_history_v1(uuid,uuid,integer,integer,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.list_finance_statement_history_v1(uuid,uuid,integer,integer,timestamptz)
  to authenticated;
