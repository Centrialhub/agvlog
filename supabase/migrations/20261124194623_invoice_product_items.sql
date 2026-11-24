-- Additive, forward-only: existing invoices/allocations are not rewritten.
do $preflight$ begin
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='public.get_driver_delivery_items(uuid)'::regprocedure)<>'ce13fda3f27ee8b53b9a467354f051b1'
  or (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='public._delivery_redelivery_remainder(uuid)'::regprocedure)<>'5a53ec40b15b55df12bb1676b2892b3d'
  or not exists(select 1 from pg_class where oid='public.current_load_items'::regclass and reloptions @> array['security_invoker=true']) then
  raise exception 'invoice_product_source_contract_changed';end if;
end;$preflight$;
alter table public.load_items add column source_product jsonb;
comment on column public.load_items.source_product is 'Imported XML product identity; transport weight is an accounting allocation, not a measured per-product weight.';

-- PostgreSQL freezes SELECT * in a view. Include the additive field in future
-- immutable snapshots while retaining the existing attempt and RLS boundary.
create or replace view public.current_load_items with(security_invoker=true) as
 select i.* from public.load_items i where i.fiscal_document_id is null or exists(
  select 1 from public.fiscal_documents f where f.id=i.fiscal_document_id
   and f.current_delivery_attempt_id is not distinct from i.delivery_attempt_id);

-- Pre-migration snapshots cannot contain the new nullable field. Only that
-- absent/null case is normalized; imported product identity remains protected.
do $compat$ declare definition text;
 marker text:=$m$(to_jsonb(i)-array['delivery_attempt_id','source_delivery_item_id','updated_at'])$m$;
begin
 select pg_get_functiondef('public._delivery_redelivery_remainder(uuid)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 then
  raise exception 'redelivery_remainder_definition_changed';end if;
 execute replace(definition,marker,$m$((case when not (v_original ? 'source_product') and i.source_product is null
  then to_jsonb(i)-'source_product' else to_jsonb(i) end)-array['delivery_attempt_id','source_delivery_item_id','updated_at'])$m$);
end;$compat$;

create function private.validate_invoice_products(_source jsonb) returns void
language plpgsql immutable security invoker set search_path='' as $fn$
declare item jsonb; position integer:=0;
begin
 if jsonb_typeof(_source) is distinct from 'object' or _source->>'version' is distinct from '1'
 or jsonb_typeof(_source->'items') is distinct from 'array'
 or jsonb_array_length(_source->'items') not between 1 and 1000 then
  raise exception 'invalid_invoice_product_source' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(_source->'items') loop
  position:=position+1;
  if jsonb_typeof(item) is distinct from 'object' or item->>'line' is distinct from position::text
  or jsonb_typeof(item->'description') is distinct from 'string' or length(btrim(item->>'description')) not between 1 and 2000
  or jsonb_typeof(item->'quantity') is distinct from 'number' or (item->>'quantity')::numeric<=0 or (item->>'quantity')::numeric>1e12
  or jsonb_typeof(item->'total') is distinct from 'number' or (item->>'total')::numeric<0 or (item->>'total')::numeric>1e15
  or jsonb_typeof(item->'unit') is distinct from 'string' or length(btrim(item->>'unit')) not between 1 and 20
  or jsonb_typeof(item->'code') is distinct from 'string' or length(item->>'code')>120 then
   raise exception 'invalid_invoice_product_line:%',position using errcode='22023';end if;
 end loop;
end;$fn$;
revoke all on function private.validate_invoice_products(jsonb) from public,anon,authenticated,service_role;

create function private.invoice_product_allocation(_items jsonb,_line integer,_weight numeric,_volume numeric)
returns jsonb language plpgsql immutable security invoker set search_path='' as $fn$
declare total numeric;factor numeric;other_weight numeric;other_volume numeric;use_value boolean;
begin
 select sum((value->>'total')::numeric)>0 into use_value from jsonb_array_elements(_items);
 select sum((value->>case when use_value then 'total' else 'quantity' end)::numeric) into total from jsonb_array_elements(_items);
 if _line=1 then
  select coalesce(sum(floor(_weight*(value->>case when use_value then 'total' else 'quantity' end)::numeric/total*1e6)/1e6),0),
   coalesce(sum(floor(_volume*(value->>case when use_value then 'total' else 'quantity' end)::numeric/total*1e6)/1e6),0)
   into other_weight,other_volume from jsonb_array_elements(_items) where (value->>'line')::integer>1;
  return jsonb_build_object('weight',_weight-other_weight,'volume',_volume-other_volume);
 end if;
 factor:=((_items->(_line-1))->>case when use_value then 'total' else 'quantity' end)::numeric;
 return jsonb_build_object('weight',floor(_weight*factor/total*1e6)/1e6,'volume',floor(_volume*factor/total*1e6)/1e6);
end;$fn$;
revoke all on function private.invoice_product_allocation(jsonb,integer,numeric,numeric) from public,anon,authenticated,service_role;

create function private.prepare_imported_product_item() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare source jsonb;first_item jsonb;allocation jsonb;parent public.load_items%rowtype;
begin
 if new.fiscal_document_id is null then return new;end if;
 if new.source_delivery_item_id is not null then
  select * into parent from public.load_items where id=new.source_delivery_item_id and tenant_id=new.tenant_id;
  if found and parent.source_product is not null then new.source_product:=parent.source_product-'expand_on_insert';end if;
  return new;
 end if;
 if new.source_product is not null then
  if pg_trigger_depth()<=1 then raise exception 'invoice_product_identity_managed_internally' using errcode='42501';end if;
  return new;
 end if;
 select delivery_meta->'invoice_products' into source from public.fiscal_documents
  where id=new.fiscal_document_id and tenant_id=new.tenant_id and document_type='inbound';
 if source is null or source='null'::jsonb then return new;end if;
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(new.tenant_id),false) then
  raise exception 'invoice_products_not_authorized' using errcode='42501';end if;
 perform private.validate_invoice_products(source);
 first_item:=source->'items'->0;
 allocation:=private.invoice_product_allocation(source->'items',1,coalesce(new.weight_kg,0),coalesce(new.volume_m3,0));
 new.source_product:=jsonb_build_object('version',1,'line',1,'code',first_item->>'code','unit',first_item->>'unit',
  'expand_on_insert',true,'invoice_weight',coalesce(new.weight_kg,0),'invoice_volume',coalesce(new.volume_m3,0),
  'physical_allocation','estimated_from_source_product_value_or_quantity','pallet_basis','invoice_total_on_first_line');
 new.item_description:=first_item->>'description';new.quantity:=(first_item->>'quantity')::numeric;
 new.weight_kg:=(allocation->>'weight')::numeric;new.volume_m3:=(allocation->>'volume')::numeric;
 return new;
