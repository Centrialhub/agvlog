-- Rollback-only PostgreSQL test, exclusively for the existing disposable CI seed.
begin;
set local statement_timeout='30s';
do $guard$ begin
 if (select count(*) from auth.users)<>7 or (select count(*) from auth.users where email like '%@agvlog-e2e.invalid')<>7 then
  raise exception 'isolated_seed_required';end if;
end;$guard$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1","active_tenant_id":"20000000-0000-4000-8000-000000000001"}',true);
select set_config('request.headers','{"x-agvlog-tenant-id":"20000000-0000-4000-8000-000000000001"}',true);
insert into public.loads(id,tenant_id,load_number,status) values
 ('74000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','QA-PRODUCTS-NATIVE','planned');
insert into public.fiscal_documents(id,tenant_id,document_type,invoice_number,status,weight_kg,pallet_count,value,delivery_meta) values
 ('94000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','inbound','QA-PRODUCTS-NATIVE','confirmed',90,3,180,
 '{"invoice_products":{"version":1,"items":[{"line":1,"code":"SAB","description":"Sabonete","quantity":12,"unit":"CX","total":120},{"line":2,"code":"DES","description":"Desodorante","quantity":3,"unit":"UN","total":60}]}}');
set local role authenticated;
select public.assign_fiscal_documents_to_load_v2('20000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001',array['94000000-0000-4000-8000-000000000001'::uuid]);
select public.assign_fiscal_documents_to_load_v2('20000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001',array['94000000-0000-4000-8000-000000000001'::uuid]);
do $products$ begin
 if (select count(*) from public.load_items where fiscal_document_id='94000000-0000-4000-8000-000000000001')<>2
  or (select sum(weight_kg) from public.load_items where fiscal_document_id='94000000-0000-4000-8000-000000000001')<>90
  or (select sum(pallet_count) from public.load_items where fiscal_document_id='94000000-0000-4000-8000-000000000001')<>3
  or not exists(select 1 from public.load_items where fiscal_document_id='94000000-0000-4000-8000-000000000001' and source_product->>'code'='DES' and quantity=3)
  or (select value from public.fiscal_documents where id='94000000-0000-4000-8000-000000000001')<>180 then
  raise exception 'invoice_product_native_assignment_failed';end if;
end;$products$;
reset role;
rollback;
