set local lock_timeout='3s';set local statement_timeout='30s';
do $preflight$
declare p record;
begin
 select * into p from pg_proc where oid=to_regprocedure('private.dispatch_trip_cancellation_context(uuid,uuid)');
 if not found or md5(replace(p.prosrc,E'\r\n',E'\n'))<>'e886db6cf5d0e3f0d0578659dd87266d' or not p.prosecdef or p.provolatile<>'s'
  or p.proconfig is distinct from array['search_path=""']::text[] then raise exception 'materialized_trip_correction_predecessor_changed';end if;
 if to_regprocedure('public.preview_dispatch_trip_cancellation(uuid,uuid)') is null or to_regprocedure('public.cancel_dispatch_trip(jsonb)') is null
  or not exists(select 1 from pg_trigger where tgrelid='public.dispatch_trips'::regclass and tgname='guard_audited_trip_cancellation' and tgenabled='O')
 then raise exception 'materialized_trip_correction_boundary_missing';end if;
end;$preflight$;

create table private.dispatch_trip_corrections(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),trip_id uuid not null unique references public.dispatch_trips(id),
 actor_id uuid not null,request_id uuid not null,payload jsonb not null,before_snapshot jsonb not null,result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),unique(tenant_id,actor_id,request_id)
);
alter table private.dispatch_trip_corrections enable row level security;
revoke all on private.dispatch_trip_corrections from public,anon,authenticated,service_role;

