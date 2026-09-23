do $migration$
declare
  v_function text;
  v_old_lat text := '''lat'', CASE WHEN can_vehicle THEN lat END';
  v_new_lat text := '''lat'', CASE WHEN can_vehicle AND lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180 THEN lat END';
  v_old_lng text := '''lng'', CASE WHEN can_vehicle THEN lng END';
  v_new_lng text := '''lng'', CASE WHEN can_vehicle AND lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180 THEN lng END';
begin
  select pg_get_functiondef('public.get_client_portal_tracking(uuid,uuid)'::regprocedure)
  into v_function;
  if position(v_old_lat in v_function) = 0 or position(v_old_lng in v_function) = 0 then
    raise exception 'portal_tracking_coordinate_contract_not_found';
  end if;
  v_function := replace(v_function, v_old_lat, v_new_lat);
  v_function := replace(v_function, v_old_lng, v_new_lng);
  execute v_function;
end;
$migration$;

comment on function public.get_client_portal_tracking(uuid, uuid) is
  'Returns authorized tracking data and suppresses non-finite or out-of-range vehicle coordinates.';
