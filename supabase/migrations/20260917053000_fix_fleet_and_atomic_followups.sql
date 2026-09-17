-- Live queue 254, 262-277.

create function public.tg_clear_disabled_geofence_states() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if old.enabled and not new.enabled then delete from public.geofence_states where tenant_id=new.tenant_id and geofence_id=new.id;end if;
 return new;
end;$fn$;
revoke all on function public.tg_clear_disabled_geofence_states() from public,anon,authenticated,service_role;
drop trigger if exists clear_disabled_geofence_states on public.geofences;
create trigger clear_disabled_geofence_states after update of enabled on public.geofences for each row execute function public.tg_clear_disabled_geofence_states();

alter table public.vehicle_odometer add constraint vehicle_odometer_reading_nonnegative check(reading_km>=0) not valid;
create function public.tg_validate_vehicle_odometer() returns trigger language plpgsql security definer set search_path='' as $fn$
declare previous_km numeric;next_km numeric;
begin
 if new.recorded_at>now() then raise exception 'odometer_reading_in_future' using errcode='22023';end if;
 if not exists(select 1 from public.vehicles v where v.tenant_id=new.tenant_id and v.id=new.vehicle_id) then raise exception 'odometer_vehicle_not_found_in_tenant' using errcode='23503';end if;
 perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text||':vehicle-odometer:'||new.vehicle_id::text,0));
 select max(reading_km) into previous_km from public.vehicle_odometer where tenant_id=new.tenant_id and vehicle_id=new.vehicle_id and recorded_at<=new.recorded_at;
 select min(reading_km) into next_km from public.vehicle_odometer where tenant_id=new.tenant_id and vehicle_id=new.vehicle_id and recorded_at>new.recorded_at;
 if previous_km is not null and new.reading_km<previous_km or next_km is not null and new.reading_km>next_km then raise exception 'odometer_reading_not_monotonic' using errcode='23514';end if;
 return new;
end;$fn$;
create function public.tg_sync_vehicle_odometer() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 update public.vehicles v set odometer_km=new.reading_km,updated_at=now() where v.tenant_id=new.tenant_id and v.id=new.vehicle_id
  and not exists(select 1 from public.vehicle_odometer later where later.tenant_id=new.tenant_id and later.vehicle_id=new.vehicle_id and (later.recorded_at,later.id)>(new.recorded_at,new.id));
 return new;
end;$fn$;
revoke all on function public.tg_validate_vehicle_odometer(),public.tg_sync_vehicle_odometer() from public,anon,authenticated,service_role;
drop trigger if exists validate_vehicle_odometer on public.vehicle_odometer;
create trigger validate_vehicle_odometer before insert on public.vehicle_odometer for each row execute function public.tg_validate_vehicle_odometer();
drop trigger if exists sync_vehicle_odometer on public.vehicle_odometer;
create trigger sync_vehicle_odometer after insert on public.vehicle_odometer for each row execute function public.tg_sync_vehicle_odometer();

create function public.tg_validate_vehicle_fueling_time() returns trigger language plpgsql set search_path='' as $fn$
begin if new.fueled_at>now() then raise exception 'fueling_in_future' using errcode='22023';end if;return new;end;$fn$;
revoke all on function public.tg_validate_vehicle_fueling_time() from public,anon,authenticated,service_role;
drop trigger if exists validate_vehicle_fueling_time on public.vehicle_fueling;
create trigger validate_vehicle_fueling_time before insert on public.vehicle_fueling for each row execute function public.tg_validate_vehicle_fueling_time();

create function public.tg_validate_vehicle_maintenance_tenant() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if not exists(select 1 from public.vehicles x where x.tenant_id=new.tenant_id and x.id=new.vehicle_id) then raise exception 'maintenance_vehicle_not_found_in_tenant' using errcode='23503';end if;
 if new.asset_id is not null and not exists(select 1 from public.assets x where x.tenant_id=new.tenant_id and x.id=new.asset_id) then raise exception 'maintenance_asset_not_found_in_tenant' using errcode='23503';end if;
 if new.employee_id is not null and not exists(select 1 from public.employees x where x.tenant_id=new.tenant_id and x.id=new.employee_id) then raise exception 'maintenance_employee_not_found_in_tenant' using errcode='23503';end if;
 if new.incident_id is not null and not exists(select 1 from public.incidents x where x.tenant_id=new.tenant_id and x.id=new.incident_id) then raise exception 'maintenance_incident_not_found_in_tenant' using errcode='23503';end if;
 return new;
