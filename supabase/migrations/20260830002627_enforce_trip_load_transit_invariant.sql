-- A load is in transit only when an associated dispatch trip has actually
-- started. The trip is the aggregate root for departure.

-- Do not manufacture a previous status or departure timestamp for legacy data.
-- Reconciliation is a separate, evidence-backed and audited operation. Existing
-- inconsistencies must be inventoried before rollout and resolved by operations.

set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$
declare v_contract record;v_name text;v_oid oid;
begin
  for v_contract in select * from(values
    ('public.driver_start_trip(uuid)','40a8d39b40f83a1499decd4a877c32c1',true,true),
    ('public.transition_load_status_v1(uuid,uuid,text,text)','91dd327e222a28cad6ffa62d0e12997b',true,false),
    ('public.sync_trip_load_mirrors()','1d76545c63804e8d35582a1f2116228c',false,true),
    ('public._tg_mark_outdated_trip_loads()','854c3470a50de5c97a2a6170287ebb3d',false,true)
  ) expected(signature,hash,authenticated,service_role) loop
    v_oid:=to_regprocedure(v_contract.signature);
    if md5(replace(pg_get_functiondef(v_oid),E'\r\n',E'\n')) is distinct from v_contract.hash then
      raise exception 'Trip/load legacy contract changed: %',v_contract.signature;
    end if;
    if has_function_privilege('anon',v_oid,'EXECUTE')
      or has_function_privilege('authenticated',v_oid,'EXECUTE') is distinct from v_contract.authenticated
      or has_function_privilege('service_role',v_oid,'EXECUTE') is distinct from v_contract.service_role then
      raise exception 'Trip/load legacy privileges changed: %',v_contract.signature;
    end if;
  end loop;
  if not exists(select 1 from pg_trigger where tgrelid='public.dispatch_trip_loads'::regclass
    and tgname='trg_sync_trip_load_mirrors' and tgfoid='public.sync_trip_load_mirrors()'::regprocedure
    and tgtype=13 and tgenabled='O' and not tgisinternal and not tgdeferrable and not tginitdeferred
    and tgnargs=0 and tgqual is null and tgattr=''::int2vector) then
    raise exception 'Trip/load legacy mirror trigger changed';
  end if;
  if exists(select 1 from pg_trigger where
    (tgrelid='public.loads'::regclass and tgname in('enforce_load_transit_requires_started_trip','enforce_load_transit_graph_at_commit'))
    or (tgrelid='public.dispatch_trips'::regclass and tgname='enforce_trip_transit_graph_at_commit')
    or (tgrelid='public.dispatch_trip_loads'::regclass and tgname in('guard_trip_load_link_graph','enforce_link_transit_graph_at_commit'))) then
    raise exception 'Trip/load invariant trigger already exists';
  end if;
  foreach v_name in array array['guard_trip_load_link_graph','enforce_load_transit_requires_started_trip',
    '_assert_load_transit_graph','enforce_trip_load_graph_consistency'] loop
    if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=v_name) then
      raise exception 'Trip/load invariant helper already exists: %',v_name;
    end if;
  end loop;
end;
$preflight$;

