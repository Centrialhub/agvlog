alter table public.inventory_movements add column if not exists request_id uuid;
alter table public.inventory_movements add column if not exists request_hash text;
create unique index if not exists inventory_movements_tenant_request_uidx
 on public.inventory_movements(tenant_id,request_id) where request_id is not null;

create or replace function public.create_inventory_movement_v1(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
 t uuid:=nullif(_payload->>'tenant_id','')::uuid;
 r uuid:=nullif(_payload->>'request_id','')::uuid;
 h text:=md5((_payload-'request_id')::text);
 existing public.inventory_movements%rowtype;
 created public.inventory_movements%rowtype;
begin
 if auth.uid() is null or not public.is_tenant_admin(t) then raise exception 'inventory_not_authorized' using errcode='42501';end if;
 if r is null then raise exception 'inventory_request_id_required' using errcode='22023';end if;
 select * into existing from public.inventory_movements where tenant_id=t and request_id=r;
 if found then
  if existing.request_hash is distinct from h then raise exception 'inventory_request_conflict' using errcode='23505';end if;
  return to_jsonb(existing);
 end if;
 insert into public.inventory_movements(
  id,tenant_id,location_id,movement_type,adjustment_direction,client_id,item_description,quantity,pallet_count,
  weight_kg,volume_m3,fiscal_document_id,notes,moved_at,created_at,created_by,request_id,request_hash
 ) values(
  gen_random_uuid(),t,nullif(_payload->>'location_id','')::uuid,_payload->>'movement_type',nullif(_payload->>'adjustment_direction',''),
  nullif(_payload->>'client_id','')::uuid,btrim(_payload->>'item_description'),(_payload->>'quantity')::numeric,
  coalesce((_payload->>'pallet_count')::integer,0),coalesce((_payload->>'weight_kg')::numeric,0),coalesce((_payload->>'volume_m3')::numeric,0),
  nullif(_payload->>'fiscal_document_id','')::uuid,nullif(_payload->>'notes',''),coalesce(nullif(_payload->>'moved_at','')::timestamptz,statement_timestamp()),
  statement_timestamp(),auth.uid(),r,h
 ) returning * into created;
 return to_jsonb(created);
end;$fn$;

revoke all on function public.create_inventory_movement_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_inventory_movement_v1(jsonb) to authenticated,service_role;
