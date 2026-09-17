-- Reported bug fixes: domain constraints and atomic multi-table writes.

alter table public.vehicle_fueling
  add constraint vehicle_fueling_liters_positive check (liters > 0) not valid,
  add constraint vehicle_fueling_price_nonnegative check (price_per_liter is null or price_per_liter >= 0) not valid,
  add constraint vehicle_fueling_total_nonnegative check (total_cost is null or total_cost >= 0) not valid,
  add constraint vehicle_fueling_odometer_nonnegative check (odometer_km is null or odometer_km >= 0) not valid;

create or replace function public.create_vehicle_fueling_with_odometer_v1(_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
set row_security = 'on'
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_vehicle_id uuid;
  v_liters numeric;
  v_price numeric;
  v_odometer numeric;
  v_fueled_at timestamptz;
  v_fueling public.vehicle_fueling%rowtype;
begin
  if jsonb_typeof(_payload) is distinct from 'object' then
    raise exception 'invalid_payload';
  end if;
  if v_actor is null then
    raise exception 'authentication_required';
  end if;

  v_tenant_id := nullif(_payload->>'tenant_id', '')::uuid;
  v_vehicle_id := nullif(_payload->>'vehicle_id', '')::uuid;
  v_liters := nullif(_payload->>'liters', '')::numeric;
  v_price := nullif(_payload->>'price_per_liter', '')::numeric;
  v_odometer := nullif(_payload->>'odometer_km', '')::numeric;
  v_fueled_at := coalesce(nullif(_payload->>'fueled_at', '')::timestamptz, now());

  if v_tenant_id is null or v_vehicle_id is null then
    raise exception 'tenant_and_vehicle_required';
  end if;
  if not public.is_tenant_admin(v_tenant_id) then
    raise exception 'admin_required';
  end if;
  if v_liters is null or v_liters <= 0 then
    raise exception 'liters_must_be_positive';
  end if;
  if v_price is not null and v_price < 0 then
    raise exception 'price_must_be_nonnegative';
  end if;
  if v_odometer is not null and v_odometer < 0 then
    raise exception 'odometer_must_be_nonnegative';
  end if;

  insert into public.vehicle_fueling (
    tenant_id, vehicle_id, driver_id, dispatch_trip_id, fueled_at,
    liters, price_per_liter, total_cost, fuel_type, odometer_km,
    station_name, station_address, is_full_tank, notes, created_by,
    employee_id, route_trip_id
  ) values (
    v_tenant_id,
    v_vehicle_id,
    nullif(_payload->>'driver_id', '')::uuid,
    nullif(_payload->>'dispatch_trip_id', '')::uuid,
    v_fueled_at,
    v_liters,
    v_price,
    case when v_price is null then null else v_liters * v_price end,
    nullif(_payload->>'fuel_type', ''),
    v_odometer,
    nullif(_payload->>'station_name', ''),
    nullif(_payload->>'station_address', ''),
    coalesce((_payload->>'is_full_tank')::boolean, true),
    nullif(_payload->>'notes', ''),
    v_actor,
    nullif(_payload->>'employee_id', '')::uuid,
    nullif(_payload->>'route_trip_id', '')::uuid
  ) returning * into v_fueling;

  if v_odometer is not null then
    insert into public.vehicle_odometer (
      tenant_id, vehicle_id, reading_km, source, recorded_at, created_by
    ) values (
      v_tenant_id, v_vehicle_id, v_odometer, 'fueling', v_fueled_at, v_actor
    );
  end if;

  return to_jsonb(v_fueling);
end;
$$;

revoke all on function public.create_vehicle_fueling_with_odometer_v1(jsonb) from public, anon;
grant execute on function public.create_vehicle_fueling_with_odometer_v1(jsonb) to authenticated;

create or replace function public.import_occurrence_report_batch_v1(
  _batch jsonb,
  _occurrences jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
set row_security = 'on'
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_occurrence_count integer;
  v_inserted integer := 0;
  v_batch public.occurrence_report_import_batches%rowtype;
begin
  if jsonb_typeof(_batch) is distinct from 'object'
     or jsonb_typeof(_occurrences) is distinct from 'array' then
    raise exception 'invalid_payload';
  end if;
  if v_actor is null then
    raise exception 'authentication_required';
  end if;

  v_tenant_id := nullif(_batch->>'tenant_id', '')::uuid;
  if v_tenant_id is null or not public.is_tenant_operator_or_admin(v_tenant_id) then
    raise exception 'operator_required';
  end if;

  v_occurrence_count := jsonb_array_length(_occurrences);
  if v_occurrence_count > 5000 then
    raise exception 'batch_too_large';
  end if;

  insert into public.occurrence_report_import_batches (
    tenant_id, file_name, detected_model, row_count, imported_count,
    unmatched_count, error_count, errors, metadata, status, source_type,
    created_by
  ) values (
    v_tenant_id,
    nullif(_batch->>'file_name', ''),
    nullif(_batch->>'detected_model', ''),
    greatest(coalesce((_batch->>'row_count')::integer, 0), 0),
    v_occurrence_count,
    greatest(coalesce((_batch->>'unmatched_count')::integer, 0), 0),
    greatest(coalesce((_batch->>'error_count')::integer, 0), 0),
    coalesce(_batch->'errors', '[]'::jsonb),
    coalesce(_batch->'metadata', '{}'::jsonb),
    case when coalesce((_batch->>'error_count')::integer, 0) > 0
      then 'completed_with_errors' else 'completed' end,
    coalesce(nullif(_batch->>'source_type', ''), 'legacy'),
    v_actor
  ) returning * into v_batch;

  if v_occurrence_count > 0 then
    insert into public.delivery_occurrences (
      tenant_id, invoice_number, cte_number, occurrence_number,
      customer_name, supplier_name, city, state, occurrence_type,
      occurrence_reason, occurrence_description, occurrence_date,
      occurrence_time, status, resolution_type, resolution_notes,
      resolved_at, closed_at, password_or_authorization, client_id,
      supplier_id, load_id, driver_id, fiscal_document_id, cte_document_id,
      responsible_user_id, legacy_status_text, metadata, created_by, updated_by
    )
    select
      v_tenant_id, o.invoice_number, o.cte_number, o.occurrence_number,
      o.customer_name, o.supplier_name, o.city, o.state,
      coalesce(nullif(o.occurrence_type, ''), 'legacy'),
      o.occurrence_reason, o.occurrence_description, o.occurrence_date,
      o.occurrence_time, coalesce(nullif(o.status, ''), 'resolved'),
      o.resolution_type, o.resolution_notes,
      coalesce(o.resolved_at, now()), o.closed_at, o.password_or_authorization,
      o.client_id, o.supplier_id, o.load_id, o.driver_id,
      o.fiscal_document_id, o.cte_document_id, o.responsible_user_id,
      o.legacy_status_text,
      coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object('import_batch_id', v_batch.id),
      v_actor, v_actor
    from jsonb_to_recordset(_occurrences) as o(
      invoice_number text, cte_number text, occurrence_number text,
      customer_name text, supplier_name text, city text, state text,
      occurrence_type text, occurrence_reason text, occurrence_description text,
      occurrence_date date, occurrence_time time, status text,
      resolution_type text, resolution_notes text, resolved_at timestamptz,
      closed_at timestamptz, password_or_authorization text, client_id uuid,
      supplier_id uuid, load_id uuid, driver_id uuid, fiscal_document_id uuid,
      cte_document_id uuid, responsible_user_id uuid, legacy_status_text text,
      metadata jsonb
    );

    get diagnostics v_inserted = row_count;
    if v_inserted <> v_occurrence_count then
      raise exception 'occurrence_count_mismatch';
    end if;
  end if;

  return to_jsonb(v_batch);
end;
$$;

revoke all on function public.import_occurrence_report_batch_v1(jsonb, jsonb) from public, anon;
grant execute on function public.import_occurrence_report_batch_v1(jsonb, jsonb) to authenticated;

create or replace function public.record_nfse_created_event_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.nfse_events (
    tenant_id, nfse_id, event_type, message, created_by
  ) values (
    new.tenant_id,
    new.id,
    'created',
    format('RPS %s criado (%s)', coalesce(new.rps_number, new.internal_number, '—'), coalesce(new.status, 'rascunho')),
    coalesce(new.created_by, auth.uid())
  );
  return new;
end;
$$;

drop trigger if exists record_nfse_created_event_v1 on public.nfse_documents;
create trigger record_nfse_created_event_v1
after insert on public.nfse_documents
for each row execute function public.record_nfse_created_event_v1();

create or replace function public.record_return_sheet_signed_proof_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'signed'
     and new.signed_proof_url is not null
     and (
       old.status is distinct from new.status
       or old.signed_proof_url is distinct from new.signed_proof_url
     ) then
    insert into public.occurrence_return_sheet_history (
      tenant_id, return_sheet_id, occurrence_id, action, metadata, created_by
    ) values (
      new.tenant_id,
      new.id,
      new.occurrence_id,
      'signed_proof_uploaded',
      jsonb_build_object('path', new.signed_proof_url),
      auth.uid()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists record_return_sheet_signed_proof_v1 on public.occurrence_return_sheets;
create trigger record_return_sheet_signed_proof_v1
after update of status, signed_proof_url on public.occurrence_return_sheets
for each row execute function public.record_return_sheet_signed_proof_v1();

do $$
begin
  if to_regprocedure('public.create_vehicle_fueling_with_odometer_v1(jsonb)') is null
     or to_regprocedure('public.import_occurrence_report_batch_v1(jsonb,jsonb)') is null then
    raise exception 'reported bug fix RPC installation failed';
  end if;
end;
$$;
