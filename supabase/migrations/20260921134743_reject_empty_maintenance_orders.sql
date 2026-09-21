alter table public.maintenance_orders
  add constraint maintenance_orders_subject_required
    check (vehicle_id is not null or asset_id is not null) not valid,
  add constraint maintenance_orders_reported_problem_required
    check (reported_problem is not null and btrim(reported_problem) <> '') not valid;

alter table public.maintenance_orders
  validate constraint maintenance_orders_subject_required,
  validate constraint maintenance_orders_reported_problem_required;
