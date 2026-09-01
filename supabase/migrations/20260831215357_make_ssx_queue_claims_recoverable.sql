-- Queue workers acquire short database claims and perform their expensive
-- processing outside the transaction. A position revision is part of every
-- claim and ACK, so a delayed worker cannot mark a newer observation done.

alter table public.vehicle_processing_queue
  add column if not exists claim_token uuid,
  add column if not exists lease_until timestamptz,
  add column if not exists claimed_position_at timestamptz;

create index if not exists idx_vehicle_processing_queue_claimable
  on public.vehicle_processing_queue (tenant_id, queued_at, vehicle_id)
  where processed_at is null;

create or replace function public.claim_vehicle_processing_queue_v1(
  _tenant_id uuid,
  _limit integer default 20
)
returns table (
  tenant_id uuid,
  vehicle_id uuid,
  queued_at timestamptz,
  last_position_at timestamptz,
  attempts integer,
  claim_token uuid,
  lease_until timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_limit integer;
begin
  if _tenant_id is null then
    raise exception using errcode = '22023', message = 'ssx_queue_tenant_required';
  end if;
  if _limit is null or _limit < 1 or _limit > 50 then
    raise exception using errcode = '22023', message = 'ssx_queue_limit_invalid';
  end if;
  v_limit := _limit;

  return query
  with candidates as materialized (
    select q.tenant_id, q.vehicle_id
    from public.vehicle_processing_queue q
    where q.tenant_id = _tenant_id
      and q.processed_at is null
      and q.attempts < 5
      and (
        q.lease_until is null
        or q.lease_until <= v_now
        or q.claimed_position_at is distinct from q.last_position_at
      )
    order by q.queued_at, q.vehicle_id
    limit v_limit
    for update of q skip locked
  ), claimed as (
    update public.vehicle_processing_queue q
       set claim_token = gen_random_uuid(),
           -- Ten minutes exceeds the hosted Edge worker's current 400-second
           -- wall-clock ceiling, so a live worker cannot outlast its lease.
           lease_until = v_now + interval '10 minutes',
           claimed_position_at = q.last_position_at,
           attempts = q.attempts + 1
      from candidates c
     where q.tenant_id = c.tenant_id and q.vehicle_id = c.vehicle_id
    returning q.tenant_id, q.vehicle_id, q.queued_at, q.last_position_at,
              q.attempts, q.claim_token, q.lease_until
  )
  select c.tenant_id, c.vehicle_id, c.queued_at, c.last_position_at,
         c.attempts, c.claim_token, c.lease_until
  from claimed c
  order by c.queued_at, c.vehicle_id;
end;
$function$;

create or replace function public.ack_vehicle_processing_queue_v1(
  _tenant_id uuid,
  _vehicle_id uuid,
  _claim_token uuid,
  _last_position_at timestamptz,
  _success boolean,
  _error text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_rows integer;
  v_now timestamptz := clock_timestamp();
begin
  if _tenant_id is null or _vehicle_id is null or _claim_token is null or _success is null then
    raise exception using errcode = '22023', message = 'ssx_queue_ack_identity_required';
  end if;

  update public.vehicle_processing_queue q
     set processed_at = case when _success then v_now else null end,
         last_error = case when _success then null
                           else left(coalesce(nullif(btrim(_error), ''), 'processing_failed'), 500) end,
         claim_token = null,
         lease_until = case when _success then null else
           v_now + make_interval(secs => least(300, greatest(15, q.attempts * 15))) end,
         claimed_position_at = q.last_position_at
   where q.tenant_id = _tenant_id
     and q.vehicle_id = _vehicle_id
     and q.processed_at is null
     and q.claim_token = _claim_token
     and q.last_position_at is not distinct from _last_position_at
     and q.claimed_position_at is not distinct from _last_position_at;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$function$;

revoke all on function public.claim_vehicle_processing_queue_v1(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.ack_vehicle_processing_queue_v1(
  uuid, uuid, uuid, timestamptz, boolean, text
) from public, anon, authenticated, service_role;
grant execute on function public.claim_vehicle_processing_queue_v1(uuid, integer)
  to service_role;
grant execute on function public.ack_vehicle_processing_queue_v1(
  uuid, uuid, uuid, timestamptz, boolean, text
) to service_role;

comment on function public.claim_vehicle_processing_queue_v1(uuid, integer) is
  'Service-only INVOKER queue claim. Uses SKIP LOCKED and a ten-minute token lease; a newer last_position_at is immediately reclaimable.';
comment on function public.ack_vehicle_processing_queue_v1(
  uuid, uuid, uuid, timestamptz, boolean, text
) is
  'Service-only INVOKER queue ACK. Token and last_position_at CAS prevent an old worker from completing or backing off newer telemetry.';
