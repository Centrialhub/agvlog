-- ONLY the reviewed disposable CI database. Always rolls back.
begin;
set local statement_timeout='30s';
do $$begin
 if (select count(*) from auth.users)<>7 or
  (select count(*) from auth.users where email like '%@agvlog-e2e.invalid')<>7 then
  raise exception 'isolated_seed_required';end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select set_config('request.headers','{"x-agvlog-tenant-id":"20000000-0000-4000-8000-000000000001"}',true);
do $$
declare t constant uuid:='20000000-0000-4000-8000-000000000001';
 l uuid:=gen_random_uuid();tr uuid:=gen_random_uuid();d uuid:=gen_random_uuid();v integer;
 before_doc jsonb;result jsonb;
begin
 insert into public.loads(id,tenant_id,load_number,status)
  values(l,t,'ARCHIVE-QA-'||l::text,'planned');
 insert into public.dispatch_trips(id,tenant_id,load_id,driver_id,vehicle_id,status)
  values(tr,t,l,'60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','planned');
 insert into public.dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values(t,tr,l);
 insert into public.dispatch_stops(tenant_id,dispatch_trip_id,stop_order,destination,status)
  values(t,tr,1,'Destino sintético de arquivamento','pending');
 insert into public.fiscal_documents(id,tenant_id,document_type,invoice_number,load_id,status,value)
  values(d,t,'inbound','ARCHIVE-QA-'||d::text,l,'confirmed',123.45);
 select version into v from public.loads where id=l;
 select to_jsonb(f) into before_doc from public.fiscal_documents f where id=d;
 result:=private.archive_non_jmacedo_load_for_cleanup(t,l,v,'Limpeza sintética isolada com preservação fiscal.');
 if result->'archived' is distinct from 'true'::jsonb then raise exception 'native_archive_unconfirmed';end if;
 if before_doc is distinct from(select to_jsonb(f) from public.fiscal_documents f where id=d) then
  raise exception 'native_archive_changed_document';end if;
 if (select status from public.dispatch_trips where id=tr)<>'cancelled' or
  exists(select 1 from public.dispatch_stops where dispatch_trip_id=tr and status<>'cancelled') then
  raise exception 'native_archive_left_trip_active';end if;
 if not exists(select 1 from public.dispatch_trip_loads where dispatch_trip_id=tr and load_id=l) then
  raise exception 'native_archive_lost_history';end if;
 result:=private.archive_non_jmacedo_load_for_cleanup(t,l,v,'Limpeza sintética isolada com preservação fiscal.');
 if result->'replayed' is distinct from 'true'::jsonb then raise exception 'native_archive_replay_failed';end if;
 perform set_config('archive.fixture_load_id',l::text,true);
end $$;
set constraints all immediate;
set local role authenticated;
do $$
declare l uuid:=current_setting('archive.fixture_load_id')::uuid;payload jsonb;
begin
 if exists(select 1 from public.loads where id=l) then raise exception 'native_archive_still_listed';end if;
 if exists(select 1 from public.list_loads_page_v1('20000000-0000-4000-8000-000000000001','{}',500,0) p,
  lateral jsonb_array_elements(p.items) e where e->>'id'=l::text) then
  raise exception 'native_archive_still_in_pagination';end if;
 payload:=public.list_operator_reference_page_v1('20000000-0000-4000-8000-000000000001','loads',true,500,null);
 if exists(select 1 from jsonb_array_elements(payload->'items') e where e->>'id'=l::text) then
  raise exception 'native_archive_still_in_catalog';end if;
end $$;
rollback;
