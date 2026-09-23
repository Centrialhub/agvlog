do $patch_control_tower_collections$
declare
  body text;
  changed text;
  next_body text;
begin
  select pg_get_functiondef('public.get_active_trips_live(uuid)'::regprocedure) into body;
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
