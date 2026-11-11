-- Reconcile only the missing/obsolete operational read contracts.
-- No operation data, tracking evaluation, writers or RLS changes.
do $patch_control_tower_collections$
declare
  body text;
  changed text;
  next_body text;
begin
  select pg_get_functiondef('public.get_active_trips_live(uuid)'::regprocedure) into body;
  -- Reapplicable on reviewed staging, which already has the bounded reader.
  if position('previous_stops_total' in body)>0 and position('pending_stops_total' in body)>0 and position('loads_total' in body)>0 then return;end if;
  changed:=body;

  next_body:=replace(changed,
$old$      previous_stops.items as previous_stops,
      pending_stops.items as pending_stops,
      loads.items as loads$old$,
$new$      previous_stops.items as previous_stops,
      previous_stops.total as previous_stops_total,
      previous_stops.total>jsonb_array_length(previous_stops.items) as previous_stops_truncated,
      pending_stops.items as pending_stops,
      pending_stops.total as pending_stops_total,
      pending_stops.total>jsonb_array_length(pending_stops.items) as pending_stops_truncated,
      loads.items as loads,
      loads.total as loads_total,
      loads.total>jsonb_array_length(loads.items) as loads_truncated$new$);
  if next_body=changed then raise exception 'control_tower_collection_projection_contract_changed';end if;
  changed:=next_body;

  next_body:=replace(changed,
$old$      select coalesce(jsonb_agg(to_jsonb(stop) order by stop.sequence, stop.id), '[]'::jsonb) as items$old$,
$new$      select coalesce(jsonb_agg(to_jsonb(stop)-'total_count' order by stop.sequence, stop.id), '[]'::jsonb) as items,
        coalesce(max(stop.total_count),0)::integer as total$new$);
  if next_body=changed then raise exception 'control_tower_stop_aggregate_contract_changed';end if;
  changed:=next_body;

  next_body:=replace(changed,
$old$          dispatch_stop.longitude
        from public.dispatch_stops dispatch_stop$old$,
$new$          dispatch_stop.longitude,
          count(*) over()::integer as total_count
        from public.dispatch_stops dispatch_stop$new$);
  if next_body=changed then raise exception 'control_tower_stop_count_contract_changed';end if;
  changed:=next_body;

  next_body:=replace(changed,
$old$          and not (dispatch_stop.status = any(public.stop_terminal_statuses()))
      ) stop$old$,
$new$          and not (dispatch_stop.status = any(public.stop_terminal_statuses()))
        order by dispatch_stop.stop_order,dispatch_stop.id
        limit 50
      ) stop$new$);
  if next_body=changed then raise exception 'control_tower_pending_stop_limit_contract_changed';end if;
  changed:=next_body;

  next_body:=replace(changed,
$old$          and dispatch_stop.status = any(public.stop_terminal_statuses())
      ) stop$old$,
$new$          and dispatch_stop.status = any(public.stop_terminal_statuses())
        order by dispatch_stop.stop_order desc,dispatch_stop.id desc
        limit 50
      ) stop$new$);
  if next_body=changed then raise exception 'control_tower_previous_stop_limit_contract_changed';end if;
  changed:=next_body;

  next_body:=replace(changed,
$old$      select coalesce(jsonb_agg(to_jsonb(load) order by load.code, load.id), '[]'::jsonb) as items$old$,
$new$      select coalesce(jsonb_agg(to_jsonb(load)-'total_count' order by load.code, load.id), '[]'::jsonb) as items,
        coalesce(max(load.total_count),0)::integer as total$new$);
  if next_body=changed then raise exception 'control_tower_load_aggregate_contract_changed';end if;
  changed:=next_body;

  next_body:=replace(changed,
$old$          ) as documents_count
        from public.loads linked_load$old$,
$new$          ) as documents_count,
          count(*) over()::integer as total_count
        from public.loads linked_load$new$);
  if next_body=changed then raise exception 'control_tower_load_count_contract_changed';end if;
  changed:=next_body;

  next_body:=replace(changed,
$old$          )
      ) load
    ) loads$old$,
$new$          )
        order by linked_load.load_number,linked_load.id
        limit 25
      ) load
    ) loads$new$);
  if next_body=changed then raise exception 'control_tower_load_limit_contract_changed';end if;

  execute next_body;
end;
$patch_control_tower_collections$;

