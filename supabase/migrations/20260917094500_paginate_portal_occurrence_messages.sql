create or replace function public.list_client_occurrence_messages_v2(
  _tenant_id uuid,
  _occurrence_id uuid,
  _limit integer default 100,
  _before_created_at timestamptz default null,
  _before_id uuid default null
)
returns table(
  id uuid,
  author_role text,
  author_name text,
  message text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_client uuid;
begin
  if _limit < 1 or _limit > 201 then
    raise exception 'Limit must be between 1 and 201';
  end if;
  if (_before_created_at is null) <> (_before_id is null) then
    raise exception 'Message cursor is incomplete';
  end if;

  select e.client_id
  into v_client
  from public.operational_events e
  where e.id = _occurrence_id
    and e.tenant_id = _tenant_id;

  if v_client is null then
    raise exception 'Occurrence not found';
  end if;
  if not (v_client = any(public._portal_user_client_ids(_tenant_id))) then
    raise exception 'Permission denied';
  end if;

  return query
  select
    m.id,
    m.author_role,
    coalesce(
      p.full_name,
      case when m.author_role = 'client' then 'Cliente' else 'Operador' end
    ) as author_name,
    m.message,
    m.created_at
  from public.client_occurrence_messages m
  left join public.profiles p on p.id = m.author_user_id
  where m.tenant_id = _tenant_id
    and m.occurrence_id = _occurrence_id
    and (
      _before_created_at is null
      or (m.created_at, m.id) < (_before_created_at, _before_id)
    )
  order by m.created_at desc, m.id desc
  limit _limit;
end;
$function$;

revoke all on function public.list_client_occurrence_messages_v2(uuid, uuid, integer, timestamptz, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.list_client_occurrence_messages_v2(uuid, uuid, integer, timestamptz, uuid)
to authenticated, service_role;
