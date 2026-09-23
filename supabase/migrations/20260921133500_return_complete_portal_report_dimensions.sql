do $migration$
declare
  v_function text;
  v_occurrence_limit text := E'    order by total desc\n    limit 20';
  v_city_limit text := E'    order by total desc\n    limit 15';
  v_order_only text := '    order by total desc';
begin
  select pg_get_functiondef(
    'public.get_client_portal_reports_summary_raw_20260917(uuid,uuid,date,date)'::regprocedure
  ) into v_function;

  if position(v_occurrence_limit in v_function) = 0
     or position(v_city_limit in v_function) = 0 then
    raise exception 'portal_report_dimension_limit_contract_not_found';
  end if;

  v_function := replace(v_function, v_occurrence_limit, v_order_only);
  v_function := replace(v_function, v_city_limit, v_order_only);
  execute v_function;
end;
$migration$;

comment on function public.get_client_portal_reports_summary_raw_20260917(uuid, uuid, date, date) is
  'Returns complete authorized report dimensions so on-screen tables and CSV exports do not silently omit categories or cities.';