-- Row triggers start after PostgreSQL has locked the changed child row. Acquire
-- all ancestors without waiting; a conflicting parent-first writer must cause
-- a retry, not a cycle. SKIP LOCKED is intentionally not used for invariants.
create or replace function public.guard_trip_load_link_graph()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare v_load_ids uuid[];v_parent_ids uuid[];v_current_parent_ids uuid[];v_tenant uuid;
begin
  v_load_ids:=array_remove(array[new.load_id,old.load_id],null);
  select coalesce(array_agg(id order by id),array[]::uuid[]) into v_parent_ids from (
    select new.dispatch_trip_id id where new.dispatch_trip_id is not null
    union select old.dispatch_trip_id where old.dispatch_trip_id is not null
    union select trip_id from public.loads where id=any(v_load_ids) and trip_id is not null
    union select dispatch_trip_id from public.dispatch_trip_loads where load_id=any(v_load_ids)
  ) parents;
  perform id from public.dispatch_trips where id=any(v_parent_ids) order by id for update nowait;
  perform id from public.loads where id=any(v_load_ids) order by id for update nowait;
  select coalesce(array_agg(id order by id),array[]::uuid[]) into v_current_parent_ids from (
    select new.dispatch_trip_id id where new.dispatch_trip_id is not null
    union select old.dispatch_trip_id where old.dispatch_trip_id is not null
    union select trip_id from public.loads where id=any(v_load_ids) and trip_id is not null
    union select dispatch_trip_id from public.dispatch_trip_loads where load_id=any(v_load_ids)
  ) parents;
  if v_current_parent_ids is distinct from v_parent_ids then
    raise exception 'trip_graph_concurrent_change' using errcode='40001';
  end if;
  if tg_op<>'DELETE' then
    select tenant_id into v_tenant from public.dispatch_trips where id=new.dispatch_trip_id;
    if v_tenant is null or new.tenant_id is distinct from v_tenant
      or not exists(select 1 from public.loads where id=new.load_id and tenant_id=v_tenant) then
      raise exception 'trip_load_assignment_mismatch' using errcode='23514';
    end if;
    if exists(select 1 from public.dispatch_trip_loads link join public.dispatch_trips trip on trip.id=link.dispatch_trip_id
      where link.load_id=new.load_id and trip.status not in('completed','cancelled')
        and link.dispatch_trip_id<>new.dispatch_trip_id and (tg_op='INSERT' or link.id is distinct from old.id)) then
      raise exception 'load_already_assigned_to_active_trip' using errcode='23514';
    end if;
    return new;
  end if;
  return old;
exception when lock_not_available then
  raise exception 'trip_graph_concurrent_change' using errcode='40001',
    hint='Outra operação alterou a viagem ou a carga. Atualize e repita a alocação completa.';
end;
$function$;
revoke all on function public.guard_trip_load_link_graph() from public,anon,authenticated,service_role;
create trigger guard_trip_load_link_graph before insert or update or delete on public.dispatch_trip_loads
for each row execute function public.guard_trip_load_link_graph();

-- Keep both mirrors canonical for insert, update and delete. Reassignments are
-- atomic: temporary detachment is allowed, but the deferred invariant still
-- rejects a committed in-transit load without a started associated trip.
create or replace function public.sync_trip_load_mirrors()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if tg_op='UPDATE' and new.dispatch_trip_id=old.dispatch_trip_id and new.load_id=old.load_id then return null;end if;
  if tg_op in('UPDATE','DELETE') then
    update public.loads l set trip_id=(
      select link.dispatch_trip_id from public.dispatch_trip_loads link
      join public.dispatch_trips t on t.id=link.dispatch_trip_id and t.tenant_id=l.tenant_id
      where link.load_id=l.id and link.tenant_id=l.tenant_id and t.status not in('completed','cancelled')
      order by link.dispatch_trip_id limit 1
    ),updated_at=clock_timestamp()
    where l.id=old.load_id and l.trip_id=old.dispatch_trip_id and not exists(
      select 1 from public.dispatch_trip_loads where load_id=l.id and dispatch_trip_id=old.dispatch_trip_id);
    update public.dispatch_trips t set load_id=(
      select link.load_id from public.dispatch_trip_loads link where link.dispatch_trip_id=t.id and link.tenant_id=t.tenant_id
      order by link.load_id limit 1
    ),updated_at=clock_timestamp()
    where t.id=old.dispatch_trip_id and t.load_id=old.load_id and not exists(
      select 1 from public.dispatch_trip_loads where dispatch_trip_id=t.id and load_id=old.load_id);
  end if;
  if tg_op in('UPDATE','INSERT') then
    update public.loads set trip_id=new.dispatch_trip_id,updated_at=clock_timestamp()
      where id=new.load_id and tenant_id=new.tenant_id and trip_id is distinct from new.dispatch_trip_id;
    update public.dispatch_trips t set load_id=new.load_id,updated_at=clock_timestamp()
      where t.id=new.dispatch_trip_id and t.tenant_id=new.tenant_id and (t.load_id is null or not exists(
        select 1 from public.dispatch_trip_loads link where link.dispatch_trip_id=t.id and link.load_id=t.load_id));
  end if;
  return null;
