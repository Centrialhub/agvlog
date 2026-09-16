set local lock_timeout='5s';
set local statement_timeout='30s';

create or replace function public.claim_address_resolution_queue_v2(
  _limit integer default 5,
  _lease_seconds integer default 45
) returns table(
  id uuid,tenant_id uuid,entity_type text,entity_id uuid,address_snapshot text,address_hash text,
  lease_token uuid,attempts integer
)
language plpgsql
security invoker
set search_path=''
as $function$
begin
  if current_user not in ('service_role','postgres') then raise exception 'not_authorized' using errcode='42501';end if;
  if _limit not between 1 and 25 or _lease_seconds not between 15 and 300 then
    raise exception 'invalid_address_queue_claim' using errcode='22023';end if;
  return query with due as (
    select q.id,gen_random_uuid() token from public.address_resolution_queue q
    where q.status in ('pending','error') and q.processed_at is null and q.attempts<10
      and q.next_attempt_at<=clock_timestamp() and (q.lease_expires_at is null or q.lease_expires_at<=clock_timestamp())
      and exists(select 1 from public.canonical_addresses a where a.tenant_id=q.tenant_id
        and a.id=q.canonical_address_id and a.address_hash=q.address_hash and a.status in ('pending','error','ambiguous'))
      and ((q.entity_type='client' and exists(select 1 from public.clients c where c.tenant_id=q.tenant_id
        and c.id=q.entity_id and c.canonical_address_id=q.canonical_address_id))
        or (q.entity_type='dispatch_stop' and exists(select 1 from public.dispatch_stops s where s.tenant_id=q.tenant_id
          and s.id=q.entity_id and s.canonical_address_id=q.canonical_address_id
          and not(s.status=any(public.stop_terminal_statuses())))))
    order by case when q.entity_type='dispatch_stop' then 0 else 1 end,
      q.next_attempt_at,q.updated_at,q.id
    for update of q skip locked limit _limit
  ), claimed as (
    update public.address_resolution_queue q set lease_token=due.token,
      lease_expires_at=clock_timestamp()+make_interval(secs=>_lease_seconds),updated_at=clock_timestamp()
    from due where q.id=due.id returning q.id,q.tenant_id,q.entity_type,q.entity_id,q.address_snapshot,
      q.address_hash,q.lease_token,q.attempts
  ) select * from claimed;
end;
$function$;
revoke all on function public.claim_address_resolution_queue_v2(integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.claim_address_resolution_queue_v2(integer,integer) to service_role;

do $postcondition$
begin
  if to_regprocedure('public.claim_address_resolution_queue_v2(integer,integer)') is null
    or not has_function_privilege('service_role','public.claim_address_resolution_queue_v2(integer,integer)','execute')
    or has_function_privilege('authenticated','public.claim_address_resolution_queue_v2(integer,integer)','execute') then
    raise exception 'delivery_geofence_resolution_priority_postcondition_failed';
  end if;
end;
$postcondition$;
