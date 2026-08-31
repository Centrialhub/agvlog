-- Emergency-only recovery of the captured ACL. This reopens an unsafe legacy
-- API and requires an explicit operational decision. It does not restore data.
grant execute on function public.driver_report_event_v1(uuid,uuid,uuid,uuid,text,jsonb,text) to authenticated;