end;
$function$;
revoke all on function public.sync_trip_load_mirrors() from public,anon,authenticated,service_role;
drop trigger if exists trg_sync_trip_load_mirrors on public.dispatch_trip_loads;
create trigger trg_sync_trip_load_mirrors after insert or update or delete on public.dispatch_trip_loads
for each row execute function public.sync_trip_load_mirrors();

create or replace function public._tg_mark_outdated_trip_loads()
returns trigger language plpgsql security definer set search_path = ''
as $function$
declare v_trip record;
begin
  for v_trip in select id,tenant_id from public.dispatch_trips where id in(new.dispatch_trip_id,old.dispatch_trip_id) order by id loop
    perform public.mark_driver_settlement_outdated(v_trip.tenant_id,v_trip.id,'trip_loads_change');
  end loop;
  return coalesce(new,old);
end;
$function$;
revoke all on function public._tg_mark_outdated_trip_loads() from public,anon,authenticated,service_role;

create or replace function public.enforce_load_transit_requires_started_trip()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_requires_validation boolean := false;
begin
  if new.status = 'in_transit' then
    if tg_op = 'INSERT' then
      v_requires_validation := true;
    elsif tg_op = 'UPDATE' then
      -- Reassignment is allowed to pass through a detached intermediate state;
      -- the final graph is always checked by the deferred constraint below.
      v_requires_validation := new.status is distinct from old.status;
    end if;
  end if;

  if v_requires_validation and not exists (
    select 1
    from public.dispatch_trips trip
    where trip.tenant_id = new.tenant_id
      and trip.status in ('in_transit', 'in_progress')
      and trip.actual_start_at is not null
      and (new.trip_id is null or trip.id = new.trip_id)
      and exists (
          select 1
          from public.dispatch_trip_loads trip_load
          where trip_load.tenant_id = new.tenant_id
            and trip_load.load_id = new.id
            and trip_load.dispatch_trip_id = trip.id
      )
  ) then
    raise exception 'trip_must_be_started_before_load'
      using errcode = '23514',
            hint = 'Inicie a viagem atribuída antes de marcar a carga em trânsito.';
  end if;

  return new;
end;
$function$;

drop trigger if exists enforce_load_transit_requires_started_trip on public.loads;
create trigger enforce_load_transit_requires_started_trip
before insert or update of status, trip_id on public.loads
for each row execute function public.enforce_load_transit_requires_started_trip();

revoke execute on function public.enforce_load_transit_requires_started_trip()
from public, anon, authenticated, service_role;

comment on function public.enforce_load_transit_requires_started_trip() is
  'Internal invariant: rejects in_transit loads without an associated started dispatch trip.';

