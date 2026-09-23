do $migration$
declare
  target regprocedure;
  previous_definition text;
  corrected_definition text;
begin
  foreach target in array array[
    'public.add_driver_progress_v1(jsonb)'::regprocedure,
    'public.add_driver_forecast_v1(jsonb)'::regprocedure
  ] loop
    previous_definition:=pg_get_functiondef(target);
    corrected_definition:=replace(
      previous_definition,
      '(v_existing.payload_hash is not null and v_existing.payload_hash <> v_hash)',
      'v_existing.payload_hash is distinct from v_hash'
    );
    corrected_definition:=regexp_replace(
      corrected_definition,
      'if v_existing\.payload_hash is null then update public\.(driver_route_progress_updates|driver_arrival_forecasts) set payload_hash = v_hash where id = v_existing\.id;\s*end if;',
      '',
      'gi'
    );
    if corrected_definition=previous_definition
       or corrected_definition like '%v_existing.payload_hash is not null%'
       or corrected_definition like '%if v_existing.payload_hash is null then%' then
      raise exception 'legacy_driver_monitor_replay_guard_not_rewritten: %',target;
    end if;
    execute corrected_definition;
  end loop;
end;
$migration$;

comment on function public.add_driver_progress_v1(jsonb) is
  'Records or safely replays progress; legacy rows without a provable payload hash are rejected.';
comment on function public.add_driver_forecast_v1(jsonb) is
  'Records or safely replays forecasts; legacy rows without a provable payload hash are rejected.';
