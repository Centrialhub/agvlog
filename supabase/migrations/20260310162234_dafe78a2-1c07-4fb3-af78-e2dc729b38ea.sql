
-- Schedule position polling every 3 minutes
SELECT cron.schedule(
  'agvlog-poll-positions-3min',
  '*/3 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://qcvnsdrbcchaxvawcngk.supabase.co/functions/v1/agvlog-pipeline-run',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjdm5zZHJiY2NoYXh2YXdjbmdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MDQ0NTIsImV4cCI6MjA4ODM4MDQ1Mn0.HL4u-KeYNBLyrPVg_Yq8KdMS-uEiDHcZnaeZH-AOk-w"}'::jsonb,
    body := '{"tenant_id": "6e874e6e-5bca-486d-9928-bef0646989c4", "pipeline_mode": "poll"}'::jsonb
  ) AS request_id;
  $$
);

-- Schedule full sync every 6 hours (token + units + positions + queue + aggregate)
SELECT cron.schedule(
  'agvlog-full-sync-6h',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qcvnsdrbcchaxvawcngk.supabase.co/functions/v1/agvlog-pipeline-run',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjdm5zZHJiY2NoYXh2YXdjbmdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MDQ0NTIsImV4cCI6MjA4ODM4MDQ1Mn0.HL4u-KeYNBLyrPVg_Yq8KdMS-uEiDHcZnaeZH-AOk-w"}'::jsonb,
    body := '{"tenant_id": "6e874e6e-5bca-486d-9928-bef0646989c4", "pipeline_mode": "full"}'::jsonb
  ) AS request_id;
  $$
);

-- Schedule daily aggregation at 2:00 AM UTC
SELECT cron.schedule(
  'agvlog-daily-aggregate',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qcvnsdrbcchaxvawcngk.supabase.co/functions/v1/agvlog-pipeline-run',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjdm5zZHJiY2NoYXh2YXdjbmdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MDQ0NTIsImV4cCI6MjA4ODM4MDQ1Mn0.HL4u-KeYNBLyrPVg_Yq8KdMS-uEiDHcZnaeZH-AOk-w"}'::jsonb,
    body := '{"tenant_id": "6e874e6e-5bca-486d-9928-bef0646989c4", "pipeline_mode": "aggregate_only"}'::jsonb
  ) AS request_id;
  $$
);