create or replace function public.transition_load_status_v1(
  p_tenant_id uuid,
  p_load_id uuid,
  p_to_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_load public.loads%rowtype;
  v_allowed text[];
  v_trip_id uuid;
  v_parent_ids uuid[];
  v_current_parent_ids uuid[];
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(p_tenant_id), false) then
    raise exception 'not_authorized';
  end if;

  select *
  into v_load
  from public.loads load
  where load.id = p_load_id
    and load.tenant_id = p_tenant_id;

  if not found then
    raise exception 'load_not_found';
  end if;

  -- Observe the parent set first, then lock in the same order as delivery/start.
  -- Recheck after locking the load: a concurrent assignment may have committed
  -- between discovery and the locks. Never continue with an unlocked new parent.
  select coalesce(array_agg(id order by id),array[]::uuid[]) into v_parent_ids from (
    select v_load.trip_id id where v_load.trip_id is not null
    union select dispatch_trip_id from public.dispatch_trip_loads where load_id=p_load_id
  ) parents;
  perform id from public.dispatch_trips where id=any(v_parent_ids) order by id for update;
  perform id from public.dispatch_trip_loads where load_id=p_load_id order by dispatch_trip_id,id for update;
  select * into v_load from public.loads where id=p_load_id and tenant_id=p_tenant_id for update;
  if not found then raise exception 'load_not_found';end if;
  select coalesce(array_agg(id order by id),array[]::uuid[]) into v_current_parent_ids from (
    select v_load.trip_id id where v_load.trip_id is not null
    union select dispatch_trip_id from public.dispatch_trip_loads where load_id=p_load_id
  ) parents;
  if v_current_parent_ids is distinct from v_parent_ids then
    raise exception 'trip_graph_concurrent_change' using errcode='40001',hint='Atualize a carga e repita a operação.';
  end if;
  if exists(select 1 from public.dispatch_trips where id=any(v_parent_ids) and tenant_id is distinct from p_tenant_id)
    or exists(select 1 from public.dispatch_trip_loads where load_id=p_load_id and tenant_id is distinct from p_tenant_id) then
    raise exception 'trip_load_assignment_mismatch' using errcode='23514';
  end if;

  if v_load.status = p_to_status then
    if p_to_status = 'in_transit' then
      perform public._assert_load_transit_graph(p_load_id);
    end if;
    return jsonb_build_object(
      'load_id', p_load_id,
      'from_status', v_load.status,
      'to_status', p_to_status,
      'changed', false,
      'dispatch_trip_id', v_load.trip_id
    );
  end if;

  v_allowed := case v_load.status
    when 'planned' then array['assembling']
    when 'assembling' then array['ready', 'planned']
    when 'ready' then array['loading', 'assembling', 'in_transit']
    when 'loading' then array['loaded', 'ready', 'in_transit']
    when 'loaded' then array['in_transit']
    when 'in_transit' then array['delivered', 'divergent', 'partial_delivery', 'returned', 'refused']
    when 'divergent' then array['in_transit', 'delivered', 'partial_delivery', 'returned', 'refused']
    when 'partial_delivery' then array['delivered', 'returned']
    when 'returned' then array['delivered']
    when 'refused' then array['returned', 'delivered']
    when 'failed' then array['returned', 'delivered']
    else array[]::text[]
  end;

  if not coalesce(p_to_status = any(v_allowed), false) then
    raise exception 'invalid_load_status_transition: % -> %', v_load.status, p_to_status;
  end if;

  if p_to_status = 'in_transit' then
    select trip.id
    into v_trip_id
    from public.dispatch_trips trip
    where trip.tenant_id = p_tenant_id
      and trip.status in ('in_transit', 'in_progress')
      and trip.actual_start_at is not null
      and (v_load.trip_id is null or trip.id = v_load.trip_id)
      and exists (
          select 1
          from public.dispatch_trip_loads trip_load
          where trip_load.tenant_id = p_tenant_id
            and trip_load.load_id = p_load_id
            and trip_load.dispatch_trip_id = trip.id
      )
    order by trip.actual_start_at desc, trip.id
    limit 1
    for share of trip;

    if v_trip_id is null then
      raise exception 'trip_must_be_started_before_load'
        using errcode = '23514',
              hint = 'Inicie a viagem atribuída antes de marcar a carga em trânsito.';
    end if;
  end if;

  update public.loads
  set status = p_to_status,
      trip_id = case when p_to_status = 'in_transit' then v_trip_id else trip_id end,
      updated_at = now()
  where id = p_load_id
    and tenant_id = p_tenant_id;

  insert into public.load_status_history(
    tenant_id, load_id, field_name, old_value, new_value, reason, created_by
  ) values (
    p_tenant_id,
    p_load_id,
    'status',
    v_load.status,
    p_to_status,
    nullif(btrim(p_reason), ''),
    auth.uid()
  );

  perform public._log_entity_audit(
    p_tenant_id,
    'load',
    p_load_id,
    'status_transition',
    jsonb_build_object('status', v_load.status),
    jsonb_build_object(
      'status', p_to_status,
      'reason', nullif(btrim(p_reason), ''),
      'dispatch_trip_id', v_trip_id
    ),
    'transition_load_status_v1'
  );

  return jsonb_build_object(
    'load_id', p_load_id,
    'from_status', v_load.status,
    'to_status', p_to_status,
    'changed', true,
    'dispatch_trip_id', coalesce(v_trip_id, v_load.trip_id)
  );
