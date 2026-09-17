create unique index if not exists operational_checklists_tenant_id_id_uidx
  on public.operational_checklists (tenant_id, id);
create unique index if not exists employees_tenant_id_id_uidx
  on public.employees (tenant_id, id);
create unique index if not exists dispatch_trips_tenant_id_id_uidx
  on public.dispatch_trips (tenant_id, id);
create unique index if not exists incidents_tenant_id_id_uidx
  on public.incidents (tenant_id, id);
create unique index if not exists maintenance_orders_tenant_id_id_uidx
  on public.maintenance_orders (tenant_id, id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'checklist_executions_tenant_checklist_fkey') then
    alter table public.checklist_executions add constraint checklist_executions_tenant_checklist_fkey
      foreign key (tenant_id, checklist_id) references public.operational_checklists (tenant_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'checklist_executions_tenant_vehicle_fkey') then
    alter table public.checklist_executions add constraint checklist_executions_tenant_vehicle_fkey
      foreign key (tenant_id, vehicle_id) references public.vehicles (tenant_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'checklist_executions_tenant_employee_fkey') then
    alter table public.checklist_executions add constraint checklist_executions_tenant_employee_fkey
      foreign key (tenant_id, employee_id) references public.employees (tenant_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'checklist_executions_tenant_trip_fkey') then
    alter table public.checklist_executions add constraint checklist_executions_tenant_trip_fkey
      foreign key (tenant_id, dispatch_trip_id) references public.dispatch_trips (tenant_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'checklist_executions_tenant_incident_fkey') then
    alter table public.checklist_executions add constraint checklist_executions_tenant_incident_fkey
      foreign key (tenant_id, generated_incident_id) references public.incidents (tenant_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'checklist_executions_tenant_maintenance_fkey') then
    alter table public.checklist_executions add constraint checklist_executions_tenant_maintenance_fkey
      foreign key (tenant_id, generated_maintenance_id) references public.maintenance_orders (tenant_id, id) not valid;
  end if;
end
$$;

