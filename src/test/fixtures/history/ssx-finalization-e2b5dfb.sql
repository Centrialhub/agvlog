-- PATCH2 local forward only. Existing v1 RPCs/ACLs are preserved.
set local lock_timeout = '3s';
set local statement_timeout = '15s';

create function public.commit_ssx_rule_violation_window_v2(
  _integration_account_id uuid, _lease_token uuid,
  _expected_last_position_id bigint, _end_position_id bigint,
  _items jsonb, _observed_at timestamptz default clock_timestamp()
) returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare
  v_gate public.ssx_sync_checkpoints;
  v_current bigint;
  v_count integer;
begin
  if _integration_account_id is null or _lease_token is null
    or _expected_last_position_id is null or _expected_last_position_id < 0
    or _end_position_id is null or _end_position_id < 0
    or _items is null or pg_catalog.jsonb_typeof(_items) <> 'array' or _observed_at is null then
    raise exception 'ssx_violation_commit_invalid' using errcode='22023';
  end if;
  -- Consistent order: checkpoint -> cursor -> violations. Claim/finish also
  -- lock the checkpoint; an expired claimant cannot race this transaction.
  select * into v_gate from public.ssx_sync_checkpoints
    where integration_account_id=_integration_account_id
      and resource='rule_violations_gate' and scope_key='' for update;
  if not found or v_gate.status <> 'running'
    or v_gate.lease_token is distinct from _lease_token
    or v_gate.lease_until is null or v_gate.lease_until <= pg_catalog.clock_timestamp() then
    return pg_catalog.jsonb_build_object('committed',false,'upserted',0);
  end if;
  select last_position_id into v_current from public.ssx_rule_violation_cursors
    where integration_account_id=_integration_account_id for update;
  if not found or v_current <> _expected_last_position_id then
    return pg_catalog.jsonb_build_object('committed',false,'upserted',0);
  end if;
  v_count := public.upsert_ssx_rule_violations_v1(_integration_account_id,_items,_observed_at);
  if not public.ack_ssx_rule_violation_window_v1(
    _integration_account_id,_expected_last_position_id,_end_position_id,true,null
  ) then
    raise exception 'ssx_violation_cursor_conflict' using errcode='40001';
  end if;
  if not public.finish_ssx_sync_checkpoint_v1(
    _integration_account_id,'rule_violations_gate','',_lease_token,
    pg_catalog.jsonb_build_object('upserted',v_count,'cursor_advanced',true),null,0
  ) then
    -- Lease expiration during either write rolls back items AND the cursor.
    raise exception 'ssx_violation_lease_lost' using errcode='40001';
  end if;
  return pg_catalog.jsonb_build_object('committed',true,'upserted',v_count);
end $function$;

create function public.fail_ssx_rule_violation_window_v2(
  _integration_account_id uuid, _lease_token uuid,
  _expected_last_position_id bigint, _end_position_id bigint,
  _error_code text, _retry_seconds integer default 0
) returns boolean language plpgsql security invoker set search_path = '' as $function$
declare
  v_gate public.ssx_sync_checkpoints;
  v_code text;
  v_retry integer := _retry_seconds;
begin
  if _integration_account_id is null or _lease_token is null
    or _expected_last_position_id is null or _expected_last_position_id < 0
    or _end_position_id is null or _end_position_id < 0
    or _error_code is null or length(_error_code) > 100
    or _retry_seconds is null or _retry_seconds not between 0 and 86400 then
    raise exception 'ssx_violation_failure_invalid' using errcode='22023';
  end if;
  select * into v_gate from public.ssx_sync_checkpoints
    where integration_account_id=_integration_account_id
      and resource='rule_violations_gate' and scope_key='' for update;
  if not found or v_gate.status <> 'running'
    or v_gate.lease_token is distinct from _lease_token
    or v_gate.lease_until is null or v_gate.lease_until <= pg_catalog.clock_timestamp() then
    return false;
  end if;
  v_code := case when _error_code ~ '^rate_limited(:[0-9]{1,5})?$' then 'rate_limited'
    when _error_code ~ '^[a-z_]{1,64}$' then _error_code else 'request_failed' end;
  if v_code='rate_limited' then
    v_retry := greatest(v_retry,900,least(86400,
      case when _error_code like 'rate_limited:%' then split_part(_error_code,':',2)::integer else 900 end));
  end if;
  if _end_position_id > 0 then
    -- CAS may reject an independently changed cursor; never overwrite it.
    perform public.ack_ssx_rule_violation_window_v1(
      _integration_account_id,_expected_last_position_id,_end_position_id,false,_error_code
    );
  end if;
  if not public.finish_ssx_sync_checkpoint_v1(
    _integration_account_id,'rule_violations_gate','',_lease_token,'{}'::jsonb,v_code,v_retry
  ) then
    raise exception 'ssx_violation_lease_lost' using errcode='40001';
  end if;
  return true;
end $function$;

revoke all on function public.commit_ssx_rule_violation_window_v2(uuid,uuid,bigint,bigint,jsonb,timestamptz)
  from public,anon,authenticated;
revoke all on function public.fail_ssx_rule_violation_window_v2(uuid,uuid,bigint,bigint,text,integer)
  from public,anon,authenticated;
grant execute on function public.commit_ssx_rule_violation_window_v2(uuid,uuid,bigint,bigint,jsonb,timestamptz)
  to service_role;
grant execute on function public.fail_ssx_rule_violation_window_v2(uuid,uuid,bigint,bigint,text,integer)
  to service_role;
