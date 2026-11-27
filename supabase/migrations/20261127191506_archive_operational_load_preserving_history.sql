-- Administrative removal preserves fiscal documents, cargo checks and trip links.
-- This maintenance entry point is deliberately NOT a client RPC.
begin;
alter table public.loads add column operational_archived_at timestamptz;
create table private.operational_load_archives (
 tenant_id uuid not null,
 load_id uuid primary key references public.loads(id) on delete restrict,
 expected_version integer not null,
 reason text not null check(length(btrim(reason)) between 10 and 2000),
 archived_at timestamptz not null default clock_timestamp(),
 database_actor text not null default session_user,
 before_snapshot jsonb not null
);
alter table private.operational_load_archives enable row level security;
revoke all on private.operational_load_archives from public,anon,authenticated,service_role;

create function private.guard_operational_load_archive() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='operational_load_archives' then
  raise exception 'operational_load_archive_history_immutable' using errcode='55000';
 end if;
 if tg_op<>'INSERT' and old.operational_archived_at is not null then
  raise exception 'operational_load_archived' using errcode='55000';
 end if;
 if tg_op='DELETE' then return old;end if;
 if new.operational_archived_at is not null and not exists(
  select 1 from private.operational_load_archives a where a.load_id=new.id
   and a.tenant_id=new.tenant_id and a.archived_at=new.operational_archived_at
 ) then raise exception 'operational_load_archive_requires_audit' using errcode='55000';end if;
 return new;
end $$;
revoke all on function private.guard_operational_load_archive() from public,anon,authenticated,service_role;
create trigger guard_operational_load_archive before insert or update or delete on public.loads
 for each row execute function private.guard_operational_load_archive();
create trigger preserve_operational_load_archive before update or delete on private.operational_load_archives
 for each row execute function private.guard_operational_load_archive();
create policy operational_load_active_listing on public.loads as restrictive
 for select to authenticated using (operational_archived_at is null);

