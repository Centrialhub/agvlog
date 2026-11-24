do $verify$
begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='load_items' and column_name='source_product' and data_type='jsonb')
  or not exists(select 1 from pg_trigger where tgrelid='public.load_items'::regclass and tgname='zz_prepare_imported_product_item' and tgenabled='O')
  or not exists(select 1 from pg_trigger where tgrelid='public.load_items'::regclass and tgname='zz_expand_imported_product_items' and tgenabled='O') then
  raise exception 'invoice_product_item_contract_missing';end if;
 if has_function_privilege('authenticated','private.prepare_imported_product_item()','execute')
  or has_function_privilege('anon','private.expand_imported_product_items()','execute') then
  raise exception 'invoice_product_private_helper_exposed';end if;
 if position('product_code' in pg_get_functiondef('public.get_driver_delivery_items(uuid)'::regprocedure))=0
  or not has_function_privilege('authenticated','public.get_driver_delivery_items(uuid)','execute')
  or has_function_privilege('anon','public.get_driver_delivery_items(uuid)','execute') then
  raise exception 'invoice_product_driver_reader_contract_invalid';end if;
 if not exists(select 1 from pg_class where oid='public.current_load_items'::regclass and reloptions @> array['security_invoker=true']) then
  raise exception 'invoice_product_view_boundary_changed';end if;
end;$verify$;