comment on function public.get_active_trips_live(uuid) is
  'Returns at most 200 trips, with at most 50 pending stops, 50 previous stops, and 25 loads per trip plus explicit collection totals.';

create or replace function public.get_control_tower_snapshot_v1(_tenant_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_trips jsonb;
  v_alerts jsonb;
  v_trip_total integer;
  v_alert_total integer;
begin
  v_trips:=public.get_active_trips_live(_tenant_id);

  with prioritized as materialized (
    select alert.*,count(*) over()::integer alert_total
    from public.get_open_trip_alerts(_tenant_id) alert
    order by
      case alert.severity when 'critical' then 1 when 'danger' then 2 when 'warning' then 3
        when 'info' then 4 when 'success' then 5 else 6 end,
      alert.opened_at desc,alert.id
    limit 200
  )
  select coalesce(jsonb_agg(to_jsonb(alert)-'alert_total'||jsonb_build_object(
    'trip_code',coalesce(trip_label.code,trip.id::text),'trip_status',trip.status,'vehicle_plate',vehicle.plate,'driver_name',driver.name
  ) order by
    case alert.severity when 'critical' then 1 when 'danger' then 2 when 'warning' then 3
      when 'info' then 4 when 'success' then 5 else 6 end,
    alert.opened_at desc,alert.id),'[]'::jsonb),coalesce(max(alert.alert_total),0)
  into v_alerts,v_alert_total
  from prioritized alert
  left join public.dispatch_trips trip on trip.tenant_id=alert.tenant_id and trip.id=alert.trip_id
  left join lateral (
    select load.load_number code
    from public.loads load
    where load.tenant_id=trip.tenant_id and (
      load.id=trip.load_id or exists(
        select 1 from public.dispatch_trip_loads link
        where link.tenant_id=trip.tenant_id and link.dispatch_trip_id=trip.id and link.load_id=load.id
      )
    )
    order by load.load_number,load.id limit 1
  ) trip_label on true
  left join public.vehicles vehicle on vehicle.tenant_id=trip.tenant_id and vehicle.id=trip.vehicle_id
  left join public.drivers driver on driver.tenant_id=trip.tenant_id and driver.id=trip.driver_id;

  select count(*)::integer into v_trip_total
  from public.dispatch_trips trip
  where trip.tenant_id=_tenant_id
    and trip.status in ('planned','loading','dispatched','in_progress','in_transit');

  return jsonb_build_object(
    'version',1,'tenant_id',_tenant_id,'read_at',statement_timestamp(),
    'trip_limit',200,'trip_total',v_trip_total,'truncated',v_trip_total>jsonb_array_length(v_trips),
    'alert_limit',200,'alert_total',v_alert_total,'alerts_truncated',v_alert_total>jsonb_array_length(v_alerts),
    'trips',v_trips,'alerts',v_alerts
  );
end;
$function$;

comment on function public.get_control_tower_snapshot_v1(uuid) is
  'Returns bounded live trips and the 200 highest-priority open alerts with explicit totals and truncation flags.';

create or replace function public.operations_dashboard_summary_v1(_tenant_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_timezone text;v_today date;v_delivered integer;v_unsuccessful integer;
begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'operator_required' using errcode='42501';end if;
 select coalesce(timezone,'America/Sao_Paulo') into v_timezone from public.tenants where id=_tenant_id;
 v_today:=(statement_timestamp() at time zone v_timezone)::date;
 select count(*) filter(where status='delivered'),count(*) filter(where status in('divergent','partial_delivery','returned','refused','failed')) into v_delivered,v_unsuccessful from public.loads where tenant_id=_tenant_id;
 return jsonb_build_object(
  'timezone',v_timezone,'today',v_today,
  'pending_orders',(select count(*)::integer from public.orders where tenant_id=_tenant_id and status not in('delivered','cancelled','returned','refused')),
  'delayed_orders',(select count(*)::integer from public.orders where tenant_id=_tenant_id and promised_date<v_today and status not in('delivered','cancelled','returned','refused')),
  'orders_by_status',(select coalesce(jsonb_agg(jsonb_build_object('status',status,'count',total) order by status),'[]'::jsonb) from(select status,count(*)::integer total from public.orders where tenant_id=_tenant_id group by status) grouped),
  'delayed_order_rows',(select coalesce(jsonb_agg(to_jsonb(row_data) order by promised_date,id),'[]'::jsonb) from(select orders.id,orders.order_number,orders.promised_date,orders.status,(v_today-orders.promised_date) days_overdue,jsonb_build_object('company_name',clients.company_name) clients from public.orders left join public.clients on clients.tenant_id=orders.tenant_id and clients.id=orders.client_id where orders.tenant_id=_tenant_id and orders.promised_date<v_today and orders.status not in('delivered','cancelled','returned','refused') order by orders.promised_date,orders.id limit 8) row_data),
  'active_loads',(select count(*)::integer from public.loads where tenant_id=_tenant_id and status not in('delivered','partial_delivery','returned','refused','failed','cancelled','divergent')),
  'in_transit_loads',(select count(*)::integer from public.loads where tenant_id=_tenant_id and status='in_transit'),
  'delivery_success_rate',case when v_delivered+v_unsuccessful=0 then null else round(v_delivered::numeric*100/(v_delivered+v_unsuccessful))::integer end,
  'open_incidents',(select count(*)::integer from public.incidents where tenant_id=_tenant_id and status not in('closed','cancelled','resolved')),
  'critical_incidents',(select count(*)::integer from public.incidents where tenant_id=_tenant_id and severity in('critical','high') and status not in('closed','cancelled','resolved')),
  'incident_cost',(select coalesce(sum(coalesce(actual_cost,estimated_cost,0)),0) from public.incidents where tenant_id=_tenant_id),
  'incident_rows',(select coalesce(jsonb_agg(to_jsonb(row_data) order by severity_rank,occurred_at desc,id),'[]'::jsonb) from(select incidents.id,incidents.incident_number,incidents.title,incidents.severity,incidents.status,incidents.occurred_at,case incidents.severity when 'critical' then 0 when 'high' then 1 else 2 end severity_rank from public.incidents where tenant_id=_tenant_id and status not in('closed','cancelled','resolved') order by severity_rank,occurred_at desc,id limit 8) row_data),
  'open_maintenance',(select count(*)::integer from public.maintenance_orders where tenant_id=_tenant_id and status not in('completed','closed','cancelled')),
  'maintenance_cost',(select coalesce(sum(total_cost),0) from public.maintenance_orders where tenant_id=_tenant_id),
  'maintenance_rows',(select coalesce(jsonb_agg(to_jsonb(row_data) order by opened_at desc,id),'[]'::jsonb) from(select maintenance.id,maintenance.order_number,maintenance.total_cost,maintenance.status,maintenance.opened_at,jsonb_build_object('plate',vehicles.plate) vehicles from public.maintenance_orders maintenance left join public.vehicles on vehicles.tenant_id=maintenance.tenant_id and vehicles.id=maintenance.vehicle_id where maintenance.tenant_id=_tenant_id and maintenance.status not in('completed','closed','cancelled') order by maintenance.opened_at desc,maintenance.id limit 8) row_data),
  'expiring_docs',(select count(*)::integer from public.employees where tenant_id=_tenant_id and status in('active','on_leave') and ((cnh_expiry is not null and cnh_expiry<v_today+30) or (medical_exam_expiry is not null and medical_exam_expiry<v_today+30))),
  'low_stock',(select count(*)::integer from public.stock_items where tenant_id=_tenant_id and active is distinct from false and coalesce(min_quantity,0)>0 and coalesce(current_quantity,0)<=min_quantity),
  'vehicle_occupancy_rows',(select coalesce(jsonb_agg(to_jsonb(row_data) order by occupancy desc,plate),'[]'::jsonb) from(select vehicles.id,vehicles.plate,vehicles.nickname,vehicles.max_pallets max_pallets,coalesce(sum(loads.total_pallet_count) filter(where loads.status in('loaded','in_transit')),0)::integer loaded_pallets,round(coalesce(sum(loads.total_pallet_count) filter(where loads.status in('loaded','in_transit')),0)::numeric*100/nullif(vehicles.max_pallets,0))::integer occupancy from public.vehicles left join public.loads on loads.tenant_id=vehicles.tenant_id and loads.vehicle_id=vehicles.id where vehicles.tenant_id=_tenant_id and vehicles.active is distinct from false and vehicles.max_pallets>0 group by vehicles.id,vehicles.plate,vehicles.nickname,vehicles.max_pallets order by occupancy desc,vehicles.plate limit 8) row_data)
 );
end;$function$;
revoke all on function public.operations_dashboard_summary_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.operations_dashboard_summary_v1(uuid) to authenticated;

notify pgrst, 'reload schema';
