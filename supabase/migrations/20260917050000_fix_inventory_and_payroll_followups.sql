-- Live queue 244-248, 252, 255-259.
revoke execute on function finance_private.assert_tenant_reference(regclass,uuid,uuid,text) from authenticated;

alter table public.inventory_movements add column if not exists adjustment_direction text;
alter table public.inventory_movements add constraint inventory_movements_supported_type
 check(movement_type in('inbound','outbound','adjustment')) not valid;
alter table public.inventory_movements add constraint inventory_adjustment_direction
 check((movement_type='adjustment' and adjustment_direction in('increase','decrease')) or (movement_type<>'adjustment' and adjustment_direction is null)) not valid;
do $merge_inventory_duplicates$
declare g record;keeper uuid;
begin
 for g in select tenant_id,location_id,client_id,item_description,sum(quantity) quantity,sum(pallet_count) pallets,
   sum(weight_kg) weight,sum(volume_m3) volume,min(first_inbound_at) first_inbound,max(last_movement_at) last_movement
  from public.inventory_balances group by tenant_id,location_id,client_id,item_description having count(*)>1 loop
  select id into keeper from public.inventory_balances where tenant_id=g.tenant_id and location_id is not distinct from g.location_id
   and client_id is not distinct from g.client_id and item_description=g.item_description order by updated_at,id limit 1;
  update public.inventory_balances set quantity=g.quantity,pallet_count=g.pallets,weight_kg=g.weight,volume_m3=g.volume,
   first_inbound_at=g.first_inbound,last_movement_at=g.last_movement,updated_at=now() where id=keeper;
  delete from public.inventory_balances where tenant_id=g.tenant_id and location_id is not distinct from g.location_id
   and client_id is not distinct from g.client_id and item_description=g.item_description and id<>keeper;
 end loop;
end;$merge_inventory_duplicates$;
alter table public.inventory_balances drop constraint inventory_balances_tenant_id_location_id_client_id_item_des_key;
alter table public.inventory_balances add constraint inventory_balances_logical_key
 unique nulls not distinct(tenant_id,location_id,client_id,item_description);
alter table public.inventory_balances add constraint inventory_balances_dimensions_nonnegative
 check(quantity>=0 and pallet_count>=0 and weight_kg>=0 and volume_m3>=0) not valid;

create or replace function public.update_inventory_balance() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare sign integer;available public.inventory_balances%rowtype;
begin
 if new.movement_type not in('inbound','outbound','adjustment') then raise exception 'unsupported_inventory_movement_type' using errcode='22023';end if;
 if new.movement_type='adjustment' and new.adjustment_direction not in('increase','decrease') then raise exception 'inventory_adjustment_direction_required' using errcode='22023';end if;
 if new.movement_type<>'adjustment' and new.adjustment_direction is not null then raise exception 'inventory_adjustment_direction_not_allowed' using errcode='22023';end if;
 if new.quantity<=0 or coalesce(new.pallet_count,0)<0 or coalesce(new.weight_kg,0)<0 or coalesce(new.volume_m3,0)<0 then raise exception 'inventory_values_must_be_nonnegative' using errcode='22023';end if;
 if new.location_id is not null and not exists(select 1 from public.inventory_locations x where x.tenant_id=new.tenant_id and x.id=new.location_id) then raise exception 'inventory_location_not_found_in_tenant' using errcode='23503';end if;
 if new.client_id is not null and not exists(select 1 from public.clients x where x.tenant_id=new.tenant_id and x.id=new.client_id) then raise exception 'inventory_client_not_found_in_tenant' using errcode='23503';end if;
 if new.fiscal_document_id is not null and not exists(select 1 from public.fiscal_documents x where x.tenant_id=new.tenant_id and x.id=new.fiscal_document_id) then raise exception 'inventory_document_not_found_in_tenant' using errcode='23503';end if;
 sign:=case when new.movement_type='inbound' or new.adjustment_direction='increase' then 1 else -1 end;
 select * into available from public.inventory_balances where tenant_id=new.tenant_id and location_id is not distinct from new.location_id
  and client_id is not distinct from new.client_id and item_description=new.item_description for update;
 if sign<0 and (not found or available.quantity<new.quantity or available.pallet_count<coalesce(new.pallet_count,0)
  or available.weight_kg<coalesce(new.weight_kg,0) or available.volume_m3<coalesce(new.volume_m3,0)) then
  raise exception 'insufficient_inventory_balance' using errcode='23514';
 end if;
 insert into public.inventory_balances(tenant_id,location_id,client_id,item_description,quantity,pallet_count,weight_kg,volume_m3,first_inbound_at,last_movement_at)
 values(new.tenant_id,new.location_id,new.client_id,new.item_description,new.quantity*sign,coalesce(new.pallet_count,0)*sign,
  coalesce(new.weight_kg,0)*sign,coalesce(new.volume_m3,0)*sign,case when sign>0 then new.moved_at end,new.moved_at)
 on conflict(tenant_id,location_id,client_id,item_description) do update set
  quantity=public.inventory_balances.quantity+excluded.quantity,pallet_count=public.inventory_balances.pallet_count+excluded.pallet_count,
  weight_kg=public.inventory_balances.weight_kg+excluded.weight_kg,volume_m3=public.inventory_balances.volume_m3+excluded.volume_m3,
  first_inbound_at=case when public.inventory_balances.quantity=0 and excluded.quantity>0 then excluded.first_inbound_at else coalesce(public.inventory_balances.first_inbound_at,excluded.first_inbound_at) end,
  last_movement_at=excluded.last_movement_at,updated_at=now();
 return new;
