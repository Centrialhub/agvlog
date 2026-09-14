-- LOCAL CANDIDATE ONLY. Public integration follows dependency and concurrency verification.
set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$
declare r record;p record;
begin
 for r in select * from(values
 ('public._lock_delivery_trip_graph(uuid,uuid)','5c07b2e49193e627e6d8794a638e21db',false),
 ('public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text)','ec626f9bef88dffc518bfc48fcf1ccd8',true),
 ('public.is_tenant_operator_or_admin(uuid)','12a3da73dd45088c8adb6cc208c8b88c',true),
 ('public._assert_load_replanning_graph(uuid,uuid[])','faad3dbedf11f61f021c2399673242f2',false)
 ) v(signature,body,definer) loop
 select * into p from pg_proc where oid=to_regprocedure(r.signature);
 if not found or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from r.body or p.prosecdef is distinct from r.definer
 or has_function_privilege('anon',p.oid,'execute') then raise exception 'trip_cancellation_predecessor_changed:%',r.signature;end if;
 end loop;
end;$preflight$;


create table private.dispatch_trip_cancellations(
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 trip_id uuid not null unique references public.dispatch_trips(id),
 actor_id uuid not null,request_id uuid not null,payload jsonb not null,
 before_snapshot jsonb not null,result jsonb not null,
 created_at timestamptz not null default now(),
 unique(tenant_id,actor_id,request_id)
);
alter table private.dispatch_trip_cancellations enable row level security;
revoke all on private.dispatch_trip_cancellations from public,anon,authenticated,service_role;

