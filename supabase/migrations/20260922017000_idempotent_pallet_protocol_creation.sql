alter table public.pallet_return_protocols
  add column if not exists create_request_id uuid,
  add column if not exists create_payload_hash text;

create unique index if not exists pallet_return_protocols_tenant_create_request_uidx
  on public.pallet_return_protocols(tenant_id,create_request_id)
  where create_request_id is not null;

create or replace function public.create_pallet_return_protocol(_tenant_id uuid, _payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _protocol_id uuid := gen_random_uuid();
  _request_id uuid := nullif(_payload->>'request_id','')::uuid;
  _payload_hash text;
  _existing public.pallet_return_protocols%rowtype;
  _number text;
  _items jsonb := coalesce(_payload->'items', '[]'::jsonb);
  _total bigint := 0;
  _item jsonb;
  _quantity numeric;
  _uid uuid := auth.uid();
  _status text := coalesce(_payload->>'status', 'draft');
  _result jsonb;
begin
  if _request_id is null then
    raise exception 'request_id_required' using errcode='22023';
  end if;
  if not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'not_authorized' using errcode='42501';
  end if;
  _payload_hash := encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'create_pallet_return_protocol:'||_tenant_id::text||':'||_request_id::text,0
  ));
  if auth.uid() is distinct from _uid or _uid is null
    or not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'not_authorized' using errcode='42501';
  end if;
  select * into _existing
  from public.pallet_return_protocols
  where tenant_id=_tenant_id and create_request_id=_request_id;
  if found then
    if _existing.created_by is distinct from _uid
      or _existing.create_payload_hash is distinct from _payload_hash then
      raise exception 'pallet_protocol_request_conflict' using errcode='23505';
    end if;
    return jsonb_build_object(
      'protocol_id',_existing.id,
      'protocol_number',_existing.protocol_number,
      'total_quantity',_existing.total_quantity
    );
  end if;
  if _payload->>'supplier_name_snapshot' is null
    or length(trim(_payload->>'supplier_name_snapshot'))=0 then
    raise exception 'supplier_required';
  end if;
  if jsonb_array_length(_items)=0 then
    raise exception 'items_required';
  end if;
  for _item in select * from jsonb_array_elements(_items) loop
    _quantity:=nullif(_item->>'quantity','')::numeric;
    if _quantity is null or _quantity<=0 or _quantity<>trunc(_quantity) or _quantity>2147483647 then
      raise exception 'invalid_quantity';
    end if;
    _total:=_total+_quantity::bigint;
    if _total>2147483647 then raise exception 'invalid_total_quantity';end if;
  end loop;

  _number:=public.next_pallet_return_protocol_number(
    _tenant_id,coalesce((_payload->>'issue_date')::date,current_date)
  );
  insert into public.pallet_return_protocols(
    id,tenant_id,protocol_number,supplier_id,supplier_name_snapshot,supplier_document_snapshot,
    company_snapshot,issue_date,expected_return_date,returned_at,status,total_quantity,
    driver_id,vehicle_id,load_id,driver_name_snapshot,vehicle_plate_snapshot,notes,
    receiver_name,receiver_document,receiver_phone,signature_date,created_by,updated_by,
    create_request_id,create_payload_hash
  ) values (
    _protocol_id,_tenant_id,_number,
    nullif(_payload->>'supplier_id','')::uuid,
    _payload->>'supplier_name_snapshot',_payload->>'supplier_document_snapshot',
    coalesce(_payload->'company_snapshot','{}'::jsonb),
    coalesce((_payload->>'issue_date')::date,current_date),
    nullif(_payload->>'expected_return_date','')::date,
    nullif(_payload->>'returned_at','')::date,
    _status,_total,
    nullif(_payload->>'driver_id','')::uuid,
    nullif(_payload->>'vehicle_id','')::uuid,
    nullif(_payload->>'load_id','')::uuid,
    _payload->>'driver_name_snapshot',_payload->>'vehicle_plate_snapshot',_payload->>'notes',
    _payload->>'receiver_name',_payload->>'receiver_document',_payload->>'receiver_phone',
    nullif(_payload->>'signature_date','')::date,_uid,_uid,_request_id,_payload_hash
  );

  insert into public.pallet_return_items(
    tenant_id,protocol_id,pallet_type_id,pallet_type_code,pallet_type_name,pallet_color,quantity,notes,sort_order
  )
  select _tenant_id,_protocol_id,
    nullif(item->>'pallet_type_id','')::uuid,item->>'pallet_type_code',item->>'pallet_type_name',
    item->>'pallet_color',(item->>'quantity')::int,item->>'notes',
    coalesce((item->>'sort_order')::int,ord::int)
  from jsonb_array_elements(_items) with ordinality as t(item,ord);

  insert into public.pallet_return_history(tenant_id,protocol_id,action,new_value,created_by,metadata)
  values(_tenant_id,_protocol_id,'created',_number,_uid,jsonb_build_object('status',_status,'total',_total));

  _result:=jsonb_build_object(
    'protocol_id',_protocol_id,'protocol_number',_number,'total_quantity',_total
  );
  return _result;
end;
$function$;
