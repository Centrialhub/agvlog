alter function public.import_driver_monitoring_workbook_v1(jsonb) security definer;

comment on function public.import_driver_monitoring_workbook_v1(jsonb) is
  'Atomically and idempotently imports driver-monitoring workbooks after explicit tenant/operator authorization.';
