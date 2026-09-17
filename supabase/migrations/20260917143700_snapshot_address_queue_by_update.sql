drop function if exists public.get_active_address_resolution_queue_v2(uuid,timestamptz,timestamptz,uuid,integer);

create function public.get_active_address_resolution_queue_v2(
  _tenant_id uuid,
  _snapshot_at timestamptz default null,
  _cursor_updated_at timestamptz default null,
  _cursor_id uuid default null,
  _page_limit integer default 100
) returns table(
  items jsonb,
  total_count bigint,
  pending_count bigint,
  ambiguous_count bigint,
  error_count bigint,
  snapshot_at timestamptz,
  next_cursor_updated_at timestamptz,
  next_cursor_id uuid,
  has_more boolean
)
language plpgsql
stable
security invoker
set search_path to ''
as $function$
declare
  v_snapshot_at timestamptz := coalesce(_snapshot_at, statement_timestamp());
begin
  if auth.uid() is null or private.request_tenant_id() is distinct from _tenant_id
    or not private.is_request_tenant_member(_tenant_id)
    or not coalesce(public.is_tenant_admin(_tenant_id), false) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if _page_limit < 1 or _page_limit > 200
    or ((_cursor_updated_at is null) <> (_cursor_id is null)) then
    raise exception 'invalid_address_resolution_cursor' using errcode = '22023';
  end if;

  return query
  with active as materialized (
    select r.id,r.tenant_id,r.entity_type,r.entity_id,r.canonical_address_id,r.address_snapshot,
      r.address_hash,r.status,r.candidates,r.attempts,r.last_error,r.invalidated_at,r.created_at,r.updated_at,
      case when r.entity_type='client' then coalesce(c.company_name,c.trade_name,'Cliente')
        else coalesce(s.destination,'Destino avulso') end company_name,
      case when r.entity_type='client' then c.trade_name else null end trade_name
    from public.address_resolution_queue r
    left join public.clients c on r.entity_type='client' and c.id=r.entity_id and c.tenant_id=r.tenant_id
    left join public.dispatch_stops s on r.entity_type='dispatch_stop' and s.id=r.entity_id and s.tenant_id=r.tenant_id
    where r.tenant_id=_tenant_id
      and r.updated_at <= v_snapshot_at
      and r.status in ('pending','ambiguous','error')
      and ((r.entity_type='client' and c.id is not null) or (r.entity_type='dispatch_stop' and s.id is not null))
  ), candidates as materialized (
    select * from active
    where _cursor_updated_at is null or (updated_at,id) > (_cursor_updated_at,_cursor_id)
    order by updated_at,id
    limit _page_limit + 1
  ), visible as materialized (
    select * from candidates order by updated_at,id limit _page_limit
  ), continuation as (
    select updated_at,id from visible order by updated_at desc,id desc limit 1
  )
  select
    coalesce((select jsonb_agg(to_jsonb(v) order by v.updated_at,v.id) from visible v),'[]'::jsonb),
    count(*),
    count(*) filter(where status='pending'),
    count(*) filter(where status='ambiguous'),
    count(*) filter(where status='error'),
    v_snapshot_at,
    case when (select count(*) from candidates) > _page_limit then (select updated_at from continuation) else null end,
    case when (select count(*) from candidates) > _page_limit then (select id from continuation) else null end,
    (select count(*) from candidates) > _page_limit
  from active;
end;
$function$;

create index if not exists address_resolution_queue_active_updated_cursor
  on public.address_resolution_queue(tenant_id,updated_at,id)
  where status in ('pending','ambiguous','error');

revoke all on function public.get_active_address_resolution_queue_v2(uuid,timestamptz,timestamptz,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_active_address_resolution_queue_v2(uuid,timestamptz,timestamptz,uuid,integer)
  to authenticated;

comment on function public.get_active_address_resolution_queue_v2(uuid,timestamptz,timestamptz,uuid,integer) is
  'Keyset-pages the active address queue by updated_at/id so rows reactivated after a snapshot wait for the next complete traversal.';
