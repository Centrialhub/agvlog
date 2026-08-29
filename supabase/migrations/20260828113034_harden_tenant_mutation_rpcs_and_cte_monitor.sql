
revoke execute on function public.diagnose_load_composition(uuid,uuid[]) from public, anon, authenticated;
revoke execute on function public.repair_load_composition(uuid,uuid[],boolean) from public, anon, authenticated;
revoke execute on function public.link_fiscal_documents_to_load_v1(uuid,uuid,uuid[]) from public, anon, authenticated;
revoke execute on function public.unlink_fiscal_documents_from_load_v1(uuid,uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.diagnose_load_composition(uuid,uuid[]),
                          public.repair_load_composition(uuid,uuid[],boolean),
                          public.link_fiscal_documents_to_load_v1(uuid,uuid,uuid[]),
                          public.unlink_fiscal_documents_from_load_v1(uuid,uuid,uuid[])
to service_role;

create or replace function public.attach_loads_to_driver_settlement(
  _settlement_id uuid,
  _load_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_s public.driver_settlements;
  v_load uuid;
begin
  select *
  into v_s
  from public.driver_settlements
  where id = _settlement_id
  for update;

  if not found then raise exception 'settlement_not_found'; end if;
  if auth.role() <> 'service_role'
     and not public.is_tenant_operator_or_admin(v_s.tenant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not v_s.is_manual then raise exception 'not_manual_settlement'; end if;
  if v_s.status not in ('pending_review','in_review','reopened') then
    raise exception 'settlement_locked';
  end if;

  if _load_ids is null or array_length(_load_ids, 1) is null then return; end if;

  if exists (
    select 1
    from unnest(_load_ids) as requested(load_id)
    where requested.load_id is null
       or not exists (
         select 1
         from public.loads l
         where l.id = requested.load_id
           and l.tenant_id = v_s.tenant_id
       )
  ) then
    raise exception 'cross_tenant_or_missing_load' using errcode = '42501';
  end if;

  foreach v_load in array _load_ids loop
    if not public._load_available_for_settlement(v_s.tenant_id, v_load, _settlement_id) then
      raise exception 'load_already_linked: %', v_load;
    end if;
    insert into public.driver_settlement_loads(
      tenant_id, settlement_id, load_id, created_by
    )
    values (v_s.tenant_id, _settlement_id, v_load, auth.uid())
    on conflict (load_id) do nothing;
  end loop;

  perform public._log_settlement_event(
    _settlement_id,
    'loads_attached',
    null,
    null,
    null,
    jsonb_build_object('count', array_length(_load_ids, 1))
  );
  perform public._build_manual_driver_settlement(_settlement_id);
end;
$function$;

create or replace function public.create_manual_driver_settlement(
  _tenant_id uuid,
  _driver_id uuid,
  _vehicle_id uuid,
  _reference_date date,
  _load_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_id uuid;
  v_load uuid;
begin
  if auth.role() <> 'service_role'
     and not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if _driver_id is null then raise exception 'driver_required'; end if;
  if _load_ids is null or array_length(_load_ids, 1) is null then
    raise exception 'no_loads_selected';
  end if;
  if not exists (
    select 1 from public.drivers
    where id = _driver_id and tenant_id = _tenant_id
  ) then
    raise exception 'cross_tenant_or_missing_driver' using errcode = '42501';
  end if;
  if _vehicle_id is not null and not exists (
    select 1 from public.vehicles
    where id = _vehicle_id and tenant_id = _tenant_id
  ) then
    raise exception 'cross_tenant_or_missing_vehicle' using errcode = '42501';
  end if;
  if exists (
    select 1
    from unnest(_load_ids) as requested(load_id)
    where requested.load_id is null
       or not exists (
         select 1 from public.loads l
         where l.id = requested.load_id
           and l.tenant_id = _tenant_id
       )
  ) then
    raise exception 'cross_tenant_or_missing_load' using errcode = '42501';
  end if;

  insert into public.driver_settlements (
    tenant_id, dispatch_trip_id, driver_id, vehicle_id, status,
    is_manual, manual_reference_date,
    trip_started_at, trip_completed_at,
    route_name, route_origin, route_destination,
    loads_count, stops_count, documents_count,
    total_invoice_value, total_freight_value, total_weight_kg,
    total_goods_value, total_freight_revenue, route_result,
    approved_expenses_total, pending_expenses_total, rejected_expenses_total, expenses_total,
    driver_reimbursement_total, invoice_balance, operational_balance,
    last_recalculated_at, needs_recalculation, recalculation_reason, created_by
  ) values (
    _tenant_id, null, _driver_id, _vehicle_id, 'pending_review',
    true, coalesce(_reference_date, current_date),
    null, (coalesce(_reference_date, current_date))::timestamptz,
    'Acerto manual', null, null,
    0, 0, 0,
    0, 0, 0,
    0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0,
    now(), false, null, auth.uid()
  )
  returning id into v_id;

  foreach v_load in array _load_ids loop
    if not public._load_available_for_settlement(_tenant_id, v_load, null) then
      raise exception 'load_already_linked: %', v_load;
    end if;
    insert into public.driver_settlement_loads(
      tenant_id, settlement_id, load_id, created_by
    )
    values (_tenant_id, v_id, v_load, auth.uid());
  end loop;

  perform public._log_settlement_event(
    v_id,
    'created_manual',
    null,
    null,
    null,
    jsonb_build_object('loads', array_length(_load_ids, 1), 'driver_id', _driver_id)
  );
  perform public._build_manual_driver_settlement(v_id);
  return v_id;
end;
$function$;

drop function public.monitor_simples_nacional_icms_violations();
drop function public.monitor_simples_nacional_icms_violations(uuid);

create function public.monitor_simples_nacional_icms_violations(_tenant_id uuid)
returns table(
  fiscal_document_id uuid,
  cte_number text,
  emitter_name text,
  icms_base numeric,
  icms_aliquota numeric,
  icms_valor numeric,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = 'public'
as $function$
begin
  if auth.role() <> 'service_role'
     and not public.is_tenant_admin(_tenant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    fd.id,
    coalesce(
      fd.invoice_number,
      fd.cte_payload->'payload'->'ide'->>'nCT',
      fd.id::text
    )::text,
    coalesce(
      te.razao_social,
      fd.cte_payload->'payload'->'emitente'->>'nome',
      'Emitente não identificado'
    )::text,
    coalesce(nullif(fd.cte_payload->'payload'->'valores'->>'baseIcms', '')::numeric, 0),
    coalesce(nullif(fd.cte_payload->'payload'->'valores'->>'aliquotaIcms', '')::numeric, 0),
    coalesce(nullif(fd.cte_payload->'payload'->'valores'->>'valorIcms', '')::numeric, 0),
    fd.created_at
  from public.fiscal_documents fd
  left join public.tenant_emitters te
    on te.id = fd.emitter_id
   and te.tenant_id = fd.tenant_id
  where fd.tenant_id = _tenant_id
    and fd.status = 'authorized'
    and fd.deleted_at is null
    and fd.cte_payload is not null
    and lower(coalesce(
      te.regime_tributario,
      fd.cte_payload->>'regimeTributario',
      fd.cte_payload->'payload'->>'regimeTributario',
      ''
    )) in ('simples', 'mei', '1')
    and (
      coalesce(nullif(fd.cte_payload->'payload'->'valores'->>'baseIcms', '')::numeric, 0) > 0
      or coalesce(nullif(fd.cte_payload->'payload'->'valores'->>'aliquotaIcms', '')::numeric, 0) > 0
      or coalesce(nullif(fd.cte_payload->'payload'->'valores'->>'valorIcms', '')::numeric, 0) > 0
    );
end;
$function$;

revoke execute on function public.monitor_simples_nacional_icms_violations(uuid)
from public, anon;
grant execute on function public.monitor_simples_nacional_icms_violations(uuid)
to authenticated, service_role;

create or replace function public.update_employee_v1(
  p_tenant_id uuid,
  p_employee_id uuid,
  p_values jsonb,
  p_expected_version integer
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_old_data jsonb;
  v_new_data jsonb;
  v_operator_id uuid := auth.uid();
  v_allowed_keys text[] := array[
    'name', 'doc_cpf', 'doc_rg', 'role_title', 'department',
    'branch', 'manager_id', 'cost_center', 'hire_date',
    'termination_date', 'status', 'phone', 'email',
    'cnh_number', 'cnh_category', 'cnh_expiry',
    'medical_exam_expiry', 'driver_id', 'user_id', 'notes'
  ];
  v_key text;
  v_manager_tenant_id uuid;
  v_driver_tenant_id uuid;
begin
  if auth.role() <> 'service_role'
     and (v_operator_id is null or not public.is_tenant_admin(p_tenant_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_expected_version is null then
    raise exception 'p_expected_version is required for optimistic locking'
      using errcode = 'P0004';
  end if;

  select to_jsonb(e.*)
  into v_old_data
  from public.employees e
  where e.id = p_employee_id
    and e.tenant_id = p_tenant_id
  for update;

  if v_old_data is null then
    raise exception 'Employee not found or access denied' using errcode = 'P0002';
  end if;
  if (v_old_data->>'version')::int <> p_expected_version then
    raise exception 'Conflict: Employee was modified by another user (expected version %, found %)',
      p_expected_version, (v_old_data->>'version')::int
      using errcode = 'P0001';
  end if;

  for v_key in select jsonb_object_keys(p_values) loop
    if not v_key = any(v_allowed_keys) then
      raise exception 'Invalid field: %', v_key using errcode = '42703';
    end if;
  end loop;

  if p_values ? 'manager_id' and nullif(p_values->>'manager_id', '') is not null then
    select tenant_id into v_manager_tenant_id
    from public.employees
    where id = (p_values->>'manager_id')::uuid;
    if v_manager_tenant_id is distinct from p_tenant_id then
      raise exception 'Cross-tenant violation: Manager belongs to another tenant'
        using errcode = '42501';
    end if;
  end if;

  if p_values ? 'driver_id' and nullif(p_values->>'driver_id', '') is not null then
    select tenant_id into v_driver_tenant_id
    from public.drivers
    where id = (p_values->>'driver_id')::uuid;
    if v_driver_tenant_id is distinct from p_tenant_id then
      raise exception 'Cross-tenant violation: Driver belongs to another tenant'
        using errcode = '42501';
    end if;
  end if;

  if p_values ? 'user_id' and nullif(p_values->>'user_id', '') is not null
     and not exists (
       select 1
       from public.tenant_memberships tm
       where tm.user_id = (p_values->>'user_id')::uuid
         and tm.tenant_id = p_tenant_id
         and tm.active = true
     ) then
    raise exception 'Cross-tenant violation: User is not an active tenant member'
      using errcode = '42501';
  end if;

  update public.employees
  set
    name = case when p_values ? 'name' then p_values->>'name' else name end,
    doc_cpf = case when p_values ? 'doc_cpf' then p_values->>'doc_cpf' else doc_cpf end,
    doc_rg = case when p_values ? 'doc_rg' then p_values->>'doc_rg' else doc_rg end,
    role_title = case when p_values ? 'role_title' then p_values->>'role_title' else role_title end,
    department = case when p_values ? 'department' then p_values->>'department' else department end,
    branch = case when p_values ? 'branch' then p_values->>'branch' else branch end,
    manager_id = case when p_values ? 'manager_id' then nullif(p_values->>'manager_id', '')::uuid else manager_id end,
    cost_center = case when p_values ? 'cost_center' then p_values->>'cost_center' else cost_center end,
    hire_date = case when p_values ? 'hire_date' then nullif(p_values->>'hire_date', '')::date else hire_date end,
    termination_date = case when p_values ? 'termination_date' then nullif(p_values->>'termination_date', '')::date else termination_date end,
    status = case when p_values ? 'status' then (p_values->>'status')::public.app_employee_status else status end,
    phone = case when p_values ? 'phone' then p_values->>'phone' else phone end,
    email = case when p_values ? 'email' then p_values->>'email' else email end,
    cnh_number = case when p_values ? 'cnh_number' then p_values->>'cnh_number' else cnh_number end,
    cnh_category = case when p_values ? 'cnh_category' then p_values->>'cnh_category' else cnh_category end,
    cnh_expiry = case when p_values ? 'cnh_expiry' then nullif(p_values->>'cnh_expiry', '')::date else cnh_expiry end,
    medical_exam_expiry = case when p_values ? 'medical_exam_expiry' then nullif(p_values->>'medical_exam_expiry', '')::date else medical_exam_expiry end,
    driver_id = case when p_values ? 'driver_id' then nullif(p_values->>'driver_id', '')::uuid else driver_id end,
    user_id = case when p_values ? 'user_id' then nullif(p_values->>'user_id', '')::uuid else user_id end,
    notes = case when p_values ? 'notes' then p_values->>'notes' else notes end,
    version = version + 1,
    updated_at = now()
  where id = p_employee_id
    and tenant_id = p_tenant_id;

  select to_jsonb(e.*)
  into v_new_data
  from public.employees e
  where e.id = p_employee_id
    and e.tenant_id = p_tenant_id;

  insert into public.vehicle_events(
    tenant_id, event_type, payload, created_by
  )
  values (
    p_tenant_id,
    'employee_updated',
    jsonb_build_object(
      'employee_id', p_employee_id,
      'before', v_old_data,
      'after', v_new_data,
      'changed_fields', p_values
    ),
    v_operator_id
  );
end;
$function$;

