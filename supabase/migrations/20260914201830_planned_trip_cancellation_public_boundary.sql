set local lock_timeout='3s';set local statement_timeout='30s';
do $preflight$
declare r record;p record;
begin
 for r in select * from(values
('private.cancel_planned_dispatch_trip(jsonb)','e6848eab1f4208a03f277f0025ae113a','v'),
('private.dispatch_trip_cancellation_context(uuid,uuid)','e886db6cf5d0e3f0d0578659dd87266d','s'),
('private.guard_cancelled_physical_journey()','5161ce908b68db0c60c274b13c024a96','v'),
('private.guard_cancelled_trip_reference()','ea0d974f44a14ae7078b60b7bd4977a5','v'),
('private.guard_cancelled_trip_stop_reference()','6f3c9558c594ff161c8c428f3873c9e6','v'),
('private.preserve_dispatch_trip_cancellation()','cf35367a251561b0d3fec04bb945f254','v')
 ) v(signature,body,volatility) loop
 select * into p from pg_proc where oid=to_regprocedure(r.signature);
 if not found or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from r.body or not p.prosecdef or p.provolatile::text is distinct from r.volatility
 or p.proconfig is distinct from array['search_path=""']::text[]
 or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner)
 then raise exception 'trip_cancellation_public_predecessor_changed:%',r.signature;end if;
 end loop;
 if not exists(select 1 from pg_class where oid='private.dispatch_trip_cancellations'::regclass and relrowsecurity) then raise exception 'trip_cancellation_journal_unprotected';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.dispatch_trips'::regclass and tgname='guard_audited_trip_cancellation' and tgtype=31 and tgenabled='O' and tgqual is null and tgnargs=1 and tgfoid='private.guard_cancelled_trip_reference()'::regprocedure) then raise exception 'trip_cancellation_trigger_changed';end if;

 for r in select * from(values
('dispatch_trips','id'),
('dispatch_trip_loads','dispatch_trip_id'),
('loads','trip_id'),
('dispatch_stops','dispatch_trip_id'),
('driver_expenses','dispatch_trip_id'),
('vehicle_fueling','dispatch_trip_id'),
('incidents','dispatch_trip_id'),
('proof_of_delivery','dispatch_trip_id'),
('operational_events','dispatch_trip_id'),
('driver_settlements','dispatch_trip_id'),
('payables','dispatch_trip_id'),
('delivery_document_outcomes','dispatch_trip_id'),
('finance_expense_batches','trip_id'),
('delivery_receipts','dispatch_trip_id'),
('trip_cargo_controls','dispatch_trip_id'),
('driver_operational_command_receipts','trip_id'),
('delivery_receipt_physical_events','dispatch_trip_id'),
('driver_delivery_fiscal_conflicts','dispatch_trip_id'),
('driver_settlement_cargo_quarantines','dispatch_trip_id'),
('trip_cargo_historical_reconciliations','dispatch_trip_id'),
('nfse_documents','trip_id'),
('checklist_executions','dispatch_trip_id'),
('dispatch_events','dispatch_trip_id'),
('route_runs','trip_id'),
('physical_journey_trips','dispatch_trip_id')
 ) v(relation,column_name) loop
 if not exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.'||r.relation) and t.tgname='guard_audited_trip_cancellation'
 and t.tgtype=31 and t.tgenabled='O' and t.tgqual is null and t.tgnargs=1 and not t.tgisinternal and not t.tgdeferrable
 and t.tgfoid='private.guard_cancelled_trip_reference()'::regprocedure
 and t.tgargs=convert_to(r.column_name,'UTF8')||decode('00','hex')) then raise exception 'trip_cancellation_reference_guard_changed:%',r.relation;end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='public.dispatch_stop_documents'::regclass and tgname='guard_audited_trip_cancellation' and tgtype=31 and tgenabled='O' and tgqual is null and tgnargs=1 and tgfoid='private.guard_cancelled_trip_stop_reference()'::regprocedure and tgargs=convert_to('dispatch_stop_id','UTF8')||decode('00','hex'))
 or not exists(select 1 from pg_trigger where tgrelid='public.physical_journeys'::regclass and tgname='guard_audited_trip_cancellation' and tgtype=27 and tgenabled='O' and tgqual is null and tgnargs=0 and tgfoid='private.guard_cancelled_physical_journey()'::regprocedure)
 or not exists(select 1 from pg_trigger where tgrelid='private.dispatch_trip_cancellations'::regclass and tgname='preserve_dispatch_trip_cancellation' and tgtype=27 and tgenabled='O' and tgqual is null and tgnargs=0 and tgfoid='private.preserve_dispatch_trip_cancellation()'::regprocedure)
 then raise exception 'trip_cancellation_history_guard_changed';end if;
end;$preflight$;

create function public.preview_dispatch_trip_cancellation(_tenant_id uuid,_trip_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare ctx jsonb;completed jsonb;
begin
 ctx:=private.dispatch_trip_cancellation_context(_tenant_id,_trip_id);
 select c.result into completed from private.dispatch_trip_cancellations c where tenant_id=_tenant_id and trip_id=_trip_id;
 return (ctx-'_evidence')||jsonb_build_object('completed_cancellation',completed is not null,'result',completed);
end;$fn$;
create function public.cancel_dispatch_trip(_payload jsonb)
returns jsonb language sql volatile security definer set search_path='' as $fn$
 select private.cancel_planned_dispatch_trip(_payload);
$fn$;
revoke all on function public.preview_dispatch_trip_cancellation(uuid,uuid),public.cancel_dispatch_trip(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.preview_dispatch_trip_cancellation(uuid,uuid),public.cancel_dispatch_trip(jsonb) to authenticated;
