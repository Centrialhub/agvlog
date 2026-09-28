-- Captured from the restored local baseline on 2026-09-28, before corrective forwards.
-- Source record: ordinality-source-targets.json; SHA256 06f042b223e92c1337e692baaf03795fb3655f9d9fd7a3c0a3efc1e9159ae59e
-- Reviewed function definition only; no credentials or customer rows.
CREATE OR REPLACE FUNCTION public.edit_pallet_return_protocol_v1(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET row_security TO 'on'
AS $function$
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
end $function$
;
