-- Native regression coverage of retained legacy APIs. Synthetic fixtures roll back.
begin isolation level serializable;
set local search_path=public,extensions;
set local lock_timeout='3s';
set local statement_timeout='60s';
do $seed_guard$
begin
 if (select count(*) from auth.users)<>7 or
  (select count(*) from public.tenants where id in('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002') and settings->'fixture'='true'::jsonb)<>2 then
  raise exception 'Legacy API compatibility tests require the isolated seven-user seed';
 end if;
end;
$seed_guard$;
select no_plan();
create function pg_temp.qa_id(label text) returns uuid language sql immutable as $$select md5('sql-api-compatibility-20261019:'||label)::uuid$$;
create function pg_temp.tenant_a() returns uuid language sql immutable as $$select '20000000-0000-4000-8000-000000000001'::uuid$$;
create function pg_temp.tenant_b() returns uuid language sql immutable as $$select '20000000-0000-4000-8000-000000000002'::uuid$$;
create function pg_temp.actor(actor_id text,aal text default 'aal1') returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claim.role','',true);
 perform set_config('request.headers','{"x-agvlog-tenant-id":"20000000-0000-4000-8000-000000000001"}',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor_id,'role','authenticated','aal',aal,'active_tenant_id',pg_temp.tenant_a())::text,true);
end;
$$;
create temporary table qa_api_results(name text primary key,result jsonb);
create function pg_temp.result(name text) returns jsonb language sql stable as $$select result from qa_api_results where name=$1$$;

insert into public.employees(id,tenant_id,name,status,version) values
 (pg_temp.qa_id('employee'),pg_temp.tenant_a(),'Synthetic SQL compatibility employee','active',1),
 (pg_temp.qa_id('foreign-manager'),pg_temp.tenant_b(),'Synthetic foreign manager','active',1);
insert into public.drivers(id,tenant_id,name,cnh_number,active,driver_type) values
 (pg_temp.qa_id('reader-driver'),pg_temp.tenant_a(),'Synthetic SQL compatibility driver','QA-CNH-20261019',true,'proprio');
insert into public.loads(id,tenant_id,load_number,status,merchandise_value,total_weight_kg) values
 (pg_temp.qa_id('load-source'),pg_temp.tenant_a(),'QA-SQL-SOURCE','assembling',125,15),
 (pg_temp.qa_id('load-target'),pg_temp.tenant_a(),'QA-SQL-TARGET','assembling',0,0),
 (pg_temp.qa_id('load-route'),pg_temp.tenant_a(),'QA-SQL-ROUTE','ready',0,0),
 (pg_temp.qa_id('load-schedule'),pg_temp.tenant_a(),'QA-SQL-SCHEDULE','ready',0,0),
 (pg_temp.qa_id('load-repair'),pg_temp.tenant_a(),'QA-SQL-REPAIR','assembling',0,0);
insert into public.fiscal_documents(id,tenant_id,document_type,status,invoice_number,value,weight_kg,pallet_count) values
 (pg_temp.qa_id('document'),pg_temp.tenant_a(),'inbound','confirmed','QA-SQL-NF',125,15,2),
 (pg_temp.qa_id('foreign-document'),pg_temp.tenant_b(),'inbound','confirmed','QA-SQL-FOREIGN',50,7,1),
 (pg_temp.qa_id('new-pod-document'),pg_temp.tenant_a(),'inbound','confirmed','QA-SQL-POD',75,5,1),
 (pg_temp.qa_id('repair-document'),pg_temp.tenant_a(),'inbound','confirmed','QA-SQL-REPAIR-NF',50,5,2);
-- Existing triggers keep the fiscal projection canonical; model stale cached
-- totals without disabling a trigger or removing a constraint.
insert into public.load_items(tenant_id,load_id,fiscal_document_id,item_description,quantity,pallet_count,weight_kg)
 values(pg_temp.tenant_a(),pg_temp.qa_id('load-repair'),pg_temp.qa_id('repair-document'),'Synthetic repair cargo',1,2,5);
update public.fiscal_documents set load_id='70000000-0000-4000-8000-000000000001' where id=pg_temp.qa_id('new-pod-document');
insert into public.load_items(tenant_id,load_id,fiscal_document_id,item_description,quantity,pallet_count,weight_kg)
 values(pg_temp.tenant_a(),'70000000-0000-4000-8000-000000000001',pg_temp.qa_id('new-pod-document'),'Synthetic POD cargo',1,1,5);
