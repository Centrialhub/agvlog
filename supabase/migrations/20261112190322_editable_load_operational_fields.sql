set local lock_timeout='5s';
set local statement_timeout='60s';
do $migration$
declare definition text; original_hash text;
begin
 select pg_get_functiondef(oid),md5(prosrc) into definition,original_hash from pg_proc where oid='public.apply_load_aggregate_command(jsonb)'::regprocedure;
 if position($new$'merchandise_value', 'payment_method',
    'actual_load_at', 'gate_departure_at', 'arrival_at', 'driver_type', 'monitor_responsible', 'monitored', 'sm_manager', 'sm_release'$new$ in definition)=0 then
  if original_hash<>'1f88fddc3b0aada32f0fd724b396fa3b' then raise exception 'load_header_source_changed';end if;
  definition:=replace(definition,$old$'merchandise_value', 'payment_method'$old$,$new$'merchandise_value', 'payment_method',
    'actual_load_at', 'gate_departure_at', 'arrival_at', 'driver_type', 'monitor_responsible', 'monitored', 'sm_manager', 'sm_release'$new$);
  definition:=replace(definition,$old$    v_changes := _payload -> 'changes';$old$,$new$    v_changes := _payload -> 'changes';
    if v_changes ? 'monitored' and jsonb_typeof(v_changes->'monitored') <> 'boolean' then
      raise exception 'invalid_monitored_value' using errcode='22023';
    end if;
    for v_key in select unnest(array['driver_type','monitor_responsible','sm_manager','sm_release']) loop
      if v_changes ? v_key and (jsonb_typeof(v_changes->v_key) not in ('string','null') or length(v_changes->>v_key)>160) then
        raise exception 'invalid_operational_text' using errcode='22023';
      end if;
    end loop;
    for v_key in select unnest(array['actual_load_at','gate_departure_at','arrival_at']) loop
      if v_changes ? v_key and jsonb_typeof(v_changes->v_key)<>'null' then
        if jsonb_typeof(v_changes->v_key)<>'string' or not isfinite((v_changes->>v_key)::timestamptz) then
          raise exception 'invalid_operational_date' using errcode='22023';
        end if;
      end if;
    end loop;$new$);
  definition:=replace(definition,$old$    if public._load_is_locked(v_load_id) then
      raise exception 'load_header_locked' using errcode = '55000';
    end if;$old$,$new$    if public._load_is_locked(v_load_id) and exists (
      select 1 from jsonb_object_keys(v_changes) field
      where field not in ('actual_load_at','gate_departure_at','arrival_at','driver_type','monitor_responsible','monitored','sm_manager','sm_release')
    ) then
      raise exception 'load_header_locked' using errcode = '55000';
    end if;$new$);
  execute definition;
 end if;
 select pg_get_functiondef(oid),md5(prosrc) into definition,original_hash from pg_proc where oid='private.bump_load_revision()'::regprocedure;
 if position('new.monitored,new.driver_type,new.monitor_responsible' in definition)=0 then
  if original_hash<>'2bbd79343d156c4499d61b06ea80c974' then raise exception 'load_revision_source_changed';end if;
  definition:=replace(definition,'new.on_hold,new.hold_reason,new.held_at,new.held_by','new.on_hold,new.hold_reason,new.held_at,new.held_by,new.monitored,new.driver_type,new.monitor_responsible,new.sm_manager,new.sm_release');
  definition:=replace(definition,'old.on_hold,old.hold_reason,old.held_at,old.held_by','old.on_hold,old.hold_reason,old.held_at,old.held_by,old.monitored,old.driver_type,old.monitor_responsible,old.sm_manager,old.sm_release');
  execute definition;
 end if;
end;
$migration$;
