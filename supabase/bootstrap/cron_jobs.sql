-- Secure, environment-specific cron bootstrap for AGV Log.
--
-- This file is intentionally outside supabase/migrations. Run it once per hosted
-- environment after creating the four Vault secrets below. No credential, project
-- URL, or tenant identifier should be committed to the repository.
--
-- Example setup (replace every placeholder in the Dashboard SQL editor):
-- select vault.create_secret('https://PROJECT_REF.supabase.co', 'agvlog_project_url');
-- select vault.create_secret('LEGACY_ANON_JWT', 'agvlog_anon_key');
-- select vault.create_secret('RANDOM_CRON_SECRET', 'agvlog_cron_secret');
-- select vault.create_secret('TENANT_UUID', 'agvlog_tenant_id');

DO $configure_cron$
DECLARE
  missing_secret_names text[];
  target_tenant_id uuid;
  ssx_effective boolean := false;
  fiscal_effective boolean := false;
BEGIN
  SELECT array_agg(required.name ORDER BY required.name)
  INTO missing_secret_names
  FROM unnest(ARRAY[
    'agvlog_project_url',
    'agvlog_anon_key',
    'agvlog_cron_secret',
    'agvlog_tenant_id'
  ]) AS required(name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets secret
    WHERE secret.name = required.name
  );

  IF missing_secret_names IS NOT NULL THEN
    RAISE EXCEPTION 'Missing Vault secrets: %', array_to_string(missing_secret_names, ', ');
  END IF;

  target_tenant_id := (
    SELECT decrypted_secret::uuid
    FROM vault.decrypted_secrets
    WHERE name = 'agvlog_tenant_id'
    LIMIT 1
  );

  SELECT
    coalesce(bool_or(policy.enabled) filter (where policy.feature_key = 'ssx_enabled'), false)
      and not coalesce(bool_or(policy.enabled) filter (where policy.feature_key = 'ssx_kill_switch'), false),
    coalesce(bool_or(policy.enabled) filter (where policy.feature_key = 'fiscal_enabled'), false)
      and not coalesce(bool_or(policy.enabled) filter (where policy.feature_key = 'fiscal_kill_switch'), false)
  INTO ssx_effective, fiscal_effective
  FROM public.tenant_feature_policy policy
  WHERE policy.tenant_id = target_tenant_id;

  PERFORM cron.unschedule(job.jobid)
  FROM cron.job AS job
  WHERE job.jobname IN (
    'agvlog-poll-positions-3min',
    'agvlog-full-sync-6h',
    'agvlog-daily-aggregate',
    'nfse-status-poll-every-1min',
    'cte-status-poll-every-1min'
  );

  IF ssx_effective THEN
    PERFORM cron.schedule(
    'agvlog-poll-positions-3min',
    '*/3 * * * *',
    $job$
      SELECT net.http_post(
        url := rtrim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'agvlog_project_url' LIMIT 1), '/') || '/functions/v1/agvlog-pipeline-run',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'agvlog_anon_key' LIMIT 1),
          'x-agvlog-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'agvlog_cron_secret' LIMIT 1)
        ),
        body := jsonb_build_object(
          'tenant_id', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'agvlog_tenant_id' LIMIT 1),
          'pipeline_mode', 'poll'
        ),
        timeout_milliseconds := 150000
      ) AS request_id;
    $job$
    );

    PERFORM cron.schedule(
    'agvlog-full-sync-6h',
    '0 */6 * * *',
    $job$
      SELECT net.http_post(
        url := rtrim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'agvlog_project_url' LIMIT 1), '/') || '/functions/v1/agvlog-pipeline-run',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'agvlog_anon_key' LIMIT 1),
          'x-agvlog-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'agvlog_cron_secret' LIMIT 1)
        ),
        body := jsonb_build_object(
          'tenant_id', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'agvlog_tenant_id' LIMIT 1),
          'pipeline_mode', 'full'
        ),
        timeout_milliseconds := 300000
      ) AS request_id;
    $job$
    );
    PERFORM cron.schedule(
    'agvlog-daily-aggregate',
    '0 2 * * *',
    $job$
      SELECT net.http_post(
        url := rtrim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'agvlog_project_url' LIMIT 1), '/') || '/functions/v1/agvlog-pipeline-run',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'agvlog_anon_key' LIMIT 1),
          'x-agvlog-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'agvlog_cron_secret' LIMIT 1)
        ),
        body := jsonb_build_object(
          'tenant_id', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'agvlog_tenant_id' LIMIT 1),
          'pipeline_mode', 'aggregate_only'
        ),
        timeout_milliseconds := 120000
      ) AS request_id;
    $job$
  );
  END IF;

  IF fiscal_effective THEN
    PERFORM cron.schedule(
    'nfse-status-poll-every-1min',
    '* * * * *',
    $job$
      SELECT net.http_post(
        url := rtrim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'agvlog_project_url' LIMIT 1), '/') || '/functions/v1/nfse-status-poll',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'agvlog_anon_key' LIMIT 1),
          'x-agvlog-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'agvlog_cron_secret' LIMIT 1)
        ),
        body := jsonb_build_object('time', now()),
        timeout_milliseconds := 55000
      ) AS request_id;
    $job$
    );

    PERFORM cron.schedule(
    'cte-status-poll-every-1min',
    '* * * * *',
    $job$
      SELECT net.http_post(
        url := rtrim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'agvlog_project_url' LIMIT 1), '/') || '/functions/v1/cte-status-poll',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'agvlog_anon_key' LIMIT 1),
          'x-agvlog-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'agvlog_cron_secret' LIMIT 1)
        ),
        body := jsonb_build_object('time', now()),
        timeout_milliseconds := 55000
      ) AS request_id;
    $job$
    );
  END IF;
END;
$configure_cron$;