insert into public.dispatch_stop_documents(id,tenant_id,dispatch_stop_id,load_id,fiscal_document_id)
 values(pg_temp.qa_id('new-pod-allocation'),pg_temp.tenant_a(),'82000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',pg_temp.qa_id('new-pod-document'));
insert into public.driver_settlements(id,tenant_id,driver_id,status,is_manual,manual_reference_date)
 values(pg_temp.qa_id('manual-settlement'),pg_temp.tenant_a(),'60000000-0000-4000-8000-000000000001','pending_review',true,current_date);
insert into public.alert_rules(id,tenant_id,rule_type,params,enabled)
 values(pg_temp.qa_id('overspeed-rule'),pg_temp.tenant_a(),'overspeed','{"speed_limit_kmh":80,"speed_limit":90}',true);
insert into public.geofences(id,tenant_id,name,enabled,geometry,shape_kind,scope_kind,enter_margin_m,exit_margin_m,transition_confirmations)
 values(pg_temp.qa_id('fleet-geofence'),pg_temp.tenant_a(),'Synthetic compatibility fleet fence',true,
 extensions.st_geomfromtext('POLYGON((-44 -17,-42 -17,-42 -14,-44 -14,-44 -17))',4326),'polygon','fleet',0,0,2);
update public.loads set total_pallet_count=99,total_weight_kg=999 where id=pg_temp.qa_id('load-repair');

select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname=any(array['add_driver_settlement_manual_expense','build_fiscal_documents_deleted_recovery_dry_run','create_ledger_entry_v1','create_load_v1','create_load_with_next_number','delete_load_v1','diagnose_load_composition','driver_report_event_v1','get_driver_workspace_v1','link_fiscal_documents_to_load_v1','list_dispatch_trips_v1','list_drivers_v1','log_operational_event_v2','move_load_items_v2','plan_dispatch_trip_v2','process_geofence_alerts','process_overspeed_alerts','repair_load_composition','unlink_fiscal_documents_from_load_v1','update_employee_v1'])
 and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))),
 'all retained legacy APIs continue denying anon and authenticated');
select ok(not has_function_privilege('service_role','public.add_driver_settlement_manual_expense(uuid,text,numeric,timestamptz,text,text,boolean,text,text)','EXECUTE'),
 'manual settlement legacy API retains its postgres-only execution boundary');

select pg_temp.actor('10000000-0000-4000-8000-000000000001','aal2');
select lives_ok($$insert into qa_api_results values('ledger',to_jsonb(public.create_ledger_entry_v1(pg_temp.tenant_a(),'loads',pg_temp.qa_id('load-source'),'manual','credit',12.50,'Synthetic SQL compatibility','{}')))$$,
 'ledger API uses the current text nature with its existing credit/debit constraint');
