-- LOCAL REHEARSAL ARTIFACT. Not a rollout authorization.
-- Restores only the captured trip/load contracts; no business rows are removed.
-- Prefer roll-forward: restoring the legacy writers reopens their known risks.
-- Execute as one transaction only after checking the destination and approvals.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $recovery_guard$
declare v_expected record;v_oid oid;
begin
  for v_expected in select * from(values
    ('public._assert_load_transit_graph(uuid)','0ba73923e4d12d6d099a673915bc2beb',false,false),
    ('public._tg_mark_outdated_trip_loads()','287e1657829fc246bd93a9aade05d5d5',false,false),
    ('public.driver_start_trip(uuid)','b3484f31c23627e1689fc4ac9b1d4403',true,true),
    ('public.enforce_load_transit_requires_started_trip()','7d5424cea010609721f85b24f39d840d',false,false),
    ('public.enforce_trip_load_graph_consistency()','d54bc06b8159f1cd700dea4e161ecb53',false,false),
    ('public.guard_trip_load_link_graph()','020ab0928aa3b624f2cdbb2f10eee329',false,false),
    ('public.sync_trip_load_mirrors()','c10a14f61c09d9001bf294a58b1cb6d6',false,false),
    ('public.transition_load_status_v1(uuid,uuid,text,text)','12e7a647d4b6436d57e9a05002a515eb',true,false)
  ) expected(signature,hash,authenticated,service_role) loop
    v_oid:=to_regprocedure(v_expected.signature);
    if md5(replace(pg_get_functiondef(v_oid),E'\r\n',E'\n')) is distinct from v_expected.hash then
      raise exception 'Trip/load recovery refused: unknown function %',v_expected.signature;
    end if;
    if has_function_privilege('anon',v_oid,'EXECUTE')
      or has_function_privilege('authenticated',v_oid,'EXECUTE') is distinct from v_expected.authenticated
      or has_function_privilege('service_role',v_oid,'EXECUTE') is distinct from v_expected.service_role then
      raise exception 'Trip/load recovery refused: privileges changed for %',v_expected.signature;
    end if;
  end loop;
  for v_expected in select * from(values
    ('public.dispatch_trip_loads','guard_trip_load_link_graph','public.guard_trip_load_link_graph()',31,false,array[]::text[]),
    ('public.loads','enforce_load_transit_requires_started_trip','public.enforce_load_transit_requires_started_trip()',23,false,array['status','trip_id']),
    ('public.loads','enforce_load_transit_graph_at_commit','public.enforce_trip_load_graph_consistency()',21,true,array['status','tenant_id','trip_id']),
    ('public.dispatch_trips','enforce_trip_transit_graph_at_commit','public.enforce_trip_load_graph_consistency()',25,true,array['actual_start_at','status','tenant_id']),
    ('public.dispatch_trip_loads','enforce_link_transit_graph_at_commit','public.enforce_trip_load_graph_consistency()',29,true,array[]::text[]),
    ('public.dispatch_trip_loads','trg_sync_trip_load_mirrors','public.sync_trip_load_mirrors()',29,false,array[]::text[])
  ) expected(relation,name,signature,type,deferred,columns) loop
    if not exists(select 1 from pg_trigger t where tgrelid=to_regclass(v_expected.relation)
      and tgname=v_expected.name and tgfoid=to_regprocedure(v_expected.signature) and tgtype=v_expected.type
      and tgenabled='O' and not tgisinternal and tgdeferrable=v_expected.deferred and tginitdeferred=v_expected.deferred
      and tgnargs=0 and tgqual is null and v_expected.columns=(
        select coalesce(array_agg(a.attname::text order by a.attname),array[]::text[]) from pg_attribute a
        where a.attrelid=t.tgrelid and a.attnum=any(t.tgattr))) then
      raise exception 'Trip/load recovery refused: trigger changed %',v_expected.name;
    end if;
  end loop;
end;
$recovery_guard$;

drop trigger guard_trip_load_link_graph on public.dispatch_trip_loads;
drop trigger enforce_load_transit_requires_started_trip on public.loads;
drop trigger enforce_load_transit_graph_at_commit on public.loads;
drop trigger enforce_trip_transit_graph_at_commit on public.dispatch_trips;
drop trigger enforce_link_transit_graph_at_commit on public.dispatch_trip_loads;
drop trigger trg_sync_trip_load_mirrors on public.dispatch_trip_loads;
CREATE OR REPLACE FUNCTION public._tg_mark_outdated_trip_loads()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_trip uuid; v_tid uuid;
BEGIN
  v_trip := COALESCE(NEW.dispatch_trip_id, OLD.dispatch_trip_id);
  SELECT tenant_id INTO v_tid FROM public.dispatch_trips WHERE id = v_trip;
  IF v_tid IS NOT NULL THEN PERFORM public.mark_driver_settlement_outdated(v_tid, v_trip, 'trip_loads_change'); END IF;
  RETURN COALESCE(NEW, OLD);
