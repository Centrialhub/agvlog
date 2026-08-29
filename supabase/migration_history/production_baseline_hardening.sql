-- Production cutover bridge for the consolidated 20260824224152 baseline.
--
-- This file is intentionally kept outside supabase/migrations: new databases
-- receive the final state from the single baseline, while the existing
-- production database receives only the incremental, idempotent hardening.

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

DO $production_baseline_preconditions$
DECLARE
  plaintext_passwords integer;
BEGIN
  IF current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'PostgreSQL 17+ is required for this production cutover';
  END IF;

  SELECT count(*)
  INTO plaintext_passwords
  FROM public.integration_accounts
  WHERE password_encrypted IS NOT NULL
    AND password_encrypted NOT LIKE 'enc:v1:%';

  IF plaintext_passwords > 0 THEN
    RAISE EXCEPTION
      'Production cutover refused: % integration password(s) are not encrypted with enc:v1',
      plaintext_passwords;
  END IF;
END;
$production_baseline_preconditions$;

-- Remove structurally duplicate indexes/constraints. The retained objects have
-- the same keys and semantics and are already present in production.
DROP INDEX IF EXISTS public.idx_clients_tax_id;
ALTER TABLE public.ingestion_cursors
  DROP CONSTRAINT IF EXISTS ingestion_cursors_tenant_unit_unique;
DROP INDEX IF EXISTS public.idx_loads_status;
DROP INDEX IF EXISTS public.idx_loads_number;
DROP INDEX IF EXISTS public.idx_pois_dedupe;
ALTER TABLE public.positions_last
  DROP CONSTRAINT IF EXISTS positions_last_tenant_vehicle_unique;
DROP INDEX IF EXISTS public.idx_provider_units_unique;
DROP INDEX IF EXISTS public.idx_telemetry_obs_unique;
DROP INDEX IF EXISTS public.idx_telemetry_obs_upsert;

-- Every tenant-scoped relation starts with tenant_id in at least one valid
-- index, keeping the frontend's RLS-filtered access paths predictable.
CREATE INDEX IF NOT EXISTS idx_alert_rules_tenant_id ON public.alert_rules USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_asset_movements_tenant_id ON public.asset_movements USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_checklist_executions_tenant_id ON public.checklist_executions USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_client_rural_delivery_profile_history_tenant_id ON public.client_rural_delivery_profile_history USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_closing_report_history_tenant_id ON public.closing_report_history USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_consumption_alerts_tenant_id ON public.consumption_alerts USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_data_recovery_batches_tenant_id ON public.data_recovery_batches USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_data_recovery_items_tenant_id ON public.data_recovery_items USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_data_repair_batch_items_tenant_id ON public.data_repair_batch_items USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_data_repair_batches_tenant_id ON public.data_repair_batches USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_events_tenant_id ON public.dispatch_events USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_stops_tenant_id ON public.dispatch_stops USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_trips_tenant_id ON public.dispatch_trips USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_webhook_inbox_tenant_id ON public.fiscal_webhook_inbox USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_geofences_tenant_id ON public.geofences USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_hub_fiscal_credentials_tenant_id ON public.hub_fiscal_credentials USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_incident_attachments_tenant_id ON public.incident_attachments USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_incident_responsible_tenant_id ON public.incident_responsible USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_load_items_tenant_id ON public.load_items USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_load_orders_tenant_id ON public.load_orders USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_parts_tenant_id ON public.maintenance_parts USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_schedules_tenant_id ON public.maintenance_schedules USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_merchandise_shortage_history_tenant_id ON public.merchandise_shortage_history USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_nfse_events_tenant_id ON public.nfse_events USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_operational_checklists_tenant_id ON public.operational_checklists USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_payroll_generation_issues_tenant_id ON public.payroll_generation_issues USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_receivables_tenant_id ON public.receivables USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_route_planning_drafts_tenant_id ON public.route_planning_drafts USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_route_waypoints_tenant_id ON public.route_waypoints USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_trip_stops_tenant_id ON public.trip_stops USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_capabilities_tenant_id ON public.vehicle_capabilities USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_fueling_tenant_id ON public.vehicle_fueling USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_tenant_id ON public.vehicle_maintenance USING btree (tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_odometer_tenant_id ON public.vehicle_odometer USING btree (tenant_id);

DO $integration_password_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.integration_accounts'::regclass
      AND conname = 'integration_accounts_password_encrypted_format'
  ) THEN
    ALTER TABLE public.integration_accounts
      ADD CONSTRAINT integration_accounts_password_encrypted_format
      CHECK (password_encrypted LIKE 'enc:v1:%'::text);
  END IF;
