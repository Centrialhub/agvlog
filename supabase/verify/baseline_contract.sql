-- Read-only post-reset verification for the AGV Log baseline.
-- Run after `supabase db reset` or against a disposable branch.

DO $verify_baseline$
DECLARE
  violation_count integer;
BEGIN
  SELECT count(*)
  INTO violation_count
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p')
    AND NOT relation.relrowsecurity;
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Baseline verification failed: % public tables without RLS', violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind = 'v'
    AND NOT coalesce(relation.reloptions, '{}'::text[]) @> ARRAY['security_invoker=true'];
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Baseline verification failed: % views without security_invoker', violation_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_event_trigger
    WHERE evtname = 'ensure_rls' AND evtenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'Baseline verification failed: ensure_rls event trigger is missing or disabled';
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN');
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Baseline verification failed: % dangerous client relation grants', violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND grantee = 'anon';
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Baseline verification failed: anon has % application relation grants', violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND has_function_privilege('anon', procedure.oid, 'EXECUTE')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_depend AS dependency
      WHERE dependency.classid = 'pg_proc'::regclass
        AND dependency.objid = procedure.oid
        AND dependency.refclassid = 'pg_extension'::regclass
        AND dependency.deptype = 'e'
    );
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Baseline verification failed: anon can execute % public functions', violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM (VALUES
    ('public.hub_fiscal_credentials', 'secret_ciphertext'),
    ('public.integration_accounts', 'password_encrypted'),
    ('public.integration_accounts', 'hashauth'),
    ('public.integration_accounts', 'hashcode'),
    ('public.integration_accounts', 'token_cache'),
    ('public.nfse_provider_configs', 'credentials_encrypted'),
    ('public.nfse_provider_configs', 'credentials_iv'),
    ('public.vehicles', 'tracker_password')
  ) AS sensitive(relation_name, column_name)
  WHERE has_column_privilege(
    'authenticated',
    sensitive.relation_name,
    sensitive.column_name,
    'SELECT'
  );
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Baseline verification failed: % credential columns are browser-readable', violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM (VALUES
    ('public.hub_fiscal_credentials', 'secret_ciphertext'),
    ('public.integration_accounts', 'password_encrypted'),
    ('public.integration_accounts', 'hashauth'),
    ('public.integration_accounts', 'hashcode'),
    ('public.integration_accounts', 'token_cache'),
    ('public.nfse_provider_configs', 'credentials_encrypted'),
    ('public.nfse_provider_configs', 'credentials_iv')
  ) AS sensitive(relation_name, column_name)
  WHERE has_column_privilege('authenticated', sensitive.relation_name, sensitive.column_name, 'INSERT')
     OR has_column_privilege('authenticated', sensitive.relation_name, sensitive.column_name, 'UPDATE');
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Baseline verification failed: % backend-only credential columns are browser-writable', violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.prosecdef
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(coalesce(procedure.proconfig, ARRAY[]::text[])) AS setting
      WHERE setting LIKE 'search_path=%'
    );
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Baseline verification failed: % SECURITY DEFINER functions without search_path', violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM pg_policy AS policy
  JOIN pg_class AS relation ON relation.oid = policy.polrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname IN ('public', 'storage')
    AND policy.polcmd IN ('w', '*')
    AND policy.polwithcheck IS NULL;
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Baseline verification failed: % UPDATE/ALL policies without WITH CHECK', violation_count;
  END IF;

  SELECT count(*)
  INTO violation_count
  FROM public.integration_accounts
  WHERE password_encrypted NOT LIKE 'enc:v1:%';
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Baseline verification failed: % plaintext integration passwords', violation_count;
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
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Baseline verification failed: % tenant tables lack a leading tenant_id index', violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM unnest(ARRAY[
    'private._driver_client_ids()',
    'private._driver_fiscal_document_ids()',
    'private._driver_load_ids()',
    'private._driver_order_ids()',
    'private._driver_pickup_order_ids()',
    'private._driver_trip_ids()',
    'private.driver_can_access_vehicle(uuid)',
    'private.driver_owns_stop(uuid)',
    'public.current_driver_id(uuid)',
    'public.driver_owns_trip(uuid)'
  ]) AS helper(signature)
  WHERE NOT has_function_privilege('authenticated', helper.signature, 'EXECUTE');
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Baseline verification failed: % RLS policy helpers are inaccessible', violation_count;
  END IF;

  IF NOT has_schema_privilege('authenticated', 'private', 'USAGE')
     OR has_schema_privilege('anon', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'Baseline verification failed: private helper schema grants are invalid';
  END IF;

  SELECT count(*) INTO violation_count
  FROM unnest(ARRAY[
    'public._driver_client_ids()',
    'public._driver_fiscal_document_ids()',
    'public._driver_load_ids()',
    'public._driver_order_ids()',
    'public._driver_pickup_order_ids()',
    'public._driver_trip_ids()',
    'public.driver_can_access_vehicle(uuid)',
    'public.driver_owns_stop(uuid)'
  ]) AS helper(signature)
  WHERE to_regprocedure(helper.signature) IS NOT NULL;
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Baseline verification failed: % internal RLS helpers remain exposed', violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM unnest(ARRAY[
    'public.diagnose_load_composition(uuid,uuid[])',
    'public.repair_load_composition(uuid,uuid[],boolean)',
    'public.link_fiscal_documents_to_load_v1(uuid,uuid,uuid[])',
    'public.unlink_fiscal_documents_from_load_v1(uuid,uuid,uuid[])'
  ]) AS legacy_rpc(signature)
  WHERE has_function_privilege('authenticated', legacy_rpc.signature, 'EXECUTE')
     OR NOT has_function_privilege('service_role', legacy_rpc.signature, 'EXECUTE');
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Baseline verification failed: % legacy maintenance RPC grants are invalid', violation_count;
  END IF;

  IF to_regprocedure('public.monitor_simples_nacional_icms_violations()') IS NOT NULL
     OR to_regprocedure('public.monitor_simples_nacional_icms_violations(uuid)') IS NULL
     OR NOT has_function_privilege(
       'authenticated',
       'public.monitor_simples_nacional_icms_violations(uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Baseline verification failed: tenant-scoped ICMS monitor contract is invalid';
  END IF;

  SELECT count(*) INTO violation_count
  FROM unnest(ARRAY[
    'public.get_client_portal_summary_v2(uuid,uuid,date,date)',
    'public.list_client_documents_v2(uuid,uuid,text,text,date,date,integer,integer)',
    'public.list_client_pods_v2(uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer)',
    'public.list_client_pickups_v2(uuid,uuid,text,timestamp with time zone,timestamp with time zone,integer,integer)',
    'public.list_client_occurrences_v2(uuid,uuid,text,boolean,integer,integer)',
    'public.search_client_portal_shipments_v2(uuid,uuid,text,text[],date,date,text,text,boolean,boolean,integer,integer)',
    'public.get_client_portal_reports_summary_v2(uuid,uuid,date,date)',
    'public.get_client_portal_alerts_v2(uuid,uuid,integer)',
    'public.get_client_portal_upcoming_deliveries_v2(uuid,uuid,integer)',
    'public.get_client_portal_tracking_v2(uuid,uuid)',
    'public.get_client_pod_metadata(uuid,uuid)'
  ]) AS portal_rpc(signature)
  WHERE NOT has_function_privilege('authenticated', portal_rpc.signature, 'EXECUTE');
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Baseline verification failed: % portal RPCs are inaccessible', violation_count;
  END IF;

  IF has_function_privilege(
       'authenticated',
       'public.log_pod_access_v2(uuid,uuid,uuid,uuid,boolean,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.log_pod_access_v2(uuid,uuid,uuid,uuid,boolean,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Baseline verification failed: POD audit RPC grants are invalid';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.get_current_memberships_v1()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Baseline verification failed: membership discovery RPC is inaccessible';
  END IF;

  IF to_regprocedure('public.session_has_privileged_mfa_v1(uuid)') IS NULL
     OR has_function_privilege(
       'authenticated',
       'public.session_has_privileged_mfa_v1(uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.session_has_privileged_mfa_v1(uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Baseline verification failed: privileged MFA helper contract is invalid';
  END IF;

  SELECT count(*) INTO violation_count
  FROM pg_proc AS procedure
  JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname IN (
      'get_user_tenant_ids',
      'has_tenant_role',
      'is_tenant_member',
      'is_tenant_admin',
      'is_tenant_operator_or_admin'
    )
    AND pg_get_functiondef(procedure.oid) ~* 'auth\.jwt'
    AND pg_get_functiondef(procedure.oid) ~* 'aal2';
  IF violation_count <> 5 THEN
    RAISE EXCEPTION 'Baseline verification failed: only % of 5 tenant helpers enforce AAL2', violation_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname = 'get_user_portal_tenants'
      AND pg_get_functiondef(procedure.oid) ~* 'session_has_privileged_mfa_v1'
  ) THEN
    RAISE EXCEPTION 'Baseline verification failed: portal tenant discovery bypasses the MFA predicate';
  END IF;

  SELECT count(*) INTO violation_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'driver_settlement_loads',
      'hub_fiscal_credentials',
      'hub_fiscal_emissions',
      'integration_accounts',
      'load_manifests',
      'operational_event_messages',
      'payables_payments',
      'receivables_payments',
      'tenant_emitters'
    )
    AND policyname IN (
      'agvlog_select_authenticated',
      'agvlog_insert_authenticated',
      'agvlog_update_authenticated',
      'agvlog_delete_authenticated'
    );
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Baseline verification failed: % legacy policies bypass the canonical tenant helpers', violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM (
    SELECT tablename, role_name, action
    FROM (
      SELECT
        policy.tablename,
        role_name,
        action
      FROM pg_policies policy
      CROSS JOIN LATERAL unnest(policy.roles) role_name
      CROSS JOIN LATERAL unnest(
        CASE policy.cmd
          WHEN 'ALL' THEN ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]
          ELSE ARRAY[policy.cmd]::text[]
        END
      ) action
      WHERE policy.schemaname = 'public'
        AND policy.permissive = 'PERMISSIVE'
        AND policy.tablename IN (
          'driver_settlement_loads',
          'hub_fiscal_emissions',
          'integration_accounts',
          'operational_event_messages',
          'payables_payments',
          'receivables_payments',
          'tenant_emitters'
        )
        AND role_name = 'authenticated'
    ) expanded
    GROUP BY tablename, role_name, action
    HAVING count(*) > 1
  ) overlap_groups;
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Baseline verification failed: % privileged RLS action groups remain permissively overlapped', violation_count;
  END IF;

  IF has_table_privilege('authenticated', 'public.load_items', 'INSERT')
     OR has_table_privilege('authenticated', 'public.load_items', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.load_items', 'DELETE')
     OR has_table_privilege('authenticated', 'public.loads', 'UPDATE') THEN
    RAISE EXCEPTION 'Baseline verification failed: canonical load mutations can be bypassed';
  END IF;

  SELECT count(*) INTO violation_count
  FROM unnest(ARRAY[
    'public.transition_load_status_v1(uuid,uuid,text,text)',
    'public.upsert_load_item_v3(uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,text,text,uuid)',
    'public.delete_load_item_v3(uuid,uuid)',
    'public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])',
    'public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])'
  ]) AS load_rpc(signature)
  WHERE NOT has_function_privilege('authenticated', load_rpc.signature, 'EXECUTE');
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Baseline verification failed: % canonical load RPCs are inaccessible', violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM unnest(ARRAY[
    'public.plan_dispatch_trip_v2(uuid,uuid,uuid,uuid[],timestamp with time zone,text)',
    'public.upsert_load_item_v1(uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,uuid)'
  ]) AS legacy_rpc(signature)
  WHERE has_function_privilege('anon', legacy_rpc.signature, 'EXECUTE')
     OR has_function_privilege('authenticated', legacy_rpc.signature, 'EXECUTE');
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Baseline verification failed: % unsafe legacy RPC signatures are exposed', violation_count;
  END IF;

  IF has_function_privilege('authenticated', 'public.verify_agvlog_cron_secret(text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.verify_agvlog_cron_secret(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Baseline verification failed: cron verifier role contract is invalid';
  END IF;

  SELECT count(*) INTO violation_count
  FROM unnest(ARRAY[
    'public.terminalize_fiscal_poll_v1(uuid,text,uuid,text,text,integer,timestamp with time zone,jsonb)',
    'public.claim_fiscal_webhook_delivery_v1(text,text,jsonb,timestamp with time zone,text)',
    'public.complete_fiscal_webhook_delivery_v1(uuid,boolean,uuid,uuid,text)'
  ]) AS backend_rpc(signature)
  WHERE has_function_privilege('authenticated', backend_rpc.signature, 'EXECUTE')
     OR NOT has_function_privilege('service_role', backend_rpc.signature, 'EXECUTE');
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Baseline verification failed: % fiscal backend RPC grants are invalid', violation_count;
  END IF;

  SELECT count(*) INTO violation_count
  FROM unnest(ARRAY[
    'last_status_check_at',
    'status_check_attempts',
    'last_status_response'
  ]) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'fiscal_documents'
      AND information_schema.columns.column_name = required.column_name
  );
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Baseline verification failed: % CT-e polling columns are missing', violation_count;
  END IF;

  IF (
    SELECT count(*) FROM storage.buckets
    WHERE id IN ('occurrence-return-proofs', 'pallet-return-proofs', 'receipts')
  ) <> 3 THEN
    RAISE EXCEPTION 'Baseline verification failed: required Storage buckets are missing';
  END IF;

  SELECT count(*) INTO violation_count
  FROM storage.buckets
  WHERE id IN ('occurrence-return-proofs', 'pallet-return-proofs', 'receipts')
    AND (
      file_size_limit IS DISTINCT FROM 10485760
      OR allowed_mime_types IS NULL
      OR cardinality(allowed_mime_types) = 0
    );
  IF violation_count <> 0 THEN
    RAISE EXCEPTION 'Baseline verification failed: % proof buckets lack authoritative upload limits', violation_count;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND (
       SELECT count(*)
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
     ) < 9 THEN
    RAISE EXCEPTION 'Baseline verification failed: Realtime publication is incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS sequence
    JOIN pg_namespace AS namespace ON namespace.oid = sequence.relnamespace
    JOIN pg_depend AS dependency
      ON dependency.objid = sequence.oid
     AND dependency.deptype = 'a'
    WHERE namespace.nspname = 'public'
      AND sequence.relname = 'freight_tables_table_code_seq'
  ) THEN
    RAISE EXCEPTION 'Baseline verification failed: freight table sequence ownership is missing';
  END IF;
END;
$verify_baseline$;

SELECT
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public') AS public_tables,
  (SELECT count(*) FROM pg_proc AS procedure JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace WHERE namespace.nspname = 'public') AS public_functions,
  (SELECT count(*) FROM pg_policies WHERE schemaname IN ('public', 'storage')) AS rls_policies,
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public') AS public_indexes,
  'baseline_contract_ok'::text AS status;
