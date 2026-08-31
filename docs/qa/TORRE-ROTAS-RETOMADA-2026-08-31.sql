-- Resume only after checking the installed candidate, JWT Edge and frontend.
-- All four functions keep their own actor/tenant/MFA checks.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
grant execute on function public.prepare_trip_route_v1(uuid,uuid,uuid,uuid),
 public.commit_trip_route_v1(uuid,uuid,uuid,uuid,jsonb),
 control_tower_private.prepare_route(uuid,uuid,uuid,uuid),
 control_tower_private.commit_route(uuid,uuid,uuid,uuid,jsonb) to authenticated;
commit;
