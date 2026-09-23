do $merge_trimmed_inventory_balances$
declare
  grouped record;
  keeper uuid;
begin
  for grouped in
    select tenant_id,location_id,client_id,btrim(item_description) item_description,
      sum(quantity) quantity,sum(pallet_count) pallet_count,sum(weight_kg) weight_kg,
      sum(volume_m3) volume_m3,min(first_inbound_at) first_inbound_at,
      max(last_movement_at) last_movement_at
    from public.inventory_balances
    where btrim(item_description)<>''
    group by tenant_id,location_id,client_id,btrim(item_description)
    having count(*)>1 or bool_or(item_description<>btrim(item_description))
  loop
    select balance.id into keeper
    from public.inventory_balances balance
    where balance.tenant_id=grouped.tenant_id
      and balance.location_id is not distinct from grouped.location_id
      and balance.client_id is not distinct from grouped.client_id
      and btrim(balance.item_description)=grouped.item_description
    order by balance.updated_at desc,balance.id
    limit 1;

    delete from public.inventory_balances balance
    where balance.tenant_id=grouped.tenant_id
      and balance.location_id is not distinct from grouped.location_id
      and balance.client_id is not distinct from grouped.client_id
      and btrim(balance.item_description)=grouped.item_description
      and balance.id<>keeper;
    update public.inventory_balances
    set item_description=grouped.item_description,quantity=grouped.quantity,
      pallet_count=grouped.pallet_count,weight_kg=grouped.weight_kg,volume_m3=grouped.volume_m3,
      first_inbound_at=grouped.first_inbound_at,last_movement_at=grouped.last_movement_at,
      updated_at=clock_timestamp()
    where id=keeper;
  end loop;
end;
$merge_trimmed_inventory_balances$;

update public.inventory_movements
set item_description=btrim(item_description)
where item_description<>btrim(item_description) and btrim(item_description)<>'';

alter table public.inventory_movements
  add constraint inventory_movement_item_description_normalized
  check(item_description=btrim(item_description) and item_description<>'') not valid;
alter table public.inventory_balances
  add constraint inventory_balance_item_description_normalized
  check(item_description=btrim(item_description) and item_description<>'') not valid;

create or replace function public.update_inventory_balance() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare
  sign integer;
  available public.inventory_balances%rowtype;
  normalized_description text:=btrim(new.item_description);
begin
 if normalized_description='' then raise exception 'inventory_item_description_required' using errcode='22023';end if;
 if new.movement_type not in('inbound','outbound','adjustment') then raise exception 'unsupported_inventory_movement_type' using errcode='22023';end if;
 if new.movement_type='adjustment' and new.adjustment_direction not in('increase','decrease') then raise exception 'inventory_adjustment_direction_required' using errcode='22023';end if;
 if new.movement_type<>'adjustment' and new.adjustment_direction is not null then raise exception 'inventory_adjustment_direction_not_allowed' using errcode='22023';end if;
 if new.quantity<=0 or coalesce(new.pallet_count,0)<0 or coalesce(new.weight_kg,0)<0 or coalesce(new.volume_m3,0)<0 then raise exception 'inventory_values_must_be_nonnegative' using errcode='22023';end if;
 if new.location_id is not null and not exists(select 1 from public.inventory_locations x where x.tenant_id=new.tenant_id and x.id=new.location_id) then raise exception 'inventory_location_not_found_in_tenant' using errcode='23503';end if;
 if new.client_id is not null and not exists(select 1 from public.clients x where x.tenant_id=new.tenant_id and x.id=new.client_id) then raise exception 'inventory_client_not_found_in_tenant' using errcode='23503';end if;
 if new.fiscal_document_id is not null and not exists(select 1 from public.fiscal_documents x where x.tenant_id=new.tenant_id and x.id=new.fiscal_document_id) then raise exception 'inventory_document_not_found_in_tenant' using errcode='23503';end if;
 sign:=case when new.movement_type='inbound' or new.adjustment_direction='increase' then 1 else -1 end;
 select * into available from public.inventory_balances where tenant_id=new.tenant_id and location_id is not distinct from new.location_id
  and client_id is not distinct from new.client_id and item_description=normalized_description for update;
 if sign<0 and (not found or available.quantity<new.quantity or available.pallet_count<coalesce(new.pallet_count,0)
  or available.weight_kg<coalesce(new.weight_kg,0) or available.volume_m3<coalesce(new.volume_m3,0)) then
  raise exception 'insufficient_inventory_balance' using errcode='23514';
 end if;
 insert into public.inventory_balances(tenant_id,location_id,client_id,item_description,quantity,pallet_count,weight_kg,volume_m3,first_inbound_at,last_movement_at)
 values(new.tenant_id,new.location_id,new.client_id,normalized_description,new.quantity*sign,coalesce(new.pallet_count,0)*sign,
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
