-- Local additive forward: v1 and v2 interfaces/ACLs are preserved.
set local lock_timeout = '3s';
set local statement_timeout = '15s';

create function public.commit_ssx_rule_violation_window_v3(
  _integration_account_id uuid, _lease_token uuid,
  _expected_last_position_id bigint, _end_position_id bigint,
  _window_end_position_id bigint, _items jsonb,
  _observed_at timestamptz default clock_timestamp()
) returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare
  v_gate public.ssx_sync_checkpoints;
  v_current bigint;
  v_count integer := 0;
  v_offset integer := 0;
  v_batch jsonb;
  v_size integer;
begin
  -- 32 provider requests yield at most 16 completed leaves of <=499 items
  -- (7984). Keep the existing 8MiB total ceiling; never raise v1 batch limits.
  if _integration_account_id is null or _lease_token is null
    or _expected_last_position_id is null or _expected_last_position_id < 0
    or _end_position_id is null or _end_position_id < 0
    or _window_end_position_id is null or _window_end_position_id < _end_position_id
    or _items is null or pg_catalog.jsonb_typeof(_items) <> 'array'
    or pg_catalog.jsonb_array_length(_items) > 8000
    or pg_catalog.octet_length(_items::text) > 8388608
    or _observed_at is null or not pg_catalog.isfinite(_observed_at)
    or _observed_at > pg_catalog.clock_timestamp() + interval '5 minutes' then
    raise exception 'ssx_violation_commit_invalid' using errcode = '22023';
  end if;
  select * into v_gate from public.ssx_sync_checkpoints
    where integration_account_id = _integration_account_id
      and resource = 'rule_violations_gate' and scope_key = '' for update;
  if not found or v_gate.status <> 'running'
    or v_gate.lease_token is distinct from _lease_token
    or v_gate.lease_until is null or v_gate.lease_until <= pg_catalog.clock_timestamp() then
    return pg_catalog.jsonb_build_object('committed',false,'upserted',0);
  end if;
  select last_position_id into v_current from public.ssx_rule_violation_cursors
    where integration_account_id = _integration_account_id for update;
  if not found or v_current <> _expected_last_position_id then
    return pg_catalog.jsonb_build_object('committed',false,'upserted',0);
  end if;
  -- Also enforce the legacy account/observation contract on an empty window.
  perform public.upsert_ssx_rule_violations_v1(_integration_account_id,'[]'::jsonb,_observed_at);
  v_size := pg_catalog.jsonb_array_length(_items);
  while v_offset < v_size loop
    select pg_catalog.jsonb_agg(value order by ordinality) into v_batch
    from pg_catalog.jsonb_array_elements(_items) with ordinality
    where ordinality > v_offset and ordinality <= v_offset + 1000;
    v_count := v_count + public.upsert_ssx_rule_violations_v1(
      _integration_account_id,v_batch,_observed_at
    );
    v_offset := v_offset + 1000;
  end loop;
  if not public.ack_ssx_rule_violation_window_v1(
    _integration_account_id,_expected_last_position_id,_end_position_id,true,null
  ) then
    raise exception 'ssx_violation_cursor_conflict' using errcode = 'P0001';
  end if;
  if not public.finish_ssx_sync_checkpoint_v1(
    _integration_account_id,'rule_violations_gate','',_lease_token,
    pg_catalog.jsonb_build_object(
      'version',3,'upserted',v_count,'cursor_advanced',true,
      'cursor_position_id',greatest(v_current,_end_position_id)::text,
      'resume_position_id',case when _end_position_id < _window_end_position_id
        then (_end_position_id + 1)::text else null end,
      'window_end_position_id',_window_end_position_id::text
    ),null,0
  ) then
    -- Any late-batch/ACK/lease failure rolls back all batches and pagination.
    raise exception 'ssx_violation_lease_lost' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object('committed',true,'upserted',v_count);
end $function$;

revoke all on function public.commit_ssx_rule_violation_window_v3(uuid,uuid,bigint,bigint,bigint,jsonb,timestamptz)
  from public,anon,authenticated;
grant execute on function public.commit_ssx_rule_violation_window_v3(uuid,uuid,bigint,bigint,bigint,jsonb,timestamptz)
  to service_role;