create function private.dispatch_trip_cancellation_context(_tenant_id uuid,_trip_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare t public.dispatch_trips%rowtype; links jsonb; stops jsonb; loads_json jsonb; journeys jsonb;
 blocked jsonb:='[]'; n bigint; dep record; lids uuid[]; snapshot jsonb;
begin
 if not private.is_request_tenant_member(_tenant_id) or not public.is_tenant_operator_or_admin(_tenant_id)
 or exists(select 1 from public.drivers where tenant_id=_tenant_id and user_id=auth.uid() and active)
 or exists(select 1 from public.tenant_memberships where tenant_id=_tenant_id and user_id=auth.uid() and active and role::text='driver')
 then raise exception 'trip_cancellation_access_denied' using errcode='42501';end if;
 select * into t from public.dispatch_trips where id=_trip_id and tenant_id=_tenant_id;
 if not found then raise exception 'trip_not_found' using errcode='22023';end if;
 if t.status is distinct from 'planned' or t.actual_start_at is not null or t.actual_end_at is not null then
 blocked:=blocked||jsonb_build_array(jsonb_build_object('code','trip_execution_started','count',1));end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into links from public.dispatch_trip_loads x where dispatch_trip_id=_trip_id;
 select coalesce(array_agg(distinct id),array[]::uuid[]) into lids from (
 select load_id id from public.dispatch_trip_loads where dispatch_trip_id=_trip_id union select id from public.loads where trip_id=_trip_id union select t.load_id where t.load_id is not null) q;
 select coalesce(jsonb_agg(to_jsonb(l) order by id),'[]') into loads_json from public.loads l where id=any(lids);
 select count(*) into n from public.loads l where id=any(lids) and (tenant_id is distinct from _tenant_id or trip_id is distinct from _trip_id or status is null or status not in('planned','assembling','ready','loading') or coalesce(on_hold,false));
 if n>0 then blocked:=blocked||jsonb_build_array(jsonb_build_object('code','load_requires_review','count',n));end if;
 select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') into stops from public.dispatch_stops s where dispatch_trip_id=_trip_id;
 select count(*) into n from public.dispatch_stops where dispatch_trip_id=_trip_id and (tenant_id is distinct from _tenant_id or status not in('pending','cancelled') or actual_arrival_at is not null or actual_departure_at is not null);
 if n>0 then blocked:=blocked||jsonb_build_array(jsonb_build_object('code','stop_execution_started','count',n));end if;
 select coalesce(jsonb_agg(to_jsonb(j) order by j.id),'[]') into journeys from public.physical_journeys j where id in(select physical_journey_id from public.physical_journey_trips where dispatch_trip_id=_trip_id);
 select count(*) into n from public.physical_journeys j where id in(select physical_journey_id from public.physical_journey_trips where dispatch_trip_id=_trip_id)
 and (status is distinct from 'planned' or actual_start_at is not null or actual_end_at is not null or (select count(*) from public.physical_journey_trips where physical_journey_id=j.id)<>1);
 if n>0 then blocked:=blocked||jsonb_build_array(jsonb_build_object('code','physical_journey_requires_review','count',n));end if;
 -- Every currently known direct operational/financial reference is a blocker.
 -- Schema preflight and child-side locking are added before promotion.
 for dep in select * from(values
 ('driver_expenses','dispatch_trip_id'),('vehicle_fueling','dispatch_trip_id'),('incidents','dispatch_trip_id'),
 ('proof_of_delivery','dispatch_trip_id'),('operational_events','dispatch_trip_id'),('driver_settlements','dispatch_trip_id'),
 ('payables','dispatch_trip_id'),('delivery_document_outcomes','dispatch_trip_id'),('finance_expense_batches','trip_id'),
 ('delivery_receipts','dispatch_trip_id'),('trip_cargo_controls','dispatch_trip_id'),('driver_operational_command_receipts','trip_id'),
 ('delivery_receipt_physical_events','dispatch_trip_id'),('driver_delivery_fiscal_conflicts','dispatch_trip_id'),
 ('driver_settlement_cargo_quarantines','dispatch_trip_id'),('trip_cargo_historical_reconciliations','dispatch_trip_id'),
 ('nfse_documents','trip_id'),('checklist_executions','dispatch_trip_id'),('dispatch_events','dispatch_trip_id'),('route_runs','trip_id')
 ) d(relation,column_name) loop
 execute format('select count(*) from public.%I where %I=$1',dep.relation,dep.column_name) into n using _trip_id;
 if n>0 then blocked:=blocked||jsonb_build_array(jsonb_build_object('code',dep.relation,'count',n));end if;
 end loop;
 select count(*) into n from public.fiscal_documents f where (f.load_id=any(lids) or f.id in(select d.fiscal_document_id from public.dispatch_stop_documents d join public.dispatch_stops s on s.id=d.dispatch_stop_id where s.dispatch_trip_id=_trip_id))
 and (f.tenant_id is distinct from _tenant_id or f.document_type is distinct from 'inbound' or f.cte_emitted_at is not null or f.cte_emitted_outbound_id is not null or f.nfse_emitted_at is not null or f.status in('delivered','returned','refused','failed','cancelled','partial_delivery'));
 if n>0 then blocked:=blocked||jsonb_build_array(jsonb_build_object('code','fiscal_review_required','count',n));end if;
 snapshot:=jsonb_build_object('trip',to_jsonb(t),'loads',loads_json,'links',links,'stops',stops,'journeys',journeys,'blockers',blocked,
 'stop_documents',(select coalesce(jsonb_agg(to_jsonb(d) order by d.id),'[]') from public.dispatch_stop_documents d join public.dispatch_stops st on st.id=d.dispatch_stop_id where st.dispatch_trip_id=_trip_id),
 'fiscal_sources',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'tenant_id',f.tenant_id,'load_id',f.load_id,'document_type',f.document_type,'status',f.status,'cte_emitted_at',f.cte_emitted_at,'cte_emitted_outbound_id',f.cte_emitted_outbound_id,'nfse_emitted_at',f.nfse_emitted_at) order by f.id),'[]') from public.fiscal_documents f where f.load_id=any(lids)));
 return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'trip_id',_trip_id,'status',t.status,
 'revision',md5(snapshot::text),'can_execute',jsonb_array_length(blocked)=0,'blockers',blocked,'load_ids',to_jsonb(lids),
 'stop_ids',(select coalesce(jsonb_agg(x->'id'),'[]') from jsonb_array_elements(stops)x),'_evidence',snapshot);
end;$fn$;
revoke all on function private.dispatch_trip_cancellation_context(uuid,uuid) from public,anon,authenticated,service_role;

