-- Forward-only catalog repair. Keep the production ledger intact while making
-- the canonical clean-environment chain converge on the same active contracts.

create index if not exists idx_ssx_position_quarantine_tenant_id
  on public.ssx_position_quarantine (tenant_id);
create index if not exists idx_finance_fiscal_projection_events_tenant_id
  on public.finance_fiscal_projection_events (tenant_id);
create index if not exists idx_tax_registry_applied_changes_tenant_id
  on public.tax_registry_applied_changes (tenant_id);
create index if not exists idx_trip_cargo_seals_tenant_id
  on public.trip_cargo_seals (tenant_id);
create index if not exists idx_finance_manual_expense_evidence_tenant_id
  on public.finance_manual_expense_evidence (tenant_id);
create index if not exists idx_trip_cargo_document_checks_tenant_id
  on public.trip_cargo_document_checks (tenant_id);
create index if not exists idx_finance_account_opening_reversals_tenant_id
  on public.finance_account_opening_reversals (tenant_id);
create index if not exists idx_finance_automatic_reconciliation_jobs_tenant_id
  on public.finance_automatic_reconciliation_jobs (tenant_id);
create index if not exists idx_finance_payable_link_reversals_tenant_id
  on public.finance_payable_link_reversals (tenant_id);
create index if not exists idx_finance_settlement_link_reversals_tenant_id
  on public.finance_settlement_link_reversals (tenant_id);
create index if not exists idx_trip_cargo_evidence_tenant_id
  on public.trip_cargo_evidence (tenant_id);
create index if not exists idx_trip_cargo_load_checks_tenant_id
  on public.trip_cargo_load_checks (tenant_id);
create index if not exists idx_finance_legacy_cut_reviews_tenant_id
  on public.finance_legacy_cut_reviews (tenant_id);
create index if not exists idx_trip_cargo_commands_tenant_id
  on public.trip_cargo_commands (tenant_id);

create or replace function public.get_active_trips_live(_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  _result jsonb;
begin
  if not (public.is_tenant_admin(_tenant_id) or public.has_tenant_role(_tenant_id, 'operator')) then
    raise exception 'Not authorized';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
  into _result
  from (
    select
      dt.id as trip_id,
      coalesce(l.load_number, dt.id::text) as trip_code,
      dt.vehicle_id,
      v.plate as vehicle_plate,
      v.nickname as vehicle_name,
      dt.driver_id,
      d.name as driver_name,
      d.phone as driver_phone,
      pl.lat,
      pl.lng,
      coalesce(pl.speed, 0) as speed_kmh,
      pl.heading,
      coalesce(tls.state, 'normal') as state,
      coalesce(tls.severity, 'info') as severity,
      tls.message as status_message,
      tr.geometry_geojson as route_geometry_geojson,
      tls.distance_from_route_meters,
      tls.delay_minutes,
      tls.stopped_minutes,
      tls.average_speed_kmh,
      tls.eta_next_stop_at,
      tls.last_signal_at,
      tls.last_signal_age_seconds,
      pl.captured_at as position_captured_at,
      (
        select to_jsonb(ns)
        from (
          select
            s.id,
            s.stop_order as sequence,
            s.destination as client_name,
            s.planned_arrival_at,
            s.status
          from public.dispatch_stops s
          where s.dispatch_trip_id = dt.id
            and not (s.status = any(public.stop_terminal_statuses()))
          order by s.stop_order asc
          limit 1
        ) ns
      ) as next_stop,
      (
        select coalesce(jsonb_agg(to_jsonb(ps) order by ps.sequence), '[]'::jsonb)
        from (
          select
            s.id,
            s.stop_order as sequence,
            s.destination as client_name,
            s.actual_arrival_at,
            s.actual_departure_at,
            s.status
          from public.dispatch_stops s
          where s.dispatch_trip_id = dt.id
            and s.status = any(public.stop_terminal_statuses())
          order by s.stop_order asc
        ) ps
      ) as previous_stops,
      (
        select coalesce(jsonb_agg(to_jsonb(pe) order by pe.sequence), '[]'::jsonb)
        from (
          select
            s.id,
            s.stop_order as sequence,
            s.destination as client_name,
            s.planned_arrival_at,
            s.status
          from public.dispatch_stops s
          where s.dispatch_trip_id = dt.id
            and not (s.status = any(public.stop_terminal_statuses()))
          order by s.stop_order asc
        ) pe
      ) as pending_stops,
      (
        select coalesce(jsonb_agg(to_jsonb(ld)), '[]'::jsonb)
        from (
          select
            lo.id,
            lo.load_number as code,
            (
              select count(*)
              from public.load_items li
              where li.load_id = lo.id
            ) as documents_count,
            lo.total_weight_kg as total_weight,
            lo.status
          from public.dispatch_trip_loads dtl
          join public.loads lo on lo.id = dtl.load_id
          where dtl.dispatch_trip_id = dt.id
        ) ld
      ) as loads
    from public.dispatch_trips dt
    left join public.loads l on l.id = dt.load_id
    left join public.vehicles v on v.id = dt.vehicle_id
    left join public.drivers d on d.id = dt.driver_id
    left join public.positions_last pl
      on pl.vehicle_id = dt.vehicle_id and pl.tenant_id = dt.tenant_id
    left join public.trip_live_status tls
      on tls.trip_id = dt.id and tls.tenant_id = dt.tenant_id
    left join public.trip_routes tr
      on tr.trip_id = dt.id and tr.tenant_id = dt.tenant_id and tr.provider = 'osrm'
    where dt.tenant_id = _tenant_id
      and dt.status in ('planned', 'loading', 'dispatched', 'in_progress')
  ) t;

  return coalesce(_result, '[]'::jsonb);
end;
$function$;

revoke all on function public.get_active_trips_live(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_active_trips_live(uuid)
to authenticated, service_role;

create or replace function public.list_client_occurrence_messages(
  _tenant_id uuid,
  _occurrence_id uuid
)
returns table(
  id uuid,
  author_role text,
  author_name text,
  message text,
  created_at timestamp with time zone
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_client uuid;
begin
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
  order by m.created_at asc;
end;
$function$;

revoke all on function public.list_client_occurrence_messages(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.list_client_occurrence_messages(uuid, uuid)
to authenticated, service_role;

create or replace function public.delete_driver_settlement(
  _settlement_id uuid,
  _reason text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_s public.driver_settlements;
begin
  select *
  into v_s
  from public.driver_settlements
  where id = _settlement_id
  for update;

  if not found then
    raise exception 'not_found';
  end if;

  perform finance_private.require_access(v_s.tenant_id);

  if not public.is_tenant_operator_or_admin(v_s.tenant_id) then
    raise exception 'forbidden';
  end if;

  if v_s.status in ('paid', 'closed') and not public.is_tenant_admin(v_s.tenant_id) then
    raise exception 'cannot_delete_settled_record';
  end if;

  -- Loads are linked canonically through driver_settlement_loads and through
  -- the settlement's dispatch_trip_id. The loads relation has no
  -- driver_settlement_id column and must not be mutated here.
  delete from public.driver_settlement_loads
  where settlement_id = _settlement_id;

  delete from public.driver_settlement_items
  where settlement_id = _settlement_id;
  delete from public.driver_settlement_events
  where settlement_id = _settlement_id;
  delete from public.driver_settlement_payments
  where settlement_id = _settlement_id;

  delete from public.driver_settlements
  where id = _settlement_id;
end;
$function$;

revoke all on function public.delete_driver_settlement(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.delete_driver_settlement(uuid, text)
to authenticated, service_role;
