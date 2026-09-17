-- SELECT-only. Run before211200; rerun after211200 and before213021.
-- Presence is necessary, not approval of every predecessor body. Inspect definitions/ACL in output.
with relations(name) as (values
 ('public.tenants'),('public.dispatch_trips'),('public.dispatch_stops'),('public.dispatch_events'),
 ('public.dispatch_stop_documents'),('public.delivery_allocation_documents'),('public.dispatch_stop_nfse_documents'),
 ('public.nfse_documents'),('public.dispatch_trip_loads'),('public.proof_of_delivery'),('public.operational_events'),
 ('public.driver_expenses'),('public.driver_settlement_payments'),('public.payables'),
 ('public.occurrence_return_sheets'),('public.pallet_return_protocols')),
 signatures(name) as (values
 ('public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text)'),
 ('public._assert_driver_owns_trip(uuid)'),('public._lock_driver_delivery_stop(uuid)'),
 ('public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text)'),
 ('public.is_tenant_operator_or_admin(uuid)'),('private.request_tenant_id()'),
 ('storage_evidence_private.is_retained(text,text,uuid)'),
 ('storage_evidence_private.array_contains_path(jsonb,text)'))
select jsonb_build_object(
 'observed_at',clock_timestamp(),
 'relations',(select jsonb_agg(jsonb_build_object('name',name,'present',to_regclass(name) is not null)) from relations),
 'schemas',jsonb_build_object('delivery_private',to_regnamespace('delivery_private') is not null,'storage_evidence_private',to_regnamespace('storage_evidence_private') is not null),
 'functions',(select jsonb_agg(jsonb_build_object('signature',s.name,'present',p.oid is not null,
   'definition_md5',case when p.oid is not null then md5(pg_get_functiondef(p.oid)) end,
   'definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text,
   'authenticated_execute',case when p.oid is not null then has_function_privilege('authenticated',p.oid,'EXECUTE') end,
   'anon_execute',case when p.oid is not null then has_function_privilege('anon',p.oid,'EXECUTE') end)) from signatures s left join pg_proc p on p.oid=to_regprocedure(s.name)),
 'gate211200',jsonb_build_object(
   'conflicts_present',to_regclass('public.driver_delivery_fiscal_conflicts') is not null,
   'preserved_writer_present',to_regprocedure('public.driver_record_delivery_outcome_without_fiscal_gate_v1(uuid,text,jsonb,uuid,text)') is not null,
   'snapshot_present',to_regprocedure('public.get_driver_delivery_fiscal_snapshot_v1(uuid,uuid,uuid)') is not null),
 'resolution213021',jsonb_build_object(
   'column_present',exists(select 1 from information_schema.columns where table_schema='public' and table_name='driver_delivery_fiscal_conflicts' and column_name='resolution_action'))
) evidence;
-- Before211200: conflicts and preserved_writer must both be absent (fresh additive install).
-- Before213021: both must be present; resolution_action must still be absent.
-- Snapshot signature is the exact three-UUID contract of211200.
-- never substitute a missing helper with a success stub.


