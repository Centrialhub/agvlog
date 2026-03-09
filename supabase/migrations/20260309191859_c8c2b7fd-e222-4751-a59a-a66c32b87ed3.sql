
-- Reset all backoffs, admin skips, and cached admin tokens so sync can retry immediately
UPDATE integration_accounts
SET settings = settings
  - 'sync_units_backoff_until'
  - 'sync_units_backoff_count'
  - 'skip_admin_until'
  - 'last_admin_error'
  - 'admin_token_cache'
  - 'admin_token_expires_at'
  - 'last_units_sync_at',
  status = 'ok',
  last_error = NULL,
  updated_at = now()
WHERE provider = 'SSX';
