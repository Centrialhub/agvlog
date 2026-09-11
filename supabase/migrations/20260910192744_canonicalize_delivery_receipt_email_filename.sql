create or replace function delivery_private.canonicalize_delivery_receipt_email_filename_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
declare v_receipt public.delivery_receipts%rowtype;v_supplier text;v_safe text;v_loads uuid[];v_load text;
begin
  select * into v_receipt from public.delivery_receipts where id=new.receipt_id and tenant_id=new.tenant_id;
  select supplier_name into v_supplier from public.delivery_receipt_email_batches
    where id=new.batch_id and tenant_id=new.tenant_id;
  if not found or v_receipt.id is null then raise exception 'delivery_receipt_email_item_scope_invalid' using errcode='23514';end if;
  select array_agg(load_id order by load_id) into v_loads from (
    select trip.load_id from public.dispatch_trips as trip
      where trip.id=v_receipt.dispatch_trip_id and trip.tenant_id=v_receipt.tenant_id and trip.load_id is not null
    union
    select link.load_id from public.dispatch_trip_loads as link
      where link.dispatch_trip_id=v_receipt.dispatch_trip_id and link.tenant_id=v_receipt.tenant_id
  ) as scoped_loads;
  v_safe:=trim(both '-' from regexp_replace(upper(left(btrim(v_supplier),60)),'[^A-Z0-9]+','-','g'));
  if v_safe='' then v_safe:='FORNECEDOR';end if;
  v_load:=case when coalesce(cardinality(v_loads),0)=0 then 'SEM-CARGA'
    when cardinality(v_loads)=1 then left(v_loads[1]::text,8)
    else left(v_loads[1]::text,8)||'-M'||cardinality(v_loads)::text end;
  new.file_name:='CANHOTO_'||v_safe||'_'||to_char(v_receipt.delivered_at,'YYYY-MM-DD')||
    '_CARGA-'||v_load||'_ENTREGA-'||left(v_receipt.delivery_event_id::text,8)||'.pdf';
  return new;
end;$function$;
revoke all on function delivery_private.canonicalize_delivery_receipt_email_filename_v1()
  from public,anon,authenticated,service_role;
create trigger canonicalize_delivery_receipt_email_filename_v1
before insert or update of batch_id,tenant_id,receipt_id,file_name on public.delivery_receipt_email_items
for each row execute function delivery_private.canonicalize_delivery_receipt_email_filename_v1();

comment on function delivery_private.canonicalize_delivery_receipt_email_filename_v1() is
  'Keeps download and supplier-email attachment names aligned with supplier, date, load set and delivery event.';
