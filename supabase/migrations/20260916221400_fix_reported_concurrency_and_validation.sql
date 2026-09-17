-- Reported bug fixes: concurrency-safe commands and domain validation.

alter table public.stock_items
  add constraint stock_items_quantity_nonnegative check (current_quantity is null or current_quantity >= 0) not valid,
  add constraint stock_items_unit_cost_nonnegative check (unit_cost is null or unit_cost >= 0) not valid;
alter table public.stock_movements
  add constraint stock_movements_quantity_positive check (quantity > 0) not valid,
  add constraint stock_movements_unit_cost_nonnegative check (unit_cost is null or unit_cost >= 0) not valid,
  add constraint stock_movements_total_cost_nonnegative check (total_cost is null or total_cost >= 0) not valid;
alter table public.inventory_movements
  add constraint inventory_movements_quantity_positive check (quantity > 0) not valid,
  add constraint inventory_movements_pallets_nonnegative check (pallet_count is null or pallet_count >= 0) not valid,
  add constraint inventory_movements_weight_nonnegative check (weight_kg is null or weight_kg >= 0) not valid,
  add constraint inventory_movements_volume_nonnegative check (volume_m3 is null or volume_m3 >= 0) not valid,
  add constraint inventory_movements_transfer_requires_destination check (movement_type <> 'transfer') not valid;
alter table public.inventory_balances
  add constraint inventory_balances_quantity_nonnegative check (quantity >= 0) not valid,
  add constraint inventory_balances_pallets_nonnegative check (pallet_count >= 0) not valid;
alter table public.maintenance_orders
  add constraint maintenance_orders_odometer_nonnegative check (odometer_km is null or odometer_km >= 0) not valid,
  add constraint maintenance_orders_parts_cost_nonnegative check (parts_cost is null or parts_cost >= 0) not valid,
  add constraint maintenance_orders_labor_cost_nonnegative check (labor_cost is null or labor_cost >= 0) not valid,
  add constraint maintenance_orders_total_cost_nonnegative check (total_cost is null or total_cost >= 0) not valid;
alter table public.receivables
  add constraint receivables_amount_positive check (amount > 0) not valid;
alter table public.orders
  add constraint orders_quantity_nonnegative check (quantity is null or quantity >= 0) not valid,
  add constraint orders_pallet_count_nonnegative check (pallet_count is null or pallet_count >= 0) not valid,
  add constraint orders_weight_nonnegative check (weight_kg is null or weight_kg >= 0) not valid,
  add constraint orders_volume_nonnegative check (volume_m3 is null or volume_m3 >= 0) not valid,
  add constraint orders_value_nonnegative check (value is null or value >= 0) not valid,
  add constraint orders_freight_weight_nonnegative check (freight_weight_value is null or freight_weight_value >= 0) not valid,
  add constraint orders_freight_delivery_nonnegative check (freight_delivery_value is null or freight_delivery_value >= 0) not valid,
  add constraint orders_insurance_nonnegative check (insurance_value is null or insurance_value >= 0) not valid,
  add constraint orders_toll_nonnegative check (toll_value is null or toll_value >= 0) not valid,
  add constraint orders_loading_nonnegative check (loading_value is null or loading_value >= 0) not valid,
  add constraint orders_tracking_nonnegative check (tracking_value is null or tracking_value >= 0) not valid,
  add constraint orders_gris_nonnegative check (gris_value is null or gris_value >= 0) not valid,
  add constraint orders_other_costs_nonnegative check (other_costs is null or other_costs >= 0) not valid,
  add constraint orders_discount_nonnegative check (discount_value is null or discount_value >= 0) not valid,
  add constraint orders_tax_bases_nonnegative check (
    (icms_base is null or icms_base >= 0) and (cbs_base is null or cbs_base >= 0) and (ibs_base is null or ibs_base >= 0)
  ) not valid,
  add constraint orders_tax_rates_nonnegative check (
    (icms_rate is null or icms_rate >= 0) and (pis_rate is null or pis_rate >= 0) and
    (cofins_rate is null or cofins_rate >= 0) and (cbs_rate is null or cbs_rate >= 0) and
    (ibs_rate is null or ibs_rate >= 0)
  ) not valid;

create unique index if not exists fiscal_documents_one_outbound_per_load_uidx
  on public.fiscal_documents(tenant_id, load_id)
  where document_type = 'outbound' and load_id is not null and deleted_at is null;

