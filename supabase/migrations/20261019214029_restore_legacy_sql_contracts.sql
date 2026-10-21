-- Preserve existing SQL APIs and execution boundaries. No data migration.
-- Canonical column types replace references to absent legacy enums/columns.
-- SSX resolves the same signed context before SQL planning; guards stay intact.
set local search_path=public,extensions;
create temporary table qa_sql_compatibility_targets(signature text,before_md5 text,after_md5 text) on commit drop;
insert into qa_sql_compatibility_targets values
('public.create_ledger_entry_v1(uuid,text,uuid,text,text,numeric,text,jsonb)','b4930246f2c063c82388aa6bce2269c2','ea649bef3fc49dff14a292012d2a59a3'),
('public.update_employee_v1(uuid,uuid,jsonb,integer)','c85b8c3c82df62e8ae4d8c33da2bfe0b','377c122a5a15b784ee0975ac1d24ed16'),
('public.create_load_v1(uuid,uuid,uuid,text,text,text,text,timestamp with time zone,text)','88d0333f5c8abbf544ddada05c7d5af1','b52ffaea1d60f7320c1a7190649e95d2'),
('public.create_load_with_next_number(uuid,text,text,uuid,uuid,text,text)','819414962389bbecf167042289b6868c','dad4207cd3bdde4adaaf8a19ebbc82f0'),
('public.delete_load_v1(uuid,uuid)','7c673d1d7a7394754510950b6f926961','f07dd5ad3f308c7eeaa9e5036c77ac9f'),
('public.list_drivers_v1(uuid,text,text,integer)','11270e448636e76a51859b65e4d8b9ee','2131e2becb9ae812f89fb17072de6b59'),
('public.resolve_ssx_mapping_conflict_v1(uuid,uuid,text)','4c052711cab30e522d467335687a12b4','a52f2a97be044c409656907eeb9b7a94'),
('public.resolve_ssx_mapping_conflict_v2(uuid,uuid,text,uuid)','703ee84167423ecbd754f8b61679d656','01007e53efaddbff45c29d08d645fc60'),
('finance_private.legacy_integrity_inventory_revision(uuid)','c133a5c91de3004b037effc581608c8a','3cf620dc7307956074dc16c780127d1f'),
('finance_private.unloading_projection_repair_context(uuid,uuid)','e2a53d89abc576eb3d2bef23d742cf54','7d56d631075ab3c1aec2f3570b0c8d12'),
('public.add_driver_settlement_manual_expense(uuid,text,numeric,timestamp with time zone,text,text,boolean,text,text)','6b32cff0461f84525eeedec5518733f9','85e3c1b0a7a9f411dce02e0374230809'),
('public.list_dispatch_trips_v1(uuid,text,text[],timestamp with time zone,integer)','4b2f4df80fcac5e09d147a956e7080de','a9e49c48d27e2a54ef9f27f0504482eb'),
('public.plan_dispatch_trip_v2(uuid,uuid,uuid,uuid[],timestamp with time zone,text)','737564d5c5de2efa09c4e0f7b219eaa6','4b69e997ff0226970eda3d3eaee88923'),
('public.plan_dispatch_trip_v2(uuid,uuid,uuid,text,uuid[],jsonb,text)','14a016666f3beecff0b49e7b30b12632','f7d09ca509d30902a9957771566a9bc7'),
('public.driver_report_event_v1(uuid,uuid,uuid,uuid,text,jsonb,text)','fe8eb8fd799670d8042f099bd7a122a4','233dcd6ae2fb3d39ce8cc5bc0397f9f9'),
('public.log_operational_event_v2(uuid,text,uuid,uuid,jsonb,jsonb,text)','9fec2242c2070f660941752362e71815','f61c11ebb4f1421ab771a6b2cd68e4e3'),
('public.get_driver_workspace_v1(uuid,uuid)','0462651574e9ae95b612e081bd044723','bcb587be555b5600b5520959140fbbf0'),
('public.process_geofence_alerts(uuid,uuid,double precision,double precision,timestamp with time zone)','1ab368ebf066e3518769ed9abc9a904e','4d2dcd4070fc2083a17a31895feb008a'),
('public.process_overspeed_alerts(uuid,uuid,numeric,timestamp with time zone)','f40211f1a59de686279079dcb5f305be','c1a516b3116f630e383e3783799ef965'),
('public.build_fiscal_documents_deleted_recovery_dry_run(timestamp with time zone,timestamp with time zone,uuid)','d7969439e368ae8a2ea33d0f233956de','7b811c59f322b2f505b41281b721a752'),
('public.diagnose_load_composition(uuid,uuid[])','2947bcae54dc9daf66353f8b79a256c8','0390245378c742885d2a087bcee86c7d'),
('public.link_fiscal_documents_to_load_v1(uuid,uuid,uuid[])','954193682974c0190da4347c030f6fa7','e85c88e4c17a50a07511c76f5612c6b0'),
('public.move_load_items_v2(uuid,uuid,uuid,uuid[])','a492e43a254110b402310f346d27effe','811a0792709ebb1f97052468922673ab'),
('public.repair_load_composition(uuid,uuid[],boolean)','7aee79bcc28b58fc2a656f5284d64330','418ec29e1c87503676770c46d69039ee'),
('public.unlink_fiscal_documents_from_load_v1(uuid,uuid,uuid[])','8ecfc5538fe0725391868b713464b327','c5c5d8d8c98cb608be2233bdc9fe2dc1');
do $preimage$ begin
 if exists(select 1 from qa_sql_compatibility_targets t left join pg_proc p on p.oid=to_regprocedure(t.signature) where p.oid is null or md5(p.prosrc) not in(t.before_md5,t.after_md5)) then raise exception 'sql_compatibility_preimage_changed';end if;
end;$preimage$;
create temporary table qa_sql_compatibility_contract_before on commit drop as select p.oid,p.proname,p.pronamespace,p.proowner,p.prolang,p.procost,p.prorows,p.provariadic,p.prosupport,p.prokind,p.prosecdef,p.proleakproof,p.proisstrict,p.proretset,p.provolatile,p.proparallel,p.pronargs,p.pronargdefaults,p.prorettype,p.proargtypes::text,p.proallargtypes,p.proargmodes,p.proargnames,p.proargdefaults::text,p.proconfig,p.proacl::text from pg_proc p where p.oid in ('public.create_ledger_entry_v1(uuid,text,uuid,text,text,numeric,text,jsonb)'::regprocedure,
'public.update_employee_v1(uuid,uuid,jsonb,integer)'::regprocedure,
'public.create_load_v1(uuid,uuid,uuid,text,text,text,text,timestamp with time zone,text)'::regprocedure,
'public.create_load_with_next_number(uuid,text,text,uuid,uuid,text,text)'::regprocedure,
'public.delete_load_v1(uuid,uuid)'::regprocedure,
'public.list_drivers_v1(uuid,text,text,integer)'::regprocedure,
'public.resolve_ssx_mapping_conflict_v1(uuid,uuid,text)'::regprocedure,
'public.resolve_ssx_mapping_conflict_v2(uuid,uuid,text,uuid)'::regprocedure,
'finance_private.legacy_integrity_inventory_revision(uuid)'::regprocedure,
'finance_private.unloading_projection_repair_context(uuid,uuid)'::regprocedure,
'public.add_driver_settlement_manual_expense(uuid,text,numeric,timestamp with time zone,text,text,boolean,text,text)'::regprocedure,
'public.list_dispatch_trips_v1(uuid,text,text[],timestamp with time zone,integer)'::regprocedure,
'public.plan_dispatch_trip_v2(uuid,uuid,uuid,uuid[],timestamp with time zone,text)'::regprocedure,
'public.plan_dispatch_trip_v2(uuid,uuid,uuid,text,uuid[],jsonb,text)'::regprocedure,
'public.driver_report_event_v1(uuid,uuid,uuid,uuid,text,jsonb,text)'::regprocedure,
'public.log_operational_event_v2(uuid,text,uuid,uuid,jsonb,jsonb,text)'::regprocedure,
'public.get_driver_workspace_v1(uuid,uuid)'::regprocedure,
'public.process_geofence_alerts(uuid,uuid,double precision,double precision,timestamp with time zone)'::regprocedure,
'public.process_overspeed_alerts(uuid,uuid,numeric,timestamp with time zone)'::regprocedure,
'public.build_fiscal_documents_deleted_recovery_dry_run(timestamp with time zone,timestamp with time zone,uuid)'::regprocedure,
'public.diagnose_load_composition(uuid,uuid[])'::regprocedure,
'public.link_fiscal_documents_to_load_v1(uuid,uuid,uuid[])'::regprocedure,
'public.move_load_items_v2(uuid,uuid,uuid,uuid[])'::regprocedure,
'public.repair_load_composition(uuid,uuid[],boolean)'::regprocedure,
'public.unlink_fiscal_documents_from_load_v1(uuid,uuid,uuid[])'::regprocedure);

