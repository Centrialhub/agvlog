alter function public.create_merchandise_shortage_case(uuid,jsonb) rename to create_merchandise_shortage_case_unsafe_20260917;
alter function public.create_merchandise_shortage_case_unsafe_20260917(uuid,jsonb) set schema finance_private;
revoke all on function finance_private.create_merchandise_shortage_case_unsafe_20260917(uuid,jsonb) from public, anon, authenticated, service_role;

create function public.create_merchandise_shortage_case(_tenant_id uuid, _payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null or not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform finance_private.assert_tenant_reference('public.delivery_occurrences', _tenant_id, nullif(_payload->>'occurrence_id', '')::uuid, 'occurrence');
  perform finance_private.assert_tenant_reference('public.fiscal_documents', _tenant_id, nullif(_payload->>'fiscal_document_id', '')::uuid, 'fiscal_document');
  perform finance_private.assert_tenant_reference('public.loads', _tenant_id, nullif(_payload->>'load_id', '')::uuid, 'load');
  perform finance_private.assert_tenant_reference('public.cte_documents', _tenant_id, nullif(_payload->>'cte_document_id', '')::uuid, 'cte_document');
  perform finance_private.assert_tenant_reference('public.drivers', _tenant_id, nullif(_payload->>'driver_id', '')::uuid, 'driver');
  perform finance_private.assert_tenant_reference('public.vehicles', _tenant_id, nullif(_payload->>'vehicle_id', '')::uuid, 'vehicle');
  perform finance_private.assert_tenant_reference('public.clients', _tenant_id, nullif(_payload->>'company_client_id', '')::uuid, 'company_client');
  perform finance_private.assert_tenant_reference('public.clients', _tenant_id, nullif(_payload->>'supplier_id', '')::uuid, 'supplier');
  perform finance_private.assert_tenant_reference('public.clients', _tenant_id, nullif(_payload->>'customer_id', '')::uuid, 'customer');
  perform finance_private.assert_tenant_reference('public.merchandise_shortage_import_batches', _tenant_id, nullif(_payload->>'import_batch_id', '')::uuid, 'import_batch');
  return finance_private.create_merchandise_shortage_case_unsafe_20260917(_tenant_id, _payload);
end
$fn$;

alter function public.update_merchandise_shortage_status(uuid,text,jsonb) rename to update_merchandise_shortage_status_unsafe_20260917;
alter function public.update_merchandise_shortage_status_unsafe_20260917(uuid,text,jsonb) set schema finance_private;
revoke all on function finance_private.update_merchandise_shortage_status_unsafe_20260917(uuid,text,jsonb) from public, anon, authenticated, service_role;

create function public.update_merchandise_shortage_status(_case_id uuid, _status text, _payload jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare t uuid;
begin
  select tenant_id into t from public.merchandise_shortage_cases where id = _case_id;
  if t is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if auth.uid() is null or not public.is_tenant_operator_or_admin(t) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform finance_private.assert_tenant_reference('public.drivers', t, nullif(_payload->>'responsible_driver_id', '')::uuid, 'responsible_driver');
  perform finance_private.assert_tenant_reference('public.clients', t, nullif(_payload->>'responsible_client_id', '')::uuid, 'responsible_client');
  perform finance_private.assert_tenant_reference('public.clients', t, nullif(_payload->>'responsible_supplier_id', '')::uuid, 'responsible_supplier');
  perform finance_private.update_merchandise_shortage_status_unsafe_20260917(_case_id, _status, _payload);
end
$fn$;

alter table public.merchandise_shortage_import_batches
  add column request_id uuid,
  add column file_hash text;
alter table public.merchandise_shortage_import_batches
  add constraint merchandise_shortage_import_file_hash_format check (file_hash is null or file_hash ~ '^[0-9a-f]{64}$');
create unique index merchandise_shortage_import_request_uidx
  on public.merchandise_shortage_import_batches(tenant_id, request_id) where request_id is not null;
create unique index merchandise_shortage_import_file_uidx
  on public.merchandise_shortage_import_batches(tenant_id, file_hash) where file_hash is not null;

create function public.import_merchandise_shortage_batch_v1(
  _tenant_id uuid, _request_id uuid, _file_name text, _row_count integer, _file_hash text, _cases jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare batch public.merchandise_shortage_import_batches%rowtype; case_payload jsonb; imported integer := 0;
begin
  if auth.uid() is null or not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if _request_id is null or nullif(btrim(_file_name), '') is null or _row_count < 0
    or _file_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(_cases) <> 'array' or jsonb_array_length(_cases) > 10000 then
    raise exception 'invalid_shortage_import' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(_tenant_id::text || ':shortage-import:' || _file_hash, 0));
  select * into batch from public.merchandise_shortage_import_batches
  where tenant_id = _tenant_id and (request_id = _request_id or file_hash = _file_hash)
  order by (request_id = _request_id) desc limit 1;
  if found then
    return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'batch_id',batch.id,
      'imported_count',batch.imported_count,'status',batch.status,'replayed',true);
  end if;

  insert into public.merchandise_shortage_import_batches(
    tenant_id,file_name,row_count,imported_count,updated_count,unmatched_count,error_count,status,errors,metadata,created_by,request_id,file_hash
  ) values (
    _tenant_id,btrim(_file_name),_row_count,0,0,0,0,'processing','[]'::jsonb,'{}'::jsonb,auth.uid(),_request_id,_file_hash
  ) returning * into batch;

  for case_payload in select value from jsonb_array_elements(_cases) loop
    perform public.create_merchandise_shortage_case(_tenant_id,
      jsonb_set(case_payload, '{import_batch_id}', to_jsonb(batch.id::text), true));
    imported := imported + 1;
  end loop;

  update public.merchandise_shortage_import_batches
  set imported_count = imported, status = 'completed'
  where id = batch.id and tenant_id = _tenant_id;
  return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'batch_id',batch.id,
    'imported_count',imported,'status','completed','replayed',false);
end
$fn$;

revoke all on function public.create_merchandise_shortage_case(uuid,jsonb) from public, anon;
revoke all on function public.update_merchandise_shortage_status(uuid,text,jsonb) from public, anon;
revoke all on function public.import_merchandise_shortage_batch_v1(uuid,uuid,text,integer,text,jsonb) from public, anon;
grant execute on function public.create_merchandise_shortage_case(uuid,jsonb) to authenticated, service_role;
grant execute on function public.update_merchandise_shortage_status(uuid,text,jsonb) to authenticated, service_role;
grant execute on function public.import_merchandise_shortage_batch_v1(uuid,uuid,text,integer,text,jsonb) to authenticated;
