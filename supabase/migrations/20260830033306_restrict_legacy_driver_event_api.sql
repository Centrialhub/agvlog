-- Published as 20260830033306. This legacy RPC accepts arbitrary event types and does not establish
-- ownership of the supplied trip/stop. Current UI/Edge/database functions have
-- no callers. Keep trusted service access; remove the driver API bypass.
set local lock_timeout = '3s';
set local statement_timeout = '20s';
do $preflight$
begin
  if md5(pg_get_functiondef('public.driver_report_event_v1(uuid,uuid,uuid,uuid,text,jsonb,text)'::regprocedure))
    <> '820fcce650445c44861f9cab01d39bc5' then
    raise exception 'Legacy driver event contract changed; review before revoking';
  end if;
end;
$preflight$;
revoke execute on function public.driver_report_event_v1(uuid,uuid,uuid,uuid,text,jsonb,text)
  from public,anon,authenticated;
