create table public.ssx_position_quarantine (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  integration_account_id uuid not null
    references public.integration_accounts(id) on delete cascade,
  reason text not null check (reason in (
    'invalid_gps', 'invalid_coordinates', 'invalid_timestamp',
    'missing_identity', 'unmatched_unit', 'ambiguous_unit',
    'outside_binding_window', 'unsupported_unit_type'
  )),
  provider_position_id text,
  tracked_unit_integration_code text,
  event_date timestamptz,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb not null,
  status text not null default 'open' check (status in ('open','resolved','ignored')),
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_note text,
  unique(integration_account_id, reason, payload_hash)
);

create index ssx_position_quarantine_open_idx
on public.ssx_position_quarantine(workspace_id, last_seen_at desc)
where status = 'open';

alter table public.ssx_position_quarantine enable row level security;
revoke all on table public.ssx_position_quarantine
from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.ssx_position_quarantine
to service_role;

create or replace function public.record_ssx_position_quarantine_batch_v1(
  _tenant_id uuid,
  _integration_account_id uuid,
  _records jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_attempted integer;
  v_recorded integer;
begin
  if jsonb_typeof(_records) <> 'array' then
    raise exception 'ssx_quarantine_records_must_be_array' using errcode = '22023';
  end if;

  v_attempted := jsonb_array_length(_records);
  if v_attempted > 1000 then
    raise exception 'ssx_quarantine_batch_too_large' using errcode = '22023';
  end if;

  select account.workspace_id into v_workspace_id
  from public.integration_accounts account
  join public.tenants tenant
    on tenant.workspace_id = account.workspace_id
   and tenant.id = _tenant_id
  join public.workspace_ssx_accounts registry
    on registry.workspace_id = account.workspace_id
   and registry.integration_account_id = account.id
   and registry.migration_state = 'ready'
  where account.id = _integration_account_id
    and lower(account.provider) = 'ssx';

  if v_workspace_id is null then
    raise exception 'workspace_ssx_account_mismatch' using errcode = '23503';
  end if;

  with incoming as (
    select record.*
    from jsonb_to_recordset(_records) as record(
      reason text,
      provider_position_id text,
      tracked_unit_integration_code text,
      event_date timestamptz,
      payload_hash text,
      payload jsonb
    )
  ), validated as (
    select * from incoming
    where reason in (
      'invalid_gps', 'invalid_coordinates', 'invalid_timestamp',
      'missing_identity', 'unmatched_unit', 'ambiguous_unit',
      'outside_binding_window', 'unsupported_unit_type'
    )
      and payload_hash ~ '^[0-9a-f]{64}$'
      and payload is not null
  ), written as (
    insert into public.ssx_position_quarantine(
      tenant_id, workspace_id, integration_account_id, reason,
      provider_position_id, tracked_unit_integration_code, event_date,
      payload_hash, payload
    )
    select
      _tenant_id, v_workspace_id, _integration_account_id, reason,
      provider_position_id, tracked_unit_integration_code, event_date,
      payload_hash, payload
    from validated
    on conflict(integration_account_id, reason, payload_hash) do update
    set last_seen_at = now(),
        occurrence_count = public.ssx_position_quarantine.occurrence_count + 1,
        payload = excluded.payload
    returning 1
  )
  select count(*) into v_recorded from written;

  if v_recorded <> v_attempted then
    raise exception 'ssx_quarantine_batch_rejected' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'version', 1,
    'tenant_id', _tenant_id,
    'integration_account_id', _integration_account_id,
    'attempted', v_attempted,
    'recorded', v_recorded
  );
end;
$function$;

revoke all on function public.record_ssx_position_quarantine_batch_v1(uuid,uuid,jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.record_ssx_position_quarantine_batch_v1(uuid,uuid,jsonb)
to service_role;

comment on table public.ssx_position_quarantine is
  'Service-only, minimized SSX position envelopes that were not safe to promote.';
