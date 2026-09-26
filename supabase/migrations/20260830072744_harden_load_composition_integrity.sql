-- Composition integrity candidate. No grants are broadened and no rows are repaired/deleted by this migration.
set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$
declare v_contract record;v_oid oid;
begin
  for v_contract in select * from(values
    ('public._load_is_locked(uuid)','e77c73ef2b708130f34da83c2830c478',false,true),
    ('public.move_load_items_between_loads(uuid,uuid,uuid,uuid[])','7426489e533d6eecb3335dcd5bc1c8dd',true,true),
    ('public.recalc_load_totals()','87b2082210a98ec8b9447543b6092e8e',false,true),
    ('public.delete_load_if_empty(uuid)','242330e8795383f6d9e66cdb4cd83b3a',false,true)
  ) expected(signature,hash,authenticated,service_role) loop
    v_oid:=to_regprocedure(v_contract.signature);
    if md5(replace(pg_get_functiondef(v_oid),E'\r\n',E'\n')) is distinct from v_contract.hash
      or has_function_privilege('anon',v_oid,'execute')
      or has_function_privilege('authenticated',v_oid,'execute') is distinct from v_contract.authenticated
      or has_function_privilege('service_role',v_oid,'execute') is distinct from v_contract.service_role then
      raise exception 'Composition contract changed: %',v_contract.signature;
    end if;
  end loop;
  if not exists(select 1 from pg_trigger where tgrelid='public.load_items'::regclass and tgname='trg_recalc_load_totals'
    and tgfoid='public.recalc_load_totals()'::regprocedure and tgtype=29 and tgenabled='O' and not tgisinternal
    and not tgdeferrable and tgnargs=0 and tgqual is null) then raise exception 'Composition totals trigger changed';end if;
  if md5(replace(pg_get_functiondef(to_regprocedure('public.is_tenant_operator_or_admin(uuid)')),E'\r\n',E'\n'))
    is distinct from '682f66029dc9bb798f9f329b4e8f95aa' then raise exception 'Composition authorization changed';end if;
  if exists(select 1 from public.load_items i join public.loads l on l.id=i.load_id where i.tenant_id is distinct from l.tenant_id)
    or exists(select 1 from public.load_items i join public.fiscal_documents f on f.id=i.fiscal_document_id where i.tenant_id is distinct from f.tenant_id)
    or exists(select 1 from public.load_items i join public.orders o on o.id=i.order_id where i.tenant_id is distinct from o.tenant_id) then
    raise exception 'Composition requires audited tenant reconciliation';
  end if;
end;
$preflight$;

create or replace function public._load_is_locked(_load_id uuid)
returns boolean language sql stable security definer set search_path=''
as $function$
  select exists(select 1 from public.loads l where l.id=_load_id and (
    l.status in('in_transit','delivered','partial_delivery','returned','refused','failed','cancelled')
    or exists(select 1 from public.dispatch_trips t where
      (t.load_id=l.id or exists(select 1 from public.dispatch_trip_loads link where link.dispatch_trip_id=t.id and link.load_id=l.id))
      and (t.actual_start_at is not null or t.status in('in_transit','in_progress','completed')))
  ));
$function$;
revoke all on function public._load_is_locked(uuid) from public,anon,authenticated,service_role;
grant execute on function public._load_is_locked(uuid) to service_role;

-- This existing trigger is shared by RPCs and direct API writes. Validate the
-- resulting item's tenant references and update BOTH parents in stable order.
-- Child-first legacy writers must reject conflicts, not wait in reverse order.
create or replace function public.recalc_load_totals()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_load_ids uuid[];
begin
  select array_agg(distinct id order by id) into v_load_ids
    from unnest(array[new.load_id,old.load_id]) ids(id) where id is not null;
  perform id from public.loads where id=any(v_load_ids) order by id for update nowait;
  if tg_op<>'DELETE' then
    if tg_op='UPDATE' and (new.tenant_id is distinct from old.tenant_id or new.id is distinct from old.id) then
      raise exception 'load_item_identity_immutable' using errcode='23514';
    end if;
    if not exists(select 1 from public.loads where id=new.load_id and tenant_id=new.tenant_id)
      or (new.fiscal_document_id is not null and not exists(select 1 from public.fiscal_documents where id=new.fiscal_document_id and tenant_id=new.tenant_id))
      or (new.order_id is not null and not exists(select 1 from public.orders where id=new.order_id and tenant_id=new.tenant_id)) then
      raise exception 'load_item_ownership_mismatch' using errcode='23514';
    end if;
  end if;
  update public.loads l set
    total_pallet_count=coalesce((select sum(i.pallet_count) from public.load_items i where i.load_id=l.id and i.tenant_id=l.tenant_id),0),
    total_weight_kg=coalesce((select sum(i.weight_kg) from public.load_items i where i.load_id=l.id and i.tenant_id=l.tenant_id),0),
    total_volume_m3=coalesce((select sum(i.volume_m3) from public.load_items i where i.load_id=l.id and i.tenant_id=l.tenant_id),0),
    updated_at=clock_timestamp()
    where l.id=any(v_load_ids);
  return coalesce(new,old);
