-- Durable request ledger for aggregate commands. Results are immutable and scoped
-- by tenant/action/request, so a lost response can be replayed safely.
create table finance_private.atomic_command_results(
 tenant_id uuid not null,action text not null,request_id uuid not null,payload_hash text not null,
 result jsonb not null,actor_id uuid not null,created_at timestamptz not null default now(),
 primary key(tenant_id,action,request_id)
);
revoke all on finance_private.atomic_command_results from public,anon,authenticated,service_role;

alter function public.create_pickup_order_v1(jsonb) rename to create_pickup_order_unsafe_20260917;
alter function public.create_pickup_order_unsafe_20260917(jsonb) set schema finance_private;
revoke all on function finance_private.create_pickup_order_unsafe_20260917(jsonb) from public,anon,authenticated,service_role;
create function public.create_pickup_order_v1(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare t uuid:=nullif(_payload->>'tenant_id','')::uuid;r uuid:=nullif(_payload->>'request_id','')::uuid;h text;stored finance_private.atomic_command_results%rowtype;out jsonb;
begin
 if auth.uid() is null or t is null or not public.is_tenant_operator_or_admin(t) then raise exception 'operator_required' using errcode='42501';end if;
 if r is null then raise exception 'request_id_required' using errcode='22023';end if;
 perform finance_private.assert_tenant_reference('public.clients',t,nullif(_payload->>'remitter_client_id','')::uuid,'remitter_client');
 perform finance_private.assert_tenant_reference('public.drivers',t,nullif(_payload->>'driver_id','')::uuid,'driver');
 perform finance_private.assert_tenant_reference('public.vehicles',t,nullif(_payload->>'vehicle_id','')::uuid,'vehicle');
 h:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended(t::text||':pickup:'||r::text,0));
 select * into stored from finance_private.atomic_command_results where tenant_id=t and action='create_pickup_order' and request_id=r;
 if found then if stored.payload_hash<>h then raise exception 'request_payload_mismatch' using errcode='22023';end if;return stored.result;end if;
 out:=finance_private.create_pickup_order_unsafe_20260917(_payload);
 insert into finance_private.atomic_command_results values(t,'create_pickup_order',r,h,out,auth.uid(),now());return out;
end;$fn$;

alter function public.create_vehicle_fueling_with_odometer_v1(jsonb) rename to create_vehicle_fueling_unsafe_20260917;
alter function public.create_vehicle_fueling_unsafe_20260917(jsonb) set schema finance_private;
revoke all on function finance_private.create_vehicle_fueling_unsafe_20260917(jsonb) from public,anon,authenticated,service_role;
create function public.create_vehicle_fueling_with_odometer_v1(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare t uuid:=nullif(_payload->>'tenant_id','')::uuid;r uuid:=nullif(_payload->>'request_id','')::uuid;h text;stored finance_private.atomic_command_results%rowtype;out jsonb;
begin
 if auth.uid() is null or t is null or not public.is_tenant_admin(t) then raise exception 'admin_required' using errcode='42501';end if;
 if r is null then raise exception 'request_id_required' using errcode='22023';end if;
 perform finance_private.assert_tenant_reference('public.vehicles',t,nullif(_payload->>'vehicle_id','')::uuid,'vehicle');
 perform finance_private.assert_tenant_reference('public.drivers',t,nullif(_payload->>'driver_id','')::uuid,'driver');
 perform finance_private.assert_tenant_reference('public.employees',t,nullif(_payload->>'employee_id','')::uuid,'employee');
 perform finance_private.assert_tenant_reference('public.dispatch_trips',t,nullif(_payload->>'dispatch_trip_id','')::uuid,'dispatch_trip');
 perform finance_private.assert_tenant_reference('public.trips',t,nullif(_payload->>'route_trip_id','')::uuid,'route_trip');
 h:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended(t::text||':fueling:'||r::text,0));
 select * into stored from finance_private.atomic_command_results where tenant_id=t and action='create_vehicle_fueling' and request_id=r;
 if found then if stored.payload_hash<>h then raise exception 'request_payload_mismatch' using errcode='22023';end if;return stored.result;end if;
 out:=finance_private.create_vehicle_fueling_unsafe_20260917(_payload);
 insert into finance_private.atomic_command_results values(t,'create_vehicle_fueling',r,h,out,auth.uid(),now());return out;
