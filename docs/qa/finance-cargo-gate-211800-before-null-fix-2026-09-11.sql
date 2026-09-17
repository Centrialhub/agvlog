-- Route completion is not custody completion. Operational and financial
-- downstream consumers share this one closed-cargo predicate.

create or replace function private.trip_cargo_is_closed_v1(_tenant_id uuid,_trip_id uuid)
returns boolean language sql stable security definer set search_path='' as $function$
  select exists(select 1 from public.trip_cargo_controls control
    where control.tenant_id=_tenant_id and control.dispatch_trip_id=_trip_id
      and control.status='closed' and control.closed_at is not null)
$function$;
revoke all on function private.trip_cargo_is_closed_v1(uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function private.guard_driver_settlement_cargo_closed_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if not private.trip_cargo_is_closed_v1(new.tenant_id,new.dispatch_trip_id) then
    raise exception 'trip_cargo_not_closed' using errcode='23514';end if;
  return new;
end;$function$;
revoke all on function private.guard_driver_settlement_cargo_closed_v1()
  from public,anon,authenticated,service_role;
create trigger driver_settlement_requires_closed_cargo_v1
before insert or update of tenant_id,dispatch_trip_id on public.driver_settlements
for each row execute function private.guard_driver_settlement_cargo_closed_v1();

create or replace function finance_private.guard_trip_expense_cargo_closed_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if new.context='trip' and not private.trip_cargo_is_closed_v1(new.tenant_id,new.trip_id) then
    raise exception 'trip_cargo_not_closed' using errcode='23514';end if;
  return new;
end;$function$;
revoke all on function finance_private.guard_trip_expense_cargo_closed_v1()
  from public,anon,authenticated,service_role;
create trigger finance_trip_expense_requires_closed_cargo_v1
before insert or update of tenant_id,context,trip_id on public.finance_expense_batches
for each row execute function finance_private.guard_trip_expense_cargo_closed_v1();

create or replace function public.generate_driver_settlement(_tenant_id uuid,_dispatch_trip_id uuid)
returns uuid language plpgsql security definer set search_path='' as $function$
declare v_trip_status text;
begin
  perform finance_private.require_access(_tenant_id);
  if coalesce(auth.jwt()->>'role','')<>'service_role' then
    if auth.uid() is null then raise exception 'auth_required';end if;
    if not public.is_tenant_operator_or_admin(_tenant_id) then raise exception 'forbidden';end if;
  end if;
  select status into v_trip_status from public.dispatch_trips
    where id=_dispatch_trip_id and tenant_id=_tenant_id;
  if v_trip_status is null then raise exception 'trip_not_found';end if;
  if v_trip_status<>'completed' then raise exception 'trip_not_completed';end if;
  if not private.trip_cargo_is_closed_v1(_tenant_id,_dispatch_trip_id) then
    raise exception 'trip_cargo_not_closed' using errcode='23514';end if;
  return public._build_driver_settlement(_tenant_id,_dispatch_trip_id);
end;$function$;
revoke all on function public.generate_driver_settlement(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.generate_driver_settlement(uuid,uuid) to authenticated,service_role;

create or replace function public.generate_pending_driver_settlements(_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  v_trip_id uuid;v_existing uuid;v_status text;v_generated integer:=0;v_recalculated integer:=0;
  v_skipped integer:=0;v_errors jsonb:='[]'::jsonb;
begin
  perform finance_private.require_access(_tenant_id);
  if coalesce(auth.jwt()->>'role','')<>'service_role'
    and not public.is_tenant_operator_or_admin(_tenant_id) then raise exception 'forbidden';end if;
  for v_trip_id in select trip.id from public.dispatch_trips trip
    where trip.tenant_id=_tenant_id and trip.status='completed'
      and private.trip_cargo_is_closed_v1(_tenant_id,trip.id)
  loop
    select id,status into v_existing,v_status from public.driver_settlements
      where tenant_id=_tenant_id and dispatch_trip_id=v_trip_id;
    begin
      if v_existing is null then
        perform public._build_driver_settlement(_tenant_id,v_trip_id);v_generated:=v_generated+1;
      elsif v_status in('pending_review','in_review','reopened') and exists(
        select 1 from public.driver_settlements settlement where settlement.id=v_existing and (
          settlement.loads_count=0 or settlement.documents_count=0 or settlement.estimated_km is null
          or settlement.total_invoice_value=0 or settlement.total_freight_value=0
          or settlement.needs_recalculation or settlement.last_recalculated_at is null)) then
        perform public._build_driver_settlement(_tenant_id,v_trip_id);v_recalculated:=v_recalculated+1;
      else v_skipped:=v_skipped+1;end if;
    exception when others then
      v_skipped:=v_skipped+1;
      v_errors:=v_errors||jsonb_build_object('trip_id',v_trip_id,'error',sqlerrm);
    end;
  end loop;
  return jsonb_build_object('generated',v_generated,'recalculated',v_recalculated,
    'skipped',v_skipped,'errors',v_errors);
end;$function$;
revoke all on function public.generate_pending_driver_settlements(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.generate_pending_driver_settlements(uuid) to authenticated,service_role;

-- Completing the route no longer creates an economically consumable record.
-- The cargo-close trigger below owns that transition.
create or replace function public._on_dispatch_trip_completed_create_settlement()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  return new;
end;$function$;
revoke all on function public._on_dispatch_trip_completed_create_settlement()
  from public,anon,authenticated,service_role;

create or replace function private.release_closed_trip_cargo_downstream_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
declare v_trip public.dispatch_trips%rowtype;v_settlement uuid;v_settlement_status text;
begin
  if new.status<>'closed' or (tg_op='UPDATE' and old.status='closed') then return new;end if;
  select * into v_trip from public.dispatch_trips where id=new.dispatch_trip_id
    and tenant_id=new.tenant_id for update;
  if not found or v_trip.status<>'completed' then
    raise exception 'trip_route_not_completed' using errcode='23514';end if;
  select id,status into v_settlement,v_settlement_status from public.driver_settlements
    where tenant_id=new.tenant_id and dispatch_trip_id=new.dispatch_trip_id for update;
  -- Historical settlements may already be approved/paid/closed. Preserve their
  -- status, amounts and payments; only build/recalculate mutable settlements.
  if not found or v_settlement_status in('pending_review','in_review','reopened') then
    begin
      v_settlement:=public._build_driver_settlement(new.tenant_id,new.dispatch_trip_id);
    exception when unique_violation then
      select id,status into v_settlement,v_settlement_status from public.driver_settlements
        where tenant_id=new.tenant_id and dispatch_trip_id=new.dispatch_trip_id for update;
    end;
  end if;
  update public.physical_journeys journey set status='completed',
    actual_end_at=coalesce(journey.actual_end_at,v_trip.actual_end_at,clock_timestamp()),updated_at=clock_timestamp()
  where journey.id in(select link.physical_journey_id from public.physical_journey_trips link
    where link.dispatch_trip_id=new.dispatch_trip_id)
    and not exists(select 1 from public.physical_journey_trips link
      join public.dispatch_trips trip on trip.id=link.dispatch_trip_id
      where link.physical_journey_id=journey.id and trip.status<>'cancelled'
        and (trip.status<>'completed' or not private.trip_cargo_is_closed_v1(trip.tenant_id,trip.id)));
  perform public._log_entity_audit(new.tenant_id,'trip_cargo_control',new.id,
    'downstream_released',jsonb_build_object('status',old.status),
    jsonb_build_object('status',new.status,'dispatch_trip_id',new.dispatch_trip_id,
      'settlement_id',v_settlement,'settlement_status_preserved',
      v_settlement_status in('approved','paid','closed')),'cargo_close_gate');
  return new;
end;$function$;
revoke all on function private.release_closed_trip_cargo_downstream_v1()
  from public,anon,authenticated,service_role;
create trigger trip_cargo_closed_releases_downstream_v1
after insert or update of status on public.trip_cargo_controls
for each row execute function private.release_closed_trip_cargo_downstream_v1();

create or replace function finance_private.expense_options(
  _tenant uuid,_kind text,_search text default '',_trip uuid default null,_page integer default 1
) returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare rows jsonb;total bigint;driver uuid;
begin
  if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
  if _kind not in('trips','movements','suppliers','centers','deliveries') or _kind is null
    or _page is null or _page not between 1 and 1000000 or length(coalesce(_search,''))>200 then
    raise exception 'finance_invalid_options' using errcode='22023';end if;
  if _trip is not null then
    select trip.driver_id into driver from public.dispatch_trips trip
    where trip.id=_trip and trip.tenant_id=_tenant and trip.status='completed'
      and private.trip_cargo_is_closed_v1(_tenant,trip.id);
    if not found then raise exception 'trip_cargo_not_closed' using errcode='23514';end if;
  end if;
  with options as materialized (
    select trip.id,coalesce(driver_row.name,'Sem motorista')||' · '||coalesce(
      to_jsonb(trip)->>'actual_end_at',to_jsonb(trip)->>'planned_start_at',left(trip.id::text,8)) label,
      jsonb_build_object('driver_id',trip.driver_id) extra
    from public.dispatch_trips trip left join public.drivers driver_row
      on driver_row.id=trip.driver_id and driver_row.tenant_id=trip.tenant_id
    where _kind='trips' and trip.tenant_id=_tenant and trip.status='completed'
      and private.trip_cargo_is_closed_v1(_tenant,trip.id)
    union all
    select movement.id,movement.beneficiary_name||' · '||movement.occurred_on::text||' · '||coalesce(
      movement.bank_reference,movement.description),jsonb_build_object('amount_cents',movement.amount_cents,
      'remaining_cents',movement.amount_cents-coalesce(allocation.used,0),'driver_id',movement.driver_id)
    from public.finance_movements movement left join lateral(select sum(expense.amount_cents) used
      from public.finance_expense_allocations expense where expense.tenant_id=_tenant
        and expense.movement_id=movement.id) allocation on true
    where _kind='movements' and movement.tenant_id=_tenant and movement.direction='out'
      and movement.nature<>'transfer' and (movement.driver_id is null or movement.driver_id=driver)
      and movement.amount_cents>coalesce(allocation.used,0)
    union all select client.id,client.company_name,'{}'::jsonb from public.clients client
      where _kind='suppliers' and client.tenant_id=_tenant and client.active
    union all select center.id,center.name,'{}'::jsonb from public.cost_centers center
      where _kind='centers' and center.tenant_id=_tenant and center.active
    union all select stop.id,stop.destination,jsonb_build_object('delivery',finance_private.delivery_context(_tenant,stop.id))
      from public.dispatch_stops stop where _kind='deliveries' and stop.tenant_id=_tenant
        and stop.dispatch_trip_id=_trip
  ), filtered as materialized (
    select * from options where position(lower(coalesce(_search,'')) in lower(coalesce(label,'')||' '||id::text))>0
  ), paged as (select * from filtered order by label,id limit 30 offset (_page-1)*30)
  select (select count(*) from filtered),coalesce(jsonb_agg(jsonb_build_object('id',id,
    'label',coalesce(label,''))||extra order by label,id),'[]') into total,rows from paged;
  return jsonb_build_object('version',1,'tenant_id',_tenant,'kind',_kind,'trip_id',_trip,
    'page',_page,'total',total,'rows',rows);
end;$function$;
revoke all on function finance_private.expense_options(uuid,text,text,uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function finance_private.expense_options(uuid,text,text,uuid,integer) to authenticated;

comment on function private.trip_cargo_is_closed_v1(uuid,uuid) is
  'Canonical release gate for every operational or financial consumer downstream of a physical trip.';