end;$fn$;
revoke all on function public.tg_validate_vehicle_maintenance_tenant() from public,anon,authenticated,service_role;
drop trigger if exists validate_vehicle_maintenance_tenant on public.vehicle_maintenance;
create trigger validate_vehicle_maintenance_tenant before insert or update of tenant_id,vehicle_id,asset_id,employee_id,incident_id on public.vehicle_maintenance for each row execute function public.tg_validate_vehicle_maintenance_tenant();

-- Validate every relation carried by an occurrence import before the legacy
-- atomic implementation inserts any row.
create or replace function public.import_occurrence_report_batch_v1(_batch jsonb,_occurrences jsonb default '[]') returns jsonb language plpgsql security definer set search_path='' as $fn$
declare t uuid:=nullif(_batch->>'tenant_id','')::uuid;r uuid:=nullif(_batch->>'request_id','')::uuid;h text;stored finance_private.atomic_command_results%rowtype;out jsonb;x record;
begin
 if auth.uid() is null or t is null or not public.is_tenant_operator_or_admin(t) then raise exception 'operator_required' using errcode='42501';end if;
 if r is null then raise exception 'request_id_required' using errcode='22023';end if;
 for x in select * from jsonb_to_recordset(_occurrences) as q(client_id uuid,supplier_id uuid,load_id uuid,driver_id uuid,fiscal_document_id uuid,cte_document_id uuid,responsible_user_id uuid) loop
  perform finance_private.assert_tenant_reference('public.clients',t,x.client_id,'client');
  perform finance_private.assert_tenant_reference('public.clients',t,x.supplier_id,'supplier');
  perform finance_private.assert_tenant_reference('public.loads',t,x.load_id,'load');
  perform finance_private.assert_tenant_reference('public.drivers',t,x.driver_id,'driver');
  perform finance_private.assert_tenant_reference('public.fiscal_documents',t,x.fiscal_document_id,'fiscal_document');
  perform finance_private.assert_tenant_reference('public.cte_documents',t,x.cte_document_id,'cte_document');
  if x.responsible_user_id is not null and not exists(select 1 from public.tenant_memberships m where m.tenant_id=t and m.user_id=x.responsible_user_id) then raise exception 'responsible_user_not_found_in_tenant' using errcode='23503';end if;
 end loop;
 h:=encode(sha256(convert_to((jsonb_build_object('batch',_batch-'request_id','occurrences',_occurrences))::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended(t::text||':occurrence-import:'||r::text,0));
 select * into stored from finance_private.atomic_command_results where tenant_id=t and action='import_occurrence_report' and request_id=r;
 if found then if stored.payload_hash<>h then raise exception 'request_payload_mismatch' using errcode='22023';end if;return stored.result;end if;
 out:=finance_private.import_occurrence_report_unsafe_20260917(_batch,_occurrences);
 insert into finance_private.atomic_command_results values(t,'import_occurrence_report',r,h,out,auth.uid(),now());return out;
end;$fn$;

-- Adjustment direction is translated only for the old balance mutator, then
-- restored atomically on the immutable movement row.
create or replace function public.create_stock_movement_v1(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare t uuid:=nullif(_payload->>'tenant_id','')::uuid;r uuid:=nullif(_payload->>'request_id','')::uuid;h text;stored finance_private.atomic_command_results%rowtype;out jsonb;kind text:=nullif(_payload->>'movement_type','');direction text:=nullif(_payload->>'adjustment_direction','');call_payload jsonb;movement_id uuid;
begin
 if auth.uid() is null or t is null or not public.is_tenant_admin(t) then raise exception 'admin_required' using errcode='42501';end if;
 if r is null then raise exception 'request_id_required' using errcode='22023';end if;
 if kind is null or kind not in('inbound','outbound','transfer','return','reserve','adjustment','consumption') then raise exception 'unsupported_stock_movement_type' using errcode='22023';end if;
 if kind='adjustment' and direction not in('increase','decrease') then raise exception 'stock_adjustment_direction_required' using errcode='22023';end if;
 if kind<>'adjustment' and direction is not null then raise exception 'stock_adjustment_direction_not_allowed' using errcode='22023';end if;
 perform finance_private.assert_tenant_reference('public.employees',t,nullif(_payload->>'employee_id','')::uuid,'employee');perform finance_private.assert_tenant_reference('public.employees',t,nullif(_payload->>'responsible_employee_id','')::uuid,'responsible_employee');
 perform finance_private.assert_tenant_reference('public.vehicles',t,nullif(_payload->>'vehicle_id','')::uuid,'vehicle');perform finance_private.assert_tenant_reference('public.assets',t,nullif(_payload->>'asset_id','')::uuid,'asset');
 perform finance_private.assert_tenant_reference('public.maintenance_orders',t,nullif(_payload->>'maintenance_order_id','')::uuid,'maintenance_order');perform finance_private.assert_tenant_reference('public.incidents',t,nullif(_payload->>'incident_id','')::uuid,'incident');
 h:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended(t::text||':stock:'||r::text,0));
 select * into stored from finance_private.atomic_command_results where tenant_id=t and action='create_stock_movement' and request_id=r;if found then if stored.payload_hash<>h then raise exception 'request_payload_mismatch' using errcode='22023';end if;return stored.result;end if;
 call_payload:=case when kind='adjustment' then jsonb_set(_payload,'{movement_type}',to_jsonb(case when direction='increase' then 'inbound' else 'outbound' end)) else _payload end;
 out:=finance_private.create_stock_movement_unsafe_20260917(call_payload);movement_id:=(out->>'id')::uuid;
 if kind='adjustment' then update public.stock_movements set movement_type='adjustment',adjustment_direction=direction where tenant_id=t and id=movement_id;end if;
 out:=out||jsonb_build_object('movement_type',kind,'adjustment_direction',direction);
 insert into finance_private.atomic_command_results values(t,'create_stock_movement',r,h,out,auth.uid(),now());return out;
end;$fn$;

create or replace function public.change_payroll_period_state_v2(_period_id uuid,_action text,_reason text,_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare t uuid;h text;stored finance_private.atomic_command_results%rowtype;out jsonb;
begin
 select tenant_id into t from public.payroll_periods where id=_period_id;
 if auth.uid() is null or t is null or not public.is_tenant_admin(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _request_id is null then raise exception 'request_id_required' using errcode='22023';end if;
 h:=encode(sha256(convert_to(jsonb_build_object('period_id',_period_id,'action',_action,'reason',btrim(_reason))::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(t::text||':payroll-lifecycle:'||_request_id::text,0));
 select * into stored from finance_private.atomic_command_results where tenant_id=t and action='payroll_period_'||_action and request_id=_request_id;
 if found then if stored.payload_hash<>h then raise exception 'request_payload_mismatch' using errcode='22023';end if;return stored.result;end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform finance_private.change_payroll_period_state_unsafe_20260917(_period_id,_action,_reason);
 out:=jsonb_build_object('ok',true,'period_id',_period_id,'action',_action,'request_id',_request_id);
 insert into finance_private.atomic_command_results values(t,'payroll_period_'||_action,_request_id,h,out,auth.uid(),now());return out;
end;$fn$;

do $prorate_payroll$
declare body text;changed text;
begin
 select pg_get_functiondef('public.generate_payroll_period(uuid,date,date,text,boolean,boolean)'::regprocedure) into body;
 changed:=replace(body,'c.id AS contract_id, c.contract_type, c.base_salary','c.id AS contract_id, c.contract_type, c.base_salary, c.start_date contract_start, c.end_date contract_end');
 changed:=replace(changed,$old$'base_salary','credit','Salário base do contrato', _emp.base_salary,$old$,
 $new$'base_salary','credit','Salário base proporcional do contrato', round(_emp.base_salary *
          ((least(coalesce(_emp.contract_end,_period_end),_period_end)-greatest(_emp.contract_start,_period_start)+1)::numeric /
           (_period_end-_period_start+1)::numeric),2),$new$);
 if changed=body then raise exception 'payroll_proration_contract_changed';end if;execute changed;
end;$prorate_payroll$;
