-- Delta on reviewed 59a048bb. Only the journey lock body changes; no grants/data.
do $patch$
declare original text;definition text;metadata jsonb;revised text:=$body$
declare v_trip public.dispatch_trips%rowtype; v_expected_tenant uuid;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode = '42501'; end if;
  select * into v_trip from public.dispatch_trips where id = _trip_id;
  if not found then raise exception 'Viagem não encontrada' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.drivers d where d.id = v_trip.driver_id
    and d.tenant_id = v_trip.tenant_id and d.user_id = auth.uid() and d.active) then
    raise exception 'Acesso negado à viagem' using errcode = '42501';
  end if;
  perform private.require_driver_operation_membership_v1(v_trip.tenant_id);
  v_expected_tenant:=v_trip.tenant_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'driver_journey:' || v_trip.tenant_id::text || ':' || auth.uid()::text, 0));
  -- Revalidate ownership after waiting for the lock; assignment may have changed.
  select t.* into v_trip from public.dispatch_trips t join public.drivers d
    on d.id = t.driver_id and d.tenant_id = t.tenant_id
  where t.id = _trip_id and d.user_id = auth.uid() and d.active for share of t;
  if not found then raise exception 'Acesso negado à viagem' using errcode = '42501'; end if;
  -- The advisory key and the first membership lock belong to the discovered tenant.
  -- A reattributed trip must not return under a different operation's lock.
  if v_trip.tenant_id is distinct from v_expected_tenant then
    raise exception 'driver_journey_context_changed' using errcode='42501';
  end if;
  perform private.require_driver_operation_membership_v1(v_trip.tenant_id);
  if v_trip.status is null or v_trip.status not in
    ('planned','loading','dispatched','in_transit','in_progress','completed') then
    raise exception 'Viagem cancelada ou indisponível' using errcode = '23514';
  end if;
  return v_trip;
end;
$body$;
begin
  if not exists(select 1 from pg_proc where oid=to_regprocedure('private.require_driver_operation_membership_v1(uuid)')
    and md5(prosrc)='094c0e69e6b4c861e2d4b607a427bb23' and prosecdef and proowner='postgres'::regrole)
    or has_function_privilege('anon','private.require_driver_operation_membership_v1(uuid)','execute')
    or has_function_privilege('authenticated','private.require_driver_operation_membership_v1(uuid)','execute')
    or has_function_privilege('service_role','private.require_driver_operation_membership_v1(uuid)','execute') then
    raise exception 'driver_after_lock_helper_changed';end if;
  select prosrc,pg_get_functiondef(oid),to_jsonb(p)-'prosrc' into original,definition,metadata from pg_proc p
    where oid=to_regprocedure('public._lock_driver_journey_trip(uuid)') and proowner='postgres'::regrole
      and prosecdef and proconfig=array['search_path=""']::text[];
  if original is null or md5(original) not in('a4fcca8c7b8d3f8a1aa92036e424dff4','82b1c6bb20a2135f513f813f9b15c2e8') or md5(revised)<>'82b1c6bb20a2135f513f813f9b15c2e8' then
    raise exception 'driver_after_lock_predecessor_changed';end if;
  if md5(original)='82b1c6bb20a2135f513f813f9b15c2e8' then return;end if;
  execute replace(definition,original,revised);
  if (select to_jsonb(p)-'prosrc' from pg_proc p where oid='public._lock_driver_journey_trip(uuid)'::regprocedure) is distinct from metadata then
    raise exception 'driver_after_lock_metadata_changed';end if;
end;$patch$;