create function private.archive_non_jmacedo_load_for_cleanup(
 _tenant_id uuid,_load_id uuid,_expected_version integer,_reason text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare l public.loads%rowtype; a private.operational_load_archives%rowtype;
 trip_ids uuid[]; journey_ids uuid[]; trip uuid; before_data jsonb;
begin
 if current_user <> 'postgres' then raise exception 'maintenance_access_denied' using errcode='42501';end if;
 if _tenant_id is null or _load_id is null or _expected_version is null
  or length(btrim(coalesce(_reason,''))) not between 10 and 2000 then
  raise exception 'invalid_archive_request' using errcode='22023';end if;
 select * into l from public.loads where id=_load_id and tenant_id=_tenant_id for update nowait;
 if not found then raise exception 'load_not_found' using errcode='22023';end if;
 select * into a from private.operational_load_archives where load_id=_load_id;
 if found then
  if a.tenant_id is distinct from _tenant_id or a.expected_version<>_expected_version or a.reason<>btrim(_reason) then
   raise exception 'archive_request_conflict' using errcode='22023';end if;
  return jsonb_build_object('load_id',_load_id,'archived',true,'replayed',true);
 end if;
 if l.version<>_expected_version then raise exception 'load_revision_conflict' using errcode='40001';end if;
 perform id from public.fiscal_documents where load_id=_load_id order by id for update nowait;
 if exists(select 1 from public.fiscal_documents f where f.load_id=_load_id and
  (f.tenant_id is distinct from _tenant_id or regexp_replace(coalesce(f.remitter_cnpj,''),'[^0-9]','','g') in
    ('14998371003134','14998371003215'))) then
  raise exception 'preserved_jmacedo_or_tenant_mismatch' using errcode='55000';end if;
 -- Completed delivery and financial workflows require their own correction API.
 if exists(select 1 from public.proof_of_delivery where load_id=_load_id)
  or exists(select 1 from public.delivery_document_outcomes where load_id=_load_id)
  or exists(select 1 from public.payables where load_id=_load_id)
  or exists(select 1 from public.receivables where load_id=_load_id)
  or exists(select 1 from public.load_payments where load_id=_load_id)
  or exists(select 1 from public.driver_settlement_loads where load_id=_load_id)
 then raise exception 'archive_requires_delivery_or_finance_correction' using errcode='55000';end if;
 select coalesce(array_agg(distinct x order by x),array[]::uuid[]) into trip_ids from (
  select l.trip_id x union select dispatch_trip_id from public.dispatch_trip_loads where load_id=_load_id
  union select id from public.dispatch_trips where load_id=_load_id
 ) s where x is not null;
 foreach trip in array trip_ids loop
  perform id from public.dispatch_trips where id=trip and tenant_id=_tenant_id for update nowait;
  if not found then raise exception 'archive_trip_tenant_mismatch' using errcode='55000';end if;
  perform id from public.dispatch_trip_loads where dispatch_trip_id=trip order by id for update nowait;
  if exists(select 1 from public.dispatch_trip_loads where dispatch_trip_id=trip and load_id<>_load_id)
   or exists(select 1 from public.loads where trip_id=trip and id<>_load_id)
   or exists(select 1 from public.dispatch_trips where id=trip and load_id is not null and load_id<>_load_id)
  then raise exception 'archive_shared_trip_requires_replanning' using errcode='55000';end if;
  perform id from public.dispatch_stops where dispatch_trip_id=trip order by id for update nowait;
 end loop;
 select coalesce(array_agg(distinct physical_journey_id order by physical_journey_id),array[]::uuid[])
  into journey_ids from public.physical_journey_trips where dispatch_trip_id=any(trip_ids);
 perform id from public.physical_journeys where id=any(journey_ids) order by id for update nowait;
 perform physical_journey_id from public.physical_journey_trips where physical_journey_id=any(journey_ids)
  order by physical_journey_id,dispatch_trip_id for update nowait;
 if exists(select 1 from public.physical_journey_trips where physical_journey_id=any(journey_ids)
  and not(dispatch_trip_id=any(trip_ids))) then
  raise exception 'archive_shared_journey_requires_replanning' using errcode='55000';end if;
 before_data:=jsonb_build_object('load',to_jsonb(l),
  'documents',coalesce((select jsonb_agg(to_jsonb(f) order by id) from public.fiscal_documents f where load_id=_load_id),'[]'::jsonb),
  'trips',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.dispatch_trips t where id=any(trip_ids)),'[]'::jsonb),
  'stops',coalesce((select jsonb_agg(to_jsonb(s) order by id) from public.dispatch_stops s where dispatch_trip_id=any(trip_ids)),'[]'::jsonb),
  'journeys',coalesce((select jsonb_agg(to_jsonb(j) order by id) from public.physical_journeys j where id=any(journey_ids)),'[]'::jsonb));
 insert into private.operational_load_archives(tenant_id,load_id,expected_version,reason,before_snapshot)
 values(_tenant_id,_load_id,_expected_version,btrim(_reason),before_data) returning * into a;
 -- Changing the load first keeps the deferred transit graph consistent.
 update public.loads set status='cancelled',operational_archived_at=a.archived_at,updated_at=clock_timestamp()
  where id=_load_id and tenant_id=_tenant_id;
 update public.dispatch_stops set status='cancelled',updated_at=clock_timestamp()
  where dispatch_trip_id=any(trip_ids) and tenant_id=_tenant_id
   and actual_arrival_at is null and actual_departure_at is null
   and status not in('completed','delivered','cancelled','skipped','refused','returned','partial_delivery','failed');
 update public.dispatch_trips set status='cancelled',updated_at=clock_timestamp()
  where id=any(trip_ids) and tenant_id=_tenant_id and status not in('cancelled','completed','delivered','finished');
 update public.physical_journeys set status='cancelled',updated_at=clock_timestamp()
  where id=any(journey_ids) and status in('planned','active');
 return jsonb_build_object('load_id',_load_id,'archived',true,'replayed',false,
  'fiscal_documents_unchanged',true,'history_preserved',true);
exception when lock_not_available then raise exception 'archive_concurrent_change' using errcode='40001';
end $$;
revoke all on function private.archive_non_jmacedo_load_for_cleanup(uuid,uuid,integer,text)
 from public,anon,authenticated,service_role;
commit;
