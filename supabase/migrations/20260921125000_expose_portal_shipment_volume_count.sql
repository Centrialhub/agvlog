do $patch$
declare
  signature regprocedure := 'public.search_client_portal_shipments_v2(uuid,uuid,text,text[],date,date,text,text,boolean,boolean,integer,integer)'::regprocedure;
  body text;
  needle text := 'fd.product_summary, fd.pallet_count, fd.weight_kg,';
  replacement text := 'fd.product_summary, fd.volume_count, fd.pallet_count, fd.weight_kg,';
begin
  select pg_get_functiondef(signature) into body;
  if position('fd.product_summary, fd.volume_count, fd.pallet_count' in body) > 0 then return; end if;
  if position(needle in body) = 0 then raise exception 'portal_shipment_volume_contract_changed'; end if;
  execute replace(body, needle, replacement);
end;
$patch$;
