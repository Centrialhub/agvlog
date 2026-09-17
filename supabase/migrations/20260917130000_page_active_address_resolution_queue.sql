create or replace function public.get_active_address_resolution_queue_v2(
  _tenant_id uuid,
  _page_offset integer default 0,
  _page_limit integer default 100
) returns table(
  items jsonb,
  total_count bigint,
  pending_count bigint,
  ambiguous_count bigint,
  error_count bigint
)
language plpgsql
stable
security invoker
set search_path to ''
as $function$
begin
  if auth.uid() is null or private.request_tenant_id() is distinct from _tenant_id
    or not private.is_request_tenant_member(_tenant_id)
    or not coalesce(public.is_tenant_admin(_tenant_id), false) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if _page_offset < 0 or _page_limit < 1 or _page_limit > 200 then
    raise exception 'invalid_address_resolution_page' using errcode = '22023';
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
      and r.status in ('pending','ambiguous','error')
      and ((r.entity_type='client' and c.id is not null) or (r.entity_type='dispatch_stop' and s.id is not null))
  ), page_rows as (
    select * from active order by updated_at,id offset _page_offset limit _page_limit
  )
  select coalesce((select jsonb_agg(to_jsonb(p) order by p.updated_at,p.id) from page_rows p),'[]'::jsonb),
    count(*),count(*) filter(where status='pending'),count(*) filter(where status='ambiguous'),count(*) filter(where status='error')
  from active;
end;
$function$;

revoke all on function public.get_active_address_resolution_queue_v2(uuid,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_active_address_resolution_queue_v2(uuid,integer,integer)
  to authenticated;

comment on function public.get_active_address_resolution_queue_v2(uuid,integer,integer) is
  'Pages only actionable address resolutions and returns exact active-status counts before pagination.';