create or replace function public.create_checklist_execution_v1(
  _tenant_id uuid,
  _checklist_id uuid,
  _checked_items jsonb,
  _vehicle_id uuid default null,
  _employee_id uuid default null,
  _dispatch_trip_id uuid default null,
  _notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_checklist public.operational_checklists%rowtype;
  v_execution public.checklist_executions%rowtype;
  v_total integer;
  v_passed integer;
  v_failed integer;
  v_status text;
  v_incident_id uuid;
  v_maintenance_id uuid;
  v_failed_labels text;
begin
  if not public.is_tenant_admin(_tenant_id) then
    raise exception 'Apenas administradores podem executar checklists' using errcode = '42501';
  end if;

  select * into v_checklist
  from public.operational_checklists
  where tenant_id = _tenant_id and id = _checklist_id
  for share;

  if v_checklist.id is null then
    raise exception 'Template de checklist não pertence ao tenant' using errcode = '23503';
  end if;
  if not coalesce(v_checklist.active, false) then
    raise exception 'Template de checklist inativo' using errcode = '23514';
  end if;
  if jsonb_typeof(_checked_items) <> 'array' then
    raise exception 'Itens conferidos devem ser uma lista' using errcode = '22023';
  end if;

  v_total := jsonb_array_length(_checked_items);
  if v_total <> jsonb_array_length(v_checklist.items)
     or (select count(distinct item->>'key') from jsonb_array_elements(_checked_items) item) <> v_total
     or exists (
       select 1 from jsonb_array_elements(v_checklist.items) template_item
       where not exists (
         select 1 from jsonb_array_elements(_checked_items) checked_item
         where checked_item->>'key' = template_item->>'key'
       )
     ) then
    raise exception 'Todos os itens do template devem ser confirmados exatamente uma vez' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(_checked_items) item
    where coalesce(item->>'status', '') not in ('ok', 'nok', 'na')
  ) then
    raise exception 'Todos os itens precisam de uma confirmação válida' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_checklist.items) template_item
    join jsonb_array_elements(_checked_items) checked_item
      on checked_item->>'key' = template_item->>'key'
    where coalesce((template_item->>'required')::boolean, false)
      and checked_item->>'status' = 'na'
  ) then
    raise exception 'Itens obrigatórios não podem ser marcados como N/A' using errcode = '23514';
  end if;

  if _vehicle_id is not null and not exists (
    select 1 from public.vehicles where tenant_id = _tenant_id and id = _vehicle_id
  ) then raise exception 'Veículo não pertence ao tenant' using errcode = '23503'; end if;
  if _employee_id is not null and not exists (
    select 1 from public.employees where tenant_id = _tenant_id and id = _employee_id
  ) then raise exception 'Funcionário não pertence ao tenant' using errcode = '23503'; end if;
  if _dispatch_trip_id is not null and not exists (
    select 1 from public.dispatch_trips where tenant_id = _tenant_id and id = _dispatch_trip_id
  ) then raise exception 'Viagem não pertence ao tenant' using errcode = '23503'; end if;

  select count(*) filter (where item->>'status' = 'ok'),
         count(*) filter (where item->>'status' = 'nok')
  into v_passed, v_failed
  from jsonb_array_elements(_checked_items) item;
  v_status := case when v_failed = 0 then 'passed' when v_passed = 0 then 'failed' else 'partial' end;

  if v_failed > 0 and coalesce(v_checklist.can_generate_maintenance, false) and _vehicle_id is null then
    raise exception 'Selecione um veículo para gerar a manutenção deste checklist' using errcode = '23514';
  end if;

  select string_agg(coalesce(item->>'label', item->>'key'), ', ' order by item->>'key')
  into v_failed_labels
  from jsonb_array_elements(_checked_items) item
  where item->>'status' = 'nok';

  if v_failed > 0 and coalesce(v_checklist.can_generate_incident, false) then
    insert into public.incidents (
      tenant_id, incident_number, incident_type, category, severity, status,
      title, description, occurred_at, reported_at, origin_type,
      vehicle_id, employee_id, dispatch_trip_id, opened_by, created_by
    ) values (
      _tenant_id,
      'INC-' || upper(left(replace(gen_random_uuid()::text, '-', ''), 12)),
      'checklist', 'operational_checklist', 'medium', 'open',
      'Reprovação no checklist: ' || v_checklist.name,
      'Itens reprovados: ' || coalesce(v_failed_labels, 'não informados'),
      now(), now(), 'checklist_execution',
      _vehicle_id, _employee_id, _dispatch_trip_id, auth.uid(), auth.uid()
    ) returning id into v_incident_id;
  end if;

  if v_failed > 0 and coalesce(v_checklist.can_generate_maintenance, false) then
    insert into public.maintenance_orders (
      tenant_id, order_number, vehicle_id, maintenance_type, status, priority,
      reported_problem, opened_at, checklist_results, notes, incident_id, created_by
    ) values (
      _tenant_id, '', _vehicle_id, 'corrective', 'open', 'high',
      'Itens reprovados no checklist ' || v_checklist.name || ': ' || coalesce(v_failed_labels, 'não informados'),
      now(), jsonb_build_object('checklist_id', v_checklist.id, 'checked_items', _checked_items),
      _notes, v_incident_id, auth.uid()
    ) returning id into v_maintenance_id;
  end if;

  insert into public.checklist_executions (
    tenant_id, checklist_id, vehicle_id, employee_id, dispatch_trip_id,
    execution_type, status, checked_items, total_items, passed_items, failed_items,
    generated_incident_id, generated_maintenance_id, blocked_operation,
    notes, executed_by
  ) values (
    _tenant_id, v_checklist.id, _vehicle_id, _employee_id, _dispatch_trip_id,
    v_checklist.checklist_type, v_status, _checked_items, v_total, v_passed, v_failed,
    v_incident_id, v_maintenance_id,
    coalesce(v_checklist.can_block_operation, false) and v_failed > 0,
    _notes, auth.uid()
  ) returning * into v_execution;

  return to_jsonb(v_execution);
end;
$function$;

revoke insert, update, delete on public.checklist_executions from authenticated;
revoke all on function public.create_checklist_execution_v1(uuid, uuid, jsonb, uuid, uuid, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.create_checklist_execution_v1(uuid, uuid, jsonb, uuid, uuid, uuid, text)
to authenticated, service_role;