create function private.cancel_planned_dispatch_trip(_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare tenant uuid:=(_payload->>'tenant_id')::uuid;trip uuid:=(_payload->>'trip_id')::uuid;
 actor uuid:=auth.uid();request uuid:=(_payload->>'request_id')::uuid;ctx jsonb;result jsonb;cached private.dispatch_trip_cancellations%rowtype;
 reason text:=btrim(_payload->>'reason');ids uuid[];
begin
 if _payload->>'version' is distinct from '1' or tenant is null or trip is null or request is null or actor is null
 or reason is null or length(reason)<10 or length(reason)>2000 or nullif(_payload->>'expected_revision','') is null
 or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','trip_id','request_id','expected_revision','reason'))
 then raise exception 'invalid_trip_cancellation' using errcode='22023';end if;
 -- Authorization is evaluated even for a replay, with membership locks retained.
 ctx:=private.dispatch_trip_cancellation_context(tenant,trip);
 perform 1 from public.tenant_memberships where tenant_id=tenant and user_id=actor and active for share nowait;
 if not found then raise exception 'trip_cancellation_access_denied' using errcode='42501';end if;
 perform 1 from public.drivers where tenant_id=tenant and user_id=actor for share nowait;
 perform pg_advisory_xact_lock(hashtext('trip_cancellation'),hashtext(tenant::text||actor::text||request::text));
 select * into cached from private.dispatch_trip_cancellations where tenant_id=tenant and actor_id=actor and request_id=request;
 if found then
 if cached.payload is distinct from _payload then raise exception 'trip_cancellation_request_conflict' using errcode='22023';end if;
 return cached.result;end if;
 perform public._lock_delivery_trip_graph(tenant,trip);
 perform f.id from public.fiscal_documents f where f.load_id in(select load_id from public.dispatch_trip_loads where dispatch_trip_id=trip) order by f.id for update nowait;
 perform j.id from public.physical_journeys j where j.id in(select physical_journey_id from public.physical_journey_trips where dispatch_trip_id=trip) order by j.id for update nowait;
 perform 1 from public.physical_journey_trips where physical_journey_id in(select physical_journey_id from public.physical_journey_trips where dispatch_trip_id=trip) for update nowait;
 ctx:=private.dispatch_trip_cancellation_context(tenant,trip);
 if ctx->>'revision' is distinct from _payload->>'expected_revision' then raise exception 'trip_cancellation_revision_changed' using errcode='40001';end if;
 if ctx->>'can_execute' is distinct from 'true' then raise exception 'trip_cancellation_dependencies' using errcode='55000';end if;
 select coalesce(array_agg(value::uuid),array[]::uuid[]) into ids from jsonb_array_elements_text(ctx->'load_ids');
 update public.dispatch_stops set status='cancelled',updated_at=clock_timestamp() where dispatch_trip_id=trip and status='pending';
 update public.dispatch_trips set status='cancelled',updated_at=clock_timestamp() where id=trip and tenant_id=tenant;
 update public.loads set trip_id=null,updated_at=clock_timestamp() where id=any(ids) and trip_id=trip and tenant_id=tenant;
 update public.physical_journeys set status='cancelled',updated_at=clock_timestamp() where id in(select physical_journey_id from public.physical_journey_trips where dispatch_trip_id=trip);
 result:=jsonb_build_object('version',1,'tenant_id',tenant,'actor_id',actor,'trip_id',trip,'request_id',request,
 'status','cancelled','confirmed',true,'load_ids',ctx->'load_ids','stop_ids',ctx->'stop_ids');
 insert into private.dispatch_trip_cancellations(tenant_id,trip_id,actor_id,request_id,payload,before_snapshot,result)
 values(tenant,trip,actor,request,_payload,ctx->'_evidence',result);
 perform public._log_entity_audit(tenant,'trip',trip,'cancel_planned_trip',ctx->'_evidence',result||jsonb_build_object('reason',reason),'audited_planning_cancellation');
 return result;
exception when lock_not_available then raise exception 'trip_cancellation_concurrent_change' using errcode='40001';
end;$fn$;
revoke all on function private.cancel_planned_dispatch_trip(jsonb) from public,anon,authenticated,service_role;

-- Child-first writers must not sneak new evidence past cancellation. The
-- following trigger locks the aggregate before permitting direct references.
create function private.guard_cancelled_trip_reference()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare ids uuid[];tid uuid;
begin
 select coalesce(array_agg(distinct value::uuid),array[]::uuid[]) into ids from unnest(array[
 case when tg_op<>'INSERT' then to_jsonb(old)->>tg_argv[0] end,
 case when tg_op<>'DELETE' then to_jsonb(new)->>tg_argv[0] end]) value where value is not null;
 for tid in select unnest(ids) order by 1 loop
 perform id from public.dispatch_trips where id=tid for key share nowait;
 if exists(select 1 from private.dispatch_trip_cancellations where trip_id=tid) then
 if tg_op='UPDATE' and tg_table_name in('dispatch_trips','dispatch_stops')
 and (to_jsonb(new)-array['notes','updated_at'])=(to_jsonb(old)-array['notes','updated_at']) then continue;end if;
 raise exception 'cancelled_trip_history_immutable' using errcode='55000';end if;
 end loop;
 if tg_op='DELETE' then return old;end if;return new;
exception when lock_not_available then raise exception 'trip_cancellation_concurrent_change' using errcode='40001';
end;$fn$;
revoke all on function private.guard_cancelled_trip_reference() from public,anon,authenticated,service_role;

-- This candidate is intentionally not exposed. Required before promotion:
-- exact predecessor metadata, reference-trigger installation, fiscal/stop
-- reference race coverage and replan compatibility, followed by public/UI tests.

do $install$
declare r record;
begin
 for r in select * from(values
 ('dispatch_trips','id'),('dispatch_trip_loads','dispatch_trip_id'),('loads','trip_id'),('dispatch_stops','dispatch_trip_id'),
 ('driver_expenses','dispatch_trip_id'),('vehicle_fueling','dispatch_trip_id'),('incidents','dispatch_trip_id'),
 ('proof_of_delivery','dispatch_trip_id'),('operational_events','dispatch_trip_id'),('driver_settlements','dispatch_trip_id'),
 ('payables','dispatch_trip_id'),('delivery_document_outcomes','dispatch_trip_id'),('finance_expense_batches','trip_id'),
 ('delivery_receipts','dispatch_trip_id'),('trip_cargo_controls','dispatch_trip_id'),('driver_operational_command_receipts','trip_id'),
 ('delivery_receipt_physical_events','dispatch_trip_id'),('driver_delivery_fiscal_conflicts','dispatch_trip_id'),
 ('driver_settlement_cargo_quarantines','dispatch_trip_id'),('trip_cargo_historical_reconciliations','dispatch_trip_id'),
 ('nfse_documents','trip_id'),('checklist_executions','dispatch_trip_id'),('dispatch_events','dispatch_trip_id'),('route_runs','trip_id'),
 ('physical_journey_trips','dispatch_trip_id')
 ) v(relation,column_name) loop
 execute format('create trigger guard_audited_trip_cancellation before insert or update or delete on public.%I for each row execute function private.guard_cancelled_trip_reference(%L)',r.relation,r.column_name);
 end loop;
end;$install$;

create function private.preserve_dispatch_trip_cancellation()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin raise exception 'trip_cancellation_history_immutable' using errcode='55000';end;$fn$;
revoke all on function private.preserve_dispatch_trip_cancellation() from public,anon,authenticated,service_role;
create trigger preserve_dispatch_trip_cancellation before update or delete on private.dispatch_trip_cancellations
for each row execute function private.preserve_dispatch_trip_cancellation();

create function private.guard_cancelled_trip_stop_reference()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare sid uuid;tid uuid;
begin
 for sid in select distinct value::uuid from unnest(array[
 case when tg_op<>'INSERT' then to_jsonb(old)->>tg_argv[0] end,
 case when tg_op<>'DELETE' then to_jsonb(new)->>tg_argv[0] end]) value where value is not null order by 1 loop
 select dispatch_trip_id into tid from public.dispatch_stops where id=sid;
 perform id from public.dispatch_trips where id=tid for key share nowait;
 if exists(select 1 from private.dispatch_trip_cancellations where trip_id=tid) then
 raise exception 'cancelled_trip_stop_history_immutable' using errcode='55000';end if;
 end loop;
 if tg_op='DELETE' then return old;end if;return new;
exception when lock_not_available then raise exception 'trip_cancellation_concurrent_change' using errcode='40001';
end;$fn$;
revoke all on function private.guard_cancelled_trip_stop_reference() from public,anon,authenticated,service_role;
create trigger guard_audited_trip_cancellation before insert or update or delete on public.dispatch_stop_documents
for each row execute function private.guard_cancelled_trip_stop_reference('dispatch_stop_id');

create function private.guard_cancelled_physical_journey()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if exists(select 1 from private.dispatch_trip_cancellations c join public.physical_journey_trips j on j.dispatch_trip_id=c.trip_id where j.physical_journey_id=old.id)
 and (tg_op='DELETE' or (to_jsonb(new)-array['metadata','updated_at']) is distinct from (to_jsonb(old)-array['metadata','updated_at'])) then
 raise exception 'cancelled_physical_journey_history_immutable' using errcode='55000';end if;
 if tg_op='DELETE' then return old;end if;return new;
end;$fn$;
revoke all on function private.guard_cancelled_physical_journey() from public,anon,authenticated,service_role;
create trigger guard_audited_trip_cancellation before update or delete on public.physical_journeys
for each row execute function private.guard_cancelled_physical_journey();

-- Retained associations on trips cancelled by this command are historical;
-- they must not obstruct a later explicit replan of the unchanged load.
do $replan$
declare body text;needle text:='and not(s.dispatch_trip_id=any(v_roots))) then';
begin
 body:=pg_get_functiondef('public._assert_load_replanning_graph(uuid,uuid[])'::regprocedure);
 if length(body)-length(replace(body,needle,''))<>length(needle) then raise exception 'trip_cancellation_replan_contract_changed';end if;
 execute replace(body,needle,'and not(s.dispatch_trip_id=any(v_roots)) and not exists(select 1 from private.dispatch_trip_cancellations cancellation where cancellation.trip_id=s.dispatch_trip_id)) then');
end;$replan$;