CREATE OR REPLACE FUNCTION public.create_ledger_entry_v1(_tenant_id uuid, _source_table text, _source_id uuid, _entry_type text, _nature text, _amount numeric, _description text, _metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO public.operational_ledger (
        tenant_id, source_table, source_id, entry_type, nature, amount, status, metadata
    )
    VALUES (
        _tenant_id, _source_table, _source_id, _entry_type, _nature, _amount, 'active', 
        _metadata || jsonb_build_object('description', _description)
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_employee_v1(p_tenant_id uuid, p_employee_id uuid, p_values jsonb, p_expected_version integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    status = case when p_values ? 'status' then p_values->>'status' else status end,
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

  perform public._log_entity_audit(p_tenant_id,'employee',p_employee_id,'update',v_old_data,v_new_data,'update_employee_v1');
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_load_v1(p_tenant_id uuid, p_vehicle_id uuid DEFAULT NULL::uuid, p_driver_id uuid DEFAULT NULL::uuid, p_origin text DEFAULT ''::text, p_destination text DEFAULT ''::text, p_notes text DEFAULT NULL::text, p_operation_type text DEFAULT NULL::text, p_scheduled_load_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_idempotency_key text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_load_id uuid;
    v_load_number text;
BEGIN
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('legacy-idempotency-key:'||p_tenant_id::text||':'||p_idempotency_key,0));
        IF EXISTS (SELECT 1 FROM public.idempotency_keys WHERE tenant_id = p_tenant_id AND key_value = p_idempotency_key) THEN
            RAISE EXCEPTION 'Duplicate request (idempotency)';
        END IF;
        INSERT INTO public.idempotency_keys (tenant_id, key_value) VALUES (p_tenant_id, p_idempotency_key);
    END IF;

    IF p_vehicle_id IS NOT NULL AND NOT check_resource_ownership(p_tenant_id, p_vehicle_id, 'vehicles') THEN
        RAISE EXCEPTION 'Vehicle does not belong to tenant';
    END IF;
    IF p_driver_id IS NOT NULL AND NOT check_resource_ownership(p_tenant_id, p_driver_id, 'drivers') THEN
        RAISE EXCEPTION 'Driver does not belong to tenant';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text,0));
    v_load_number := public.peek_next_load_number(p_tenant_id);

    INSERT INTO public.loads (
        tenant_id, load_number, vehicle_id, driver_id, origin, destination, 
        notes, operation_type, scheduled_load_at, status
    ) VALUES (
        p_tenant_id, v_load_number, p_vehicle_id, p_driver_id, p_origin, p_destination,
        p_notes, p_operation_type::public.operation_type, p_scheduled_load_at, 'assembling'
    ) RETURNING id INTO v_load_id;

    INSERT INTO public.entity_state_audit_log (
        tenant_id, entity_type, entity_id, to_status, idempotency_key
    ) VALUES (
        p_tenant_id, 'load', v_load_id, 'assembling', p_idempotency_key
    );

    RETURN v_load_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_load_with_next_number(_tenant_id uuid, _origin text DEFAULT NULL::text, _destination text DEFAULT NULL::text, _vehicle_id uuid DEFAULT NULL::uuid, _driver_id uuid DEFAULT NULL::uuid, _trip_id text DEFAULT NULL::text, _notes text DEFAULT NULL::text)
 RETURNS loads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _next_number text;
  _created public.loads;
BEGIN
  IF NOT public.is_tenant_member(_tenant_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_tenant_id::text, 0));
  _next_number := public.peek_next_load_number(_tenant_id);

  INSERT INTO public.loads (
    tenant_id,
    load_number,
    origin,
    destination,
    vehicle_id,
    driver_id,
    trip_id,
    notes,
    created_by
  ) VALUES (
    _tenant_id,
    _next_number,
    _origin,
    _destination,
    _vehicle_id,
    _driver_id,
    _trip_id::uuid,
    _notes,
    auth.uid()
  )
  RETURNING * INTO _created;

  RETURN _created;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_load_v1(p_tenant_id uuid, p_load_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_load public.loads;
  v_active_trip boolean;
BEGIN
  IF p_tenant_id IS NULL OR p_load_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENTS';
  END IF;
  IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT * INTO v_load FROM public.loads
   WHERE id = p_load_id AND tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LOAD_NOT_FOUND';
  END IF;

  IF lower(coalesce(v_load.status,'')) IN ('delivered','entregue','in_transit','finished','completed')
     OR lower(coalesce(v_load.operational_status,'')) IN ('delivered','entregue') THEN
    RAISE EXCEPTION 'LOAD_NOT_DELETABLE_STATUS: %', v_load.status;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.dispatch_trip_loads dtl
      JOIN public.dispatch_trips dt ON dt.id = dtl.dispatch_trip_id
     WHERE dtl.load_id = p_load_id
       AND dt.tenant_id = p_tenant_id
       AND lower(coalesce(dt.status,'')) NOT IN ('cancelled','canceled','draft')
  ) INTO v_active_trip;

  IF v_active_trip OR v_load.trip_id IS NOT NULL THEN
    RAISE EXCEPTION 'LOAD_IN_ACTIVE_TRIP';
  END IF;

  INSERT INTO public.entity_state_audit_log
    (tenant_id, entity_type, entity_id, from_status, to_status, actor_id, reason, metadata)
  VALUES (
    p_tenant_id, 'load', p_load_id, v_load.status, 'deleted', auth.uid(),
    'delete_load_v1',
    jsonb_build_object('load_number', v_load.load_number, 'version', v_load.version)
  );

  DELETE FROM public.loads WHERE id = p_load_id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object('id', p_load_id, 'deleted', true);
END
$function$;