end;$fn$;
revoke all on function private.prepare_imported_product_item() from public,anon,authenticated,service_role;

create function private.expand_imported_product_items() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare source jsonb;item jsonb;allocation jsonb;
begin
 if new.source_product->>'expand_on_insert' is distinct from 'true' then return new;end if;
 select delivery_meta->'invoice_products' into source from public.fiscal_documents where id=new.fiscal_document_id and tenant_id=new.tenant_id;
 perform private.validate_invoice_products(source);
 for item in select value from jsonb_array_elements(source->'items') where (value->>'line')::integer>1 loop
  allocation:=private.invoice_product_allocation(source->'items',(item->>'line')::integer,
    (new.source_product->>'invoice_weight')::numeric,(new.source_product->>'invoice_volume')::numeric);
  insert into public.load_items(tenant_id,load_id,fiscal_document_id,delivery_attempt_id,item_description,quantity,
   pallet_count,weight_kg,volume_m3,status,source_product)
  values(new.tenant_id,new.load_id,new.fiscal_document_id,new.delivery_attempt_id,item->>'description',(item->>'quantity')::numeric,
   0,(allocation->>'weight')::numeric,(allocation->>'volume')::numeric,new.status,
   jsonb_build_object('version',1,'line',(item->>'line')::integer,'code',item->>'code','unit',item->>'unit',
    'physical_allocation','estimated_from_source_product_value_or_quantity','pallet_basis','invoice_total_on_first_line'));
 end loop;
 return new;
end;$fn$;
revoke all on function private.expand_imported_product_items() from public,anon,authenticated,service_role;

create trigger zz_prepare_imported_product_item before insert on public.load_items
for each row execute function private.prepare_imported_product_item();
create trigger zz_expand_imported_product_items after insert on public.load_items
for each row execute function private.expand_imported_product_items();

create unique index load_items_imported_product_identity on public.load_items
 (tenant_id,load_id,fiscal_document_id,delivery_attempt_id,((source_product->>'line')::integer)) nulls not distinct
 where source_product is not null;

-- Extend the existing assigned-driver reader without broadening its authorization or exposing prices.
do $extend$ declare definition text;marker text:=$m$'quantity',i.quantity,$m$;begin
 select pg_get_functiondef('public.get_driver_delivery_items(uuid)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 then
  raise exception 'driver_delivery_items_definition_changed';end if;
 execute replace(definition,marker,marker||$m$'product_code',i.source_product->>'code','unit',i.source_product->>'unit','invoice_number',current_f.invoice_number,$m$);
end;$extend$;
