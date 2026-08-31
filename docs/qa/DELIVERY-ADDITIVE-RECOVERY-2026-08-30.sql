-- Run only after reverting the legacy cutover/frontend. No business rows are deleted.
-- If new delivery events exist, quarantine API access and keep functions/index/history
-- for investigation and roll-forward; do not discard committed idempotency evidence.
set local lock_timeout='3s';
set local statement_timeout='20s';
do $recovery$
declare v_contract record;
begin
  for v_contract in select * from (values
    ('public.driver_finalize_delivery(uuid,text,text,text[],text,text,text)','4763cb11f881c831b3b632c58018b71d'),
    ('public.driver_update_stop_status(uuid,text,text)','bc46a754cd9e3f9d688b80292d4837dc'),
    ('public.finalize_driver_delivery(uuid,text,text,text[],uuid)','fa2466240c273dee0aa0e9e74c91ff1e'),
    ('public.derive_trip_and_load_status_v1(uuid,uuid)','8c2b9d7ee1dbac08dc3a80fab68aff59'),
    ('public.transition_stop_status_v1(uuid,uuid,text,uuid,text,text,jsonb)','4aaa78a290e6ad9e8ce1ced7396f374d')
  ) expected(signature,hash) loop
    if md5(pg_get_functiondef(to_regprocedure(v_contract.signature))) is distinct from v_contract.hash then
      raise exception 'Restore/verify legacy contracts before additive recovery: %',v_contract.signature;
    end if;
  end loop;
  if exists(select 1 from public.dispatch_events
    where payload ? 'delivery_request' and event_type in('delivery_note','delivery_delivered','stop_partial_delivery',
      'stop_returned','stop_refused','stop_failed','stop_skipped','stop_cancelled')) then
    revoke all on function public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text) from public,anon,authenticated,service_role;
    revoke all on function public.driver_record_delivery_note(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
    revoke all on function public.driver_finalize_delivery(uuid,text,text,text[],text,text,text) from public,anon,authenticated,service_role;
    revoke all on function public.driver_update_stop_status(uuid,text,text) from public,anon,authenticated,service_role;
    revoke all on function public.finalize_driver_delivery(uuid,text,text,text[],uuid) from public,anon,authenticated,service_role;
    revoke all on function public.transition_stop_status_v1(uuid,uuid,text,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
    revoke all on function public.derive_trip_and_load_status_v1(uuid,uuid) from public,anon,authenticated,service_role;
    raise notice 'Delivery APIs quarantined. Committed events/proofs and idempotency index preserved; investigate and roll forward.';
  else
    if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prokind='f'
        and p.proname not in('driver_record_delivery_outcome','driver_record_delivery_note',
          '_lock_delivery_trip_graph','_lock_driver_delivery_stop','_delivery_result_from_statuses','_derive_driver_delivery_result')
        and p.prosrc ~ '(driver_record_delivery_outcome|driver_record_delivery_note|_derive_driver_delivery_result|_lock_driver_delivery_stop|_lock_delivery_trip_graph|_delivery_result_from_statuses)') then
      raise exception 'Unexpected caller of additive delivery functions; inspect dependencies before recovery';
    end if;
    drop function public.driver_record_delivery_note(uuid,text,jsonb,uuid);
    drop function public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text);
    drop function public._derive_driver_delivery_result(uuid,uuid);
    drop function public._lock_driver_delivery_stop(uuid);
    drop function public._lock_delivery_trip_graph(uuid,uuid);
    drop function public._delivery_result_from_statuses(text[]);
    drop index public.dispatch_events_delivery_request_key_idx;
  end if;
end;
$recovery$;
