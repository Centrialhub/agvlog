-- Reset backoff and clear admin skip so sync can retry immediately with new dual-token logic
UPDATE integration_accounts
SET settings = settings
  - 'sync_units_backoff_until'
  - 'sync_units_backoff_count'
  - 'skip_admin_until'
  - 'last_admin_error'
  - 'admin_token_cache'
  - 'admin_token_expires_at',
  status = 'ok',
  last_error = NULL,
  updated_at = now()
WHERE provider = 'SSX';