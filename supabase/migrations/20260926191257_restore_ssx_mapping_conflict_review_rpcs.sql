-- Restore only the public SSX review RPCs required by the published client.
-- The original migration also deletes the geocoding cache; replaying it here is unsafe.
do $preflight$
begin
  if to_regclass('public.ssx_mapping_conflicts') is null
    or to_regclass('public.vehicles') is null
    or to_regprocedure('auth.uid()') is null
    or to_regprocedure('private.request_tenant_id()') is null
    or to_regprocedure('public.is_tenant_operator_or_admin(uuid)') is null
    or to_regprocedure('public.resolve_ssx_mapping_conflict_v1(uuid,uuid,text)') is null then
    raise exception 'ssx_review_dependencies_missing' using errcode = '55000';
  end if;
  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.ssx_mapping_conflicts'::regclass
      and attname in ('resolution_request_id','resolution_result')
      and not attisdropped
      and (attname = 'resolution_request_id' and atttypid <> 'uuid'::regtype
        or attname = 'resolution_result' and atttypid <> 'jsonb'::regtype)
  ) then raise exception 'ssx_review_columns_incompatible' using errcode = '55000'; end if;
end;
$preflight$;

alter table public.ssx_mapping_conflicts
  add column if not exists resolution_request_id uuid,
  add column if not exists resolution_result jsonb;
-- The published idx_ssx_mapping_conflicts_review has only the first four
-- columns. Use a new name so IF NOT EXISTS cannot silently retain that shape.
create index if not exists idx_ssx_mapping_conflicts_review_v2
  on public.ssx_mapping_conflicts (tenant_id, status, due_at, first_observed_at, id);
do $index_contract$
begin
  if not exists (
    select 1 from pg_index i
    where i.indexrelid = to_regclass('public.idx_ssx_mapping_conflicts_review_v2')
      and i.indisvalid and i.indisready
      and pg_get_indexdef(i.indexrelid) =
        'CREATE INDEX idx_ssx_mapping_conflicts_review_v2 ON public.ssx_mapping_conflicts USING btree (tenant_id, status, due_at, first_observed_at, id)'
  ) then
    raise exception 'ssx_review_index_contract_changed' using errcode = '55000';
  end if;
end;
$index_contract$;
create unique index if not exists uq_ssx_mapping_conflicts_resolution_request
  on public.ssx_mapping_conflicts (resolution_request_id)
  where resolution_request_id is not null;

do $install_0$
begin
  if to_regprocedure('public.list_ssx_mapping_conflicts_v2(uuid,text,integer,jsonb,timestamptz)') is null then
    execute $ddl_0$
create function public.list_ssx_mapping_conflicts_v2(
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
$ddl_0$;
    revoke all on function public.list_ssx_mapping_conflicts_v2(uuid,text,integer,jsonb,timestamptz) from public, anon, authenticated, service_role;
    grant execute on function public.list_ssx_mapping_conflicts_v2(uuid,text,integer,jsonb,timestamptz) to authenticated;
  end if;
end;
$install_0$;

do $install_1$
begin
  if to_regprocedure('public.resolve_ssx_mapping_conflict_v2(uuid,uuid,text,uuid)') is null then
    execute $ddl_1$
create function public.resolve_ssx_mapping_conflict_v2(
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
$ddl_1$;
    revoke all on function public.resolve_ssx_mapping_conflict_v2(uuid,uuid,text,uuid) from public, anon, authenticated, service_role;
    grant execute on function public.resolve_ssx_mapping_conflict_v2(uuid,uuid,text,uuid) to authenticated;
  end if;
end;
$install_1$;
