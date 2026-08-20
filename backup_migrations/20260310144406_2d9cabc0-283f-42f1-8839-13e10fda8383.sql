
-- Clear stuck ingestion cursors (backoff + errors) for all SSX accounts
UPDATE public.ingestion_cursors
SET backoff_until = NULL,
    last_error = NULL,
    last_error_at = NULL
WHERE last_error IS NOT NULL;

-- Clear poll_cooldown_until from integration_accounts settings
UPDATE public.integration_accounts
SET settings = settings - 'poll_cooldown_until' - 'poll_working_property' - 'poll_working_url' - 'poll_working_format' - 'poll_working_time_prop' - 'poll_memo_empty_count',
    last_error = NULL,
    updated_at = now()
WHERE provider = 'SSX';