end;$fn$;

alter function public.create_stock_movement_v1(jsonb) rename to create_stock_movement_unsafe_20260917;
alter function public.create_stock_movement_unsafe_20260917(jsonb) set schema finance_private;
revoke all on function finance_private.create_stock_movement_unsafe_20260917(jsonb) from public,anon,authenticated,service_role;
create function public.create_stock_movement_v1(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare t uuid:=nullif(_payload->>'tenant_id','')::uuid;r uuid:=nullif(_payload->>'request_id','')::uuid;h text;stored finance_private.atomic_command_results%rowtype;out jsonb;kind text:=nullif(_payload->>'movement_type','');
begin
 if auth.uid() is null or t is null or not public.is_tenant_admin(t) then raise exception 'admin_required' using errcode='42501';end if;
 if r is null then raise exception 'request_id_required' using errcode='22023';end if;
 if kind is null or kind not in('inbound','outbound','transfer','return','reserve','adjustment','consumption') then raise exception 'unsupported_stock_movement_type' using errcode='22023';end if;
 perform finance_private.assert_tenant_reference('public.employees',t,nullif(_payload->>'employee_id','')::uuid,'employee');
 perform finance_private.assert_tenant_reference('public.employees',t,nullif(_payload->>'responsible_employee_id','')::uuid,'responsible_employee');
 perform finance_private.assert_tenant_reference('public.vehicles',t,nullif(_payload->>'vehicle_id','')::uuid,'vehicle');
 perform finance_private.assert_tenant_reference('public.assets',t,nullif(_payload->>'asset_id','')::uuid,'asset');
 perform finance_private.assert_tenant_reference('public.maintenance_orders',t,nullif(_payload->>'maintenance_order_id','')::uuid,'maintenance_order');
 perform finance_private.assert_tenant_reference('public.incidents',t,nullif(_payload->>'incident_id','')::uuid,'incident');
 h:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended(t::text||':stock:'||r::text,0));
 select * into stored from finance_private.atomic_command_results where tenant_id=t and action='create_stock_movement' and request_id=r;
 if found then if stored.payload_hash<>h then raise exception 'request_payload_mismatch' using errcode='22023';end if;return stored.result;end if;
 out:=finance_private.create_stock_movement_unsafe_20260917(_payload);
 insert into finance_private.atomic_command_results values(t,'create_stock_movement',r,h,out,auth.uid(),now());return out;
end;$fn$;

alter function public.create_employee_contract_v1(jsonb) rename to create_employee_contract_unsafe_20260917;
alter function public.create_employee_contract_unsafe_20260917(jsonb) set schema finance_private;
revoke all on function finance_private.create_employee_contract_unsafe_20260917(jsonb) from public,anon,authenticated,service_role;
create function public.create_employee_contract_v1(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare t uuid:=nullif(_payload->>'tenant_id','')::uuid;r uuid:=nullif(_payload->>'request_id','')::uuid;h text;stored finance_private.atomic_command_results%rowtype;out jsonb;
begin
 if auth.uid() is null or t is null or not public.is_tenant_admin(t) then raise exception 'admin_required' using errcode='42501';end if;
 if r is null then raise exception 'request_id_required' using errcode='22023';end if;
 perform finance_private.assert_tenant_reference('public.employees',t,nullif(_payload->>'employee_id','')::uuid,'employee');
 h:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended(t::text||':employee-contract:'||r::text,0));
 select * into stored from finance_private.atomic_command_results where tenant_id=t and action='create_employee_contract' and request_id=r;
 if found then if stored.payload_hash<>h then raise exception 'request_payload_mismatch' using errcode='22023';end if;return stored.result;end if;
 out:=finance_private.create_employee_contract_unsafe_20260917(_payload);
 insert into finance_private.atomic_command_results values(t,'create_employee_contract',r,h,out,auth.uid(),now());return out;
end;$fn$;