END;
$integration_password_constraint$;

CREATE OR REPLACE FUNCTION public.next_nfse_number_by_emitter(_tenant_id uuid, _emitter_id uuid, _series text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_branch text;
  v_num bigint;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN
    RAISE EXCEPTION 'Acesso negado para reservar numeração de NFS-e'
      USING ERRCODE = '42501';
  END IF;

  SELECT branch_code INTO v_branch FROM public.tenant_emitters
    WHERE id = _emitter_id AND tenant_id = _tenant_id;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'Emitente não encontrado para o tenant';
  END IF;

  INSERT INTO public.nfse_sequences (tenant_id, branch_code, series, emitter_id, next_number)
  VALUES (_tenant_id, v_branch, _series, _emitter_id, 2)
  ON CONFLICT (tenant_id, branch_code, series) DO UPDATE
    SET next_number = public.nfse_sequences.next_number + 1,
        emitter_id  = COALESCE(public.nfse_sequences.emitter_id, EXCLUDED.emitter_id),
        updated_at  = now()
  RETURNING next_number - 1 INTO v_num;

  RETURN v_num;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cte_defaults_for_group(p_load_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_emitter jsonb;
  v_remitter jsonb;
  v_recipient jsonb;
  v_driver jsonb;
  v_vehicle jsonb;
  v_totals jsonb;
  v_cargo_predominant text;
BEGIN
  IF p_load_ids IS NULL OR array_length(p_load_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('error','no_loads');
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.loads WHERE id = p_load_ids[1];
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('error','load_not_found');
  END IF;

  IF NOT public.is_tenant_member(v_tenant) THEN
    RAISE EXCEPTION 'Acesso negado às cargas informadas'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_load_ids) AS requested(load_id)
    LEFT JOIN public.loads AS scoped
      ON scoped.id = requested.load_id
    WHERE scoped.id IS NULL OR scoped.tenant_id <> v_tenant
  ) THEN
    RAISE EXCEPTION 'Todas as cargas devem existir e pertencer ao mesmo tenant'
      USING ERRCODE = '22023';
  END IF;

  SELECT to_jsonb(e.*) INTO v_emitter
  FROM public.tenant_emitters e
  WHERE e.tenant_id = v_tenant AND e.active = true
  ORDER BY e.is_default DESC NULLS LAST, e.created_at ASC
  LIMIT 1;

  SELECT jsonb_build_object(
    'remitter_cnpj', regexp_replace(COALESCE(remitter_cnpj,''), '[^0-9]', '', 'g'),
    'remitter', remitter,
    'origin_city', origin_city,
    'origin_state', origin_state
  ) INTO v_remitter
  FROM public.fiscal_documents
  WHERE tenant_id = v_tenant
    AND document_type = 'inbound'
    AND load_id = ANY(p_load_ids)
    AND remitter_cnpj IS NOT NULL
  GROUP BY remitter_cnpj, remitter, origin_city, origin_state
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  WITH agg AS (
    SELECT
      fd.recipient,
      COALESCE(
        NULLIF(regexp_replace(COALESCE(fd.recipient_cnpj,''), '[^0-9]', '', 'g'), ''),
        NULLIF(regexp_replace(COALESCE(c.tax_id,''), '[^0-9]', '', 'g'), '')
      ) AS cnpj_norm,
      fd.recipient_city,
      fd.recipient_state,
      fd.client_id,
      COUNT(*) AS n
    FROM public.fiscal_documents fd
    LEFT JOIN public.clients c ON c.id = fd.client_id
    WHERE fd.tenant_id = v_tenant
      AND fd.document_type = 'inbound'
      AND fd.load_id = ANY(p_load_ids)
    GROUP BY fd.recipient, cnpj_norm, fd.recipient_city, fd.recipient_state, fd.client_id
    ORDER BY n DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'recipient_cnpj', cnpj_norm,
    'recipient', recipient,
    'recipient_city', recipient_city,
    'recipient_state', recipient_state,
    'client_id', client_id
  ) INTO v_recipient FROM agg;

  SELECT to_jsonb(d.*) INTO v_driver
  FROM public.drivers d
  JOIN public.loads l ON l.driver_id = d.id
  WHERE l.id = ANY(p_load_ids) AND d.tenant_id = v_tenant
  LIMIT 1;

  SELECT to_jsonb(v.*) INTO v_vehicle
  FROM public.vehicles v
  JOIN public.loads l ON l.vehicle_id = v.id
  WHERE l.id = ANY(p_load_ids) AND v.tenant_id = v_tenant
  LIMIT 1;

  SELECT cargo_description INTO v_cargo_predominant
  FROM public.fiscal_documents
  WHERE load_id = ANY(p_load_ids)
    AND tenant_id = v_tenant
    AND document_type = 'inbound'
    AND cargo_description IS NOT NULL
  GROUP BY cargo_description
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  SELECT jsonb_build_object(
    'total_weight_kg', COALESCE(SUM(fd.weight_kg), 0),
    'total_value', COALESCE(SUM(fd.value), 0),
    'invoice_count', COUNT(*)
  ) INTO v_totals
  FROM public.fiscal_documents fd
  WHERE fd.tenant_id = v_tenant
    AND fd.document_type = 'inbound'
    AND fd.load_id = ANY(p_load_ids);

  RETURN jsonb_build_object(
    'tenant_id', v_tenant,
    'emitter', v_emitter,
    'remitter', v_remitter,
    'recipient', v_recipient,
    'driver', v_driver,
    'vehicle', v_vehicle,
    'totals', COALESCE(v_totals, '{}'::jsonb),
    'cargo_predominant', v_cargo_predominant,
    'taker_role_default', 'destinatario',
    'nature_default', 'PRESTACAO DE SERVICO DE TRANSPORTE'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_hfe_sync(p_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.hub_fiscal_emissions
  SET sync_attempts = sync_attempts + 1,
      last_synced_at = now()
  WHERE id = p_id;
$function$;

-- Evaluate auth.uid() once per statement and give UPDATE/ALL policies explicit
-- WITH CHECK expressions matching their existing USING contract.
DO $production_policy_hardening$
DECLARE
  policy_row record;
  using_expression text;
  check_expression text;
  alter_statement text;
BEGIN
  FOR policy_row IN
    SELECT
      policy.polname,
      policy.polcmd,
      namespace.nspname AS schema_name,
      relation.relname AS relation_name,
      pg_get_expr(policy.polqual, policy.polrelid) AS using_expression,
      pg_get_expr(policy.polwithcheck, policy.polrelid) AS check_expression
    FROM pg_policy AS policy
    JOIN pg_class AS relation ON relation.oid = policy.polrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname IN ('public', 'storage')
  LOOP
    using_expression := policy_row.using_expression;
    check_expression := policy_row.check_expression;

    IF using_expression IS NOT NULL THEN
      using_expression := replace(using_expression, 'auth.uid()', '(SELECT auth.uid())');
    END IF;

    IF check_expression IS NOT NULL THEN
      check_expression := replace(check_expression, 'auth.uid()', '(SELECT auth.uid())');
    ELSIF policy_row.polcmd IN ('w', '*') AND using_expression IS NOT NULL THEN
      check_expression := using_expression;
    END IF;

    alter_statement := format(
      'ALTER POLICY %I ON %I.%I',
      policy_row.polname,
      policy_row.schema_name,
      policy_row.relation_name
    );

    IF using_expression IS NOT NULL THEN
      alter_statement := alter_statement || format(' USING (%s)', using_expression);
    END IF;

    IF check_expression IS NOT NULL THEN
      alter_statement := alter_statement || format(' WITH CHECK (%s)', check_expression);
    END IF;

    EXECUTE alter_statement;
  END LOOP;
END;
$production_policy_hardening$;

-- Least-privilege Data API surface.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

DO $production_relation_privileges$
DECLARE
  relation_row record;
  sensitive_row record;
  allowed_columns text;
  writable_columns text;
BEGIN
  FOR relation_row IN
    SELECT relation.relname, relation.relkind
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'S')
    ORDER BY relation.relkind, relation.relname
  LOOP
    IF relation_row.relkind = 'S' THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON SEQUENCE public.%I FROM PUBLIC, anon, authenticated, service_role',
        relation_row.relname
      );
      EXECUTE format('GRANT USAGE ON SEQUENCE public.%I TO authenticated', relation_row.relname);
      EXECUTE format('GRANT ALL PRIVILEGES ON SEQUENCE public.%I TO service_role', relation_row.relname);
    ELSE
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
        relation_row.relname
      );

      IF relation_row.relkind IN ('v', 'm') THEN
        EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', relation_row.relname);
      ELSE
        EXECUTE format(
          'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated',
          relation_row.relname
        );
      END IF;

      EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', relation_row.relname);
    END IF;
  END LOOP;

  FOR sensitive_row IN
    SELECT *
    FROM (VALUES
      ('hub_fiscal_credentials', ARRAY['secret_ciphertext']::text[], ARRAY['secret_ciphertext']::text[]),
      ('integration_accounts', ARRAY['password_encrypted', 'hashauth', 'hashcode', 'token_cache']::text[], ARRAY['password_encrypted', 'hashauth', 'hashcode', 'token_cache']::text[]),
      ('nfse_provider_configs', ARRAY['credentials_encrypted', 'credentials_iv']::text[], ARRAY['credentials_encrypted', 'credentials_iv']::text[]),
      ('vehicles', ARRAY['tracker_password']::text[], ARRAY[]::text[])
    ) AS sensitive(table_name, denied_select_columns, denied_write_columns)
  LOOP
    SELECT string_agg(quote_ident(attribute.attname), ', ' ORDER BY attribute.attnum)
    INTO allowed_columns
    FROM pg_attribute AS attribute
    JOIN pg_class AS relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = sensitive_row.table_name
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND NOT (attribute.attname = ANY(sensitive_row.denied_select_columns));

    IF allowed_columns IS NULL THEN
      RAISE EXCEPTION 'Sensitive relation missing from production: %', sensitive_row.table_name;
    END IF;

    EXECUTE format('REVOKE SELECT ON TABLE public.%I FROM authenticated', sensitive_row.table_name);
    EXECUTE format(
      'GRANT SELECT (%s) ON TABLE public.%I TO authenticated',
      allowed_columns,
      sensitive_row.table_name
    );

    IF cardinality(sensitive_row.denied_write_columns) > 0 THEN
      SELECT string_agg(quote_ident(attribute.attname), ', ' ORDER BY attribute.attnum)
      INTO writable_columns
      FROM pg_attribute AS attribute
      JOIN pg_class AS relation ON relation.oid = attribute.attrelid
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = sensitive_row.table_name
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
        AND NOT (attribute.attname = ANY(sensitive_row.denied_write_columns));

      EXECUTE format('REVOKE INSERT, UPDATE ON TABLE public.%I FROM authenticated', sensitive_row.table_name);
      EXECUTE format(
        'GRANT INSERT (%s), UPDATE (%s) ON TABLE public.%I TO authenticated',
        writable_columns,
        writable_columns,
        sensitive_row.table_name
      );
    END IF;
  END LOOP;