create function private.dispatch_trip_correction_context(_tenant_id uuid,_trip_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare base jsonb;completed jsonb;planned jsonb;clean_planned boolean;revision text;evidence jsonb;
begin
 base:=private.dispatch_trip_cancellation_context(_tenant_id,_trip_id);
 select result into completed from private.dispatch_trip_corrections where tenant_id=_tenant_id and trip_id=_trip_id;
 select result into planned from private.dispatch_trip_cancellations where tenant_id=_tenant_id and trip_id=_trip_id;
 clean_planned:=base->>'status'='planned' and base#>>'{_evidence,trip,actual_start_at}' is null and base#>>'{_evidence,trip,actual_end_at}' is null and jsonb_array_length(base->'blockers')=0;
 evidence:=(base->'_evidence')||jsonb_build_object('mode','materialized_correction','dependency_counts',base->'blockers','completed',completed,'planned_cancellation',planned);
 revision:=md5(evidence::text);
 return (base-'_evidence'-'can_execute'-'blockers'-'revision')||jsonb_build_object(
  'mode','materialized_correction','revision',revision,'can_execute',completed is null and planned is null and base->>'status'<>'cancelled' and not clean_planned,
  'clean_planned_trip',clean_planned,'completed_correction',completed is not null,'result',completed,
  'dependency_counts',base->'blockers','_evidence',evidence,
  'pending_stop_count',(select count(*) from public.dispatch_stops s where s.tenant_id=_tenant_id and s.dispatch_trip_id=_trip_id
   and s.actual_arrival_at is null and s.actual_departure_at is null and s.status not in('completed','delivered','cancelled','skipped','refused','returned','partial_delivery','failed')));
end;$fn$;
revoke all on function private.dispatch_trip_correction_context(uuid,uuid) from public,anon,authenticated,service_role;

create function private.correct_materialized_dispatch_trip(_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $fn$
declare tenant uuid;trip uuid;actor uuid:=auth.uid();request uuid;reason text;ctx jsonb;cached private.dispatch_trip_corrections%rowtype;
 result jsonb;prior_status text;pending bigint;dep record;
begin
 if jsonb_typeof(_payload) is distinct from 'object' or _payload->'version' is distinct from '1'::jsonb
  or jsonb_typeof(_payload->'reason') is distinct from 'string' or length(btrim(_payload->>'reason')) not between 10 and 2000
  or coalesce(_payload->>'expected_revision','')!~'^[0-9a-f]{32}$'
  or _payload->'preserve_history_confirmed' is distinct from 'true'::jsonb
  or _payload->'fiscal_financial_unchanged_confirmed' is distinct from 'true'::jsonb
  or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','trip_id','request_id','expected_revision','reason','preserve_history_confirmed','fiscal_financial_unchanged_confirmed'))
 then raise exception 'invalid_materialized_trip_correction' using errcode='22023';end if;
 begin tenant:=(_payload->>'tenant_id')::uuid;trip:=(_payload->>'trip_id')::uuid;request:=(_payload->>'request_id')::uuid;
 exception when invalid_text_representation then raise exception 'invalid_materialized_trip_correction' using errcode='22023';end;
 if tenant is null or trip is null or request is null or actor is null then raise exception 'invalid_materialized_trip_correction' using errcode='22023';end if;
 reason:=btrim(_payload->>'reason');
 ctx:=private.dispatch_trip_correction_context(tenant,trip);
 perform 1 from public.tenant_memberships where tenant_id=tenant and user_id=actor and active for share nowait;
 if not found then raise exception 'trip_correction_access_denied' using errcode='42501';end if;
 perform 1 from public.drivers where tenant_id=tenant and user_id=actor for share nowait;
 perform pg_advisory_xact_lock(hashtext('materialized_trip_correction'),hashtext(tenant::text||actor::text||request::text));
 select * into cached from private.dispatch_trip_corrections where tenant_id=tenant and actor_id=actor and request_id=request;
 if found then if cached.payload is distinct from _payload then raise exception 'trip_correction_request_conflict' using errcode='22023';end if;return cached.result;end if;
 select status into prior_status from public.dispatch_trips where tenant_id=tenant and id=trip for update nowait;
 if not found then raise exception 'trip_not_found' using errcode='22023';end if;
 perform id from public.dispatch_trip_loads where dispatch_trip_id=trip order by id for update nowait;
 perform id from public.loads where tenant_id=tenant and (trip_id=trip or id in(select load_id from public.dispatch_trip_loads where dispatch_trip_id=trip)) order by id for update nowait;
 perform id from public.dispatch_stops where dispatch_trip_id=trip order by id for update nowait;
 perform d.id from public.dispatch_stop_documents d join public.dispatch_stops s on s.id=d.dispatch_stop_id where s.dispatch_trip_id=trip order by d.id for update of d nowait;
 perform j.physical_journey_id from public.physical_journey_trips j where j.dispatch_trip_id=trip order by j.physical_journey_id for update nowait;
 perform j.id from public.physical_journeys j where j.id in(select physical_journey_id from public.physical_journey_trips where dispatch_trip_id=trip) order by j.id for update nowait;
 for dep in select * from(values
  ('driver_expenses','dispatch_trip_id'),('vehicle_fueling','dispatch_trip_id'),('incidents','dispatch_trip_id'),('proof_of_delivery','dispatch_trip_id'),
  ('operational_events','dispatch_trip_id'),('driver_settlements','dispatch_trip_id'),('payables','dispatch_trip_id'),('delivery_document_outcomes','dispatch_trip_id'),
  ('finance_expense_batches','trip_id'),('delivery_receipts','dispatch_trip_id'),('trip_cargo_controls','dispatch_trip_id'),('driver_operational_command_receipts','trip_id'),
  ('delivery_receipt_physical_events','dispatch_trip_id'),('driver_delivery_fiscal_conflicts','dispatch_trip_id'),('driver_settlement_cargo_quarantines','dispatch_trip_id'),
  ('trip_cargo_historical_reconciliations','dispatch_trip_id'),('nfse_documents','trip_id'),('checklist_executions','dispatch_trip_id'),('dispatch_events','dispatch_trip_id'),('route_runs','trip_id')
 ) d(relation,column_name) loop
  execute format('select 1 from public.%I where %I=$1 order by id for update nowait',dep.relation,dep.column_name) using trip;
 end loop;
 ctx:=private.dispatch_trip_correction_context(tenant,trip);
 if ctx->>'revision' is distinct from _payload->>'expected_revision' then raise exception 'trip_correction_revision_changed' using errcode='40001';end if;
 if ctx->'can_execute' is distinct from 'true'::jsonb then raise exception 'trip_correction_unavailable' using errcode='55000';end if;
 pending:=(ctx->>'pending_stop_count')::bigint;
 update public.dispatch_stops set status='cancelled',updated_at=clock_timestamp() where tenant_id=tenant and dispatch_trip_id=trip
  and actual_arrival_at is null and actual_departure_at is null and status not in('completed','delivered','cancelled','skipped','refused','returned','partial_delivery','failed');
 update public.dispatch_trips set status='cancelled',updated_at=clock_timestamp() where tenant_id=tenant and id=trip;
 result:=jsonb_build_object('version',1,'tenant_id',tenant,'actor_id',actor,'trip_id',trip,'request_id',request,'prior_status',prior_status,'status','cancelled',
  'confirmed',true,'pending_stops_cancelled',pending,'load_links_preserved',true,'operational_history_preserved',true,'fiscal_changed',false,'financial_changed',false);
 insert into private.dispatch_trip_corrections(tenant_id,trip_id,actor_id,request_id,payload,before_snapshot,result)
 values(tenant,trip,actor,request,_payload,ctx->'_evidence',result);
 perform public._log_entity_audit(tenant,'trip',trip,'correct_materialized_trip',ctx->'_evidence',result||jsonb_build_object('reason',reason),'audited_materialized_trip_correction');
 return result;
exception when lock_not_available then raise exception 'trip_correction_concurrent_change' using errcode='40001';
end;$fn$;
revoke all on function private.correct_materialized_dispatch_trip(jsonb) from public,anon,authenticated,service_role;

create function private.preserve_dispatch_trip_correction() returns trigger language plpgsql security definer set search_path='' as $fn$
begin raise exception 'trip_correction_history_immutable' using errcode='55000';end;$fn$;
revoke all on function private.preserve_dispatch_trip_correction() from public,anon,authenticated,service_role;
create trigger preserve_dispatch_trip_correction before update or delete on private.dispatch_trip_corrections for each row execute function private.preserve_dispatch_trip_correction();

create function private.guard_corrected_trip_reference() returns trigger language plpgsql security definer set search_path='' as $fn$
declare ids uuid[];tid uuid;old_id uuid;new_id uuid;
begin
 old_id:=case when tg_op<>'INSERT' then (to_jsonb(old)->>tg_argv[0])::uuid end;new_id:=case when tg_op<>'DELETE' then (to_jsonb(new)->>tg_argv[0])::uuid end;
 select coalesce(array_agg(distinct x order by x),array[]::uuid[]) into ids from unnest(array[old_id,new_id]) x where x is not null;
 for tid in select unnest(ids) loop
  perform id from public.dispatch_trips where id=tid for key share nowait;
  if exists(select 1 from private.dispatch_trip_corrections where trip_id=tid) then
   if tg_table_name='dispatch_trips' then
    if tg_op='DELETE' or (to_jsonb(new)-array['notes','updated_at']) is distinct from (to_jsonb(old)-array['notes','updated_at']) then raise exception 'corrected_trip_history_immutable' using errcode='55000';end if;
   elsif tg_table_name='dispatch_stops' then
    if tg_op<>'UPDATE' or (to_jsonb(new)-array['notes','updated_at']) is distinct from (to_jsonb(old)-array['notes','updated_at']) then raise exception 'corrected_trip_history_immutable' using errcode='55000';end if;
   elsif tg_table_name in('dispatch_trip_loads','physical_journey_trips') or tg_op in('INSERT','DELETE') or old_id is distinct from new_id then
    raise exception 'corrected_trip_history_immutable' using errcode='55000';
   end if;
  end if;
 end loop;
 if tg_op='DELETE' then return old;end if;return new;
exception when lock_not_available then raise exception 'trip_correction_concurrent_change' using errcode='40001';
end;$fn$;
revoke all on function private.guard_corrected_trip_reference() from public,anon,authenticated,service_role;
do $install$
declare r record;
begin
 for r in select * from(values
  ('dispatch_trips','id'),('dispatch_trip_loads','dispatch_trip_id'),('loads','trip_id'),('dispatch_stops','dispatch_trip_id'),
  ('driver_expenses','dispatch_trip_id'),('vehicle_fueling','dispatch_trip_id'),('incidents','dispatch_trip_id'),('proof_of_delivery','dispatch_trip_id'),
  ('operational_events','dispatch_trip_id'),('driver_settlements','dispatch_trip_id'),('payables','dispatch_trip_id'),('delivery_document_outcomes','dispatch_trip_id'),
  ('finance_expense_batches','trip_id'),('delivery_receipts','dispatch_trip_id'),('trip_cargo_controls','dispatch_trip_id'),('driver_operational_command_receipts','trip_id'),
  ('delivery_receipt_physical_events','dispatch_trip_id'),('driver_delivery_fiscal_conflicts','dispatch_trip_id'),('driver_settlement_cargo_quarantines','dispatch_trip_id'),
  ('trip_cargo_historical_reconciliations','dispatch_trip_id'),('nfse_documents','trip_id'),('checklist_executions','dispatch_trip_id'),('dispatch_events','dispatch_trip_id'),
  ('route_runs','trip_id'),('physical_journey_trips','dispatch_trip_id')
 ) v(relation,column_name) loop
  execute format('create trigger guard_materialized_trip_correction before insert or update or delete on public.%I for each row execute function private.guard_corrected_trip_reference(%L)',r.relation,r.column_name);
 end loop;
end;$install$;

create function private.guard_corrected_trip_stop_reference() returns trigger language plpgsql security definer set search_path='' as $fn$
declare sid uuid;tid uuid;
begin
 for sid in select distinct x from unnest(array[case when tg_op<>'INSERT' then old.dispatch_stop_id end,case when tg_op<>'DELETE' then new.dispatch_stop_id end]) x where x is not null loop
  select dispatch_trip_id into tid from public.dispatch_stops where id=sid;perform id from public.dispatch_trips where id=tid for key share nowait;
  if exists(select 1 from private.dispatch_trip_corrections where trip_id=tid) then raise exception 'corrected_trip_stop_history_immutable' using errcode='55000';end if;
 end loop;
 if tg_op='DELETE' then return old;end if;return new;
exception when lock_not_available then raise exception 'trip_correction_concurrent_change' using errcode='40001';
end;$fn$;
revoke all on function private.guard_corrected_trip_stop_reference() from public,anon,authenticated,service_role;
create trigger guard_materialized_trip_correction before insert or update or delete on public.dispatch_stop_documents for each row execute function private.guard_corrected_trip_stop_reference();

create function private.dispatch_trip_correction_preview(_tenant_id uuid,_trip_id uuid)
returns jsonb language sql stable security definer set search_path='' as $fn$select private.dispatch_trip_correction_context(_tenant_id,_trip_id)-'_evidence'$fn$;
create function private.dispatch_trip_correction_apply(_payload jsonb)
returns jsonb language sql volatile security definer set search_path='' as $fn$select private.correct_materialized_dispatch_trip(_payload)$fn$;
revoke all on function private.dispatch_trip_correction_preview(uuid,uuid),private.dispatch_trip_correction_apply(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.dispatch_trip_correction_preview(uuid,uuid),private.dispatch_trip_correction_apply(jsonb) to authenticated;
create function public.preview_dispatch_trip_correction(_tenant_id uuid,_trip_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $fn$select private.dispatch_trip_correction_preview(_tenant_id,_trip_id)$fn$;
create function public.correct_dispatch_trip(_payload jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $fn$select private.dispatch_trip_correction_apply(_payload)$fn$;
revoke all on function public.preview_dispatch_trip_correction(uuid,uuid),public.correct_dispatch_trip(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.preview_dispatch_trip_correction(uuid,uuid),public.correct_dispatch_trip(jsonb) to authenticated;