end;$fn$;
revoke all on function public.update_inventory_balance() from public,anon,authenticated,service_role;
grant execute on function public.update_inventory_balance() to service_role;

alter table public.stock_movements add column if not exists adjustment_direction text;
alter table public.stock_movements add constraint stock_adjustment_direction
 check((movement_type='adjustment' and adjustment_direction in('increase','decrease')) or (movement_type<>'adjustment' and adjustment_direction is null)) not valid;

create or replace function public.create_stock_movement_v1(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare t uuid:=nullif(_payload->>'tenant_id','')::uuid;r uuid:=nullif(_payload->>'request_id','')::uuid;h text;stored finance_private.atomic_command_results%rowtype;out jsonb;kind text:=nullif(_payload->>'movement_type','');direction text:=nullif(_payload->>'adjustment_direction','');qty numeric:=nullif(_payload->>'quantity','')::numeric;movement_id uuid;
begin
 if auth.uid() is null or t is null or not public.is_tenant_admin(t) then raise exception 'admin_required' using errcode='42501';end if;
 if r is null then raise exception 'request_id_required' using errcode='22023';end if;
 if kind is null or kind not in('inbound','outbound','transfer','return','reserve','adjustment','consumption') then raise exception 'unsupported_stock_movement_type' using errcode='22023';end if;
 if kind='adjustment' and direction not in('increase','decrease') then raise exception 'stock_adjustment_direction_required' using errcode='22023';end if;
 if kind<>'adjustment' and direction is not null then raise exception 'stock_adjustment_direction_not_allowed' using errcode='22023';end if;
 perform finance_private.assert_tenant_reference('public.employees',t,nullif(_payload->>'employee_id','')::uuid,'employee');
 perform finance_private.assert_tenant_reference('public.employees',t,nullif(_payload->>'responsible_employee_id','')::uuid,'responsible_employee');
 perform finance_private.assert_tenant_reference('public.vehicles',t,nullif(_payload->>'vehicle_id','')::uuid,'vehicle');
 perform finance_private.assert_tenant_reference('public.assets',t,nullif(_payload->>'asset_id','')::uuid,'asset');
 perform finance_private.assert_tenant_reference('public.maintenance_orders',t,nullif(_payload->>'maintenance_order_id','')::uuid,'maintenance_order');
 perform finance_private.assert_tenant_reference('public.incidents',t,nullif(_payload->>'incident_id','')::uuid,'incident');
 h:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');perform pg_advisory_xact_lock(hashtextextended(t::text||':stock:'||r::text,0));
 select * into stored from finance_private.atomic_command_results where tenant_id=t and action='create_stock_movement' and request_id=r;
 if found then if stored.payload_hash<>h then raise exception 'request_payload_mismatch' using errcode='22023';end if;return stored.result;end if;
 out:=finance_private.create_stock_movement_unsafe_20260917(_payload);movement_id:=(out->>'id')::uuid;
 update public.stock_movements set adjustment_direction=direction where tenant_id=t and id=movement_id;
 if kind='adjustment' and direction='increase' then update public.stock_items set current_quantity=current_quantity+qty*2,updated_at=now() where tenant_id=t and id=nullif(_payload->>'stock_item_id','')::uuid;end if;
 out:=out||jsonb_build_object('adjustment_direction',direction);
 insert into finance_private.atomic_command_results values(t,'create_stock_movement',r,h,out,auth.uid(),now());return out;
end;$fn$;

-- Preserve one request identity across uncertain payroll lifecycle responses.
alter function public.change_payroll_period_state(uuid,text,text) rename to change_payroll_period_state_unsafe_20260917;
alter function public.change_payroll_period_state_unsafe_20260917(uuid,text,text) set schema finance_private;
revoke all on function finance_private.change_payroll_period_state_unsafe_20260917(uuid,text,text) from public,anon,authenticated,service_role;
create function public.change_payroll_period_state_v2(_period_id uuid,_action text,_reason text,_request_id uuid)
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
 perform finance_private.change_payroll_period_state_unsafe_20260917(_period_id,_action,_reason);
 out:=jsonb_build_object('ok',true,'period_id',_period_id,'action',_action,'request_id',_request_id);
 insert into finance_private.atomic_command_results values(t,'payroll_period_'||_action,_request_id,h,out,auth.uid(),now());return out;
end;$fn$;
revoke all on function public.change_payroll_period_state_v2(uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.change_payroll_period_state_v2(uuid,text,text,uuid) to authenticated;

-- Patch the legacy payroll generator in place while keeping all surrounding
-- lifecycle/closed-period guards installed by earlier migrations.
do $patch_payroll$
declare body text;changed text;
begin
 select pg_get_functiondef('public.generate_payroll_period(uuid,date,date,text,boolean,boolean)'::regprocedure) into body;
 changed:=replace(body,
 $old$LEFT JOIN public.employee_contracts c
      ON c.employee_id = e.id AND c.active = true AND c.tenant_id = _tenant_id$old$,
 $new$LEFT JOIN LATERAL (select c0.* from public.employee_contracts c0 where c0.employee_id=e.id and c0.tenant_id=_tenant_id
      and c0.start_date<=_period_end and (c0.end_date is null or c0.end_date>=_period_start)
      order by c0.start_date desc,c0.id desc limit 1) c ON true$new$);
 changed:=replace(changed,
 $old$ON CONFLICT (payroll_period_id, employee_id) DO NOTHING
    RETURNING id INTO _entry_id;$old$,
 $new$ON CONFLICT (payroll_period_id, employee_id) DO UPDATE SET driver_id=excluded.driver_id,contract_id=excluded.contract_id,
      entry_type=excluded.entry_type,updated_at=now() WHERE payroll_entries.status in('draft','calculated')
    RETURNING id INTO _entry_id;$new$);
 changed:=replace(changed,
 $old$delete from public.payroll_entries e where e.tenant_id=_tenant_id and e.payroll_period_id=_period_id and e.status in('draft','calculated')
    and ((_include_drivers=false and e.driver_id is not null) or (_include_non_drivers=false and e.driver_id is null));$old$,
 $new$delete from public.payroll_entries pe where pe.tenant_id=_tenant_id and pe.payroll_period_id=_period_id and pe.status in('draft','calculated')
    and (not exists(select 1 from public.employees e where e.tenant_id=_tenant_id and e.id=pe.employee_id
      and (e.status is null or e.status in('active','on_leave'))
      and ((_include_drivers and e.driver_id is not null) or (_include_non_drivers and e.driver_id is null))));$new$);
 if changed=body then raise exception 'payroll_generator_contract_changed';end if;
 execute changed;
end;$patch_payroll$;
