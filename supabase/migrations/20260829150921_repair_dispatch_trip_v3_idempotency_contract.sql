alter table public.idempotency_keys
  add column if not exists operation text,
  add column if not exists idempotency_key text,
  add column if not exists payload_hash text,
  add column if not exists result_id uuid;

create unique index if not exists idempotency_keys_operation_key_uidx
  on public.idempotency_keys (tenant_id, operation, idempotency_key)
  where operation is not null and idempotency_key is not null;

create or replace function public.plan_dispatch_trip_v3(
  p_tenant_id uuid,
  p_idempotency_key text,
  p_driver_id uuid,
  p_vehicle_id uuid,
  p_route_name text,
  p_load_ids uuid[],
  p_stops jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
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
$function$;

comment on function public.plan_dispatch_trip_v3(uuid, text, uuid, uuid, text, uuid[], jsonb)
  is 'Atomically plans a tenant-scoped dispatch trip with durable payload-aware idempotency.';
