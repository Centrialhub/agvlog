-- Keep the SSX runtime installed but silent while the tenant capability is off.
-- The environment bootstrap recreates these jobs when SSX is deliberately enabled.

do $reconcile_disabled_ssx_cron$
declare
  target_tenant_secret text;
  target_tenant_id uuid;
  ssx_effective boolean := false;
begin
  select secret.decrypted_secret
  into target_tenant_secret
  from vault.decrypted_secrets secret
  where secret.name = 'agvlog_tenant_id'
  limit 1;

  if target_tenant_secret is not null then
    begin
      target_tenant_id := target_tenant_secret::uuid;
    exception
      when invalid_text_representation then
        target_tenant_id := null;
    end;
  end if;

  if target_tenant_id is not null then
    select
      count(*) = 2
      and coalesce(
        bool_or(policy.enabled) filter (where policy.feature_key = 'ssx_enabled'),
        false
      )
      and not coalesce(
        bool_or(policy.enabled) filter (where policy.feature_key = 'ssx_kill_switch'),
        true
      )
    into ssx_effective
    from public.tenant_feature_policy policy
    where policy.tenant_id = target_tenant_id
      and policy.feature_key in ('ssx_enabled', 'ssx_kill_switch');
  end if;

  if not coalesce(ssx_effective, false) then
    perform cron.unschedule(job.jobid)
    from cron.job job
    where job.jobname in (
      'agvlog-poll-positions-3min',
      'agvlog-full-sync-6h',
      'agvlog-daily-aggregate'
    );
  end if;
end;
$reconcile_disabled_ssx_cron$;
