create or replace function public.attach_loads_to_driver_settlement(
  _settlement_id uuid,
  _load_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_s public.driver_settlements;
  v_load uuid;
  v_load_ids uuid[];
  v_row_count integer;
  v_inserted integer := 0;
begin
  select *
  into v_s
  from public.driver_settlements
  where id = _settlement_id
  for update;

  if not found then raise exception 'settlement_not_found'; end if;
  if auth.role() <> 'service_role'
     and not public.is_tenant_operator_or_admin(v_s.tenant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not v_s.is_manual then raise exception 'not_manual_settlement'; end if;
  if v_s.status not in ('pending_review','in_review','reopened') then
    raise exception 'settlement_locked';
  end if;

  if _load_ids is null or array_length(_load_ids, 1) is null then return; end if;

  if exists (select 1 from unnest(_load_ids) as requested(load_id) where requested.load_id is null) then
    raise exception 'cross_tenant_or_missing_load' using errcode = '42501';
  end if;
  select array_agg(distinct requested.load_id order by requested.load_id)
  into v_load_ids
  from unnest(_load_ids) as requested(load_id);

  perform l.id
  from public.loads l
  where l.id = any (v_load_ids)
  for update;

  if exists (
    select 1
    from unnest(v_load_ids) as requested(load_id)
    where not exists (
      select 1
      from public.loads l
      where l.id = requested.load_id
        and l.tenant_id = v_s.tenant_id
    )
  ) then
    raise exception 'cross_tenant_or_missing_load' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.loads l
    where l.id = any (v_load_ids)
      and l.tenant_id = v_s.tenant_id
      and l.driver_id is distinct from v_s.driver_id
  ) then
    raise exception 'load_driver_mismatch' using errcode = '22023';
  end if;

  foreach v_load in array v_load_ids loop
    if not public._load_available_for_settlement(v_s.tenant_id, v_load, _settlement_id) then
      raise exception 'load_already_linked: %', v_load;
    end if;
    insert into public.driver_settlement_loads(
      tenant_id, settlement_id, load_id, created_by
    )
    values (v_s.tenant_id, _settlement_id, v_load, auth.uid())
    on conflict (load_id) do nothing;
    get diagnostics v_row_count = row_count;
    v_inserted := v_inserted + v_row_count;
  end loop;

  if v_inserted = 0 then
    raise exception 'loads_already_attached' using errcode = '22023';
  end if;

  perform public._log_settlement_event(
    _settlement_id,
    'loads_attached',
    null,
    null,
    null,
    jsonb_build_object('count', v_inserted)
  );
  perform public._build_manual_driver_settlement(_settlement_id);
end;
$function$;

revoke all on function public.attach_loads_to_driver_settlement(uuid,uuid[]) from public,anon;
grant execute on function public.attach_loads_to_driver_settlement(uuid,uuid[]) to authenticated,service_role;