exception when lock_not_available then
  raise exception 'composition_concurrent_change' using errcode='40001',hint='Atualize ambas as cargas antes de repetir a composição.';
end;
$function$;
revoke all on function public.recalc_load_totals() from public,anon,authenticated,service_role;
grant execute on function public.recalc_load_totals() to service_role;

create or replace function public.delete_load_if_empty(v_load_id uuid)
returns void language plpgsql security definer set search_path=''
as $function$
declare v_tenant_id uuid;
begin
  if v_load_id is null then return;end if;
  select tenant_id into v_tenant_id from public.loads where id=v_load_id for update nowait;
  if not found then return;end if;
  -- Documents are not the whole composition. Never delete remaining manual cargo.
  if exists(select 1 from public.load_items where load_id=v_load_id)
    or exists(select 1 from public.fiscal_documents where load_id=v_load_id and deleted_at is null and status is distinct from 'deleted') then
    return;
  end if;
  perform public.delete_load_safely(v_tenant_id,v_load_id);
exception when others then
  -- Preserve the legacy best-effort cleanup contract. Integrity/lock rejection
  -- leaves the empty load intact; it must never turn into a forced delete.
  return;
end;
$function$;
revoke all on function public.delete_load_if_empty(uuid) from public,anon,authenticated,service_role;
grant execute on function public.delete_load_if_empty(uuid) to service_role;

create or replace function public.move_load_items_between_loads(_tenant_id uuid,_source_load_id uuid,_target_load_id uuid,_item_ids uuid[])
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_actor uuid:=auth.uid();v_items uuid[];v_docs uuid[];v_actual_docs uuid[];v_roots uuid[];v_actual_roots uuid[];
  v_source_trip uuid;v_target_trip uuid;v_count int;v_moved int;v_source_removed boolean;
