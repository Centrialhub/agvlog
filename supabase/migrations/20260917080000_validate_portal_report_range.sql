alter function public.get_client_portal_reports_summary_v2(uuid,uuid,date,date)
  rename to get_client_portal_reports_summary_raw_20260917;
revoke all on function public.get_client_portal_reports_summary_raw_20260917(uuid,uuid,date,date)
  from public, anon, authenticated, service_role;

create function public.get_client_portal_reports_summary_v2(
  _tenant_id uuid,
  _client_id uuid default null,
  _start_date date default null,
  _end_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if _start_date is not null and _end_date is not null and _start_date > _end_date then
    raise exception 'invalid_report_date_range' using errcode = '22023';
  end if;
  return public.get_client_portal_reports_summary_raw_20260917(_tenant_id,_client_id,_start_date,_end_date);
end
$fn$;
revoke all on function public.get_client_portal_reports_summary_v2(uuid,uuid,date,date) from public, anon;
grant execute on function public.get_client_portal_reports_summary_v2(uuid,uuid,date,date) to authenticated, service_role;
