create or replace function public.import_occurrence_report_batch_v1(
  _batch jsonb,
  _occurrences jsonb default '[]'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  t uuid := nullif(_batch->>'tenant_id','')::uuid;
  r uuid := nullif(_batch->>'request_id','')::uuid;
  h text;
  stored finance_private.atomic_command_results%rowtype;
  out jsonb;
  x record;
begin
  if auth.uid() is null or t is null or not public.is_tenant_operator_or_admin(t) then
    raise exception 'operator_required' using errcode = '42501';
  end if;
  if r is null then
    raise exception 'request_id_required' using errcode = '22023';
  end if;

  for x in
    select *
    from jsonb_to_recordset(_occurrences) as q(
      client_id uuid,
      supplier_id uuid,
      load_id uuid,
      driver_id uuid,
      fiscal_document_id uuid,
      cte_document_id uuid,
      responsible_user_id uuid
    )
  loop
    perform finance_private.assert_tenant_reference('public.clients',t,x.client_id,'client');
    perform finance_private.assert_tenant_reference('public.clients',t,x.supplier_id,'supplier');
    perform finance_private.assert_tenant_reference('public.loads',t,x.load_id,'load');
    perform finance_private.assert_tenant_reference('public.drivers',t,x.driver_id,'driver');
    perform finance_private.assert_tenant_reference('public.fiscal_documents',t,x.fiscal_document_id,'fiscal_document');
    perform finance_private.assert_tenant_reference('public.cte_documents',t,x.cte_document_id,'cte_document');

    if x.responsible_user_id is not null and not exists (
      select 1
      from public.tenant_memberships membership
      where membership.tenant_id = t
        and membership.user_id = x.responsible_user_id
        and membership.active = true
    ) then
      raise exception 'responsible_user_not_active_in_tenant' using errcode = '23503';
    end if;
  end loop;

  h := encode(
    sha256(convert_to((jsonb_build_object('batch',_batch-'request_id','occurrences',_occurrences))::text,'UTF8')),
    'hex'
  );
  perform pg_advisory_xact_lock(hashtextextended(t::text||':occurrence-import:'||r::text,0));
  select * into stored
  from finance_private.atomic_command_results
  where tenant_id=t and action='import_occurrence_report' and request_id=r;
  if found then
    if stored.payload_hash<>h then
      raise exception 'request_payload_mismatch' using errcode='22023';
    end if;
    return stored.result;
  end if;

  out := finance_private.import_occurrence_report_unsafe_20260917(_batch,_occurrences);
  insert into finance_private.atomic_command_results
  values(t,'import_occurrence_report',r,h,out,auth.uid(),now());
  return out;
end;
$function$;

revoke all on function public.import_occurrence_report_batch_v1(jsonb,jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.import_occurrence_report_batch_v1(jsonb,jsonb)
to authenticated, service_role;
