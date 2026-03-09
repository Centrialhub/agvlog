UPDATE integration_accounts
SET settings = settings 
  - 'sync_units_backoff_until' 
  - 'sync_units_backoff_count'
  - 'skip_admin_until'
  - 'last_admin_error'
  || CASE WHEN settings->>'api_version' IS NULL THEN '{"api_version":"v3"}'::jsonb ELSE '{}'::jsonb END,
  status = 'ok',
  last_error = NULL
WHERE provider = 'SSX';