

# Fix: Cron Jobs Failing Auth (Positions Not Updating)

## Diagnosis

The cron jobs **are running every 3 minutes** (confirmed in `cron.job_run_details`), but every call returns **401 Unauthorized** silently.

**Root cause**: The cron job headers only include `Authorization: Bearer <anon_key>` but do NOT include the `x-agvlog-cron-secret` header. The pipeline function checks for the cron secret first -- if missing, it falls back to `auth.getUser()` with the anon key, which fails because the anon key is not a user session token.

**Evidence**:
- `positions_last.captured_at` is stuck at 12:33 UTC (hours stale)
- `tenants.settings.pipeline_health` is `null` (pipeline never completes successfully)
- `cron.job_run_details` shows `status: succeeded` because pg_cron only tracks whether the HTTP call was dispatched, not whether the edge function returned 200

## Fix

**One change only**: Recreate the 3 cron jobs with the `x-agvlog-cron-secret` header added to the headers JSON.

```sql
-- Drop existing jobs
SELECT cron.unschedule('agvlog-poll-positions-3min');
SELECT cron.unschedule('agvlog-full-sync-6h');
SELECT cron.unschedule('agvlog-daily-aggregate');

-- Recreate with cron secret header
SELECT cron.schedule('agvlog-poll-positions-3min', '*/3 * * * *', $$
  SELECT net.http_post(
    url := '...agvlog-pipeline-run',
    headers := '{"Content-Type":"application/json",
                 "Authorization":"Bearer <anon_key>",
                 "x-agvlog-cron-secret":"<secret_value>"}'::jsonb,
    body := '{"tenant_id":"...","pipeline_mode":"poll"}'::jsonb
  );
$$);
-- (same for full-sync-6h and daily-aggregate)
```

This must be run via the SQL editor (not a migration file) because it contains the actual secret value.

## Expected Result

After this fix, the cron will authenticate as a cron caller, the pipeline will execute fully, and `positions_last` will start updating automatically every 3 minutes.