create or replace function public.create_pickup_order_v1(_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' set row_security='on' as $$
declare
  v_tenant uuid := nullif(_payload->>'tenant_id','')::uuid;
  v_number text;
  v_row public.pickup_orders%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if v_tenant is null or not public.is_tenant_operator_or_admin(v_tenant) then raise exception 'operator_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pickup:' || v_tenant::text, 0));
  select coalesce(max((regexp_match(pickup_number, '[0-9]+$'))[1]::integer),0)+1::integer
    into v_number from public.pickup_orders where tenant_id=v_tenant;
  insert into public.pickup_orders(
    tenant_id,pickup_number,remitter_client_id,remitter_name,remitter_cnpj,
    recipient_name,driver_id,driver_name_snapshot,vehicle_id,vehicle_plate_snapshot,
    pickup_at,status,notes,manual_meta,created_by
  ) values (
    v_tenant,v_number,
    nullif(_payload->>'remitter_client_id','')::uuid,nullif(_payload->>'remitter_name',''),nullif(_payload->>'remitter_cnpj',''),
    nullif(_payload->>'recipient_name',''),nullif(_payload->>'driver_id','')::uuid,nullif(_payload->>'driver_name_snapshot',''),
    nullif(_payload->>'vehicle_id','')::uuid,nullif(_payload->>'vehicle_plate_snapshot',''),
    coalesce(nullif(_payload->>'pickup_at','')::timestamptz,now()),coalesce(nullif(_payload->>'status',''),'pendente'),
    nullif(_payload->>'notes',''),_payload->'manual_meta',auth.uid()
  ) returning * into v_row;
  return to_jsonb(v_row);
end $$;
revoke all on function public.create_pickup_order_v1(jsonb) from public,anon;
grant execute on function public.create_pickup_order_v1(jsonb) to authenticated;

create or replace function public.request_client_pickup(_tenant_id uuid, _client_id uuid, _pickup_at timestamptz, _recipient_name text default null, _notes text default null)
returns uuid language plpgsql security definer set search_path='public' as $$
declare v_id uuid; v_num text; v_requester_name text; v_requester_doc text;
begin
  if not public._portal_user_has_perm(_tenant_id,_client_id,'can_request_pickup') then raise exception 'Permission denied: cannot request pickup for this client'; end if;
  select coalesce(c.trade_name,c.company_name,c.legal_name),c.tax_id into v_requester_name,v_requester_doc
    from public.clients c where c.id=_client_id and c.tenant_id=_tenant_id;
  if v_requester_name is null then raise exception 'Client not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pickup:' || _tenant_id::text,0));
  select (coalesce(max((regexp_match(pickup_number,'[0-9]+$'))[1]::integer),0)+1)::text into v_num
    from public.pickup_orders where tenant_id=_tenant_id;
  insert into public.pickup_orders(tenant_id,pickup_number,remitter_client_id,remitter_name,remitter_cnpj,recipient_name,pickup_at,status,notes,created_by)
  values(_tenant_id,v_num,_client_id,v_requester_name,v_requester_doc,_recipient_name,_pickup_at,'pendente',_notes,auth.uid()) returning id into v_id;
  perform public._log_entity_audit(_tenant_id,'pickup_order',v_id,'create_by_client',null,jsonb_build_object('client_id',_client_id,'pickup_at',_pickup_at),'portal');
  return v_id;
end $$;

