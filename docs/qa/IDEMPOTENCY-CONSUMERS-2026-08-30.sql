-- Captured production consumers, for local regression fixtures only.
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

    SELECT COALESCE(MAX(load_number::int), 1000) + 1 INTO v_load_number
    FROM public.loads
    WHERE tenant_id = p_tenant_id;

    INSERT INTO public.loads (
        tenant_id, load_number, vehicle_id, driver_id, origin, destination, 
        notes, operation_type, scheduled_load_at, status
    ) VALUES (
        p_tenant_id, v_load_number, p_vehicle_id, p_driver_id, p_origin, p_destination,
        p_notes, p_operation_type, p_scheduled_load_at, 'assembling'
    ) RETURNING id INTO v_load_id;

    INSERT INTO public.entity_state_audit_log (
        tenant_id, entity_type, entity_id, to_status, idempotency_key
    ) VALUES (
        p_tenant_id, 'load', v_load_id, 'assembling', p_idempotency_key
    );

    RETURN v_load_id;
END;
$function$
;
revoke all on function public.create_load_v1(uuid,uuid,uuid,text,text,text,text,timestamp with time zone,text) from public,anon,authenticated,service_role;
grant execute on function public.create_load_v1(uuid,uuid,uuid,text,text,text,text,timestamp with time zone,text) to service_role;

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
        tenant_id, vehicle_id, driver_id, status, scheduled_start_at
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
$function$
;
revoke all on function public.plan_dispatch_trip_v2(uuid,uuid,uuid,uuid[],timestamp with time zone,text) from public,anon,authenticated,service_role;
grant execute on function public.plan_dispatch_trip_v2(uuid,uuid,uuid,uuid[],timestamp with time zone,text) to service_role;