begin
  if v_actor is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'not_authorized' using errcode='42501';
  end if;
  if _source_load_id is null or _target_load_id is null or _source_load_id=_target_load_id
    or coalesce(cardinality(_item_ids),0)=0 or cardinality(_item_ids)<>(select count(distinct id) from unnest(_item_ids) ids(id)) then
    raise exception 'invalid_composition_request' using errcode='22023';
  end if;
  select array_agg(id order by id) into v_items from unnest(_item_ids) ids(id);
  perform tenant_id from public.tenant_memberships where tenant_id=_tenant_id and user_id=v_actor
    and active and role::text in('owner','admin','operator') for share nowait;
  if not found then raise exception 'not_authorized' using errcode='42501';end if;
  -- Acquire the same parent order as departure/delivery. Never hold child locks
  -- while waiting for another planner, allocation or composition transaction.
  select coalesce(array_agg(id order by id),array[]::uuid[]) into v_roots from (
    select trip_id id from public.loads where id in(_source_load_id,_target_load_id) and trip_id is not null
    union select dispatch_trip_id from public.dispatch_trip_loads where load_id in(_source_load_id,_target_load_id)
    union select id from public.dispatch_trips where load_id in(_source_load_id,_target_load_id)
  ) roots;
  perform id from public.dispatch_trips where id=any(v_roots) order by id for update nowait;
  perform id from public.loads where id in(_source_load_id,_target_load_id) and tenant_id=_tenant_id order by id for update nowait;
  get diagnostics v_count=row_count;
  if v_count<>2 then raise exception 'load_ownership_mismatch' using errcode='23514';end if;
  select coalesce(array_agg(id order by id),array[]::uuid[]) into v_actual_roots from (
    select trip_id id from public.loads where id in(_source_load_id,_target_load_id) and trip_id is not null
    union select dispatch_trip_id from public.dispatch_trip_loads where load_id in(_source_load_id,_target_load_id)
    union select id from public.dispatch_trips where load_id in(_source_load_id,_target_load_id)
  ) roots;
  if v_actual_roots is distinct from v_roots then raise exception 'composition_concurrent_change' using errcode='40001';end if;
  if public._load_is_locked(_source_load_id) or public._load_is_locked(_target_load_id) then
    raise exception 'load_locked' using errcode='23514';
  end if;
  if exists(select 1 from public.loads where id in(_source_load_id,_target_load_id)
    and (status is null or status not in('planned','assembling','ready','loading','loaded','divergent'))) then
    raise exception 'load_not_eligible_for_composition' using errcode='23514';
  end if;
  -- A different trip requires an explicit destination-stop/replanning request.
  -- For the SAME unstarted trip, preserve each invoice's original destination.
  select min(link.dispatch_trip_id::text)::uuid into v_source_trip from public.dispatch_trip_loads link
    join public.dispatch_trips t on t.id=link.dispatch_trip_id where link.load_id=_source_load_id and t.status is distinct from 'cancelled';
  select min(link.dispatch_trip_id::text)::uuid into v_target_trip from public.dispatch_trip_loads link
    join public.dispatch_trips t on t.id=link.dispatch_trip_id where link.load_id=_target_load_id and t.status is distinct from 'cancelled';
  if v_source_trip is distinct from v_target_trip then
    raise exception 'composition_requires_replanning' using errcode='23514';
  end if;
  if exists(select 1 from public.loads where id in(_source_load_id,_target_load_id) and trip_id is distinct from v_source_trip)
    or (v_source_trip is not null and exists(select 1 from public.dispatch_trip_loads link
      join public.dispatch_trips t on t.id=link.dispatch_trip_id where link.load_id in(_source_load_id,_target_load_id)
      and t.status is distinct from 'cancelled' and t.id<>v_source_trip)) then
    raise exception 'composition_trip_graph_mismatch' using errcode='23514';
  end if;
  select coalesce(array_agg(distinct fiscal_document_id order by fiscal_document_id) filter(where fiscal_document_id is not null),array[]::uuid[])
    into v_docs from public.load_items where id=any(v_items) and load_id=_source_load_id and tenant_id=_tenant_id;
  perform id from public.fiscal_documents where id=any(v_docs) order by id for update nowait;
  perform id from public.load_items where id=any(v_items) and load_id=_source_load_id and tenant_id=_tenant_id order by id for update nowait;
  get diagnostics v_count=row_count;
  if v_count<>cardinality(v_items) then raise exception 'composition_items_changed' using errcode='23514';end if;
  select coalesce(array_agg(distinct fiscal_document_id order by fiscal_document_id) filter(where fiscal_document_id is not null),array[]::uuid[])
    into v_actual_docs from public.load_items where id=any(v_items);
  if v_actual_docs is distinct from v_docs then raise exception 'composition_concurrent_change' using errcode='40001';end if;
  if exists(select 1 from public.load_items where fiscal_document_id=any(v_docs) and not(id=any(v_items))) then
    raise exception 'composition_document_split_not_allowed' using errcode='23514';
  end if;
  if exists(select 1 from unnest(v_docs) wanted(id) left join public.fiscal_documents f on f.id=wanted.id
    where f.id is null or f.tenant_id is distinct from _tenant_id or f.load_id is distinct from _source_load_id or f.document_type is distinct from 'inbound') then
    raise exception 'composition_document_mismatch' using errcode='23514';
  end if;
  if v_source_trip is not null and (exists(select 1 from public.dispatch_stop_documents d
    join public.dispatch_stops s on s.id=d.dispatch_stop_id where d.fiscal_document_id=any(v_docs)
      and (s.dispatch_trip_id<>v_source_trip or d.tenant_id<>_tenant_id or d.load_id<>_source_load_id))
    or exists(select 1 from unnest(v_docs) wanted(id) where (select count(*) from public.dispatch_stop_documents d
      join public.dispatch_stops s on s.id=d.dispatch_stop_id where d.fiscal_document_id=wanted.id and s.dispatch_trip_id=v_source_trip)<>1)) then
    raise exception 'composition_stop_graph_mismatch' using errcode='23514';
  end if;
  update public.load_items set load_id=_target_load_id,updated_at=clock_timestamp()
    where id=any(v_items) and tenant_id=_tenant_id and load_id=_source_load_id;
  get diagnostics v_moved=row_count;
  if v_moved<>cardinality(v_items) then raise exception 'composition_items_changed' using errcode='40001';end if;
  if v_source_trip is not null then
    update public.dispatch_stop_documents d set load_id=_target_load_id from public.dispatch_stops s
      where s.id=d.dispatch_stop_id and s.dispatch_trip_id=v_source_trip and d.fiscal_document_id=any(v_docs);
    if not exists(select 1 from public.load_items where load_id=_source_load_id) then
      delete from public.dispatch_trip_loads where dispatch_trip_id=v_source_trip and load_id=_source_load_id and tenant_id=_tenant_id;
      perform public.delete_load_if_empty(_source_load_id);
    end if;
  end if;
  select not exists(select 1 from public.loads where id=_source_load_id) into v_source_removed;
  perform public._log_entity_audit(_tenant_id,'load',_source_load_id,'move_items_out',null,
    jsonb_build_object('target_load_id',_target_load_id,'item_ids',v_items,'document_ids',v_docs,'source_removed',v_source_removed),'composition_rpc');
  perform public._log_entity_audit(_tenant_id,'load',_target_load_id,'move_items_in',null,
    jsonb_build_object('source_load_id',_source_load_id,'item_ids',v_items,'document_ids',v_docs),'composition_rpc');
  return jsonb_build_object('moved',v_moved,'source_load_id',_source_load_id,'target_load_id',_target_load_id,
    'document_ids',v_docs,'source_removed',v_source_removed);
exception when lock_not_available then
  raise exception 'composition_concurrent_change' using errcode='40001',hint='Atualize ambas as cargas e repita a movimentação completa.';
end;
$function$;
revoke all on function public.move_load_items_between_loads(uuid,uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.move_load_items_between_loads(uuid,uuid,uuid,uuid[]) to authenticated,service_role;