END; $function$
;
revoke all on function public._tg_mark_outdated_trip_loads() from public,anon,authenticated,service_role;
grant execute on function public._tg_mark_outdated_trip_loads() to service_role;
comment on function public._tg_mark_outdated_trip_loads() is null;

CREATE OR REPLACE FUNCTION public.driver_start_trip(_trip_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_trip public.dispatch_trips%ROWTYPE;
  v_driver_id uuid;
  v_load_ids uuid[] := ARRAY[]::uuid[];
  v_previous_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT *
  INTO v_trip
  FROM public.dispatch_trips
  WHERE id = _trip_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem não encontrada';
  END IF;

  v_driver_id := public.current_driver_id(v_trip.tenant_id);
  IF v_driver_id IS NULL OR v_trip.driver_id IS DISTINCT FROM v_driver_id THEN
    RAISE EXCEPTION 'Viagem não atribuída ao motorista autenticado';
  END IF;

  IF v_trip.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Viagem encerrada ou cancelada';
  END IF;

  SELECT COALESCE(array_agg(load_id ORDER BY load_id), ARRAY[]::uuid[])
  INTO v_load_ids
  FROM (
    SELECT DISTINCT dispatch_trip_loads.load_id
    FROM public.dispatch_trip_loads
    WHERE dispatch_trip_loads.dispatch_trip_id = v_trip.id
      AND dispatch_trip_loads.tenant_id = v_trip.tenant_id
    UNION
    SELECT v_trip.load_id
    WHERE v_trip.load_id IS NOT NULL
  ) AS assigned_loads;

  IF EXISTS (
    SELECT 1
    FROM public.loads
    WHERE id = ANY(v_load_ids)
      AND tenant_id = v_trip.tenant_id
      AND on_hold
  ) THEN
    RAISE EXCEPTION 'Uma ou mais cargas da viagem estão bloqueadas';
  END IF;

  v_previous_status := v_trip.status;

  UPDATE public.dispatch_trips
  SET status = 'in_transit',
      actual_start_at = COALESCE(actual_start_at, now()),
      updated_at = now()
  WHERE id = v_trip.id
    AND status IS DISTINCT FROM 'in_transit';

  UPDATE public.loads
  SET trip_id = v_trip.id,
      driver_id = v_driver_id,
      vehicle_id = COALESCE(v_trip.vehicle_id, vehicle_id),
      status = CASE
        WHEN status IN ('delivered', 'cancelled', 'returned', 'refused', 'partial_delivery', 'failed') THEN status
        ELSE 'in_transit'
      END,
      updated_at = now()
  WHERE id = ANY(v_load_ids)
    AND tenant_id = v_trip.tenant_id;

  IF v_previous_status IS DISTINCT FROM 'in_transit' THEN
    INSERT INTO public.dispatch_events(
      tenant_id, dispatch_trip_id, event_type, payload, created_by
    ) VALUES (
      v_trip.tenant_id,
      v_trip.id,
      'trip_started',
      jsonb_build_object('previous_status', v_previous_status, 'driver_id', v_driver_id),
      auth.uid()
    );

    PERFORM public._log_entity_audit(
      v_trip.tenant_id,
      'dispatch_trip',
      v_trip.id,
      'start_by_driver',
      jsonb_build_object('status', v_previous_status),
      jsonb_build_object('status', 'in_transit', 'driver_id', v_driver_id),
      'driver_app'
    );
  END IF;

  RETURN jsonb_build_object(
    'trip_id', v_trip.id,
    'status', 'in_transit',
    'load_ids', to_jsonb(v_load_ids)
  );
END;
$function$
;
revoke all on function public.driver_start_trip(uuid) from public,anon,authenticated,service_role;
grant execute on function public.driver_start_trip(uuid) to authenticated;
grant execute on function public.driver_start_trip(uuid) to service_role;
comment on function public.driver_start_trip(uuid) is 'Starts a trip only for its authenticated linked driver and synchronizes canonical load assignment/status.';

CREATE OR REPLACE FUNCTION public.sync_trip_load_mirrors()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Atualiza espelho na loads (apenas se for o primeiro link ou principal)
        UPDATE public.loads 
        SET trip_id = NEW.dispatch_trip_id, 
            updated_at = now() 
        WHERE id = NEW.load_id AND (trip_id IS NULL OR trip_id = NEW.dispatch_trip_id);
        
        -- Atualiza espelho na dispatch_trips (apenas se for o primeiro link ou principal)
        UPDATE public.dispatch_trips 
        SET load_id = NEW.load_id, 
            updated_at = now() 
        WHERE id = NEW.dispatch_trip_id AND (load_id IS NULL OR load_id = NEW.load_id);
    ELSIF TG_OP = 'DELETE' THEN
        -- Limpa espelhos se a relação for removida
        UPDATE public.loads 
        SET trip_id = NULL, 
            updated_at = now() 
        WHERE id = OLD.load_id AND trip_id = OLD.dispatch_trip_id;
        
        UPDATE public.dispatch_trips 
        SET load_id = NULL, 
            updated_at = now() 
        WHERE id = OLD.dispatch_trip_id AND load_id = OLD.load_id;
    END IF;
    RETURN NULL;
END;
$function$
;
revoke all on function public.sync_trip_load_mirrors() from public,anon,authenticated,service_role;
grant execute on function public.sync_trip_load_mirrors() to service_role;
comment on function public.sync_trip_load_mirrors() is null;

CREATE OR REPLACE FUNCTION public.transition_load_status_v1(p_tenant_id uuid, p_load_id uuid, p_to_status text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from_status text;
  v_allowed text[];
BEGIN
  IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT status
    INTO v_from_status
  FROM public.loads
  WHERE id = p_load_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'load_not_found';
  END IF;

  IF v_from_status = p_to_status THEN
    RETURN jsonb_build_object('load_id', p_load_id, 'from_status', v_from_status, 'to_status', p_to_status, 'changed', false);
  END IF;

  v_allowed := CASE v_from_status
    WHEN 'planned' THEN ARRAY['assembling']
    WHEN 'assembling' THEN ARRAY['ready', 'planned']
    WHEN 'ready' THEN ARRAY['loading', 'assembling', 'in_transit']
    WHEN 'loading' THEN ARRAY['loaded', 'ready', 'in_transit']
    WHEN 'loaded' THEN ARRAY['in_transit']
    WHEN 'in_transit' THEN ARRAY['delivered', 'divergent', 'partial_delivery', 'returned', 'refused']
    WHEN 'divergent' THEN ARRAY['in_transit', 'delivered', 'partial_delivery', 'returned', 'refused']
    WHEN 'partial_delivery' THEN ARRAY['delivered', 'returned']
    WHEN 'returned' THEN ARRAY['delivered']
    WHEN 'refused' THEN ARRAY['returned', 'delivered']
    WHEN 'failed' THEN ARRAY['returned', 'delivered']
    ELSE ARRAY[]::text[]
  END;

  IF NOT (p_to_status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'invalid_load_status_transition: % -> %', v_from_status, p_to_status;
  END IF;

  UPDATE public.loads
  SET status = p_to_status,
      updated_at = now()
  WHERE id = p_load_id AND tenant_id = p_tenant_id;

  INSERT INTO public.load_status_history (
    tenant_id, load_id, field_name, old_value, new_value, reason, created_by
  ) VALUES (
    p_tenant_id, p_load_id, 'status', v_from_status, p_to_status,
    NULLIF(btrim(p_reason), ''), auth.uid()
  );

  PERFORM public._log_entity_audit(
    p_tenant_id,
    'load',
    p_load_id,
    'status_transition',
    jsonb_build_object('status', v_from_status),
    jsonb_build_object('status', p_to_status, 'reason', NULLIF(btrim(p_reason), '')),
    'transition_load_status_v1'
  );

  RETURN jsonb_build_object('load_id', p_load_id, 'from_status', v_from_status, 'to_status', p_to_status, 'changed', true);
END;
$function$
;
revoke all on function public.transition_load_status_v1(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.transition_load_status_v1(uuid,uuid,text,text) to authenticated;
comment on function public.transition_load_status_v1(uuid,uuid,text,text) is null;
CREATE TRIGGER trg_sync_trip_load_mirrors AFTER INSERT OR DELETE ON public.dispatch_trip_loads FOR EACH ROW EXECUTE FUNCTION public.sync_trip_load_mirrors();
drop function public.guard_trip_load_link_graph();
drop function public.enforce_load_transit_requires_started_trip();
drop function public.enforce_trip_load_graph_consistency();
drop function public._assert_load_transit_graph(uuid);
commit;
