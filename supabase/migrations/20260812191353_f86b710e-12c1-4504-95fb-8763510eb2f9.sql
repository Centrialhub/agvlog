SELECT cron.unschedule('nfse-status-poll-every-5min');

-- Re-scheduling with 1min frequency
SELECT cron.schedule('nfse-status-poll-every-1min', '* * * * *', 
  $$
  SELECT net.http_post(
    url := 'https://qcvnsdrbcchaxvawcngk.supabase.co/functions/v1/nfse-status-poll',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjdm5zZHJiY2NoYXh2YXdjbmdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MDQ0NTIsImV4cCI6MjA4ODM4MDQ1Mn0.HL4u-KeYNBLyrPVg_Yq8KdMS-uEiDHcZnaeZH-AOk-w"}'::jsonb,
    body := '{"time": "' || now() || '"}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule('cte-status-poll-every-1min', '* * * * *', 
  $$
  SELECT net.http_post(
    url := 'https://qcvnsdrbcchaxvawcngk.supabase.co/functions/v1/cte-status-poll',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFjdm5zZHJiY2NoYXh2YXdjbmdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MDQ0NTIsImV4cCI6MjA4ODM4MDQ1Mn0.HL4u-KeYNBLyrPVg_Yq8KdMS-uEiDHcZnaeZH-AOk-w"}'::jsonb,
    body := '{"time": "' || now() || '"}'::jsonb
  ) AS request_id;
  $$
);