CREATE OR REPLACE FUNCTION public.plan_dispatch_trip_v3(p_tenant_id uuid, p_idempotency_key text, p_driver_id uuid, p_vehicle_id uuid, p_route_name text, p_load_ids uuid[], p_stops jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_operator_id uuid := auth.uid();
  v_payload_hash text;
  v_existing_result_id uuid;
  v_existing_payload_hash text;
  v_trip_id uuid;
  v_stop record;
  v_stop_id uuid;
  v_doc_id uuid;
  v_doc_ids uuid[];
  v_load_id uuid;
  v_found_count integer;
begin
  if v_operator_id is null or not exists (
    select 1
    from public.tenant_memberships
    where user_id = v_operator_id
      and tenant_id = p_tenant_id
      and active = true
      and role in ('owner', 'admin', 'operator')
  ) then
    raise exception 'not_authorized';
  end if;

  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'idempotency_key_required';
  end if;

  if coalesce(array_length(p_load_ids, 1), 0) = 0 then
    raise exception 'load_ids_required';
  end if;

  if p_stops is null or jsonb_typeof(p_stops) <> 'array' then
    raise exception 'stops_must_be_an_array';
  end if;

  v_payload_hash := md5(jsonb_build_object(
    'driver_id', p_driver_id,
    'vehicle_id', p_vehicle_id,
    'route_name', p_route_name,
    'load_ids', p_load_ids,
    'stops', p_stops
  )::text);

  select result_id, payload_hash
    into v_existing_result_id, v_existing_payload_hash
  from public.idempotency_keys
  where tenant_id = p_tenant_id
    and operation = 'plan_dispatch_trip'
    and idempotency_key = p_idempotency_key;

  if found then
    if v_existing_payload_hash = v_payload_hash then
      return v_existing_result_id;
    end if;
    raise exception 'idempotency_key_mismatch';
  end if;

  perform id
  from public.loads
  where id = any(p_load_ids)
    and tenant_id = p_tenant_id
  for update;
  get diagnostics v_found_count = row_count;

  if v_found_count <> array_length(p_load_ids, 1) then
    raise exception 'load_ownership_mismatch';
  end if;

  if not exists (
    select 1 from public.vehicles
    where id = p_vehicle_id and tenant_id = p_tenant_id
  ) then
    raise exception 'invalid_vehicle_for_tenant';
  end if;

  if not exists (
    select 1 from public.drivers
    where id = p_driver_id and tenant_id = p_tenant_id
  ) then
    raise exception 'invalid_driver_for_tenant';
  end if;

  insert into public.dispatch_trips (
    tenant_id, driver_id, vehicle_id, notes, status, planned_start_at, created_by
  ) values (
    p_tenant_id, p_driver_id, p_vehicle_id, p_route_name, 'planned', now(), v_operator_id
  )
  returning id into v_trip_id;

  foreach v_load_id in array p_load_ids loop
    insert into public.dispatch_trip_loads (tenant_id, dispatch_trip_id, load_id)
    values (p_tenant_id, v_trip_id, v_load_id);

    update public.loads
    set status = 'ready',
        trip_id = v_trip_id,
        updated_at = now()
    where id = v_load_id and tenant_id = p_tenant_id;
  end loop;

  for v_stop in
    select *
    from jsonb_to_recordset(p_stops) as x(
      destination text,
      client_id uuid,
      stop_order integer,
      fiscal_document_ids uuid[],
      document_ids uuid[]
    )
  loop
    if nullif(btrim(v_stop.destination), '') is null or v_stop.stop_order is null then
      raise exception 'invalid_dispatch_stop';
    end if;

    if v_stop.client_id is not null and not exists (
      select 1 from public.clients
      where id = v_stop.client_id and tenant_id = p_tenant_id
    ) then
      raise exception 'invalid_client_for_tenant';
    end if;

    insert into public.dispatch_stops (
      tenant_id, dispatch_trip_id, destination, client_id, stop_order, status
    ) values (
      p_tenant_id, v_trip_id, v_stop.destination, v_stop.client_id, v_stop.stop_order, 'pending'
    )
    returning id into v_stop_id;

    v_doc_ids := coalesce(v_stop.fiscal_document_ids, v_stop.document_ids, array[]::uuid[]);
    foreach v_doc_id in array v_doc_ids loop
      if not exists (
        select 1 from public.fiscal_documents
        where id = v_doc_id and tenant_id = p_tenant_id
      ) then
        raise exception 'invalid_document_for_tenant';
      end if;

      insert into public.dispatch_stop_documents (
        tenant_id, dispatch_stop_id, fiscal_document_id
      ) values (
        p_tenant_id, v_stop_id, v_doc_id
      );
    end loop;
  end loop;

  insert into public.idempotency_keys (
    tenant_id, key_value, operation, idempotency_key, payload_hash, result_id
  ) values (
    p_tenant_id,
    'plan_dispatch_trip:' || p_idempotency_key,
    'plan_dispatch_trip',
    p_idempotency_key,
    v_payload_hash,
    v_trip_id
  );

  insert into public.entity_state_audit_log (
    tenant_id, entity_type, entity_id, to_status, actor_id, idempotency_key, metadata
  ) values (
    p_tenant_id,
    'trip',
    v_trip_id,
    'planned',
    v_operator_id,
    p_idempotency_key,
    jsonb_build_object('route_name', p_route_name, 'load_ids', p_load_ids)
  );

  return v_trip_id;
exception
  when unique_violation then
    select result_id, payload_hash
      into v_existing_result_id, v_existing_payload_hash
    from public.idempotency_keys
    where tenant_id = p_tenant_id
      and operation = 'plan_dispatch_trip'
      and idempotency_key = p_idempotency_key;

    if v_existing_payload_hash = v_payload_hash then
      return v_existing_result_id;
    end if;
    raise exception 'idempotency_key_mismatch';
end;
$function$
;
revoke all on function public.plan_dispatch_trip_v3(uuid,text,uuid,uuid,text,uuid[],jsonb) from public,anon,authenticated,service_role;
grant execute on function public.plan_dispatch_trip_v3(uuid,text,uuid,uuid,text,uuid[],jsonb) to authenticated;
grant execute on function public.plan_dispatch_trip_v3(uuid,text,uuid,uuid,text,uuid[],jsonb) to service_role;
