-- Durable progress for optional SSX synchronization; no browser access.
set local lock_timeout = '3s';
set local statement_timeout = '15s';
create table public.ssx_sync_checkpoints (
  integration_account_id uuid not null references public.integration_accounts(id) on delete cascade,
  resource text not null check (resource ~ '^[a-z_]{1,64}$'),
  scope_key text not null default '' check (length(scope_key) <= 200),
  status text not null default 'pending' check (status in ('pending','running','success','failed','attention_required')),
  lease_token uuid, lease_until timestamptz,
  attempts integer not null default 0,
  last_success_at timestamptz, retry_at timestamptz,
  error_code text, result jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (integration_account_id,resource,scope_key),
  check (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 65536)
);
alter table public.ssx_sync_checkpoints enable row level security;
revoke all on public.ssx_sync_checkpoints from public, anon, authenticated;
grant select, insert, update on public.ssx_sync_checkpoints to service_role;
create policy ssx_sync_checkpoints_service on public.ssx_sync_checkpoints
  for all to service_role using (true) with check (true);

create function public.claim_ssx_sync_checkpoint_v1(
  _account_id uuid, _resource text, _scope_key text default '', _max_age_seconds integer default 21600
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v public.ssx_sync_checkpoints; v_now timestamptz:=clock_timestamp(); v_token uuid;
begin
  if _account_id is null or _resource is null or _resource !~ '^[a-z_]{1,64}$'
    or _scope_key is null or length(_scope_key)>200 or _max_age_seconds is null
    or _max_age_seconds not between 0 and 21600 then
    raise exception 'ssx_checkpoint_invalid' using errcode='22023';
  end if;
  if not exists(select 1 from public.integration_accounts where id=_account_id and lower(provider)='ssx') then
    raise exception 'ssx_account_invalid' using errcode='42501';
  end if;
  insert into public.ssx_sync_checkpoints(integration_account_id,resource,scope_key)
    values(_account_id,_resource,_scope_key) on conflict do nothing;
  select * into v from public.ssx_sync_checkpoints where integration_account_id=_account_id
    and resource=_resource and scope_key=_scope_key for update;
  if v.status='running' and v.lease_until>v_now then
    return jsonb_build_object('decision','deferred','error_code','in_progress','retry_after_seconds',
      ceil(extract(epoch from v.lease_until-v_now)));
  end if;
  if v.retry_at>v_now then
    return jsonb_build_object('decision','deferred','error_code',v.error_code,'status',v.status,
      'retry_after_seconds',ceil(extract(epoch from v.retry_at-v_now)));
  end if;
  if v.status='success' and _max_age_seconds>0
    and v.last_success_at>v_now-make_interval(secs=>_max_age_seconds) then
    return jsonb_build_object('decision','cached','result',v.result);
  end if;
  v_token:=gen_random_uuid();
  update public.ssx_sync_checkpoints set status='running',lease_token=v_token,
    lease_until=v_now+interval '90 seconds',attempts=attempts+1,updated_at=v_now
    where integration_account_id=_account_id and resource=_resource and scope_key=_scope_key;
  return jsonb_build_object('decision','claimed','lease_token',v_token);
end $$;

create function public.finish_ssx_sync_checkpoint_v1(
  _account_id uuid, _resource text, _scope_key text, _lease_token uuid,
  _result jsonb default '{}'::jsonb, _error_code text default null, _retry_seconds integer default 0
) returns boolean language plpgsql security invoker set search_path='' as $$
declare v public.ssx_sync_checkpoints; v_now timestamptz:=clock_timestamp(); v_delay integer;
begin
  if _result is null or jsonb_typeof(_result)<>'object' or octet_length(_result::text)>65536
    or (_error_code is not null and _error_code !~ '^[a-z_]{1,64}$')
    or _retry_seconds is null or _retry_seconds not between 0 and 86400 then
    raise exception 'ssx_checkpoint_result_invalid' using errcode='22023';
  end if;
  select * into v from public.ssx_sync_checkpoints where integration_account_id=_account_id
    and resource=_resource and scope_key=_scope_key for update;
  if not found or v.status<>'running' or v.lease_token is distinct from _lease_token
    or v.lease_until<=v_now then return false; end if;
  v_delay:=greatest(_retry_seconds,least(21600,300*power(2,least(v.attempts-1,6))::integer));
  if _error_code in ('permission_denied','invalid_schema','duplicate_external_key','provider_conflict','parameters_rejected') then
    v_delay:=greatest(v_delay,21600);
  end if;
  update public.ssx_sync_checkpoints set
    status=case when _error_code is null then 'success'
      when _error_code in ('permission_denied','invalid_schema','duplicate_external_key','provider_conflict','parameters_rejected')
      then 'attention_required' else 'failed' end,
    lease_token=null,lease_until=null,error_code=_error_code,
    result=case when _error_code is null then _result else result end,
    attempts=case when _error_code is null then 0 else attempts end,
    last_success_at=case when _error_code is null then v_now else last_success_at end,
    retry_at=case when _error_code is null then null else v_now+make_interval(secs=>v_delay) end,
    updated_at=v_now
  where integration_account_id=_account_id and resource=_resource and scope_key=_scope_key;
  return true;
end $$;
revoke all on function public.claim_ssx_sync_checkpoint_v1(uuid,text,text,integer) from public,anon,authenticated;
revoke all on function public.finish_ssx_sync_checkpoint_v1(uuid,text,text,uuid,jsonb,text,integer) from public,anon,authenticated;
grant execute on function public.claim_ssx_sync_checkpoint_v1(uuid,text,text,integer) to service_role;
grant execute on function public.finish_ssx_sync_checkpoint_v1(uuid,text,text,uuid,jsonb,text,integer) to service_role;