CREATE OR REPLACE FUNCTION public.list_drivers_v1(p_tenant_id uuid, p_search text DEFAULT NULL::text, p_cursor text DEFAULT NULL::text, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_total_count bigint;
    v_items jsonb;
    v_next_cursor text;
BEGIN
    SELECT count(*) INTO v_total_count
    FROM public.drivers
    WHERE tenant_id = p_tenant_id
      AND active = true
      AND (p_search IS NULL OR unaccent(name) ILIKE unaccent('%' || p_search || '%') OR cnh_number ILIKE '%' || p_search || '%');

    SELECT jsonb_agg(t) INTO v_items FROM (
        SELECT *
        FROM public.drivers
        WHERE tenant_id = p_tenant_id
          AND active = true
          AND (p_search IS NULL OR unaccent(name) ILIKE unaccent('%' || p_search || '%') OR cnh_number ILIKE '%' || p_search || '%')
          AND (p_cursor IS NULL OR name > p_cursor)
        ORDER BY name ASC
        LIMIT p_limit
    ) t;

    IF v_items IS NOT NULL AND jsonb_array_length(v_items) = p_limit THEN
        v_next_cursor := v_items->(p_limit-1)->>'name';
    END IF;

    RETURN jsonb_build_object(
        'items', COALESCE(v_items, '[]'::jsonb),
        'next_cursor', v_next_cursor,
        'total_count', v_total_count
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_ssx_mapping_conflict_v1(_conflict_id uuid, _vehicle_id uuid, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_conflict public.ssx_mapping_conflicts%rowtype;
  v_unit_link public.vehicle_tracker_links%rowtype;
  v_vehicle_link public.vehicle_tracker_links%rowtype;
  v_link_id uuid;
  v_request_tenant uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if length(btrim(coalesce(_reason,''))) < 3 then
    raise exception 'resolution_reason_required' using errcode = '22023';
  end if;

  v_request_tenant := private.request_tenant_id();
  select * into v_conflict
  from public.ssx_mapping_conflicts
  where id = _conflict_id
    and tenant_id = v_request_tenant
  for update;
  if not found then raise exception 'mapping_conflict_not_found' using errcode = 'P0002'; end if;
  if not public.is_tenant_operator_or_admin(v_conflict.tenant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_conflict.status <> 'open' then
    raise exception 'mapping_conflict_already_resolved' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.vehicles vehicle
    where vehicle.id = _vehicle_id and vehicle.tenant_id = v_conflict.tenant_id and vehicle.active
  ) then
    raise exception 'active_vehicle_not_found' using errcode = '23514';
  end if;

  perform 1 from public.provider_units unit
  where unit.id = v_conflict.provider_unit_id and unit.tenant_id = v_conflict.tenant_id
  for update;
  if not found then raise exception 'provider_unit_not_found' using errcode = 'P0002'; end if;

  select * into v_unit_link from public.vehicle_tracker_links link
  where link.tenant_id = v_conflict.tenant_id
    and link.provider_unit_id = v_conflict.provider_unit_id and link.active
  for update;
  select * into v_vehicle_link from public.vehicle_tracker_links link
  where link.tenant_id = v_conflict.tenant_id
    and link.vehicle_id = _vehicle_id and link.active
  for update;

  if v_vehicle_link.id is not null and v_vehicle_link.provider_unit_id <> v_conflict.provider_unit_id then
    raise exception 'vehicle_already_linked_to_another_unit' using errcode = '23505';
  end if;

  if v_unit_link.id is not null and v_unit_link.vehicle_id = _vehicle_id then
    v_link_id := v_unit_link.id;
  else
    if v_unit_link.id is not null then
      update public.vehicle_tracker_links
      set active = false, end_at = clock_timestamp()
      where id = v_unit_link.id;
    end if;
    insert into public.vehicle_tracker_links (tenant_id, vehicle_id, provider_unit_id, active)
    values (v_conflict.tenant_id, _vehicle_id, v_conflict.provider_unit_id, true)
    returning id into v_link_id;
  end if;

  update public.ssx_mapping_conflicts
  set status = 'resolved', resolved_at = clock_timestamp(), resolved_by = auth.uid(),
      resolution_reason = btrim(_reason), resolved_vehicle_id = _vehicle_id,
      updated_at = clock_timestamp()
  where id = v_conflict.id;

  return jsonb_build_object('conflict_id',v_conflict.id,'tracker_link_id',v_link_id,'vehicle_id',_vehicle_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_ssx_mapping_conflict_v2(_conflict_id uuid, _vehicle_id uuid, _reason text, _request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_conflict public.ssx_mapping_conflicts%rowtype;
  v_result jsonb;
  v_request_tenant uuid;
begin
  if auth.uid() is null or private.request_tenant_id() is null or _request_id is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  v_request_tenant := private.request_tenant_id();
  select * into v_conflict
  from public.ssx_mapping_conflicts
  where id = _conflict_id and tenant_id = v_request_tenant
  for update;
  if not found then raise exception 'mapping_conflict_not_found' using errcode = 'P0002'; end if;
  if not public.is_tenant_operator_or_admin(v_conflict.tenant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_conflict.resolution_request_id = _request_id then
    if v_conflict.resolved_by is distinct from auth.uid()
      or v_conflict.resolved_vehicle_id is distinct from _vehicle_id
      or v_conflict.resolution_reason is distinct from btrim(_reason) then
      raise exception 'resolution_request_mismatch' using errcode = '23514';
    end if;
    return v_conflict.resolution_result;
  end if;
  v_result := public.resolve_ssx_mapping_conflict_v1(_conflict_id, _vehicle_id, _reason);
  update public.ssx_mapping_conflicts
  set resolution_request_id = _request_id, resolution_result = v_result
  where id = _conflict_id;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION finance_private.legacy_integrity_inventory_revision(_tenant uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare names text[]:=array['receivables_payments','receivable_payment_reversals','payables_payments','driver_settlement_payments','closing_report_payments','load_payments','employee_advances','payroll_entry_items','bank_transactions','receivables','payables','driver_settlements','closing_reports','loads','employees','payroll_entries','payroll_periods','bank_statement_imports','bank_accounts','finance_movements','finance_settlement_movement_links','finance_settlement_link_reversals','finance_payable_movement_links','finance_payable_link_reversals','finance_movement_voids'];name text;n bigint;x text;state text:='legacy-integrity-v2';
begin
 for name in select unnest(names) loop
  if to_regclass('public.'||name) is null then state:=state||':'||name||':missing';continue;end if;
  execute format('select count(*)::bigint,coalesce(max(xmin::text::bigint)::text,'''') from public.%I where tenant_id=$1',name) into n,x using _tenant;
  state:=state||':'||name||':'||n::text||':'||x;
 end loop;
 return md5(state);
end$function$;

CREATE OR REPLACE FUNCTION finance_private.unloading_projection_repair_context(_tenant uuid, _charge uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.finance_unloading_charges%rowtype;r public.receivables%rowtype;cmd public.finance_commands%rowtype;
 commands jsonb;events jsonb;history jsonb;deps jsonb:='[]';blockers jsonb:='[]';evidence jsonb;result jsonb;proof boolean;rows jsonb;row_data jsonb;tab text;blocked boolean;reason text;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into c from public.finance_unloading_charges where tenant_id=_tenant and id=_charge;
 if not found then raise exception 'finance_unloading_not_found' using errcode='22023';end if;
 select * into r from public.receivables where tenant_id=_tenant and id=c.receivable_id;
 select coalesce(jsonb_agg(to_jsonb(x) order by request_id),'[]') into commands from public.finance_commands x where tenant_id=_tenant and action='record_unloading' and x.result->>'charge_id'=c.id::text;
 select x.* into cmd from public.finance_commands x where x.tenant_id=_tenant and x.action='record_unloading' and x.result->>'charge_id'=c.id::text order by x.request_id limit 1;
 select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') into events from public.finance_events x where tenant_id=_tenant and entity_type='unloading' and entity_id=c.id and action='recorded';
 proof:=jsonb_array_length(commands)=1 and jsonb_array_length(events)=1
  and cmd.payload->>'tenant_id'=c.tenant_id::text and cmd.result->>'tenant_id'=c.tenant_id::text
  and cmd.actor_id=c.created_by and cmd.result->>'receivable_id'=c.receivable_id::text and cmd.result->>'supplier_id'=c.supplier_id::text
  and cmd.payload->>'amount_cents'=c.amount_cents::text and cmd.payload->>'occurred_on'=c.occurred_on::text
  and ((c.receipt_path is not null and cmd.payload->>'receipt_path'=c.receipt_path) or (c.receipt_path is null and secure_upload_private.unloading_prepared_receipt_proven(c.tenant_id,c.id,cmd.payload))) and cmd.payload->>'stop_id'=c.recorded_stop_id::text
  and cmd.payload->>'expected_revision'=c.source_snapshot->>'revision'
  and c.source_snapshot->>'supplier_id'=c.supplier_id::text and c.source_snapshot->>'delivery_stop_id'=c.delivery_stop_id::text
  and events#>'{0,after_data,context}'=c.source_snapshot
  and events#>>'{0,actor_id}'=c.created_by::text and events#>>'{0,after_data,receivable_id}'=c.receivable_id::text
  and events#>>'{0,after_data,amount_cents}'=c.amount_cents::text
  and exists(select 1 from public.clients where tenant_id=_tenant and id=c.supplier_id);
 if proof is distinct from true then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_origin_unverified','source_table','finance_unloading_charges','source_ids',jsonb_build_array(c.id)));end if;
 if r.id is null or r.status is distinct from 'pending' or coalesce(r.received_amount,0)<>0 or r.client_invoice_id is not null or r.closing_report_id is not null or to_jsonb(r)->>'fiscal_document_id' is not null or to_jsonb(r)->>'cte_document_id' is not null then
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_projection_state_requires_resolution','source_table','receivables','source_ids',jsonb_build_array(c.receivable_id)));
 end if;
 if r.client_id is not distinct from c.supplier_id and r.amount*100 is not distinct from c.amount_cents::numeric then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_projection_already_matches','source_table','receivables','source_ids',jsonb_build_array(c.receivable_id)));end if;
 evidence:=jsonb_build_object('charge',to_jsonb(c),'receivable',to_jsonb(r),'commands',commands,'events',events);
 for tab in select unnest(array['receivables_payments','receivable_financial_commands','finance_customer_credits','finance_receivable_movement_links','finance_legacy_receipt_movement_links','finance_fiscal_receivable_origins','finance_expense_items','financial_obligations','payables','driver_settlement_items','payroll_entry_items','finance_account_period_dependencies','client_invoices','closing_reports']) loop
  if to_regclass('public.'||tab) is null then
   blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_dependency_reader_missing','source_table',tab,'source_ids','[]'::jsonb));continue;
  end if;
  execute format($q$select coalesce(jsonb_agg(j order by j::text),'[]') from (select to_jsonb(x) j from public.%I x where tenant_id=$1) d
   where j->>'receivable_id'=$2 or j->>'unloading_id'=$3 or (j->>'source_table'='receivables' and j->>'source_id'=$2)
    or (j->>'source_kind'='receivables' and j->>'source_id'=$2)
    or j#>>'{metadata,receivable_id}'=$2
    or ($4 in('payables','financial_obligations','driver_settlement_items','payroll_entry_items') and exists(select 1 from public.finance_expense_items e where e.tenant_id=$1 and e.unloading_id=$3::uuid and (
     ($4='payables' and j->>'id'=e.payable_id::text) or (j->>'source_table'='finance_expense_items' and j->>'source_id'=e.id::text) or (j->>'source_table'='payables' and j->>'source_id'=e.payable_id::text))))$q$,tab) into rows using _tenant,c.receivable_id::text,c.id::text,tab;
  evidence:=evidence||jsonb_build_object(tab,rows);
  for row_data in select value from jsonb_array_elements(rows) loop
   blocked:=tab<>'finance_expense_items';
   if tab in('payables','financial_obligations','driver_settlement_items','payroll_entry_items') and row_data->>'receivable_id' is distinct from c.receivable_id::text and row_data#>>'{metadata,receivable_id}' is distinct from c.receivable_id::text and not(coalesce(row_data->>'source_table','')='receivables' and row_data->>'source_id'=c.receivable_id::text) then blocked:=false;end if;
   reason:=case when blocked then 'unloading_financial_history_requires_resolution' else 'unchanged_canonical_cost' end;
   if tab='finance_account_period_dependencies' and exists(select 1 from public.finance_account_period_reopenings where tenant_id=_tenant and closure_id=(row_data->>'closure_id')::uuid) then blocked:=false;reason:='reopened_period_history';end if;
   if tab='finance_expense_items' and row_data->>'amount_cents' is distinct from c.amount_cents::text then blocked:=true;reason:='unloading_cost_origin_mismatch';end if;
   deps:=deps||jsonb_build_array(jsonb_build_object('source_table',tab,'source_id',coalesce(row_data->>'id',row_data->>'command_id',row_data->>'closure_id'),'blocking',blocked,'reason',reason));
   if blocked then blockers:=blockers||jsonb_build_array(jsonb_build_object('code',reason,'source_table',tab,'source_ids',jsonb_build_array(coalesce(row_data->>'id',row_data->>'command_id',row_data->>'closure_id'))));end if;
  end loop;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'request_id',x.request_id,'actor_id',x.actor_id,'actor_name',x.actor_name,'reason',x.reason,'created_at',x.created_at,
 'before',jsonb_build_object('client_id',x.before_data->'client_id','amount_cents',finance_private.unloading_repair_cents(x.before_data->'amount')),
 'after',jsonb_build_object('client_id',x.after_data->'client_id','amount_cents',finance_private.unloading_repair_cents(x.after_data->'amount'))) order by created_at,id),'[]') into history from public.finance_unloading_projection_repairs x where tenant_id=_tenant and charge_id=_charge;
 evidence:=evidence||jsonb_build_object('history',history);
 result:=jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'charge_id',_charge,'receivable_id',c.receivable_id,'origin_verified',coalesce(proof,false),
  'original',jsonb_build_object('supplier_id',c.supplier_id,'supplier_name',c.source_snapshot->>'supplier_name','amount_cents',c.amount_cents::text,'delivery_stop_id',c.delivery_stop_id),
  'current',jsonb_build_object('receivable_id',c.receivable_id,'client_id',r.client_id,'amount_cents',finance_private.unloading_repair_cents(to_jsonb(r)->'amount'),'status',r.status),
  'target',jsonb_build_object('client_id',c.supplier_id,'amount_cents',c.amount_cents::text),'dependencies',deps,'blockers',blockers,
  'eligible',jsonb_array_length(blockers)=0,'can_repair',finance_private.can_repair_unloading(_tenant),'can_execute',false,'history',history,
  'effects',jsonb_build_object('cash_changed',false,'charge_changed',false,'cost_changed',false),'_evidence',evidence);

 if exists(select 1 from finance_private.unloading_origin_amendments where tenant_id=_tenant and charge_id=_charge) then
  result:=result||jsonb_build_object('eligible',false,'blockers',(result->'blockers')||jsonb_build_array(jsonb_build_object('code','unloading_origin_has_amendments','source_table','finance_unloading_charges','source_ids',jsonb_build_array(_charge))));
 end if;
 return result||jsonb_build_object('revision',md5(result::text));
end $function$;

CREATE OR REPLACE FUNCTION public.add_driver_settlement_manual_expense(_settlement_id uuid, _category text, _amount numeric, _expense_at timestamp with time zone, _cost_center text, _payment_source text DEFAULT 'driver'::text, _reimbursable boolean DEFAULT true, _receipt_url text DEFAULT NULL::text, _notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
 v_tenant uuid; v_actor uuid:=auth.uid(); v_request uuid:=gen_random_uuid();
 v_context jsonb; v_receipt jsonb; v_metadata jsonb; v_path text; v_response jsonb;
BEGIN
 SELECT tenant_id INTO v_tenant FROM public.driver_settlements WHERE id=_settlement_id;
 PERFORM finance_private.require_access(v_tenant);
 IF NOT public.is_tenant_operator_or_admin(v_tenant) THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE='42501'; END IF;
 IF _amount IS NULL OR _amount<=0 OR _amount*100<>trunc(_amount*100) THEN RAISE EXCEPTION 'expense_creation_invalid_amount' USING ERRCODE='22023'; END IF;
 IF _receipt_url IS NOT NULL THEN
  v_path:=regexp_replace(split_part(_receipt_url,'?',1),'^https://[^/]+/storage/v1/object/(public|authenticated|sign)/receipts/','');
  SELECT user_metadata INTO v_metadata FROM storage.objects WHERE bucket_id='receipts' AND name=v_path
   AND user_metadata @> jsonb_build_object('tenant_id',v_tenant,'actor_id',v_actor,'source_type','settlement','source_id',_settlement_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'expense_receipt_existing_object_mismatch' USING ERRCODE='23514'; END IF;
  v_request:=(v_metadata->>'request_id')::uuid;
  v_receipt:=jsonb_build_object('sha256',v_metadata->'sha256','mime',v_metadata->'mime','size',v_metadata->'size');
  IF public._expense_receipt_descriptor(v_tenant,v_actor,v_request,v_receipt)->>'path' IS DISTINCT FROM v_path THEN RAISE EXCEPTION 'expense_receipt_existing_object_mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 v_context:=public.get_expense_creation_context(v_tenant,'settlement',_settlement_id);
 v_response:=public.create_driver_expense_command(jsonb_build_object('version',1,'tenant_id',v_tenant,'actor_id',v_actor,'request_id',v_request,
  'source_type','settlement','source_id',_settlement_id,'expected_revision',v_context->>'revision','receipt',v_receipt,
  'fields',jsonb_build_object('category',_category,'amount_cents',trunc(_amount*100),'expense_at',to_char(_expense_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'payment_source',_payment_source,'reimbursable',_reimbursable,'cost_center',_cost_center,'notes',_notes,'no_receipt',v_receipt IS NULL,'no_receipt_reason',CASE WHEN v_receipt IS NULL THEN _notes END)));
 RETURN (v_response->>'expense_id')::uuid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_dispatch_trips_v1(p_tenant_id uuid, p_search text DEFAULT NULL::text, p_status text[] DEFAULT NULL::text[], p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_total_count bigint;
    v_items jsonb;
    v_next_cursor timestamptz;
BEGIN
    SELECT count(*) INTO v_total_count
    FROM public.dispatch_trips
    WHERE tenant_id = p_tenant_id
      AND (p_status IS NULL OR status = ANY(p_status))
      AND (p_search IS NULL OR id::text ILIKE '%' || p_search || '%');

    SELECT jsonb_agg(t) INTO v_items FROM (
        SELECT tr.*, 
               (SELECT row_to_json(v) FROM (SELECT plate, nickname FROM vehicles WHERE id = tr.vehicle_id) v) as vehicle,
               (SELECT row_to_json(d) FROM (SELECT name FROM drivers WHERE id = tr.driver_id) d) as driver
        FROM public.dispatch_trips tr
        WHERE tr.tenant_id = p_tenant_id
          AND (p_status IS NULL OR tr.status = ANY(p_status))
          AND (p_search IS NULL OR tr.id::text ILIKE '%' || p_search || '%')
          AND (p_cursor IS NULL OR tr.created_at < p_cursor)
        ORDER BY tr.created_at DESC
        LIMIT p_limit
    ) t;

    IF v_items IS NOT NULL AND jsonb_array_length(v_items) = p_limit THEN
        v_next_cursor := (v_items->(p_limit-1)->>'created_at')::timestamptz;
    END IF;

    RETURN jsonb_build_object(
        'items', COALESCE(v_items, '[]'::jsonb),
        'next_cursor', v_next_cursor,
        'total_count', v_total_count
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.plan_dispatch_trip_v2(p_tenant_id uuid, p_vehicle_id uuid, p_driver_id uuid, p_load_ids uuid[], p_scheduled_start timestamp with time zone DEFAULT now(), p_idempotency_key text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_trip_id uuid;
    v_load_id uuid;
BEGIN
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('legacy-idempotency-key:'||p_tenant_id::text||':'||p_idempotency_key,0));
        IF EXISTS (SELECT 1 FROM public.idempotency_keys WHERE tenant_id = p_tenant_id AND key_value = p_idempotency_key) THEN
            RAISE EXCEPTION 'Duplicate request (idempotency)';
        END IF;
        INSERT INTO public.idempotency_keys (tenant_id, key_value) VALUES (p_tenant_id, p_idempotency_key);
    END IF;

    PERFORM 1 FROM public.loads WHERE id = ANY(p_load_ids) AND tenant_id = p_tenant_id FOR UPDATE;

    IF EXISTS (SELECT 1 FROM public.loads WHERE id = ANY(p_load_ids) AND status NOT IN ('assembling', 'ready')) THEN
        RAISE EXCEPTION 'One or more loads are not in valid status for dispatch';
    END IF;

    INSERT INTO public.dispatch_trips (
        tenant_id, vehicle_id, driver_id, status, planned_start_at
    ) VALUES (
        p_tenant_id, p_vehicle_id, p_driver_id, 'planned', p_scheduled_start
    ) RETURNING id INTO v_trip_id;

    FOREACH v_load_id IN ARRAY p_load_ids
    LOOP
        INSERT INTO public.dispatch_trip_loads (tenant_id, dispatch_trip_id, load_id)
        VALUES (p_tenant_id, v_trip_id, v_load_id);
        
        UPDATE public.loads SET status = 'ready', trip_id = v_trip_id 
        WHERE id = v_load_id AND tenant_id = p_tenant_id;
    END LOOP;

    INSERT INTO public.entity_state_audit_log (
        tenant_id, entity_type, entity_id, to_status, idempotency_key
    ) VALUES (
        p_tenant_id, 'trip', v_trip_id, 'planned', p_idempotency_key
    );

    RETURN v_trip_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.plan_dispatch_trip_v2(p_tenant_id uuid, p_driver_id uuid, p_vehicle_id uuid, p_route_name text, p_load_ids uuid[], p_stops jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 RETURN public.plan_dispatch_trip_v3(p_tenant_id,'legacy-v2:'||coalesce(p_idempotency_key,gen_random_uuid()::text),p_driver_id,p_vehicle_id,p_route_name,p_load_ids,p_stops);
END;
$function$;

CREATE OR REPLACE FUNCTION public.driver_report_event_v1(p_driver_id uuid, p_tenant_id uuid, p_trip_id uuid, p_stop_id uuid, p_event_type text, p_payload jsonb DEFAULT '{}'::jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_event_id uuid;
BEGIN
    -- 1. Validate Ownership and Tenant
    IF NOT EXISTS (
        SELECT 1 FROM public.drivers 
        WHERE id = p_driver_id AND tenant_id = p_tenant_id AND user_id = v_user_id
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Driver mismatch';
    END IF;

    -- 2. Idempotency Check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_event_id 
        FROM public.dispatch_events 
        WHERE payload->>'idempotency_key' = p_idempotency_key
          AND tenant_id = p_tenant_id;
        
        IF v_event_id IS NOT NULL THEN
            RETURN jsonb_build_object('status', 'success', 'event_id', v_event_id, 'idempotent', true);
        END IF;
    END IF;

    -- 3. Log Event
    INSERT INTO public.dispatch_events (
        tenant_id,
        dispatch_trip_id,
        dispatch_stop_id,
        event_type,
        event_at,
        payload,
        created_by
    ) VALUES (
        p_tenant_id,
        p_trip_id,
        p_stop_id,
        p_event_type,
        now(),
        p_payload || jsonb_build_object('idempotency_key', p_idempotency_key),
        v_user_id
    ) RETURNING id INTO v_event_id;

    -- 4. State Transitions (Synchronous)
    IF p_event_type = 'trip_start' THEN
        UPDATE public.dispatch_trips 
        SET status = 'in_transit', 
            actual_start_at = now()
        WHERE id = p_trip_id AND tenant_id = p_tenant_id;
        
    ELSIF p_event_type = 'arrival' THEN
        UPDATE public.dispatch_stops 
        SET status = 'arrived', 
            actual_arrival_at = now()
        WHERE id = p_stop_id AND dispatch_trip_id = p_trip_id AND tenant_id = p_tenant_id;

    ELSIF p_event_type = 'departure' OR p_event_type = 'delivery_complete' THEN
        UPDATE public.dispatch_stops 
        SET status = 'completed', 
            actual_departure_at = now()
        WHERE id = p_stop_id AND dispatch_trip_id = p_trip_id AND tenant_id = p_tenant_id;

    ELSIF p_event_type = 'trip_end' THEN
        UPDATE public.dispatch_trips 
        SET status = 'completed', 
            actual_end_at = now()
        WHERE id = p_trip_id AND tenant_id = p_tenant_id;
    END IF;

    RETURN jsonb_build_object('status', 'success', 'event_id', v_event_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.log_operational_event_v2(p_tenant_id uuid, p_event_type text, p_dispatch_stop_id uuid DEFAULT NULL::uuid, p_fiscal_document_id uuid DEFAULT NULL::uuid, p_payload jsonb DEFAULT '{}'::jsonb, p_pod_data jsonb DEFAULT NULL::jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_event_id uuid;
    v_pod_id uuid;
    v_content_hash text;
BEGIN
    IF NOT public.is_tenant_member(p_tenant_id) THEN
        RAISE EXCEPTION 'forbidden';
    END IF;
    -- Validate stop ownership if provided
    IF p_dispatch_stop_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.dispatch_stops WHERE id = p_dispatch_stop_id AND tenant_id = p_tenant_id) THEN
        RAISE EXCEPTION 'Parada inválida para este tenant';
    END IF;

    IF p_fiscal_document_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.fiscal_documents WHERE tenant_id=p_tenant_id AND id=p_fiscal_document_id) THEN RAISE EXCEPTION 'Documento inválido para este tenant'; END IF;
    IF p_idempotency_key IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('legacy-operational-event:'||p_tenant_id::text||':'||p_idempotency_key,0));
        SELECT id INTO v_event_id FROM public.operational_events 
        WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
        IF v_event_id IS NOT NULL THEN
            RETURN jsonb_build_object('status', 'success', 'event_id', v_event_id, 'idempotent', true);
        END IF;
    END IF;

    IF p_pod_data IS NOT NULL THEN
        PERFORM 1 FROM public.fiscal_documents WHERE tenant_id=p_tenant_id AND id=p_fiscal_document_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'POD fiscal document is required'; END IF;
        v_content_hash := encode(extensions.digest(p_pod_data::text, 'sha256'), 'hex');
        UPDATE public.proof_of_delivery SET is_active = false 
        WHERE dispatch_stop_id = p_dispatch_stop_id 
          AND (fiscal_document_id = p_fiscal_document_id OR (fiscal_document_id IS NULL AND p_fiscal_document_id IS NULL))
          AND tenant_id = p_tenant_id AND retired_event_id IS NULL AND is_active;
        INSERT INTO public.proof_of_delivery (
            tenant_id, dispatch_stop_id, fiscal_document_id, proof_type, load_id, dispatch_trip_id, receiver_name, receiver_document,
            received_at, photo_url, signature_url, latitude, longitude, accuracy, content_hash, version, created_by
        ) VALUES (
            p_tenant_id, p_dispatch_stop_id, p_fiscal_document_id,
            CASE WHEN nullif(p_pod_data->>'signature_url','') IS NOT NULL THEN 'signature' WHEN nullif(p_pod_data->>'photo_url','') IS NOT NULL THEN 'pod_photo' ELSE 'receiver_confirmation' END,
            (SELECT load_id FROM public.fiscal_documents WHERE tenant_id=p_tenant_id AND id=p_fiscal_document_id),
            (SELECT dispatch_trip_id FROM public.dispatch_stops WHERE tenant_id=p_tenant_id AND id=p_dispatch_stop_id),p_pod_data->>'receiver_name', p_pod_data->>'receiver_tax_id',
            COALESCE((p_pod_data->>'signed_at')::timestamp with time zone, now()), p_pod_data->>'photo_url', p_pod_data->>'signature_url',
            (p_pod_data->>'latitude')::numeric, (p_pod_data->>'longitude')::numeric, (p_pod_data->>'accuracy')::numeric, v_content_hash,
            COALESCE((SELECT max(version) + 1 FROM public.proof_of_delivery WHERE tenant_id=p_tenant_id AND fiscal_document_id=p_fiscal_document_id), 1), v_user_id
        ) RETURNING id INTO v_pod_id;
    END IF;

    INSERT INTO public.operational_events (
        tenant_id, event_type, dispatch_stop_id, proof_of_delivery_id, fiscal_document_id, payload, idempotency_key, created_by
    ) VALUES (
        p_tenant_id, p_event_type, p_dispatch_stop_id, v_pod_id, p_fiscal_document_id, p_payload, p_idempotency_key, v_user_id
    ) RETURNING id INTO v_event_id;

    IF p_event_type IN ('delivery_success', 'delivery_failure') THEN
        INSERT INTO public.delivery_occurrences (
            tenant_id, fiscal_document_id, metadata, occurrence_type, occurrence_description, status, created_by
        ) VALUES (
            p_tenant_id, p_fiscal_document_id, jsonb_build_object('dispatch_stop_id',p_dispatch_stop_id,'operational_event_id',v_event_id), p_event_type, p_payload->>'description',
            CASE WHEN p_event_type = 'delivery_success' THEN 'completed' ELSE 'pending' END, v_user_id
        );
    END IF;

    RETURN jsonb_build_object('status', 'success', 'event_id', v_event_id, 'pod_id', v_pod_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_driver_workspace_v1(p_driver_id uuid, p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_trip_record record;
    v_loads jsonb;
    v_stops jsonb;
    v_progress jsonb;
    v_next_action jsonb;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = p_driver_id AND tenant_id = p_tenant_id AND user_id = auth.uid()) THEN
        RAISE EXCEPTION 'Acesso negado ao workspace do motorista';
    END IF;

    -- 1. Identify active trip
    SELECT * INTO v_trip_record
    FROM public.dispatch_trips
    WHERE driver_id = p_driver_id
      AND tenant_id = p_tenant_id
      AND status NOT IN ('completed', 'cancelled')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_trip_record.id IS NULL THEN
        RETURN jsonb_build_object(
            'has_active_trip', false,
            'driver_id', p_driver_id
        );
    END IF;

    -- 2. Fetch loads via canonical mapping
    SELECT jsonb_agg(l.*) INTO v_loads
    FROM (
        SELECT 
            loads.id,
            loads.load_number,
            loads.status,
            loads.origin,
            loads.destination,
            loads.gross_cargo_value as total_value,
            loads.total_weight_kg as total_weight
        FROM public.dispatch_trip_loads dtl
        JOIN public.loads ON loads.id = dtl.load_id
        WHERE dtl.dispatch_trip_id = v_trip_record.id
    ) l;

    -- 3. Fetch stops and stop-level documents
    SELECT jsonb_agg(s.*) INTO v_stops
    FROM (
        SELECT 
            ds.id,
            ds.stop_order,
            ds.status,
            null::text as stop_type,
            ds.destination as location_name,
            ds.location_address as address,
            ds.actual_arrival_at as arrival_time,
            ds.actual_departure_at as departure_time,
            (
                SELECT jsonb_agg(doc.*)
                FROM (
                    SELECT 
                        fd.id,
                        fd.invoice_number as number,
                        fd.invoice_series as series,
                        fd.value as total_value,
                        allocation.status as stop_status
                    FROM public.dispatch_stop_documents dsd
                    JOIN public.fiscal_documents fd ON fd.id = dsd.fiscal_document_id
                    LEFT JOIN public.delivery_allocation_documents allocation ON allocation.allocation_id=dsd.id
                    WHERE dsd.dispatch_stop_id = ds.id
                ) doc
            ) as documents
        FROM public.dispatch_stops ds
        WHERE ds.dispatch_trip_id = v_trip_record.id
        ORDER BY ds.stop_order ASC
    ) s;

    -- 4. Calculate progress
    SELECT jsonb_build_object(
        'total_stops', count(*),
        'completed_stops', count(*) FILTER (WHERE status = 'completed'),
        'pending_stops', count(*) FILTER (WHERE status IN ('pending', 'arrived', 'in_progress'))
    ) INTO v_progress
    FROM public.dispatch_stops
    WHERE dispatch_trip_id = v_trip_record.id;

    -- 5. Determine next action
    SELECT jsonb_build_object(
        'stop_id', id,
        'stop_type', null::text,
        'status', status,
        'location_name', destination
    ) INTO v_next_action
    FROM public.dispatch_stops
    WHERE dispatch_trip_id = v_trip_record.id
      AND status != 'completed'
    ORDER BY stop_order ASC
    LIMIT 1;

    RETURN jsonb_build_object(
        'has_active_trip', true,
        'trip', jsonb_build_object(
            'id', v_trip_record.id,
            'status', v_trip_record.status,
            'start_km', (select (e.payload->>'odometer')::numeric from public.dispatch_events e where e.tenant_id=p_tenant_id and e.dispatch_trip_id=v_trip_record.id and e.event_type='trip_start' order by e.event_at desc,e.id limit 1),
            'created_at', v_trip_record.created_at
        ),
        'loads', COALESCE(v_loads, '[]'::jsonb),
        'stops', COALESCE(v_stops, '[]'::jsonb),
        'progress', v_progress,
        'next_action', v_next_action
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_geofence_alerts(_tenant_id uuid, _vehicle_id uuid, _lat double precision, _lng double precision, _captured_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
 PERFORM public.process_geofence_position_batch_v2(_tenant_id,_vehicle_id,jsonb_build_array(jsonb_build_object('captured_at',_captured_at,'lat',_lat,'lng',_lng)));
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_overspeed_alerts(_tenant_id uuid, _vehicle_id uuid, _speed numeric, _captured_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _rule RECORD;
  _limit numeric;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.vehicles WHERE tenant_id=_tenant_id AND id=_vehicle_id) THEN RAISE EXCEPTION 'overspeed_vehicle_tenant_mismatch' USING ERRCODE='23514'; END IF;
  -- Find enabled overspeed rule for this tenant
  SELECT * INTO _rule 
  FROM public.alert_rules 
  WHERE tenant_id = _tenant_id 
    AND rule_type = 'overspeed' 
    AND enabled = true 
  LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  _limit := coalesce((_rule.params->>'speed_limit_kmh')::numeric,(_rule.params->>'speed_limit')::numeric);
  
  IF _speed > _limit THEN
    -- Serialize legacy upserts without inventing a new uniqueness constraint.
    PERFORM pg_advisory_xact_lock(hashtextextended('legacy-overspeed:'||_tenant_id::text||':'||_rule.id::text||':'||_vehicle_id::text,0));
    -- Create event
    INSERT INTO public.events (tenant_id, vehicle_id, event_type, event_at, severity, payload)
    VALUES (_tenant_id, _vehicle_id, 'overspeed', _captured_at, 'warning', 
            jsonb_build_object('speed', _speed, 'limit', _limit));
            
    -- Open/Update alert instance
    UPDATE public.alert_instances SET opened_at=LEAST(opened_at,_captured_at)
     WHERE tenant_id=_tenant_id AND rule_id=_rule.id AND vehicle_id=_vehicle_id AND status='open';
    IF NOT FOUND THEN
     INSERT INTO public.alert_instances(tenant_id,rule_id,vehicle_id,status,opened_at) VALUES(_tenant_id,_rule.id,_vehicle_id,'open',_captured_at);
    END IF;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.build_fiscal_documents_deleted_recovery_dry_run(_start_time timestamp with time zone, _end_time timestamp with time zone, _tenant_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(tenant_id uuid, deleted_count bigint, sample_ids uuid[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT (public.is_tenant_admin(_tenant_id)) AND coalesce(auth.role(),'') <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    RETURN QUERY
    SELECT 
        fd.tenant_id,
        count(*),
        array_agg(fd.id) FILTER (WHERE fd.id IS NOT NULL)
    FROM public.fiscal_documents fd
    WHERE fd.deleted_at BETWEEN _start_time AND _end_time
      AND (_tenant_id IS NULL OR fd.tenant_id = _tenant_id)
      AND fd.document_type = 'inbound'
    GROUP BY fd.tenant_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.diagnose_load_composition(_tenant_id uuid, _load_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(load_id uuid, load_number text, entity_id uuid, entity_type text, issue text, severity text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT public.is_tenant_admin(_tenant_id) AND coalesce(auth.role(),'') <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    RETURN QUERY
    -- Discrepancy: load_items SoT missing in fiscal_documents projection
    SELECT 
        l.id, l.load_number, li.fiscal_document_id, 'fiscal_document'::text,
        'SoT exists in load_items but projection missing in fiscal_documents'::text, 'high'::text
    FROM public.load_items li
    JOIN public.loads l ON l.id = li.load_id
    LEFT JOIN public.fiscal_documents fd ON fd.id = li.fiscal_document_id
    WHERE li.tenant_id = _tenant_id
      AND li.fiscal_document_id IS NOT NULL
      AND (fd.load_id IS NULL OR fd.load_id <> li.load_id)
      AND (_load_ids IS NULL OR li.load_id = ANY(_load_ids))

    UNION ALL

    -- Discrepancy: fiscal_documents has load_id but missing in load_items SoT
    SELECT 
        l.id, l.load_number, fd.id, 'fiscal_document'::text,
        'Projection exists in fiscal_documents but SoT missing in load_items'::text, 'high'::text
    FROM public.fiscal_documents fd
    JOIN public.loads l ON l.id = fd.load_id
    LEFT JOIN public.load_items li ON li.fiscal_document_id = fd.id AND li.load_id = fd.load_id
    WHERE fd.tenant_id = _tenant_id
      AND fd.load_id IS NOT NULL
      AND li.id IS NULL
      AND (_load_ids IS NULL OR fd.load_id = ANY(_load_ids))
    
    UNION ALL
    
    -- Totals discrepancy
    SELECT 
        l.id, l.load_number, l.id, 'load'::text,
        'Totals discrepancy (recalc needed)'::text, 'medium'::text
    FROM public.loads l
    WHERE l.tenant_id = _tenant_id
      AND (_load_ids IS NULL OR l.id = ANY(_load_ids))
      AND (
          l.total_pallet_count <> COALESCE((SELECT sum(pallet_count) FROM public.load_items total_item WHERE total_item.load_id = l.id), 0)
          OR l.total_weight_kg <> COALESCE((SELECT sum(weight_kg) FROM public.load_items total_item WHERE total_item.load_id = l.id), 0)
      );
END;
$function$;

CREATE OR REPLACE FUNCTION public.link_fiscal_documents_to_load_v1(_tenant_id uuid, _load_id uuid, _document_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_doc_id uuid;
    v_updated_count int := 0;
    v_audit_old jsonb;
    v_audit_new jsonb;
BEGIN
    -- Auth Guard
    IF NOT (public.is_tenant_admin(_tenant_id) OR public.is_tenant_operator_or_admin(_tenant_id)) AND coalesce(auth.role(),'') <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    -- Existence Check
    IF NOT EXISTS (SELECT 1 FROM public.loads WHERE id = _load_id AND tenant_id = _tenant_id) THEN
        RAISE EXCEPTION 'Load not found or unauthorized';
    END IF;

    -- Serialize composition using existing rows, without adding a uniqueness rule
    -- that would reject the current redelivery model.
    PERFORM 1 FROM public.loads WHERE tenant_id=_tenant_id AND id=_load_id FOR UPDATE;
    PERFORM 1 FROM public.fiscal_documents WHERE tenant_id=_tenant_id AND id=ANY(_document_ids) ORDER BY id FOR UPDATE;
    -- Lock Check
    IF public._load_is_locked(_load_id) THEN
        RAISE EXCEPTION 'Load is locked and cannot be modified';
    END IF;

    -- Transactional Linkage
    FOREACH v_doc_id IN ARRAY _document_ids LOOP
        -- Skip if already linked to this load
        IF EXISTS (SELECT 1 FROM public.load_items WHERE load_id = _load_id AND fiscal_document_id = v_doc_id) THEN
            CONTINUE;
        END IF;

        -- Verify ownership and availability
        IF NOT EXISTS (SELECT 1 FROM public.fiscal_documents WHERE id = v_doc_id AND tenant_id = _tenant_id) THEN
            RAISE EXCEPTION 'Document % not found or unauthorized', v_doc_id;
        END IF;

        -- Check if linked elsewhere
        IF EXISTS (SELECT 1 FROM public.fiscal_documents WHERE id = v_doc_id AND load_id IS NOT NULL AND load_id <> _load_id) THEN
             RAISE EXCEPTION 'Document % is already linked to another load', v_doc_id;
        END IF;

        -- Capture audit state
        SELECT jsonb_build_object('load_id', load_id) INTO v_audit_old FROM public.fiscal_documents WHERE id = v_doc_id;

        -- Link Projection 1: fiscal_documents
        UPDATE public.fiscal_documents 
        SET load_id = _load_id, updated_at = now() 
        WHERE id = v_doc_id;

        -- Link SoT: load_items
        INSERT INTO public.load_items (
            tenant_id, load_id, fiscal_document_id, item_description, 
            pallet_count, weight_kg, volume_m3, status
        )
        SELECT 
            _tenant_id, _load_id, id, 
            COALESCE(product_summary, 'Doc ' || invoice_number),
            COALESCE(pallet_count, 0), COALESCE(weight_kg, 0), 0, 'pending'
        FROM public.fiscal_documents
        WHERE id = v_doc_id
;

        -- Link Projection 2: load_documents (join table mirror)
        INSERT INTO public.load_documents (tenant_id, load_id, fiscal_document_id)
        VALUES (_tenant_id, _load_id, v_doc_id)
        ON CONFLICT (load_id, fiscal_document_id) DO NOTHING;

        v_audit_new := jsonb_build_object('load_id', _load_id);
        
        PERFORM public._log_entity_audit(
            _tenant_id, 'fiscal_document', v_doc_id, 'link_to_load', 
            v_audit_old, v_audit_new, 'composition_rpc'
        );

        v_updated_count := v_updated_count + 1;
    END LOOP;

    -- Recalculate
    PERFORM public._recalculate_load_totals(_load_id);

    RETURN jsonb_build_object('success', true, 'linked_count', v_updated_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.move_load_items_v2(_tenant_id uuid, _source_load_id uuid, _target_load_id uuid, _document_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_res_unlink jsonb;
    v_res_link jsonb;
BEGIN
    -- Auth Guard
    IF NOT (public.is_tenant_admin(_tenant_id) OR public.is_tenant_operator_or_admin(_tenant_id)) AND coalesce(auth.role(),'') <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    IF _source_load_id = _target_load_id THEN
        RAISE EXCEPTION 'Source and target loads are the same';
    END IF;

    IF (SELECT count(*) FROM public.loads WHERE tenant_id=_tenant_id AND id IN(_source_load_id,_target_load_id))<>2 THEN RAISE EXCEPTION 'Load not found or unauthorized'; END IF;
    PERFORM 1 FROM public.loads WHERE tenant_id=_tenant_id AND id IN(_source_load_id,_target_load_id) ORDER BY id FOR UPDATE;
    -- 1. Unlink from source (atomically within this TX)
    -- We bypass the check in link_v1 by doing it manually or modifying unlink
    -- But since they are separate functions, we can just call them if we relax the check or order them.
    
    -- Actually, let's just implement it directly for maximum control
    
    -- Lock Checks
    IF public._load_is_locked(_source_load_id) THEN RAISE EXCEPTION 'Source load is locked'; END IF;
    IF public._load_is_locked(_target_load_id) THEN RAISE EXCEPTION 'Target load is locked'; END IF;

    -- Unlink
    PERFORM public.unlink_fiscal_documents_from_load_v1(_tenant_id, _source_load_id, _document_ids);
    
    -- Link
    PERFORM public.link_fiscal_documents_to_load_v1(_tenant_id, _target_load_id, _document_ids);

    RETURN jsonb_build_object('success', true, 'moved_count', array_length(_document_ids, 1));
END;
$function$;

CREATE OR REPLACE FUNCTION public.repair_load_composition(_tenant_id uuid, _load_ids uuid[], _dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_load_id uuid;
BEGIN
    IF NOT public.is_tenant_admin(_tenant_id) AND coalesce(auth.role(),'') <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    IF EXISTS(SELECT 1 FROM unnest(_load_ids) requested(id) WHERE requested.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.loads l WHERE l.id=requested.id AND l.tenant_id=_tenant_id)) THEN RAISE EXCEPTION 'Load not found or unauthorized'; END IF;
    IF NOT _dry_run THEN PERFORM 1 FROM public.loads WHERE tenant_id=_tenant_id AND id=ANY(_load_ids) ORDER BY id FOR UPDATE; END IF;
    IF _dry_run THEN
        RETURN jsonb_build_object('dry_run', true, 'issues', (SELECT jsonb_agg(t) FROM public.diagnose_load_composition(_tenant_id, _load_ids) t));
    END IF;

    FOREACH v_load_id IN ARRAY _load_ids LOOP
        -- 1. Sync fiscal_documents to load_items (SoT wins)
        UPDATE public.fiscal_documents fd
        SET load_id = li.load_id
        FROM public.load_items li
        WHERE li.fiscal_document_id = fd.id
          AND li.load_id = v_load_id
          AND fd.tenant_id = _tenant_id
          AND (fd.load_id IS NULL OR fd.load_id <> v_load_id);

        -- 2. Clean up dangling fiscal_documents links
        UPDATE public.fiscal_documents fd
        SET load_id = NULL
        WHERE fd.load_id = v_load_id
          AND fd.tenant_id = _tenant_id
          AND NOT EXISTS (SELECT 1 FROM public.load_items li WHERE li.fiscal_document_id = fd.id AND li.load_id = v_load_id);
          
        -- 3. Sync load_documents join table
        DELETE FROM public.load_documents WHERE load_id = v_load_id;
        INSERT INTO public.load_documents (tenant_id, load_id, fiscal_document_id)
        SELECT li.tenant_id, li.load_id, li.fiscal_document_id
        FROM public.load_items li
        WHERE li.load_id = v_load_id AND li.fiscal_document_id IS NOT NULL;

        -- 4. Recalculate totals
        PERFORM public._recalculate_load_totals(v_load_id);
    END LOOP;

    RETURN jsonb_build_object('success', true, 'repaired_loads', array_length(_load_ids, 1));
END;
$function$;

CREATE OR REPLACE FUNCTION public.unlink_fiscal_documents_from_load_v1(_tenant_id uuid, _load_id uuid, _document_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_doc_id uuid;
    v_removed_count int := 0;
BEGIN
    -- Auth Guard
    IF NOT (public.is_tenant_admin(_tenant_id) OR public.is_tenant_operator_or_admin(_tenant_id)) AND coalesce(auth.role(),'') <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    IF NOT EXISTS(SELECT 1 FROM public.loads WHERE id=_load_id AND tenant_id=_tenant_id) THEN RAISE EXCEPTION 'Load not found or unauthorized'; END IF;
    PERFORM 1 FROM public.loads WHERE tenant_id=_tenant_id AND id=_load_id FOR UPDATE;
    PERFORM 1 FROM public.fiscal_documents WHERE tenant_id=_tenant_id AND id=ANY(_document_ids) ORDER BY id FOR UPDATE;
    -- Lock Check
    IF public._load_is_locked(_load_id) THEN
        RAISE EXCEPTION 'Load is locked and cannot be modified';
    END IF;

    FOREACH v_doc_id IN ARRAY _document_ids LOOP
        -- SoT Update
        DELETE FROM public.load_items 
        WHERE load_id = _load_id AND fiscal_document_id = v_doc_id;
        
        -- Projection 1
        UPDATE public.fiscal_documents 
        SET load_id = NULL, updated_at = now() 
        WHERE id = v_doc_id AND load_id = _load_id;

        -- Projection 2
        DELETE FROM public.load_documents 
        WHERE load_id = _load_id AND fiscal_document_id = v_doc_id;

        PERFORM public._log_entity_audit(
            _tenant_id, 'fiscal_document', v_doc_id, 'unlink_from_load', 
            jsonb_build_object('load_id', _load_id), jsonb_build_object('load_id', null), 
            'composition_rpc'
        );

        v_removed_count := v_removed_count + 1;
    END LOOP;

    -- Recalculate
    PERFORM public._recalculate_load_totals(_load_id);

    RETURN jsonb_build_object('success', true, 'unlinked_count', v_removed_count);
END;
$function$;

do $preserve_contract$
begin
 if exists ((select * from qa_sql_compatibility_contract_before except select p.oid,p.proname,p.pronamespace,p.proowner,p.prolang,p.procost,p.prorows,p.provariadic,p.prosupport,p.prokind,p.prosecdef,p.proleakproof,p.proisstrict,p.proretset,p.provolatile,p.proparallel,p.pronargs,p.pronargdefaults,p.prorettype,p.proargtypes::text,p.proallargtypes,p.proargmodes,p.proargnames,p.proargdefaults::text,p.proconfig,p.proacl::text from pg_proc p where p.oid in ('public.create_ledger_entry_v1(uuid,text,uuid,text,text,numeric,text,jsonb)'::regprocedure,
'public.update_employee_v1(uuid,uuid,jsonb,integer)'::regprocedure,
'public.create_load_v1(uuid,uuid,uuid,text,text,text,text,timestamp with time zone,text)'::regprocedure,
'public.create_load_with_next_number(uuid,text,text,uuid,uuid,text,text)'::regprocedure,
'public.delete_load_v1(uuid,uuid)'::regprocedure,
'public.list_drivers_v1(uuid,text,text,integer)'::regprocedure,
'public.resolve_ssx_mapping_conflict_v1(uuid,uuid,text)'::regprocedure,
'public.resolve_ssx_mapping_conflict_v2(uuid,uuid,text,uuid)'::regprocedure,
'finance_private.legacy_integrity_inventory_revision(uuid)'::regprocedure,
'finance_private.unloading_projection_repair_context(uuid,uuid)'::regprocedure,
'public.add_driver_settlement_manual_expense(uuid,text,numeric,timestamp with time zone,text,text,boolean,text,text)'::regprocedure,
'public.list_dispatch_trips_v1(uuid,text,text[],timestamp with time zone,integer)'::regprocedure,
'public.plan_dispatch_trip_v2(uuid,uuid,uuid,uuid[],timestamp with time zone,text)'::regprocedure,
'public.plan_dispatch_trip_v2(uuid,uuid,uuid,text,uuid[],jsonb,text)'::regprocedure,
'public.driver_report_event_v1(uuid,uuid,uuid,uuid,text,jsonb,text)'::regprocedure,
'public.log_operational_event_v2(uuid,text,uuid,uuid,jsonb,jsonb,text)'::regprocedure,
'public.get_driver_workspace_v1(uuid,uuid)'::regprocedure,
'public.process_geofence_alerts(uuid,uuid,double precision,double precision,timestamp with time zone)'::regprocedure,
'public.process_overspeed_alerts(uuid,uuid,numeric,timestamp with time zone)'::regprocedure,
'public.build_fiscal_documents_deleted_recovery_dry_run(timestamp with time zone,timestamp with time zone,uuid)'::regprocedure,
'public.diagnose_load_composition(uuid,uuid[])'::regprocedure,
'public.link_fiscal_documents_to_load_v1(uuid,uuid,uuid[])'::regprocedure,
'public.move_load_items_v2(uuid,uuid,uuid,uuid[])'::regprocedure,
'public.repair_load_composition(uuid,uuid[],boolean)'::regprocedure,
'public.unlink_fiscal_documents_from_load_v1(uuid,uuid,uuid[])'::regprocedure)) union all (select p.oid,p.proname,p.pronamespace,p.proowner,p.prolang,p.procost,p.prorows,p.provariadic,p.prosupport,p.prokind,p.prosecdef,p.proleakproof,p.proisstrict,p.proretset,p.provolatile,p.proparallel,p.pronargs,p.pronargdefaults,p.prorettype,p.proargtypes::text,p.proallargtypes,p.proargmodes,p.proargnames,p.proargdefaults::text,p.proconfig,p.proacl::text from pg_proc p where p.oid in ('public.create_ledger_entry_v1(uuid,text,uuid,text,text,numeric,text,jsonb)'::regprocedure,
'public.update_employee_v1(uuid,uuid,jsonb,integer)'::regprocedure,
'public.create_load_v1(uuid,uuid,uuid,text,text,text,text,timestamp with time zone,text)'::regprocedure,
'public.create_load_with_next_number(uuid,text,text,uuid,uuid,text,text)'::regprocedure,
'public.delete_load_v1(uuid,uuid)'::regprocedure,
'public.list_drivers_v1(uuid,text,text,integer)'::regprocedure,
'public.resolve_ssx_mapping_conflict_v1(uuid,uuid,text)'::regprocedure,
'public.resolve_ssx_mapping_conflict_v2(uuid,uuid,text,uuid)'::regprocedure,
'finance_private.legacy_integrity_inventory_revision(uuid)'::regprocedure,
'finance_private.unloading_projection_repair_context(uuid,uuid)'::regprocedure,
'public.add_driver_settlement_manual_expense(uuid,text,numeric,timestamp with time zone,text,text,boolean,text,text)'::regprocedure,
'public.list_dispatch_trips_v1(uuid,text,text[],timestamp with time zone,integer)'::regprocedure,
'public.plan_dispatch_trip_v2(uuid,uuid,uuid,uuid[],timestamp with time zone,text)'::regprocedure,
'public.plan_dispatch_trip_v2(uuid,uuid,uuid,text,uuid[],jsonb,text)'::regprocedure,
'public.driver_report_event_v1(uuid,uuid,uuid,uuid,text,jsonb,text)'::regprocedure,
'public.log_operational_event_v2(uuid,text,uuid,uuid,jsonb,jsonb,text)'::regprocedure,
'public.get_driver_workspace_v1(uuid,uuid)'::regprocedure,
'public.process_geofence_alerts(uuid,uuid,double precision,double precision,timestamp with time zone)'::regprocedure,
'public.process_overspeed_alerts(uuid,uuid,numeric,timestamp with time zone)'::regprocedure,
'public.build_fiscal_documents_deleted_recovery_dry_run(timestamp with time zone,timestamp with time zone,uuid)'::regprocedure,
'public.diagnose_load_composition(uuid,uuid[])'::regprocedure,
'public.link_fiscal_documents_to_load_v1(uuid,uuid,uuid[])'::regprocedure,
'public.move_load_items_v2(uuid,uuid,uuid,uuid[])'::regprocedure,
'public.repair_load_composition(uuid,uuid[],boolean)'::regprocedure,
'public.unlink_fiscal_documents_from_load_v1(uuid,uuid,uuid[])'::regprocedure) except select * from qa_sql_compatibility_contract_before)) then
  raise exception 'sql_compatibility_contract_or_acl_changed';
 end if;
 if exists(select 1 from qa_sql_compatibility_targets t join pg_proc p on p.oid=to_regprocedure(t.signature) where md5(p.prosrc)<>t.after_md5) then raise exception 'sql_compatibility_result_changed';end if;
end;
$preserve_contract$;
