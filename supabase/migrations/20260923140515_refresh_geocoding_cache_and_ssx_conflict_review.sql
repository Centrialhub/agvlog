-- Prior cache entries may contain only the first requested candidate. Rebuild
-- them from full provider responses after the matching Edge Function deploy.
delete from public.address_geocoding_cache;

drop index if exists public.idx_ssx_mapping_conflicts_review;
create index idx_ssx_mapping_conflicts_review
  on public.ssx_mapping_conflicts (tenant_id, status, due_at, first_observed_at, id);

create or replace function public.list_ssx_mapping_conflicts_v2(
  _tenant_id uuid,
  _status text default 'open',
  _limit integer default 200,
  _cursor jsonb default null,
  _snapshot_at timestamptz default null
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $function$
declare
  v_snapshot timestamptz := coalesce(_snapshot_at, clock_timestamp());
  v_due_at timestamptz;
  v_first_observed_at timestamptz;
  v_id uuid;
  v_items jsonb;
  v_last jsonb;
begin
  if auth.uid() is null or private.request_tenant_id() is distinct from _tenant_id
    or not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if _status not in ('open', 'resolved', 'all') or _limit not between 1 and 200 then
    raise exception 'invalid_conflict_query' using errcode = '22023';
  end if;
  if _cursor is not null then
    if jsonb_typeof(_cursor) <> 'object' then
      raise exception 'invalid_conflict_cursor' using errcode = '22023';
    end if;
    begin
      v_due_at := (_cursor->>'due_at')::timestamptz;
      v_first_observed_at := (_cursor->>'first_observed_at')::timestamptz;
      v_id := (_cursor->>'id')::uuid;
    exception when others then
      raise exception 'invalid_conflict_cursor' using errcode = '22023';
    end;
    if v_due_at is null or v_first_observed_at is null or v_id is null then
      raise exception 'invalid_conflict_cursor' using errcode = '22023';
    end if;
  end if;

  select coalesce(jsonb_agg(page.row_payload order by page.due_at, page.first_observed_at, page.id), '[]'::jsonb)
  into v_items
  from (
    select conflict.due_at, conflict.first_observed_at, conflict.id,
      to_jsonb(conflict) || jsonb_build_object(
        'candidate_vehicles', coalesce((
          select jsonb_agg(jsonb_build_object('id', vehicle.id, 'plate', vehicle.plate, 'nickname', vehicle.nickname)
            order by vehicle.plate, vehicle.id)
          from public.vehicles vehicle
          where vehicle.id = any(conflict.candidate_vehicle_ids)
            and vehicle.tenant_id = conflict.tenant_id
        ), '[]'::jsonb),
        'linked_vehicle', (
          select jsonb_build_object('id', vehicle.id, 'plate', vehicle.plate, 'nickname', vehicle.nickname)
          from public.vehicles vehicle
          where vehicle.id = conflict.linked_vehicle_id and vehicle.tenant_id = conflict.tenant_id
        )
      ) as row_payload
    from public.ssx_mapping_conflicts conflict
    where conflict.tenant_id = _tenant_id
      and (_status = 'all' or conflict.status = _status)
      and conflict.created_at <= v_snapshot
      and (_cursor is null or (conflict.due_at, conflict.first_observed_at, conflict.id)
        > (v_due_at, v_first_observed_at, v_id))
    order by conflict.due_at, conflict.first_observed_at, conflict.id
    limit _limit
  ) page;
  if jsonb_array_length(v_items) = _limit then
    v_last := v_items -> (jsonb_array_length(v_items) - 1);
  end if;
  return jsonb_build_object(
    'items', v_items,
    'snapshot_at', v_snapshot,
    'next_cursor', case when v_last is null then null else jsonb_build_object(
      'due_at', v_last->>'due_at',
      'first_observed_at', v_last->>'first_observed_at',
      'id', v_last->>'id'
    ) end
  );
end;
$function$;

revoke all on function public.list_ssx_mapping_conflicts_v2(uuid,text,integer,jsonb,timestamptz) from public, anon;
grant execute on function public.list_ssx_mapping_conflicts_v2(uuid,text,integer,jsonb,timestamptz) to authenticated;

alter table public.ssx_mapping_conflicts
  add column resolution_request_id uuid,
  add column resolution_result jsonb;
create unique index uq_ssx_mapping_conflicts_resolution_request
  on public.ssx_mapping_conflicts (resolution_request_id)
  where resolution_request_id is not null;

create or replace function public.resolve_ssx_mapping_conflict_v2(
  _conflict_id uuid,
  _vehicle_id uuid,
  _reason text,
  _request_id uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_conflict public.ssx_mapping_conflicts%rowtype;
  v_result jsonb;
begin
  if auth.uid() is null or private.request_tenant_id() is null or _request_id is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into v_conflict
  from public.ssx_mapping_conflicts
  where id = _conflict_id and tenant_id = private.request_tenant_id()
  for update;
  if not found then raise exception 'mapping_conflict_not_found' using errcode = 'P0002'; end if;
  if not public.is_tenant_operator_or_admin(v_conflict.tenant_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_conflict.resolution_request_id = _request_id then
    if v_conflict.resolved_by is distinct from auth.uid()
      or v_conflict.resolved_vehicle_id is distinct from _vehicle_id
      or v_conflict.resolution_reason is distinct from btrim(_reason) then
      raise exception 'resolution_request_mismatch' using errcode = '23514';
    end if;
    return v_conflict.resolution_result;
  end if;
  v_result := public.resolve_ssx_mapping_conflict_v1(_conflict_id, _vehicle_id, _reason);
  update public.ssx_mapping_conflicts
  set resolution_request_id = _request_id, resolution_result = v_result
  where id = _conflict_id;
  return v_result;
end;
$function$;

revoke all on function public.resolve_ssx_mapping_conflict_v2(uuid,uuid,text,uuid) from public, anon;
grant execute on function public.resolve_ssx_mapping_conflict_v2(uuid,uuid,text,uuid) to authenticated;
