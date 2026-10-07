-- The service-role queue acknowledgement is SECURITY INVOKER and calls this
-- private SECURITY DEFINER helper after resolving an address. It needs EXECUTE
-- on that helper; anon and authenticated must remain unable to call it.
do $$
begin
  if to_regprocedure('private.sync_fleet_geofences_for_canonical_v1(uuid,uuid)') is null then
    raise exception 'geofence_sync_helper_not_found';
  end if;
  if not has_schema_privilege('service_role', 'private', 'USAGE') then
    raise exception 'service_role_lacks_private_schema_usage';
  end if;
  if has_function_privilege('anon', 'private.sync_fleet_geofences_for_canonical_v1(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.sync_fleet_geofences_for_canonical_v1(uuid,uuid)', 'EXECUTE') then
    raise exception 'geofence_sync_helper_exposed_to_clients';
  end if;
end;
$$;

grant execute on function private.sync_fleet_geofences_for_canonical_v1(uuid,uuid)
  to service_role;

do $$
begin
  if not has_function_privilege('service_role', 'private.sync_fleet_geofences_for_canonical_v1(uuid,uuid)', 'EXECUTE') then
    raise exception 'service_role_geofence_sync_grant_failed';
  end if;
end;
$$;