END;
$production_relation_privileges$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

-- Existing explicit authenticated RPC grants are preserved. Public/anonymous
-- execution is removed; policy helpers are then granted explicitly.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

GRANT EXECUTE ON FUNCTION public._driver_trip_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public._driver_load_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public._driver_fiscal_document_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public._driver_order_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public._driver_client_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public._driver_pickup_order_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_driver_id(_tenant_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_owns_trip(_trip_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_can_access_vehicle(_vehicle_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_owns_stop(_stop_id uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.next_nfse_number_by_emitter(_tenant_id uuid, _emitter_id uuid, _series text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cte_defaults_for_group(p_load_ids uuid[]) TO authenticated;

REVOKE ALL PRIVILEGES ON FUNCTION public.increment_hfe_sync(p_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_hfe_sync(p_id uuid) TO service_role;

DO $production_internal_function_contract$
DECLARE
  function_name text;
  function_row record;
  internal_only_functions constant text[] := ARRAY[
    'check_resource_ownership',
    'commit_load_import_v1',
    'create_load_v1',
    'delete_load_item_v1',
    'execute_data_repair_v1',
    'get_next_load_number_v1',
    'handle_new_user',
    'list_clients_v1',
    'list_drivers_v1',
    'list_fiscal_documents_v1',
    'list_load_control_v1',
    'list_loads_v1',
    'list_operational_routes_v1'
  ];
BEGIN
  FOREACH function_name IN ARRAY internal_only_functions LOOP
    FOR function_row IN
      SELECT procedure.oid::regprocedure::text AS signature
      FROM pg_proc AS procedure
      JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.proname = function_name
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', function_row.signature);
    END LOOP;
  END LOOP;
END;
$production_internal_function_contract$;

-- Atomic postconditions. Any violation aborts and rolls back the entire cutover.
DO $production_baseline_postconditions$
DECLARE
  violation_count integer;
BEGIN
  SELECT count(*) INTO violation_count
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p')
    AND NOT relation.relrowsecurity;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'Postcondition failed: % public table(s) do not have RLS', violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN');
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'Postcondition failed: % dangerous browser relation grant(s)', violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND grantee = 'anon';
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'Postcondition failed: anon retains % public relation grant(s)', violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM pg_policy AS policy
  JOIN pg_class AS relation ON relation.oid = policy.polrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname IN ('public', 'storage')
    AND policy.polcmd IN ('w', '*')
    AND policy.polqual IS NOT NULL
    AND policy.polwithcheck IS NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'Postcondition failed: % UPDATE/ALL policy check gap(s)', violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM public.integration_accounts
  WHERE password_encrypted IS NOT NULL
    AND password_encrypted NOT LIKE 'enc:v1:%';
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'Postcondition failed: % plaintext integration password(s)', violation_count;
  END IF;

  WITH tenant_tables AS (
    SELECT relation.oid
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = relation.oid
     AND attribute.attname = 'tenant_id'
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
  ), tenant_indexed AS (
    SELECT DISTINCT index_row.indrelid
    FROM pg_index AS index_row
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = index_row.indrelid
     AND attribute.attnum = index_row.indkey[0]
    WHERE index_row.indisvalid
      AND attribute.attname = 'tenant_id'
  )
  SELECT count(*) INTO violation_count
  FROM tenant_tables
  LEFT JOIN tenant_indexed ON tenant_indexed.indrelid = tenant_tables.oid
  WHERE tenant_indexed.indrelid IS NULL;
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'Postcondition failed: % tenant table(s) lack a leading tenant_id index', violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM information_schema.column_privileges
  WHERE table_schema = 'public'
    AND grantee = 'authenticated'
    AND (
      (table_name = 'hub_fiscal_credentials' AND column_name = 'secret_ciphertext' AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE'))
      OR (table_name = 'integration_accounts' AND column_name = ANY (ARRAY['password_encrypted', 'hashauth', 'hashcode', 'token_cache']) AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE'))
      OR (table_name = 'nfse_provider_configs' AND column_name = ANY (ARRAY['credentials_encrypted', 'credentials_iv']) AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE'))
      OR (table_name = 'vehicles' AND column_name = 'tracker_password' AND privilege_type = 'SELECT')
    );
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'Postcondition failed: % sensitive browser column grant(s)', violation_count;
  END IF;

  IF to_regprocedure('public.increment_hfe_sync(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Postcondition failed: increment_hfe_sync(uuid) is missing';
  END IF;

  IF has_function_privilege('authenticated', 'public.increment_hfe_sync(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postcondition failed: increment_hfe_sync(uuid) is browser-executable';
  END IF;
END;
$production_baseline_postconditions$;
