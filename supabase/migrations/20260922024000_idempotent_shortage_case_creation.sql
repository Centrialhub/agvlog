alter table public.merchandise_shortage_cases
  add column if not exists create_request_id uuid,
  add column if not exists create_payload_hash text;

create unique index if not exists merchandise_shortage_cases_tenant_create_request_uidx
  on public.merchandise_shortage_cases(tenant_id,create_request_id)
  where create_request_id is not null;

create or replace function public.create_merchandise_shortage_case(_tenant_id uuid,_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_request uuid:=nullif(_payload->>'request_id','')::uuid;
  v_actor uuid:=auth.uid();
  v_payload_hash text;
  v_existing public.merchandise_shortage_cases%rowtype;
  v_case_id uuid;
begin
  if v_actor is null or not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if v_request is null and nullif(_payload->>'import_batch_id','') is null then
    raise exception 'shortage_request_id_required' using errcode='22023';
  end if;
  perform finance_private.assert_tenant_reference('public.delivery_occurrences',_tenant_id,nullif(_payload->>'occurrence_id','')::uuid,'occurrence');
  perform finance_private.assert_tenant_reference('public.fiscal_documents',_tenant_id,nullif(_payload->>'fiscal_document_id','')::uuid,'fiscal_document');
  perform finance_private.assert_tenant_reference('public.loads',_tenant_id,nullif(_payload->>'load_id','')::uuid,'load');
  perform finance_private.assert_tenant_reference('public.cte_documents',_tenant_id,nullif(_payload->>'cte_document_id','')::uuid,'cte_document');
  perform finance_private.assert_tenant_reference('public.drivers',_tenant_id,nullif(_payload->>'driver_id','')::uuid,'driver');
  perform finance_private.assert_tenant_reference('public.vehicles',_tenant_id,nullif(_payload->>'vehicle_id','')::uuid,'vehicle');
  perform finance_private.assert_tenant_reference('public.clients',_tenant_id,nullif(_payload->>'company_client_id','')::uuid,'company_client');
  perform finance_private.assert_tenant_reference('public.clients',_tenant_id,nullif(_payload->>'supplier_id','')::uuid,'supplier');
  perform finance_private.assert_tenant_reference('public.clients',_tenant_id,nullif(_payload->>'customer_id','')::uuid,'customer');
  perform finance_private.assert_tenant_reference('public.merchandise_shortage_import_batches',_tenant_id,nullif(_payload->>'import_batch_id','')::uuid,'import_batch');
  if v_request is null then
    return finance_private.create_merchandise_shortage_case_unsafe_20260917(_tenant_id,_payload);
  end if;

  v_payload_hash:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'create_merchandise_shortage_case:'||_tenant_id::text||':'||v_request::text,0
  ));
  if auth.uid() is distinct from v_actor or v_actor is null
    or not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  select * into v_existing
  from public.merchandise_shortage_cases
  where tenant_id=_tenant_id and create_request_id=v_request;
  if found then
    if v_existing.created_by is distinct from v_actor
      or v_existing.create_payload_hash is distinct from v_payload_hash then
      raise exception 'shortage_request_conflict' using errcode='23505';
    end if;
    return v_existing.id;
  end if;

  v_case_id:=finance_private.create_merchandise_shortage_case_unsafe_20260917(_tenant_id,_payload);
  update public.merchandise_shortage_cases
  set create_request_id=v_request,create_payload_hash=v_payload_hash
  where tenant_id=_tenant_id and id=v_case_id;
  if not found then raise exception 'shortage_creation_not_confirmed' using errcode='40001';end if;
  return v_case_id;
end;
$function$;

revoke all on function public.create_merchandise_shortage_case(uuid,jsonb) from public,anon;
grant execute on function public.create_merchandise_shortage_case(uuid,jsonb) to authenticated,service_role;
