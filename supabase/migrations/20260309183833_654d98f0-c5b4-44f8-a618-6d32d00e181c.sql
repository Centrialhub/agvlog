UPDATE integration_accounts
SET settings = settings 
  - 'sync_units_backoff_until' 
  - 'sync_units_backoff_count'
  || jsonb_build_object('skip_admin_until', to_jsonb((now() + interval '24 hours')::text)),
    status = 'ok',
    last_error = NULL
WHERE id = '223159b8-8e1b-4742-bef9-3b8008738ade';