create or replace function public.create_stock_movement_v1(_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' set row_security='on' as $$
declare
  v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid;
  v_item uuid:=nullif(_payload->>'stock_item_id','')::uuid;
  v_type text:=nullif(_payload->>'movement_type','');
  v_qty numeric:=nullif(_payload->>'quantity','')::numeric;
  v_unit_cost numeric:=nullif(_payload->>'unit_cost','')::numeric;
  v_current numeric;
  v_delta numeric;
  v_row public.stock_movements%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if v_tenant is null or not public.is_tenant_admin(v_tenant) then raise exception 'admin_required'; end if;
  if v_qty is null or v_qty<=0 then raise exception 'quantity_must_be_positive'; end if;
  if v_unit_cost is not null and v_unit_cost<0 then raise exception 'unit_cost_must_be_nonnegative'; end if;
  if v_type='transfer' and (nullif(_payload->>'from_branch','') is null or nullif(_payload->>'to_branch','') is null or _payload->>'from_branch'=_payload->>'to_branch') then
    raise exception 'transfer_requires_distinct_branches';
  end if;
  select coalesce(current_quantity,0) into v_current from public.stock_items where id=v_item and tenant_id=v_tenant for update;
  if not found then raise exception 'stock_item_not_found'; end if;
  v_delta:=case when v_type in ('inbound','return') then v_qty when v_type='transfer' then 0 else -v_qty end;
  if v_current+v_delta<0 then raise exception 'insufficient_stock'; end if;
  insert into public.stock_movements(tenant_id,stock_item_id,movement_type,quantity,reason,moved_at,unit_cost,total_cost,
    from_branch,to_branch,employee_id,responsible_employee_id,vehicle_id,asset_id,maintenance_order_id,incident_id,cost_center,justification,created_by)
  values(v_tenant,v_item,v_type,v_qty,coalesce(nullif(_payload->>'reason',''),'Movimentação de estoque'),
    coalesce(nullif(_payload->>'moved_at','')::timestamptz,now()),v_unit_cost,case when v_unit_cost is null then null else v_unit_cost*v_qty end,
    nullif(_payload->>'from_branch',''),nullif(_payload->>'to_branch',''),nullif(_payload->>'employee_id','')::uuid,
    nullif(_payload->>'responsible_employee_id','')::uuid,nullif(_payload->>'vehicle_id','')::uuid,nullif(_payload->>'asset_id','')::uuid,
    nullif(_payload->>'maintenance_order_id','')::uuid,nullif(_payload->>'incident_id','')::uuid,nullif(_payload->>'cost_center',''),
    nullif(_payload->>'justification',''),auth.uid()) returning * into v_row;
  update public.stock_items set current_quantity=v_current+v_delta,updated_at=now() where id=v_item and tenant_id=v_tenant;
  return to_jsonb(v_row);
end $$;
revoke all on function public.create_stock_movement_v1(jsonb) from public,anon;
grant execute on function public.create_stock_movement_v1(jsonb) to authenticated;

create or replace function public.update_inventory_balance()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_sign integer; v_available numeric;
begin
  if new.movement_type='transfer' then raise exception 'inventory_transfer_requires_destination'; end if;
  if new.quantity<=0 or coalesce(new.pallet_count,0)<0 or coalesce(new.weight_kg,0)<0 or coalesce(new.volume_m3,0)<0 then raise exception 'inventory_values_must_be_nonnegative'; end if;
  v_sign:=case when new.movement_type in ('inbound','return') then 1 else -1 end;
  if v_sign<0 then
    select coalesce(quantity,0) into v_available from public.inventory_balances
      where tenant_id=new.tenant_id and location_id is not distinct from new.location_id
        and client_id is not distinct from new.client_id and item_description=new.item_description for update;
    if coalesce(v_available,0)<new.quantity then raise exception 'insufficient_inventory_balance'; end if;
  end if;
  insert into public.inventory_balances(tenant_id,location_id,client_id,item_description,quantity,pallet_count,weight_kg,volume_m3,first_inbound_at,last_movement_at)
  values(new.tenant_id,new.location_id,new.client_id,new.item_description,new.quantity*v_sign,coalesce(new.pallet_count,0)*v_sign,
    coalesce(new.weight_kg,0)*v_sign,coalesce(new.volume_m3,0)*v_sign,case when v_sign>0 then new.moved_at end,new.moved_at)
  on conflict(tenant_id,location_id,client_id,item_description) do update set
    quantity=public.inventory_balances.quantity+excluded.quantity,
    pallet_count=public.inventory_balances.pallet_count+excluded.pallet_count,
    weight_kg=coalesce(public.inventory_balances.weight_kg,0)+excluded.weight_kg,
    volume_m3=coalesce(public.inventory_balances.volume_m3,0)+excluded.volume_m3,
    first_inbound_at=coalesce(public.inventory_balances.first_inbound_at,excluded.first_inbound_at),
    last_movement_at=excluded.last_movement_at,updated_at=now();
  return new;
end $$;

create or replace function public.save_route_template_v1(_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' set row_security='on' as $$
declare v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid; v_id uuid:=nullif(_payload->>'route_id','')::uuid; v_route public.route_templates%rowtype; v_waypoints jsonb:=coalesce(_payload->'waypoints','[]'::jsonb);
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if v_tenant is null or not public.is_tenant_admin(v_tenant) then raise exception 'admin_required'; end if;
  if jsonb_typeof(v_waypoints)<>'array' then raise exception 'invalid_waypoints'; end if;
  if v_id is null then
    insert into public.route_templates(tenant_id,name,corridor_geofence_id,corridor_inside_ratio_threshold,allowed_outside_minutes,route_speed_limit_kmh,enabled)
    values(v_tenant,_payload->>'name',nullif(_payload->>'corridor_geofence_id','')::uuid,nullif(_payload->>'corridor_inside_ratio_threshold','')::numeric,
      coalesce(nullif(_payload->>'allowed_outside_minutes','')::integer,5),nullif(_payload->>'route_speed_limit_kmh','')::integer,coalesce((_payload->>'enabled')::boolean,true)) returning * into v_route;
    v_id:=v_route.id;
  else
    update public.route_templates set name=_payload->>'name',corridor_geofence_id=nullif(_payload->>'corridor_geofence_id','')::uuid,
      corridor_inside_ratio_threshold=nullif(_payload->>'corridor_inside_ratio_threshold','')::numeric,
      allowed_outside_minutes=coalesce(nullif(_payload->>'allowed_outside_minutes','')::integer,5),
      route_speed_limit_kmh=nullif(_payload->>'route_speed_limit_kmh','')::integer,enabled=coalesce((_payload->>'enabled')::boolean,true)
      where id=v_id and tenant_id=v_tenant returning * into v_route;
    if not found then raise exception 'route_not_found'; end if;
  end if;
  delete from public.route_waypoints where route_id=v_id and tenant_id=v_tenant;
  insert into public.route_waypoints(tenant_id,route_id,waypoint_order,waypoint_type,label,address,poi_id,geofence_id,estimated_duration_min,notes,lat,lng)
  select v_tenant,v_id,coalesce(x.waypoint_order,ord-1),coalesce(x.waypoint_type,'stop'::public.waypoint_type),x.label,x.address,x.poi_id,x.geofence_id,x.estimated_duration_min,x.notes,x.lat,x.lng
  from jsonb_to_recordset(v_waypoints) with ordinality as x(waypoint_order integer,waypoint_type public.waypoint_type,label text,address text,poi_id uuid,geofence_id uuid,estimated_duration_min integer,notes text,lat double precision,lng double precision,ord bigint);
  return to_jsonb(v_route);
end $$;
revoke all on function public.save_route_template_v1(jsonb) from public,anon;
grant execute on function public.save_route_template_v1(jsonb) to authenticated;

create or replace function public.create_employee_contract_v1(_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' set row_security='on' as $$
declare v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid; v_employee uuid:=nullif(_payload->>'employee_id','')::uuid; v_start date:=(_payload->>'start_date')::date; v_active boolean:=coalesce((_payload->>'active')::boolean,true); v_row public.employee_contracts%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if v_tenant is null or not public.is_tenant_admin(v_tenant) then raise exception 'admin_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('employee-contract:'||v_employee::text,0));
  if v_active then update public.employee_contracts set active=false,end_date=v_start,updated_at=now(),updated_by=auth.uid() where tenant_id=v_tenant and employee_id=v_employee and active; end if;
  insert into public.employee_contracts(tenant_id,employee_id,contract_type,employment_regime,start_date,end_date,active,position_title,department,branch,cost_center,
    base_salary,hourly_rate,daily_rate,commission_rate,payment_cycle,payment_method,bank_info,notes,created_by)
  values(v_tenant,v_employee,coalesce(nullif(_payload->>'contract_type',''),'clt'),nullif(_payload->>'employment_regime',''),v_start,nullif(_payload->>'end_date','')::date,v_active,
    nullif(_payload->>'position_title',''),nullif(_payload->>'department',''),nullif(_payload->>'branch',''),nullif(_payload->>'cost_center',''),
    coalesce(nullif(_payload->>'base_salary','')::numeric,0),coalesce(nullif(_payload->>'hourly_rate','')::numeric,0),coalesce(nullif(_payload->>'daily_rate','')::numeric,0),
    coalesce(nullif(_payload->>'commission_rate','')::numeric,0),coalesce(nullif(_payload->>'payment_cycle',''),'monthly'),nullif(_payload->>'payment_method',''),
    coalesce(_payload->'bank_info','{}'::jsonb),nullif(_payload->>'notes',''),auth.uid()) returning * into v_row;
  return to_jsonb(v_row);
end $$;
revoke all on function public.create_employee_contract_v1(jsonb) from public,anon;
grant execute on function public.create_employee_contract_v1(jsonb) to authenticated;

create or replace function public.edit_pallet_return_protocol_v1(_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' set row_security='on' as $$
declare v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid; v_id uuid:=nullif(_payload->>'protocol_id','')::uuid; v_patch jsonb:=coalesce(_payload->'patch','{}'::jsonb); v_items jsonb:=_payload->'items'; v_status text; v_total numeric; v_row public.pallet_return_protocols%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if v_tenant is null or not public.is_tenant_operator_or_admin(v_tenant) then raise exception 'operator_required'; end if;
  select status into v_status from public.pallet_return_protocols where id=v_id and tenant_id=v_tenant for update;
  if not found then raise exception 'protocol_not_found'; end if;
  if v_status in ('confirmed','cancelled') then raise exception 'protocol_locked'; end if;
  if v_items is not null and jsonb_typeof(v_items)<>'array' then raise exception 'invalid_items'; end if;
  select coalesce(sum(x.quantity),0) into v_total from jsonb_to_recordset(coalesce(v_items,'[]'::jsonb)) as x(quantity numeric);
  if v_items is not null and (jsonb_array_length(v_items)=0 or exists(select 1 from jsonb_to_recordset(v_items) as x(quantity numeric) where x.quantity<=0)) then raise exception 'invalid_items'; end if;
  update public.pallet_return_protocols set supplier_name_snapshot=coalesce(nullif(v_patch->>'supplier_name_snapshot',''),supplier_name_snapshot),
    issue_date=coalesce(nullif(v_patch->>'issue_date','')::date,issue_date),returned_at=case when v_patch?'returned_at' then nullif(v_patch->>'returned_at','')::date else returned_at end,
    driver_name_snapshot=case when v_patch?'driver_name_snapshot' then nullif(v_patch->>'driver_name_snapshot','') else driver_name_snapshot end,
    vehicle_plate_snapshot=case when v_patch?'vehicle_plate_snapshot' then nullif(v_patch->>'vehicle_plate_snapshot','') else vehicle_plate_snapshot end,
    notes=case when v_patch?'notes' then nullif(v_patch->>'notes','') else notes end,total_quantity=case when v_items is null then total_quantity else v_total end,
    updated_at=now(),updated_by=auth.uid() where id=v_id and tenant_id=v_tenant returning * into v_row;
  if v_items is not null then
    delete from public.pallet_return_items where protocol_id=v_id and tenant_id=v_tenant;
    insert into public.pallet_return_items(tenant_id,protocol_id,pallet_type_id,pallet_type_code,pallet_type_name,pallet_color,quantity,notes,sort_order)
    select v_tenant,v_id,x.pallet_type_id,x.pallet_type_code,x.pallet_type_name,x.pallet_color,x.quantity,x.notes,coalesce(x.sort_order,ord-1)
    from jsonb_to_recordset(v_items) with ordinality as x(pallet_type_id uuid,pallet_type_code text,pallet_type_name text,pallet_color text,quantity numeric,notes text,sort_order integer,ord bigint);
  end if;
  insert into public.pallet_return_history(tenant_id,protocol_id,action,reason,metadata,created_by)
  values(v_tenant,v_id,'edited',nullif(_payload->>'reason',''),jsonb_build_object('patch',v_patch,'items_replaced',v_items is not null),auth.uid());
  return to_jsonb(v_row);
end $$;
revoke all on function public.edit_pallet_return_protocol_v1(jsonb) from public,anon;
grant execute on function public.edit_pallet_return_protocol_v1(jsonb) to authenticated;

alter table public.driver_route_progress_updates add column if not exists request_id uuid;
alter table public.driver_arrival_forecasts add column if not exists request_id uuid;
create unique index if not exists driver_progress_request_uidx on public.driver_route_progress_updates(tenant_id,request_id) where request_id is not null;
create unique index if not exists driver_forecast_request_uidx on public.driver_arrival_forecasts(tenant_id,request_id) where request_id is not null;

create or replace function public.add_driver_progress_v1(_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' set row_security='on' as $$
declare v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid; v_monitor uuid:=nullif(_payload->>'monitor_id','')::uuid; v_request uuid:=nullif(_payload->>'request_id','')::uuid; v_m public.driver_route_monitors%rowtype; v_row public.driver_route_progress_updates%rowtype; v_completed integer;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if v_tenant is null or not public.is_tenant_operator_or_admin(v_tenant) then raise exception 'operator_required'; end if;
  select * into v_row from public.driver_route_progress_updates where tenant_id=v_tenant and request_id=v_request;
  if found then return to_jsonb(v_row); end if;
  select * into v_m from public.driver_route_monitors where id=v_monitor and tenant_id=v_tenant for update;
  if not found then raise exception 'monitor_not_found'; end if;
  insert into public.driver_route_progress_updates(tenant_id,monitor_id,driver_id,load_id,update_date,city,deliveries_completed_in_city,next_city,next_city_deliveries,city_finished_at,observation,source_type,created_by,request_id)
  values(v_tenant,v_monitor,v_m.driver_id,v_m.load_id,(_payload->>'update_date')::date,nullif(_payload->>'city',''),greatest(coalesce((_payload->>'deliveries_completed_in_city')::integer,0),0),
    nullif(_payload->>'next_city',''),nullif(_payload->>'next_city_deliveries','')::integer,nullif(_payload->>'city_finished_at','')::timestamptz,nullif(_payload->>'observation',''),'manual',auth.uid(),v_request) returning * into v_row;
  select coalesce(sum(deliveries_completed_in_city),0) into v_completed from public.driver_route_progress_updates where tenant_id=v_tenant and monitor_id=v_monitor;
  update public.driver_route_monitors set completed_deliveries=v_completed,remaining_deliveries=greatest(total_deliveries-v_completed,0),
    current_city=coalesce(nullif(_payload->>'city',''),current_city),next_city=coalesce(nullif(_payload->>'next_city',''),next_city),last_update_at=now(),updated_at=now(),updated_by=auth.uid(),revision=revision+1
    where id=v_monitor and tenant_id=v_tenant;
  insert into public.driver_monitoring_history(tenant_id,monitor_id,action,new_value,created_by)
    values(v_tenant,v_monitor,'progress_update',coalesce(_payload->>'city','')||' (+'||coalesce(_payload->>'deliveries_completed_in_city','0')||')',auth.uid());
  return to_jsonb(v_row);
end $$;
revoke all on function public.add_driver_progress_v1(jsonb) from public,anon;
grant execute on function public.add_driver_progress_v1(jsonb) to authenticated;

create or replace function public.add_driver_forecast_v1(_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' set row_security='on' as $$
declare v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid; v_monitor uuid:=nullif(_payload->>'monitor_id','')::uuid; v_request uuid:=nullif(_payload->>'request_id','')::uuid; v_m public.driver_route_monitors%rowtype; v_row public.driver_arrival_forecasts%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if v_tenant is null or not public.is_tenant_operator_or_admin(v_tenant) then raise exception 'operator_required'; end if;
  select * into v_row from public.driver_arrival_forecasts where tenant_id=v_tenant and request_id=v_request;
  if found then return to_jsonb(v_row); end if;
  select * into v_m from public.driver_route_monitors where id=v_monitor and tenant_id=v_tenant for update;
  if not found then raise exception 'monitor_not_found'; end if;
  insert into public.driver_arrival_forecasts(tenant_id,monitor_id,driver_id,forecast_date,forecast_time,current_city,forecast_text,remaining_cities_text,observation,status,created_by,request_id)
  values(v_tenant,v_monitor,v_m.driver_id,(_payload->>'forecast_date')::date,nullif(_payload->>'forecast_time','')::time,nullif(_payload->>'current_city',''),nullif(_payload->>'forecast_text',''),nullif(_payload->>'remaining_cities_text',''),nullif(_payload->>'observation',''),'active',auth.uid(),v_request) returning * into v_row;
  update public.driver_route_monitors set arrival_forecast_text=nullif(_payload->>'forecast_text',''),current_city=coalesce(nullif(_payload->>'current_city',''),current_city),updated_at=now(),updated_by=auth.uid(),revision=revision+1
    where id=v_monitor and tenant_id=v_tenant;
  return to_jsonb(v_row);
end $$;
revoke all on function public.add_driver_forecast_v1(jsonb) from public,anon;
grant execute on function public.add_driver_forecast_v1(jsonb) to authenticated;