end;
$function$;

revoke all privileges on function public.transition_load_status_v1(
  uuid, uuid, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.transition_load_status_v1(
  uuid, uuid, text, text
) to authenticated;

comment on function public.transition_load_status_v1(uuid, uuid, text, text) is
  'Transitions a load status and requires a started associated trip before in_transit.';

-- Validate the committed graph too: changing a trip or removing its relation
-- must not leave an in-transit load behind. Deferred checks allow existing
-- completion routines to update the trip and its loads in the same transaction.
create or replace function public._assert_load_transit_graph(p_load_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_load public.loads%rowtype;
  v_trip_id uuid;
begin
  -- Deferred triggers can be entered with child rows already locked. Do not
  -- wait for another parent-first writer while retaining those child locks.
  select * into v_load from public.loads where id = p_load_id for update nowait;
  if not found or v_load.status is distinct from 'in_transit' then return; end if;

  select trip.id into v_trip_id
  from public.dispatch_trips trip
  where trip.tenant_id = v_load.tenant_id
    and trip.status in ('in_transit', 'in_progress')
    and trip.actual_start_at is not null
    and (v_load.trip_id is null or trip.id = v_load.trip_id)
    and exists (
        select 1 from public.dispatch_trip_loads link
        where link.tenant_id = v_load.tenant_id
          and link.load_id = v_load.id and link.dispatch_trip_id = trip.id
    )
  order by trip.id limit 1 for share of trip nowait;
  if v_trip_id is null then
    raise exception 'trip_must_be_started_before_load' using errcode = '23514',
      hint = 'Conclua ou reconcilie as cargas antes de encerrar/desvincular a viagem.';
  end if;
exception when lock_not_available then
  raise exception 'trip_graph_concurrent_change' using errcode='40001',
    hint='Outra operação alterou a viagem ou a carga. Atualize e repita a operação completa.';
end;
$function$;

create or replace function public.enforce_trip_load_graph_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_load_id uuid;
begin
  if tg_table_name = 'loads' then
    perform public._assert_load_transit_graph(new.id);
  elsif tg_table_name = 'dispatch_trip_loads' then
    if tg_op <> 'INSERT' then perform public._assert_load_transit_graph(old.load_id); end if;
    if tg_op <> 'DELETE' then perform public._assert_load_transit_graph(new.load_id); end if;
  else
    for v_load_id in
      select load.id from public.loads load
      where load.trip_id = old.id or exists (
        select 1 from public.dispatch_trip_loads link
        where link.load_id = load.id and link.dispatch_trip_id = old.id
      )
      order by load.id
    loop
      perform public._assert_load_transit_graph(v_load_id);
    end loop;
  end if;
  return null;
end;
$function$;

create constraint trigger enforce_load_transit_graph_at_commit
after insert or update of status, trip_id, tenant_id on public.loads
deferrable initially deferred
for each row execute function public.enforce_trip_load_graph_consistency();

create constraint trigger enforce_trip_transit_graph_at_commit
after update of status, actual_start_at, tenant_id or delete on public.dispatch_trips
deferrable initially deferred
for each row execute function public.enforce_trip_load_graph_consistency();

create constraint trigger enforce_link_transit_graph_at_commit
after insert or update or delete on public.dispatch_trip_loads
deferrable initially deferred
for each row execute function public.enforce_trip_load_graph_consistency();

revoke all on function public._assert_load_transit_graph(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.enforce_trip_load_graph_consistency()
from public, anon, authenticated, service_role;

create or replace function public.driver_start_trip(_trip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_trip public.dispatch_trips%rowtype;
  v_driver_id uuid;
  v_load_ids uuid[];
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode = '42501'; end if;
  select * into v_trip from public.dispatch_trips where id = _trip_id for update;
  if not found then raise exception 'Viagem não encontrada'; end if;
  v_driver_id := public.current_driver_id(v_trip.tenant_id);
  if v_driver_id is null or v_trip.driver_id is distinct from v_driver_id then
    raise exception 'Viagem não atribuída ao motorista autenticado' using errcode = '42501';
  end if;
  if not coalesce(v_trip.status in ('planned', 'loading', 'in_transit', 'in_progress'), false) then
    raise exception 'Viagem encerrada, cancelada ou com estado inválido' using errcode = '23514';
  end if;
  if v_trip.status in ('in_transit', 'in_progress') and v_trip.actual_start_at is null then
    raise exception 'trip_start_requires_reconciliation' using errcode = '23514',
      hint = 'Viagem já marcada em trânsito, mas sem início registrado. Solicite reconciliação à operação.';
  end if;

  perform id from public.dispatch_trip_loads where dispatch_trip_id=v_trip.id order by load_id,id for update;
  if exists(select 1 from public.dispatch_trip_loads where dispatch_trip_id=v_trip.id
    and tenant_id is distinct from v_trip.tenant_id) then
    raise exception 'trip_load_assignment_mismatch' using errcode='23514';
  end if;
  select coalesce(array_agg(load_id order by load_id), array[]::uuid[])
  into v_load_ids from (
    select link.load_id from public.dispatch_trip_loads link
    where link.dispatch_trip_id = v_trip.id and link.tenant_id = v_trip.tenant_id
  ) assigned;
  if cardinality(v_load_ids) = 0 or (v_trip.load_id is not null and not (v_trip.load_id = any(v_load_ids))) then
    raise exception 'trip_load_assignment_mismatch' using errcode = '23514';
  end if;

  -- Serialize hold/reassignment changes before validating and starting loads.
  perform 1 from public.loads where id = any(v_load_ids) order by id for update;
  if exists (
    select 1 from unnest(v_load_ids) as assigned(load_id)
    left join public.loads load on load.id = assigned.load_id
    where load.id is null or load.tenant_id is distinct from v_trip.tenant_id
      or (load.trip_id is not null and load.trip_id <> v_trip.id)
  ) then
    raise exception 'trip_load_assignment_mismatch' using errcode = '23514';
  end if;
  if exists (select 1 from public.loads where id = any(v_load_ids) and on_hold) then
    raise exception 'Uma ou mais cargas da viagem estão bloqueadas' using errcode = '23514';
  end if;

  if v_trip.status in ('in_transit', 'in_progress') then
    return jsonb_build_object('trip_id', v_trip.id, 'status', v_trip.status,
      'load_ids', to_jsonb(v_load_ids), 'changed', false);
  end if;

  if exists (select 1 from public.loads where id = any(v_load_ids) and status = 'in_transit') then
    raise exception 'trip_start_requires_reconciliation' using errcode = '23514',
      hint = 'Há carga já em trânsito sem partida registrada nesta viagem. Confirme o histórico com a operação.';
  end if;

  update public.dispatch_trips
  set status = 'in_transit', actual_start_at = coalesce(actual_start_at, now()), updated_at = now()
  where id = v_trip.id;

  update public.loads
  set trip_id = v_trip.id, driver_id = v_driver_id,
      vehicle_id = coalesce(v_trip.vehicle_id, vehicle_id),
      status = case when status in ('delivered', 'cancelled', 'returned', 'refused', 'partial_delivery', 'failed')
        then status else 'in_transit' end,
      updated_at = now()
  where id = any(v_load_ids) and tenant_id = v_trip.tenant_id;

  insert into public.dispatch_events(tenant_id, dispatch_trip_id, event_type, payload, created_by)
  values (v_trip.tenant_id, v_trip.id, 'trip_started',
    jsonb_build_object('previous_status', v_trip.status, 'driver_id', v_driver_id), auth.uid());
  perform public._log_entity_audit(v_trip.tenant_id, 'dispatch_trip', v_trip.id, 'start_by_driver',
    jsonb_build_object('status', v_trip.status),
    jsonb_build_object('status', 'in_transit', 'driver_id', v_driver_id), 'driver_app');
  return jsonb_build_object('trip_id', v_trip.id, 'status', 'in_transit',
    'load_ids', to_jsonb(v_load_ids), 'changed', true);
end;
$function$;

revoke all on function public.driver_start_trip(uuid) from public, anon, authenticated, service_role;
grant execute on function public.driver_start_trip(uuid) to authenticated, service_role;
