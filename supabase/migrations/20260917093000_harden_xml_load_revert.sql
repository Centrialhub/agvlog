create or replace function public.revert_xml_loads_to_available(_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _load_ids uuid[] := array[]::uuid[];
  _affected_trip_ids uuid[] := array[]::uuid[];
  _trip_ids uuid[] := array[]::uuid[];
  _dispatch_events_count integer := 0;
  _dispatch_stops_count integer := 0;
  _dispatch_stop_docs_count integer := 0;
  _dispatch_trip_loads_count integer := 0;
  _dispatch_trips_count integer := 0;
  _loads_updated_count integer := 0;
  _drafts_updated_count integer := 0;
  _result jsonb;
begin
  if not (auth.role() = 'service_role' or public.is_tenant_admin(_tenant_id)) then
    raise exception 'Apenas administradores do tenant podem reverter cargas de XML';
  end if;

  select coalesce(array_agg(distinct li.load_id), array[]::uuid[])
  into _load_ids
  from public.load_items li
  where li.tenant_id = _tenant_id
    and li.load_id is not null
    and li.fiscal_document_id is not null;

  if cardinality(_load_ids) = 0 then
    return jsonb_build_object(
      'message', 'Nenhum load de XML encontrado para reverter',
      'loads_updated', 0,
      'trips_removed', 0,
      'stops_removed', 0,
      'events_removed', 0,
      'trip_loads_removed', 0,
      'stop_docs_removed', 0,
      'drafts_reset', 0
    );
  end if;

  -- Discover trips through both the legacy singular reference and the canonical
  -- many-load relationship.
  select coalesce(array_agg(distinct linked.trip_id), array[]::uuid[])
  into _affected_trip_ids
  from (
    select dt.id as trip_id
    from public.dispatch_trips dt
    where dt.tenant_id = _tenant_id
      and dt.load_id = any(_load_ids)
    union
    select dtl.dispatch_trip_id
    from public.dispatch_trip_loads dtl
    where dtl.tenant_id = _tenant_id
      and dtl.load_id = any(_load_ids)
  ) linked;

  -- A trip is removable only when every load associated with it belongs to the
  -- XML set. Mixed trips are preserved.
  select coalesce(array_agg(affected.trip_id), array[]::uuid[])
  into _trip_ids
  from unnest(_affected_trip_ids) as affected(trip_id)
  where not exists (
    select 1
    from (
      select dt.load_id
      from public.dispatch_trips dt
      where dt.tenant_id = _tenant_id
        and dt.id = affected.trip_id
        and dt.load_id is not null
      union
      select dtl.load_id
      from public.dispatch_trip_loads dtl
      where dtl.tenant_id = _tenant_id
        and dtl.dispatch_trip_id = affected.trip_id
    ) trip_load
    where not (trip_load.load_id = any(_load_ids))
  );

  -- When a mixed trip points at an XML load through the legacy column, retain a
  -- remaining non-XML load as its compatibility reference.
  update public.dispatch_trips dt
  set load_id = (
        select dtl.load_id
        from public.dispatch_trip_loads dtl
        where dtl.tenant_id = _tenant_id
          and dtl.dispatch_trip_id = dt.id
          and not (dtl.load_id = any(_load_ids))
        order by dtl.created_at, dtl.id
        limit 1
      ),
      updated_at = now()
  where dt.tenant_id = _tenant_id
    and dt.id = any(_affected_trip_ids)
    and not (dt.id = any(_trip_ids))
    and dt.load_id = any(_load_ids);

  if cardinality(_affected_trip_ids) > 0 then
    delete from public.dispatch_stop_documents dsd
    using public.dispatch_stops ds
    where dsd.tenant_id = _tenant_id
      and ds.tenant_id = _tenant_id
      and dsd.dispatch_stop_id = ds.id
      and ds.dispatch_trip_id = any(_affected_trip_ids)
      and (
        ds.dispatch_trip_id = any(_trip_ids)
        or dsd.load_id = any(_load_ids)
        or exists (
          select 1
          from public.load_items li
          where li.tenant_id = _tenant_id
            and li.load_id = any(_load_ids)
            and li.fiscal_document_id = dsd.fiscal_document_id
        )
      );
    get diagnostics _dispatch_stop_docs_count = row_count;

    delete from public.dispatch_trip_loads dtl
    where dtl.tenant_id = _tenant_id
      and dtl.dispatch_trip_id = any(_affected_trip_ids)
      and (dtl.dispatch_trip_id = any(_trip_ids) or dtl.load_id = any(_load_ids));
    get diagnostics _dispatch_trip_loads_count = row_count;
  end if;

  if cardinality(_trip_ids) > 0 then
    delete from public.dispatch_events
    where tenant_id = _tenant_id
      and dispatch_trip_id = any(_trip_ids);
    get diagnostics _dispatch_events_count = row_count;

    delete from public.dispatch_stops
    where tenant_id = _tenant_id
      and dispatch_trip_id = any(_trip_ids);
    get diagnostics _dispatch_stops_count = row_count;

    delete from public.dispatch_trips
    where tenant_id = _tenant_id
      and id = any(_trip_ids);
    get diagnostics _dispatch_trips_count = row_count;
  end if;

  update public.loads
  set status = 'planned',
      trip_id = null,
      vehicle_id = null,
      driver_id = null,
      updated_at = now()
  where tenant_id = _tenant_id
    and id = any(_load_ids)
    and (status <> 'planned' or trip_id is not null or vehicle_id is not null or driver_id is not null);
  get diagnostics _loads_updated_count = row_count;

  update public.route_planning_drafts
  set status = 'draft',
      converted_load_id = null,
      updated_at = now()
  where tenant_id = _tenant_id
    and status = 'dispatched'
    and converted_load_id = any(_load_ids);
  get diagnostics _drafts_updated_count = row_count;

  _result := jsonb_build_object(
    'message', 'XMLs revertidos para carga disponível com sucesso',
    'loads_updated', _loads_updated_count,
    'trips_removed', _dispatch_trips_count,
    'stops_removed', _dispatch_stops_count,
    'events_removed', _dispatch_events_count,
    'trip_loads_removed', _dispatch_trip_loads_count,
    'stop_docs_removed', _dispatch_stop_docs_count,
    'drafts_reset', _drafts_updated_count,
    'affected_load_ids', _load_ids,
    'affected_trip_ids', _affected_trip_ids,
    'removed_trip_ids', _trip_ids
  );

  insert into public.entity_audit_log (
    id, tenant_id, entity_type, entity_id, action, old_data, new_data,
    actor_user_id, actor_role, source, request_id, created_at
  ) values (
    gen_random_uuid(), _tenant_id, 'tenant', _tenant_id,
    'revert_xml_loads_to_available',
    jsonb_build_object('affected_load_ids', _load_ids, 'affected_trip_ids', _affected_trip_ids),
    _result,
    auth.uid(),
    case when auth.role() = 'service_role' then 'service_role' else 'admin' end,
    'settings_maintenance',
    gen_random_uuid()::text,
    now()
  );

  return _result;
end;
$function$;

revoke all on function public.revert_xml_loads_to_available(uuid) from public, anon;
grant execute on function public.revert_xml_loads_to_available(uuid) to authenticated, service_role;