select is((select amount from public.operational_ledger where id=(pg_temp.result('ledger')#>>'{}')::uuid),12.50::numeric,'ledger preserves the requested amount');
select throws_ok($$select public.create_ledger_entry_v1(pg_temp.tenant_a(),'loads',pg_temp.qa_id('load-source'),'manual','invalid-nature',12.50,'Invalid synthetic nature','{}')$$,
 '23514',null,'ledger still rejects a nature outside its existing constraint');
select lives_ok($$insert into qa_api_results values('load-created',to_jsonb(public.create_load_v1(pg_temp.tenant_a(),null,null,'A','B','Synthetic','frota',now(),'qa-sql-create-load')))$$,
 'create load accepts the current operation enum and existing alphanumeric load numbers');
select is((select operation_type::text from public.loads where id=(pg_temp.result('load-created')#>>'{}')::uuid),'frota','created load stores the canonical operation type');
select throws_ok($$select public.create_load_v1(pg_temp.tenant_a(),null,null,'A','B',null,'invalid-operation',now(),null)$$,
 '22P02',null,'invalid operation strings are rejected by the current enum');
select throws_ok($$select public.create_load_v1(pg_temp.tenant_a(),null,null,'A','B','Synthetic','frota',now(),'qa-sql-create-load')$$,
 'P0001','Duplicate request (idempotency)','legacy create-load replay retains its duplicate response');
select lives_ok($$insert into qa_api_results values('load-next',to_jsonb(public.create_load_with_next_number(pg_temp.tenant_a(),'A','B',null,null,'80000000-0000-4000-8000-000000000001','Synthetic')))$$,
 'text trip argument accepts the existing UUID relationship');
select is((pg_temp.result('load-next')->>'trip_id'),'80000000-0000-4000-8000-000000000001','load row return retains its linked trip');
select lives_ok($$select public.delete_load_v1(pg_temp.tenant_a(),(pg_temp.result('load-created')#>>'{}')::uuid)$$,'delete-load API executes its current dispatch relationship check');
select is((select count(*) from public.loads where id=(pg_temp.result('load-created')#>>'{}')::uuid),0::bigint,'empty load deletion has the requested effect');
select throws_ok($$select public.create_load_with_next_number(pg_temp.tenant_a(),'A','B',null,null,'not-a-uuid','Synthetic')$$,
 '22P02',null,'malformed trip identifiers do not create a load');
select is(jsonb_array_length(public.list_drivers_v1(pg_temp.tenant_a(),'QA-CNH-20261019',null,10)->'items'),1,'legacy driver search uses the existing CNH field');
select is(public.list_drivers_v1(pg_temp.tenant_a(),'QA-CNH-20261019',null,10)#>>'{items,0,id}',pg_temp.qa_id('reader-driver')::text,'driver reader returns the matching registration');
select is(jsonb_array_length(public.list_dispatch_trips_v1(pg_temp.tenant_a(),'80000000-0000-4000-8000-000000000001',null,null,10)->'items'),1,'trip search accepts the ID used by the current UI');

select lives_ok($$select public.update_employee_v1(pg_temp.tenant_a(),pg_temp.qa_id('employee'),'{"status":"inactive","notes":"Synthetic edit"}',1)$$,
 'employee update uses the canonical status column and retains optimistic locking');
select is((select version from public.employees where id=pg_temp.qa_id('employee')),2,'employee version increments exactly once');
select is((select status from public.employees where id=pg_temp.qa_id('employee')),'inactive','employee status is persisted');
select is((select count(*) from public.entity_audit_log where entity_type='employee' and entity_id=pg_temp.qa_id('employee') and source='update_employee_v1' and actor_user_id='10000000-0000-4000-8000-000000000001'),1::bigint,
 'employee audit records the actual employee identity and actor without inventing a vehicle');
select throws_ok($$select public.update_employee_v1(pg_temp.tenant_a(),pg_temp.qa_id('employee'),'{"status":"active"}',1)$$,
 'P0001',null,'stale employee version is rejected');
select throws_ok($$select public.update_employee_v1(pg_temp.tenant_a(),pg_temp.qa_id('employee'),jsonb_build_object('manager_id',pg_temp.qa_id('foreign-manager')),2)$$,
 '42501','Cross-tenant violation: Manager belongs to another tenant','employee updates retain cross-company manager protection');
select lives_ok($$insert into qa_api_results values('manual-expense',to_jsonb(public.add_driver_settlement_manual_expense(pg_temp.qa_id('manual-settlement'),'food',12.50,now(),'QA-COST','driver',true,null,'Synthetic reason for unavailable receipt')))$$,
 'manual expense adapter executes the current guarded creation command');
select is((select approval_status from public.driver_expenses where id=(pg_temp.result('manual-expense')#>>'{}')::uuid),'pending',
 'legacy signature retains the current review boundary instead of approving expenses implicitly');
select is((select count(*) from public.driver_expense_creations where expense_id=(pg_temp.result('manual-expense')#>>'{}')::uuid),1::bigint,
 'manual expense adapter retains current creation provenance');
select throws_ok($$select public.add_driver_settlement_manual_expense(pg_temp.qa_id('manual-settlement'),'food',12.50,now(),'QA-COST','driver',true,'https://example.invalid/foreign-receipt','Synthetic receipt check')$$,
 '23514','expense_receipt_existing_object_mismatch','legacy receipt URL cannot bypass receipt ownership and provenance');

select lives_ok($$select public.link_fiscal_documents_to_load_v1(pg_temp.tenant_a(),pg_temp.qa_id('load-source'),array[pg_temp.qa_id('document')])$$,
 'composition link writes canonical item and projections without adding a uniqueness rule');
select is(public.link_fiscal_documents_to_load_v1(pg_temp.tenant_a(),pg_temp.qa_id('load-source'),array[pg_temp.qa_id('document')])->>'linked_count','0','composition link replay does not duplicate the item');
select is((select count(*) from public.load_items where load_id=pg_temp.qa_id('load-source') and fiscal_document_id=pg_temp.qa_id('document')),1::bigint,'exactly one item is linked');
select throws_ok($$select public.link_fiscal_documents_to_load_v1(pg_temp.tenant_a(),pg_temp.qa_id('load-source'),array[pg_temp.qa_id('foreign-document')])$$,
 'P0001',null,'composition rejects a document from another company');
select lives_ok($$select public.diagnose_load_composition(pg_temp.tenant_a(),array[pg_temp.qa_id('load-source')])$$,'composition diagnosis retains its table return');
select lives_ok($$select public.move_load_items_v2(pg_temp.tenant_a(),pg_temp.qa_id('load-source'),pg_temp.qa_id('load-target'),array[pg_temp.qa_id('document')])$$,
 'composition move uses both retained APIs atomically');
select is((select load_id from public.fiscal_documents where id=pg_temp.qa_id('document')),pg_temp.qa_id('load-target'),'moved fiscal projection matches the destination');
select lives_ok($$select public.unlink_fiscal_documents_from_load_v1(pg_temp.tenant_a(),pg_temp.qa_id('load-target'),array[pg_temp.qa_id('document')])$$,'composition unlink retains its audit path');
select is((select count(*) from public.load_items where fiscal_document_id=pg_temp.qa_id('document')),0::bigint,'unlink removes the canonical item');
select ok((select count(*) from public.diagnose_load_composition(pg_temp.tenant_a(),array[pg_temp.qa_id('load-repair')]))>0,'diagnosis identifies the deliberately stale cached totals');
select lives_ok($$select public.repair_load_composition(pg_temp.tenant_a(),array[pg_temp.qa_id('load-repair')],true)$$,'repair retains its dry-run contract');
select is((select total_pallet_count from public.loads where id=pg_temp.qa_id('load-repair')),99,'dry-run does not rewrite the stale cached totals');
select lives_ok($$select public.repair_load_composition(pg_temp.tenant_a(),array[pg_temp.qa_id('load-repair')],false)$$,'repair executes against the canonical composition schema');
select is((select load_id from public.fiscal_documents where id=pg_temp.qa_id('repair-document')),pg_temp.qa_id('load-repair'),'repair restores the canonical fiscal projection');
select is((select count(*) from public.diagnose_load_composition(pg_temp.tenant_a(),array[pg_temp.qa_id('load-repair')])),0::bigint,'repaired composition has no remaining discrepancies');
select throws_ok($$select public.repair_load_composition(pg_temp.tenant_a(),array['70000000-0000-4000-8000-000000000002'::uuid],false)$$,
 'P0001','Load not found or unauthorized','repair cannot rewrite a load from another company');
select lives_ok($$select public.build_fiscal_documents_deleted_recovery_dry_run(now()-interval '1 day',now(),pg_temp.tenant_a())$$,'recovery dry run retains scoped admin access');

select lives_ok($$insert into qa_api_results values('scheduled-trip',to_jsonb(public.plan_dispatch_trip_v2(pg_temp.tenant_a(),'50000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',array[pg_temp.qa_id('load-schedule')],now()+interval '2 days','qa-sql-schedule')))$$,
 'scheduled legacy planner writes planned_start_at');
select lives_ok($$insert into qa_api_results values('route-trip',to_jsonb(public.plan_dispatch_trip_v2(pg_temp.tenant_a(),'60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','Synthetic route',array[pg_temp.qa_id('load-route')],'[]','qa-sql-route')))$$,
 'route planner adapts the retained signature to the current audited planner');
select is(public.plan_dispatch_trip_v2(pg_temp.tenant_a(),'60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','Synthetic route',array[pg_temp.qa_id('load-route')],'[]','qa-sql-route'),(pg_temp.result('route-trip')#>>'{}')::uuid,'route replay returns the same identity');
select throws_ok($$select public.plan_dispatch_trip_v2(pg_temp.tenant_a(),'60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','Changed route',array[pg_temp.qa_id('load-route')],'[]','qa-sql-route')$$,
 'P0001','idempotency_key_mismatch','route replay refuses a changed payload');

select pg_temp.actor('10000000-0000-4000-8000-000000000003');
select lives_ok($$select public.get_driver_workspace_v1('60000000-0000-4000-8000-000000000001',pg_temp.tenant_a())$$,'legacy workspace projects current fields into its JSON keys');
select throws_ok($$select public.driver_report_event_v1('60000000-0000-4000-8000-000000000001',pg_temp.tenant_a(),(pg_temp.result('route-trip')#>>'{}')::uuid,null,'trip_start','{"odometer":12345}','qa-sql-trip-start')$$,
 '23514','trip_cargo_departure_confirmation_required','legacy start cannot bypass the existing cargo departure confirmation');
select is((select status from public.dispatch_trips where id=(pg_temp.result('route-trip')#>>'{}')::uuid),'planned','rejected departure keeps the trip planned');
select lives_ok($$select public.driver_report_event_v1('60000000-0000-4000-8000-000000000001',pg_temp.tenant_a(),(pg_temp.result('route-trip')#>>'{}')::uuid,null,'qa_sql_note','{"synthetic":true}','qa-sql-driver-note')$$,
 'legacy driver event retains its permitted event logging path');
select throws_ok($$select public.get_driver_workspace_v1('60000000-0000-4000-8000-000000000002',pg_temp.tenant_b())$$,
 'P0001','Acesso negado ao workspace do motorista','legacy workspace still rejects a foreign driver registration');

select lives_ok($$select public.log_operational_event_v2(pg_temp.tenant_a(),'qa_sql_event',null,null,'{"synthetic":true}',null,'qa-sql-operational')$$,'operational event API retains its non-POD path');
select lives_ok($$insert into qa_api_results values('pod-event',public.log_operational_event_v2(pg_temp.tenant_a(),'delivery_success','82000000-0000-4000-8000-000000000001',pg_temp.qa_id('new-pod-document'),'{"description":"Synthetic delivery outcome"}','{"receiver_name":"Synthetic Receiver","receiver_tax_id":"00000000000","photo_url":"https://example.invalid/synthetic-proof.jpg","latitude":-15.8,"longitude":-43.3,"accuracy":10}','qa-sql-pod-event'))$$,
 'legacy POD branch hashes evidence and records an occurrence with canonical metadata');
select ok((pg_temp.result('pod-event')->>'pod_id') is not null,'POD branch returns its persisted proof identity');
select is((select fiscal_document_id from public.operational_events where id=(pg_temp.result('pod-event')->>'event_id')::uuid),pg_temp.qa_id('new-pod-document'),'POD event retains the canonical document link');
select is(public.log_operational_event_v2(pg_temp.tenant_a(),'delivery_success','82000000-0000-4000-8000-000000000001',pg_temp.qa_id('new-pod-document'),'{"description":"Synthetic delivery outcome"}','{"receiver_name":"Synthetic Receiver"}','qa-sql-pod-event')->>'idempotent','true','POD replay returns the existing event');
select is((select count(*) from public.proof_of_delivery where fiscal_document_id=pg_temp.qa_id('new-pod-document')),1::bigint,'POD replay does not create another proof version');
select throws_ok($$select public.log_operational_event_v2(pg_temp.tenant_a(),'delivery_success','82000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','{"description":"Attempt to replace existing evidence"}','{"receiver_name":"Synthetic Receiver"}','qa-sql-existing-pod')$$,
 '55000','Proof retirement must preserve original evidence','legacy POD cannot replace prior evidence without the current audited correction');
select lives_ok($$select public.process_geofence_alerts(pg_temp.tenant_a(),'50000000-0000-4000-8000-000000000001',-15.8,-43.3,now()-interval '20 seconds')$$,'legacy point API executes the current scoped geofence engine');
select lives_ok($$select public.process_geofence_alerts(pg_temp.tenant_a(),'50000000-0000-4000-8000-000000000001',-15.8,-43.3,now()-interval '10 seconds')$$,'legacy point API keeps the current confirmation samples');
select is((select count(*) from public.geofence_events where geofence_id=pg_temp.qa_id('fleet-geofence') and direction='enter'),1::bigint,'confirmed samples produce one canonical enter event');
select lives_ok($$select public.process_geofence_alerts(pg_temp.tenant_a(),'50000000-0000-4000-8000-000000000001',-15.8,-43.3,now()-interval '20 seconds')$$,'replayed older telemetry is accepted without rewriting newer state');
select is((select count(*) from public.geofence_events where geofence_id=pg_temp.qa_id('fleet-geofence')),1::bigint,'telemetry replay does not duplicate the transition');
select throws_ok($$select public.process_geofence_alerts(pg_temp.tenant_a(),'50000000-0000-4000-8000-000000000002',-15.8,-43.3,now())$$,
 '23514','geofence_vehicle_tenant_mismatch','geofence alias retains cross-company vehicle rejection');
select lives_ok($$select public.process_overspeed_alerts(pg_temp.tenant_a(),'50000000-0000-4000-8000-000000000001',200,now()-interval '1 minute')$$,'overspeed API creates the first alert without a new uniqueness constraint');
select lives_ok($$select public.process_overspeed_alerts(pg_temp.tenant_a(),'50000000-0000-4000-8000-000000000001',180,now())$$,'overspeed API updates the open alert on another observation');
select is((select count(*) from public.alert_instances where rule_id=pg_temp.qa_id('overspeed-rule') and status='open'),1::bigint,'overspeed observations retain one open alert');
select is((select opened_at from public.alert_instances where rule_id=pg_temp.qa_id('overspeed-rule') and status='open'),now()-interval '1 minute','overspeed retains the earliest opening');
select throws_ok($$select public.process_overspeed_alerts(pg_temp.tenant_a(),'50000000-0000-4000-8000-000000000002',200,now())$$,
 '23514','overspeed_vehicle_tenant_mismatch','overspeed refuses a foreign-company vehicle');

select lives_ok($$select extensions.postgis_full_version()$$,'PostGIS version still supports absent optional modules');
create temporary table qa_compat_geometry(geom extensions.geometry);
insert into qa_compat_geometry values(extensions.st_setsrid(extensions.st_makepoint(0,0),4326)),(extensions.st_setsrid(extensions.st_makepoint(1,1),4326));
select is(extensions.st_findextent('qa_compat_geometry','geom')::text,'BOX(0 0,1 1)','typed two-argument extent is correct');
select is(extensions.st_findextent('pg_temp','qa_compat_geometry','geom')::text,'BOX(0 0,1 1)','typed three-argument extent is correct');
create temporary table "qa extent quoted"("geom column" extensions.geometry);
insert into "qa extent quoted" values(extensions.st_setsrid(extensions.st_makepoint(2,3),4326));
select is(extensions.st_findextent('qa extent quoted','geom column')::text,'BOX(2 3,2 3)','extent correctly quotes SQL identifiers');
select lives_ok($$select extensions.addauth('synthetic-lock')$$,'AddAuth creates its transaction-local table on first use');
select lives_ok($$select extensions.addauth('synthetic-lock-again')$$,'AddAuth reuses its own temporary table');
select lives_ok($$select extensions.addauth('synthetic''quoted-lock')$$,'AddAuth preserves quoted lock values as data');
select lives_ok($$select extensions.addauth(null)$$,'AddAuth retains its existing nullable argument behavior');
create table public.qa_sql_compat_geometry(geom extensions.geometry);
select is(extensions.populate_geometry_columns('public.qa_sql_compat_geometry'::regclass,true),0,'empty unconstrained geometry retains its zero-result behavior');
insert into public.qa_sql_compat_geometry values(extensions.st_setsrid(extensions.st_makepoint(2,3),4326));
select is(extensions.populate_geometry_columns('public.qa_sql_compat_geometry'::regclass,true),1,'geometry population types the actual nonempty column');
select is((select srid from extensions.geometry_columns where f_table_schema='public' and f_table_name='qa_sql_compat_geometry'),4326,'geometry population preserves the measured SRID');
select lives_ok($$select extensions.enablelongtransactions()$$,'long transaction fixture is initialized through its existing API');
select is(extensions.lockrow('public','qa_sql_compat_geometry','synthetic-row','auth-a',(now()+interval '1 minute')::timestamp),1,'LockRow acquires the existing authorization protocol');
select is(extensions.lockrow('public','qa_sql_compat_geometry','synthetic-row','auth-a',(now()+interval '1 minute')::timestamp),1,'LockRow reuses its own authorization');
select is(extensions.lockrow('public','qa_sql_compat_geometry','synthetic-row','auth-b',(now()+interval '1 minute')::timestamp),0,'LockRow refuses a competing authorization');

select * from finish();
rollback;
