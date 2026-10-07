-- Separate forward discovered by the restored baseline contract on 2026-09-28.
-- These eight zero-argument functions serve existing triggers, not direct RPCs.
-- Trigger execution does not require the table writer to hold function EXECUTE.
-- Preserve function bodies, owners, trigger bindings and unrelated RPC grants.
DO $restrict_internal_trigger_execute$
DECLARE
  function_name text;
  function_oid oid;
  client_role text;
  internal_functions constant text[] := ARRAY[
    'guard_freight_table_overlap',
    'guard_reported_catalog_values',
    'guard_shortage_status_values',
    'protect_imported_note_status_v1',
    'protect_tenant_owners',
    'record_nfse_created_event_v1',
    'record_return_sheet_signed_proof_v1',
    'validate_trip_stop_poi_tenant_v1'
  ];
BEGIN
  -- Validate the entire narrow target set before changing any ACL.
  FOREACH function_name IN ARRAY internal_functions LOOP
    function_oid := pg_catalog.to_regprocedure(pg_catalog.format('public.%I()', function_name));
    IF function_oid IS NULL OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      WHERE procedure.oid = function_oid
        AND procedure.prokind = 'f'
        AND procedure.pronargs = 0
        AND procedure.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
        AND pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
        AND EXISTS (
          SELECT 1 FROM pg_catalog.pg_trigger AS trigger
          WHERE trigger.tgfoid = procedure.oid AND NOT trigger.tgisinternal
        )
    ) THEN
      RAISE EXCEPTION 'Internal trigger ACL preflight failed: public.%()', function_name;
    END IF;
  END LOOP;

  FOREACH function_name IN ARRAY internal_functions LOOP
    EXECUTE pg_catalog.format(
      'REVOKE EXECUTE ON FUNCTION public.%I() FROM PUBLIC, anon, authenticated, service_role',
      function_name
    );
    function_oid := pg_catalog.to_regprocedure(pg_catalog.format('public.%I()', function_name));
    FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF pg_catalog.has_function_privilege(client_role, function_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'Internal trigger ACL verification failed: % still executes public.%()', client_role, function_name;
      END IF;
    END LOOP;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))) AS privilege
      WHERE procedure.oid = function_oid AND privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'Internal trigger ACL verification failed: PUBLIC still executes public.%()', function_name;
    END IF;
  END LOOP;
END;
$restrict_internal_trigger_execute$;
