alter table public.driver_monitoring_import_batches
  add column if not exists file_fingerprint text,
  add column if not exists request_id uuid;

create unique index if not exists driver_monitoring_import_batches_fingerprint_uidx
  on public.driver_monitoring_import_batches (tenant_id, file_fingerprint)
  where file_fingerprint is not null;

create unique index if not exists driver_monitoring_import_batches_request_uidx
  on public.driver_monitoring_import_batches (tenant_id, request_id)
  where request_id is not null;

create or replace function private.driver_monitor_normalized_name(_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $function$
  select lower(regexp_replace(btrim(_value), '[[:space:]]+', ' ', 'g'));
$function$;

create or replace function public.import_driver_monitoring_workbook_v1(_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = 'on'
as $function$
declare
  v_tenant uuid := nullif(_payload->>'tenant_id', '')::uuid;
  v_request uuid := nullif(_payload->>'request_id', '')::uuid;
  v_fingerprint text := lower(nullif(_payload->>'file_fingerprint', ''));
  v_file_name text := nullif(btrim(_payload->>'file_name'), '');
  v_parsed jsonb := coalesce(_payload->'parsed', '{}'::jsonb);
  v_monitors jsonb := coalesce(v_parsed->'monitors', '[]'::jsonb);
  v_forecasts jsonb := coalesce(v_parsed->'forecasts', '[]'::jsonb);
  v_parser_errors jsonb := coalesce(v_parsed->'errors', '[]'::jsonb);
  v_existing public.driver_monitoring_import_batches%rowtype;
  v_batch public.driver_monitoring_import_batches%rowtype;
  v_monitor jsonb;
  v_update jsonb;
  v_forecast jsonb;
  v_driver public.drivers%rowtype;
  v_monitor_row public.driver_route_monitors%rowtype;
  v_monitor_id uuid;
  v_client_key text;
  v_driver_name text;
  v_driver_matches integer;
  v_total integer;
  v_quantity integer;
  v_completed integer;
  v_remaining integer;
  v_deadline integer;
  v_status text;
  v_first_update_date date;
  v_last_update_date date;
  v_started_at timestamptz;
  v_expected_return date;
  v_last_city text;
  v_last_next_city text;
  v_monitor_map jsonb := '{}'::jsonb;
  v_monitor_driver_map jsonb := '{}'::jsonb;
  v_monitor_count integer := 0;
  v_update_count integer := 0;
  v_forecast_count integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if v_tenant is null or not private.is_request_tenant_member(v_tenant)
     or not public.is_tenant_operator_or_admin(v_tenant) then
    raise exception 'operator_required' using errcode = '42501';
  end if;
  if v_request is null then
    raise exception 'request_id_required' using errcode = '22023';
  end if;
  if v_fingerprint is null or v_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'file_fingerprint_invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(v_monitors) <> 'array' or jsonb_typeof(v_forecasts) <> 'array'
     or jsonb_typeof(v_parser_errors) <> 'array' then
    raise exception 'workbook_payload_invalid' using errcode = '22023';
  end if;
  if jsonb_array_length(v_parser_errors) > 0 then
    raise exception 'workbook_validation_failed: %', left(v_parser_errors::text, 1000)
      using errcode = '22023';
  end if;
  if jsonb_array_length(v_monitors) = 0 then
    raise exception 'workbook_has_no_monitors' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_tenant::text || ':' || v_fingerprint, 0)
  );

  select * into v_existing
  from public.driver_monitoring_import_batches
  where tenant_id = v_tenant
    and (file_fingerprint = v_fingerprint or request_id = v_request)
  order by (file_fingerprint = v_fingerprint) desc
  limit 1;
  if found then
    return jsonb_build_object(
      'batch_id', v_existing.id,
      'importedMonitors', v_existing.imported_monitors,
      'importedUpdates', v_existing.imported_updates,
      'importedForecasts', v_existing.imported_forecasts,
      'errors', v_existing.errors,
      'duplicate', true
    );
  end if;

  insert into public.driver_monitoring_import_batches(
    tenant_id, file_name, file_fingerprint, request_id, row_count, status,
    errors, metadata, created_by
  ) values (
    v_tenant, v_file_name, v_fingerprint, v_request,
    jsonb_array_length(v_monitors) + jsonb_array_length(v_forecasts),
    'processing', '[]'::jsonb,
    jsonb_build_object('sheet_names', coalesce(v_parsed->'sheetNames', '[]'::jsonb)),
    auth.uid()
  ) returning * into v_batch;

  for v_monitor in select value from jsonb_array_elements(v_monitors)
  loop
    v_monitor_count := v_monitor_count + 1;
    v_client_key := nullif(btrim(v_monitor->>'client_key'), '');
    v_driver_name := nullif(btrim(v_monitor->>'driver_name'), '');
    if v_client_key is null or v_monitor_map ? v_client_key then
      raise exception 'monitor_client_key_invalid_or_duplicated' using errcode = '22023';
    end if;
    if v_driver_name is null then
      raise exception 'monitor_driver_name_required' using errcode = '22023';
    end if;

    select count(*) into v_driver_matches
    from public.drivers d
    where d.tenant_id = v_tenant
      and private.driver_monitor_normalized_name(d.name) = private.driver_monitor_normalized_name(v_driver_name);
    if v_driver_matches = 0 then
      raise exception 'driver_not_found: %', v_driver_name using errcode = '23503';
    elsif v_driver_matches > 1 then
      raise exception 'driver_name_ambiguous: %', v_driver_name using errcode = '21000';
    end if;
    select d.id into strict v_monitor_id
    from public.drivers d
    where d.tenant_id = v_tenant
      and private.driver_monitor_normalized_name(d.name) = private.driver_monitor_normalized_name(v_driver_name);
    select * into strict v_driver from public.drivers where id = v_monitor_id and tenant_id = v_tenant;

    v_total := coalesce(nullif(v_monitor->>'total_deliveries', '')::integer, 0);
    v_deadline := nullif(v_monitor->>'return_deadline_days', '')::integer;
    if v_total <= 0 then
      raise exception 'monitor_total_deliveries_invalid: %', v_driver_name using errcode = '23514';
    end if;
    if v_deadline is not null and v_deadline < 0 then
      raise exception 'monitor_return_deadline_invalid: %', v_driver_name using errcode = '23514';
    end if;

    v_completed := 0;
    v_first_update_date := null;
    v_last_update_date := null;
    v_last_city := null;
    v_last_next_city := null;
    for v_update in select value from jsonb_array_elements(coalesce(v_monitor->'updates', '[]'::jsonb))
    loop
      if nullif(v_update->>'update_date', '') is null then
        if coalesce(nullif(btrim(v_update->>'city'), ''), nullif(btrim(v_update->>'next_city'), '')) is not null
           or coalesce(nullif(v_update->>'deliveries_completed_in_city', '')::integer, 0) <> 0 then
          raise exception 'progress_update_date_required: %', v_driver_name using errcode = '22023';
        end if;
        continue;
      end if;
      v_quantity := coalesce(nullif(v_update->>'deliveries_completed_in_city', '')::integer, 0);
      if v_quantity < 0 then
        raise exception 'progress_quantity_invalid: %', v_driver_name using errcode = '23514';
      end if;
      v_completed := v_completed + v_quantity;
      if v_completed > v_total then
        raise exception 'progress_exceeds_total_deliveries: %', v_driver_name using errcode = '23514';
      end if;
      v_first_update_date := least(
        coalesce(v_first_update_date, (v_update->>'update_date')::date),
        (v_update->>'update_date')::date
      );
      if v_last_update_date is null or (v_update->>'update_date')::date >= v_last_update_date then
        v_last_update_date := (v_update->>'update_date')::date;
        v_last_city := nullif(btrim(v_update->>'city'), '');
        v_last_next_city := nullif(btrim(v_update->>'next_city'), '');
      end if;
    end loop;

    v_started_at := coalesce(
      v_first_update_date::timestamp at time zone 'America/Sao_Paulo',
      v_now
    );
    v_expected_return := case when v_deadline is null then null
      else (v_started_at at time zone 'America/Sao_Paulo')::date + v_deadline end;
    v_remaining := v_total - v_completed;
    v_status := private.driver_monitor_effective_status(
      'active', v_total, v_completed, v_expected_return, null,
      coalesce(v_last_update_date::timestamp at time zone 'America/Sao_Paulo', v_now),
      null, v_now
    );

    insert into public.driver_route_monitors(
      tenant_id, driver_id, monitor_number, driver_name_snapshot,
      planned_route_text, planned_cities, started_at, expected_return_date,
      return_deadline_days, total_deliveries, completed_deliveries,
      remaining_deliveries, current_city, next_city, status, last_update_at,
      source_type, import_batch_id, created_by, updated_by
    ) values (
      v_tenant, v_driver.id,
      'IMP-' || upper(substr(replace(v_batch.id::text, '-', ''), 1, 10)) || '-' || lpad(v_monitor_count::text, 4, '0'),
      v_driver_name, nullif(btrim(v_monitor->>'planned_route_text'), ''),
      coalesce(v_monitor->'planned_cities', '[]'::jsonb), v_started_at, v_expected_return,
      v_deadline, v_total, v_completed, v_remaining, v_last_city, v_last_next_city,
      v_status,
      coalesce(v_last_update_date::timestamp at time zone 'America/Sao_Paulo', v_now),
      'spreadsheet_import', v_batch.id, auth.uid(), auth.uid()
    ) returning * into v_monitor_row;

    v_monitor_id := v_monitor_row.id;
    v_monitor_map := v_monitor_map || jsonb_build_object(v_client_key, v_monitor_id::text);
    v_monitor_driver_map := v_monitor_driver_map || jsonb_build_object(
      v_client_key, private.driver_monitor_normalized_name(v_driver_name)
    );

    for v_update in select value from jsonb_array_elements(coalesce(v_monitor->'updates', '[]'::jsonb))
    loop
      if nullif(v_update->>'update_date', '') is null then continue; end if;
      insert into public.driver_route_progress_updates(
        tenant_id, monitor_id, driver_id, update_date, city,
        deliveries_completed_in_city, city_total_deliveries, deadline_to_finish,
        city_finished_at, next_city, next_city_deliveries, next_deadline_to_finish,
        next_city_finished_at, observation, status, source_type, created_by
      ) values (
        v_tenant, v_monitor_id, v_driver.id, (v_update->>'update_date')::date,
        nullif(btrim(v_update->>'city'), ''),
        coalesce(nullif(v_update->>'deliveries_completed_in_city', '')::integer, 0),
        nullif(v_update->>'city_total_deliveries', '')::integer,
        nullif(btrim(v_update->>'deadline_to_finish'), ''),
        nullif(v_update->>'city_finished_at', '')::time,
        nullif(btrim(v_update->>'next_city'), ''),
        nullif(v_update->>'next_city_deliveries', '')::integer,
        nullif(btrim(v_update->>'next_deadline_to_finish'), ''),
        nullif(v_update->>'next_city_finished_at', '')::time,
        nullif(btrim(v_update->>'observation'), ''),
        nullif(btrim(v_update->>'status'), ''),
        'spreadsheet_import', auth.uid()
      );
      v_update_count := v_update_count + 1;
    end loop;
  end loop;

  for v_forecast in select value from jsonb_array_elements(v_forecasts)
  loop
    v_client_key := nullif(btrim(v_forecast->>'monitor_key'), '');
    v_driver_name := nullif(btrim(v_forecast->>'driver_name'), '');
    if v_client_key is null or not (v_monitor_map ? v_client_key) then
      raise exception 'forecast_monitor_missing_or_ambiguous: %', coalesce(v_driver_name, '(sem motorista)')
        using errcode = '22023';
    end if;
    if v_driver_name is null
       or private.driver_monitor_normalized_name(v_driver_name) is distinct from (v_monitor_driver_map->>v_client_key) then
      raise exception 'forecast_driver_monitor_mismatch: %', coalesce(v_driver_name, '(sem motorista)')
        using errcode = '23514';
    end if;
    if nullif(v_forecast->>'forecast_date', '') is null then
      raise exception 'forecast_date_required: %', v_driver_name using errcode = '22023';
    end if;
    v_monitor_id := (v_monitor_map->>v_client_key)::uuid;
    select * into strict v_monitor_row
    from public.driver_route_monitors
    where tenant_id = v_tenant and id = v_monitor_id;

    insert into public.driver_arrival_forecasts(
      tenant_id, monitor_id, driver_id, forecast_date, forecast_time,
      current_city, forecast_text, remaining_cities_text, remaining_cities,
      observation, status, created_by
    ) values (
      v_tenant, v_monitor_id, v_monitor_row.driver_id,
      (v_forecast->>'forecast_date')::date, nullif(v_forecast->>'forecast_time', '')::time,
      nullif(btrim(v_forecast->>'current_city'), ''), nullif(btrim(v_forecast->>'forecast_text'), ''),
      nullif(btrim(v_forecast->>'remaining_cities_text'), ''),
      coalesce(v_forecast->'remaining_cities', '[]'::jsonb),
      nullif(btrim(v_forecast->>'observation'), ''), 'active', auth.uid()
    );
    v_forecast_count := v_forecast_count + 1;

    update public.driver_route_monitors
    set arrival_forecast_text = nullif(btrim(v_forecast->>'forecast_text'), ''),
        arrival_forecast_at = case
          when nullif(v_forecast->>'forecast_time', '') is null
            then (v_forecast->>'forecast_date')::date::timestamp at time zone 'America/Sao_Paulo'
          else ((v_forecast->>'forecast_date')::date + (v_forecast->>'forecast_time')::time)
            at time zone 'America/Sao_Paulo'
        end,
        current_city = coalesce(nullif(btrim(v_forecast->>'current_city'), ''), current_city),
        updated_at = v_now,
        updated_by = auth.uid(),
        revision = revision + 1
    where tenant_id = v_tenant and id = v_monitor_id;
  end loop;

  update public.driver_monitoring_import_batches
  set imported_monitors = v_monitor_count,
      imported_updates = v_update_count,
      imported_forecasts = v_forecast_count,
      error_count = 0,
      status = 'completed',
      errors = '[]'::jsonb,
      metadata = metadata || jsonb_build_object('completed_at', v_now)
  where tenant_id = v_tenant and id = v_batch.id
  returning * into v_batch;

  return jsonb_build_object(
    'batch_id', v_batch.id,
    'importedMonitors', v_monitor_count,
    'importedUpdates', v_update_count,
    'importedForecasts', v_forecast_count,
    'errors', '[]'::jsonb,
    'duplicate', false
  );
end;
$function$;

revoke all on function private.driver_monitor_normalized_name(text) from public, anon, authenticated, service_role;
revoke all on function public.import_driver_monitoring_workbook_v1(jsonb) from public, anon;
grant execute on function public.import_driver_monitoring_workbook_v1(jsonb) to authenticated, service_role;

comment on function public.import_driver_monitoring_workbook_v1(jsonb) is
  'Atomically and idempotently imports driver-monitoring workbooks with exact per-block forecast links.';