alter function public.save_route_template_v1(jsonb) rename to save_route_template_unsafe_20260917;
alter function public.save_route_template_unsafe_20260917(jsonb) set schema finance_private;
revoke all on function finance_private.save_route_template_unsafe_20260917(jsonb) from public,anon,authenticated,service_role;
create function public.save_route_template_v1(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare t uuid:=nullif(_payload->>'tenant_id','')::uuid;r uuid:=nullif(_payload->>'request_id','')::uuid;h text;stored finance_private.atomic_command_results%rowtype;out jsonb;wps jsonb:=coalesce(_payload->'waypoints','[]');
begin
 if auth.uid() is null or t is null or not public.is_tenant_admin(t) then raise exception 'admin_required' using errcode='42501';end if;
 if r is null then raise exception 'request_id_required' using errcode='22023';end if;
 if coalesce(length(btrim(_payload->>'name')),0)=0 then raise exception 'route_name_required' using errcode='22023';end if;
 perform finance_private.assert_tenant_reference('public.geofences',t,nullif(_payload->>'corridor_geofence_id','')::uuid,'corridor_geofence');
 if exists(select 1 from jsonb_to_recordset(wps) x(poi_id uuid) left join public.pois p on p.tenant_id=t and p.id=x.poi_id where x.poi_id is not null and p.id is null) then raise exception 'route_poi_not_found_in_tenant' using errcode='23503';end if;
 if exists(select 1 from jsonb_to_recordset(wps) x(geofence_id uuid) left join public.geofences g on g.tenant_id=t and g.id=x.geofence_id where x.geofence_id is not null and g.id is null) then raise exception 'route_geofence_not_found_in_tenant' using errcode='23503';end if;
 _payload:=jsonb_set(_payload,'{name}',to_jsonb(btrim(_payload->>'name')));
 h:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended(t::text||':route:'||r::text,0));
 select * into stored from finance_private.atomic_command_results where tenant_id=t and action='save_route_template' and request_id=r;
 if found then if stored.payload_hash<>h then raise exception 'request_payload_mismatch' using errcode='22023';end if;return stored.result;end if;
 out:=finance_private.save_route_template_unsafe_20260917(_payload);
 insert into finance_private.atomic_command_results values(t,'save_route_template',r,h,out,auth.uid(),now());return out;
end;$fn$;

alter function public.import_occurrence_report_batch_v1(jsonb,jsonb) rename to import_occurrence_report_unsafe_20260917;
alter function public.import_occurrence_report_unsafe_20260917(jsonb,jsonb) set schema finance_private;
revoke all on function finance_private.import_occurrence_report_unsafe_20260917(jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.import_occurrence_report_batch_v1(_batch jsonb,_occurrences jsonb default '[]') returns jsonb language plpgsql security definer set search_path='' as $fn$
declare t uuid:=nullif(_batch->>'tenant_id','')::uuid;r uuid:=nullif(_batch->>'request_id','')::uuid;h text;stored finance_private.atomic_command_results%rowtype;out jsonb;
begin
 if auth.uid() is null or t is null or not public.is_tenant_operator_or_admin(t) then raise exception 'operator_required' using errcode='42501';end if;
 if r is null then raise exception 'request_id_required' using errcode='22023';end if;
 h:=encode(sha256(convert_to((jsonb_build_object('batch',_batch-'request_id','occurrences',_occurrences))::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended(t::text||':occurrence-import:'||r::text,0));
 select * into stored from finance_private.atomic_command_results where tenant_id=t and action='import_occurrence_report' and request_id=r;
 if found then if stored.payload_hash<>h then raise exception 'request_payload_mismatch' using errcode='22023';end if;return stored.result;end if;
 out:=finance_private.import_occurrence_report_unsafe_20260917(_batch,_occurrences);
 insert into finance_private.atomic_command_results values(t,'import_occurrence_report',r,h,out,auth.uid(),now());return out;
end;$fn$;

revoke all on function public.create_pickup_order_v1(jsonb),public.create_vehicle_fueling_with_odometer_v1(jsonb),
 public.create_stock_movement_v1(jsonb),public.create_employee_contract_v1(jsonb),public.save_route_template_v1(jsonb),
 public.import_occurrence_report_batch_v1(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_pickup_order_v1(jsonb),public.create_vehicle_fueling_with_odometer_v1(jsonb),
 public.create_stock_movement_v1(jsonb),public.create_employee_contract_v1(jsonb),public.save_route_template_v1(jsonb),
 public.import_occurrence_report_batch_v1(jsonb,jsonb) to authenticated;
