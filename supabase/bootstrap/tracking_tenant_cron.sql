-- Run after migrations, pg_cron/pg_net and the Vault secrets documented in
-- cron_jobs.sql. This replaces the former single-tenant SSX jobs with one
-- dispatcher that claims due tenants according to tenant_tracking_schedules.
do $tracking_tenant_cron$
begin
  perform cron.unschedule(job.jobid) from cron.job job
  where job.jobname in (
    'agvlog-poll-positions-3min',
    'agvlog-full-sync-6h',
    'agvlog-daily-aggregate',
    'agvlog-schedule-tenants-every-minute'
  );

  perform cron.schedule(
    'agvlog-schedule-tenants-every-minute',
    '* * * * *',
    $job$
      select net.http_post(
        url := rtrim((select decrypted_secret from vault.decrypted_secrets where name='agvlog_project_url' limit 1),'/')
          || '/functions/v1/agvlog-schedule-tenants',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='agvlog_anon_key' limit 1),
          'x-agvlog-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='agvlog_cron_secret' limit 1)
        ),
        body := jsonb_build_object('limit',8),
        timeout_milliseconds := 300000
      ) as request_id;
    $job$
  );
end;
$tracking_tenant_cron$;
