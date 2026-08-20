UPDATE integration_accounts
SET settings = settings - 'sync_units_backoff_until' - 'sync_units_backoff_count',
    status = 'ok',
    last_error = NULL
WHERE id = '223159b8-8e1b-4742-bef9-3b8008738ade';