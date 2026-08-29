-- Moves the legacy literal pg_cron configuration into Supabase Vault and
-- installs a service-role-only verifier used by Edge Functions.

DO $secure_cron_vault$
DECLARE
  source_command text;
  project_url text;
  anon_key text;
  tenant_id text;
  cron_secret text;
  secret_id uuid;
BEGIN
  SELECT command
  INTO source_command
  FROM cron.job
  WHERE jobname = 'agvlog-poll-positions-3min'
  LIMIT 1;

  IF source_command IS NULL THEN
    RAISE EXCEPTION 'Cannot migrate cron credentials: source job is missing';
  END IF;

  project_url := substring(
    source_command FROM $regex$url\s*:=\s*'([^']+)/functions/v1/agvlog-pipeline-run'$regex$
  );
  anon_key := substring(
    source_command FROM $regex$"Authorization"\s*:\s*"Bearer ([^"]+)"$regex$
  );
  tenant_id := substring(
    source_command FROM $regex$"tenant_id"\s*:\s*"([0-9a-fA-F-]{36})"$regex$
  );

  IF project_url IS NULL OR anon_key IS NULL OR tenant_id IS NULL THEN
    RAISE EXCEPTION 'Cannot migrate cron credentials: legacy job format is not recognized';
  END IF;

  IF tenant_id::uuid IS NULL THEN
    RAISE EXCEPTION 'Cannot migrate cron credentials: tenant identifier is invalid';
  END IF;

  cron_secret := encode(extensions.gen_random_bytes(32), 'hex');

  SELECT id INTO secret_id FROM vault.secrets WHERE name = 'agvlog_project_url' LIMIT 1;
  IF secret_id IS NULL THEN
    PERFORM vault.create_secret(project_url, 'agvlog_project_url', 'AGV Log Edge Function base URL');
  ELSE
    PERFORM vault.update_secret(secret_id, project_url, 'agvlog_project_url', 'AGV Log Edge Function base URL');
  END IF;

  secret_id := NULL;
  SELECT id INTO secret_id FROM vault.secrets WHERE name = 'agvlog_anon_key' LIMIT 1;
  IF secret_id IS NULL THEN
    PERFORM vault.create_secret(anon_key, 'agvlog_anon_key', 'AGV Log publishable legacy JWT for Edge gateway');
  ELSE
    PERFORM vault.update_secret(secret_id, anon_key, 'agvlog_anon_key', 'AGV Log publishable legacy JWT for Edge gateway');
  END IF;

  secret_id := NULL;
  SELECT id INTO secret_id FROM vault.secrets WHERE name = 'agvlog_tenant_id' LIMIT 1;
  IF secret_id IS NULL THEN
    PERFORM vault.create_secret(tenant_id, 'agvlog_tenant_id', 'AGV Log tenant used by scheduled ingestion');
  ELSE
    PERFORM vault.update_secret(secret_id, tenant_id, 'agvlog_tenant_id', 'AGV Log tenant used by scheduled ingestion');
  END IF;

  secret_id := NULL;
  SELECT id INTO secret_id FROM vault.secrets WHERE name = 'agvlog_cron_secret' LIMIT 1;
  IF secret_id IS NULL THEN
    PERFORM vault.create_secret(cron_secret, 'agvlog_cron_secret', 'Rotated secret for authenticated pg_cron Edge calls');
  ELSE
    PERFORM vault.update_secret(secret_id, cron_secret, 'agvlog_cron_secret', 'Rotated secret for authenticated pg_cron Edge calls');
  END IF;
END;
$secure_cron_vault$;

CREATE OR REPLACE FUNCTION public.verify_agvlog_cron_secret(p_secret text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'vault'
AS $function$
  SELECT p_secret IS NOT NULL
    AND octet_length(p_secret) >= 32
    AND EXISTS (
      SELECT 1
      FROM vault.decrypted_secrets AS secret
      WHERE secret.name = 'agvlog_cron_secret'
        AND secret.decrypted_secret = p_secret
    );
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.verify_agvlog_cron_secret(p_secret text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_agvlog_cron_secret(p_secret text)
  TO service_role;

DO $secure_cron_vault_postconditions$
DECLARE
  violation_count integer;
BEGIN
  SELECT count(*) INTO violation_count
  FROM unnest(ARRAY[
    'agvlog_project_url',
    'agvlog_anon_key',
    'agvlog_cron_secret',
    'agvlog_tenant_id'
  ]) AS required(name)
  WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE vault.secrets.name = required.name);
  IF violation_count > 0 THEN
    RAISE EXCEPTION 'Postcondition failed: % Vault cron secret(s) are missing', violation_count;
  END IF;

  IF NOT public.verify_agvlog_cron_secret(
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'agvlog_cron_secret' LIMIT 1)
  ) THEN
    RAISE EXCEPTION 'Postcondition failed: Vault cron verifier rejected the stored secret';
  END IF;

  IF has_function_privilege('authenticated', 'public.verify_agvlog_cron_secret(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postcondition failed: cron verifier is browser-executable';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.verify_agvlog_cron_secret(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Postcondition failed: cron verifier is unavailable to service_role';
  END IF;
END;
$secure_cron_vault_postconditions$;
