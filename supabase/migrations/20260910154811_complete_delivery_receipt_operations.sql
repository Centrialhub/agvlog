create table public.delivery_receipt_email_templates(
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  supplier_name text not null check(length(btrim(supplier_name)) between 2 and 200),
  recipients text[] not null check(cardinality(recipients) between 1 and 10),
  subject_template text not null check(length(btrim(subject_template)) between 3 and 200),
  body_template text not null check(length(btrim(body_template)) between 3 and 5000),
  is_active boolean not null default true,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create unique index delivery_receipt_email_templates_supplier_unique
  on public.delivery_receipt_email_templates(tenant_id,lower(btrim(supplier_name)));

create table public.delivery_receipt_replacements(
  request_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_id uuid not null,
  previous_receipt_id uuid not null references public.delivery_receipts(id) on delete restrict,
  replacement_receipt_id uuid not null references public.delivery_receipts(id) on delete restrict,
  payload_hash text not null check(payload_hash~'^[a-f0-9]{64}$'),
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(tenant_id,replacement_receipt_id)
);

alter table public.delivery_receipt_email_templates enable row level security;
alter table public.delivery_receipt_replacements enable row level security;
revoke all on table public.delivery_receipt_email_templates,public.delivery_receipt_replacements
  from public,anon,authenticated,service_role;
grant select on table public.delivery_receipt_email_templates to authenticated;
grant all on table public.delivery_receipt_email_templates,public.delivery_receipt_replacements to service_role;
create policy delivery_receipt_email_templates_operator_read on public.delivery_receipt_email_templates
  for select to authenticated using(coalesce(public.is_tenant_operator_or_admin(tenant_id),false));

create or replace function public.save_delivery_receipt_email_template_v1(
  _tenant_id uuid,_template_id uuid,_supplier_name text,_recipients text[],_subject text,_body text,
  _is_active boolean,_expected_updated_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_template public.delivery_receipt_email_templates%rowtype;v_before jsonb;v_recipients text[];
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'delivery_receipt_template_not_authorized' using errcode='42501';end if;
  v_recipients:=array(select lower(btrim(value)) from unnest(_recipients) value order by 1);
  if _template_id is null or length(coalesce(btrim(_supplier_name),'')) not between 2 and 200
    or coalesce(cardinality(_recipients),0) not between 1 and 10
    or cardinality(_recipients)<>(select count(distinct lower(btrim(value))) from unnest(_recipients) value)
    or exists(select 1 from unnest(_recipients) value where btrim(value)!~*'^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9.-]+[.][A-Z]{2,63}$')
    or length(coalesce(btrim(_subject),'')) not between 3 and 200
    or length(coalesce(btrim(_body),'')) not between 3 and 5000 or _is_active is null then
    raise exception 'invalid_delivery_receipt_template' using errcode='22023';end if;
  select * into v_template from public.delivery_receipt_email_templates
    where id=_template_id and tenant_id=_tenant_id for update;
  if found then
    if v_template.supplier_name=btrim(_supplier_name) and v_template.recipients=v_recipients
      and v_template.subject_template=btrim(_subject) and v_template.body_template=btrim(_body)
      and v_template.is_active=_is_active then
      return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),
        'template',to_jsonb(v_template),'confirmed',true,'replayed',true);
    end if;
    if _expected_updated_at is null or v_template.updated_at is distinct from _expected_updated_at then
      raise exception 'delivery_receipt_template_changed' using errcode='40001';end if;
    v_before:=to_jsonb(v_template);
    update public.delivery_receipt_email_templates set supplier_name=btrim(_supplier_name),recipients=v_recipients,
      subject_template=btrim(_subject),body_template=btrim(_body),is_active=_is_active,updated_by=auth.uid(),updated_at=clock_timestamp()
      where id=v_template.id returning * into v_template;
  else
    if _expected_updated_at is not null then raise exception 'delivery_receipt_template_not_found' using errcode='P0002';end if;
    insert into public.delivery_receipt_email_templates(id,tenant_id,supplier_name,recipients,subject_template,body_template,is_active,created_by,updated_by)
      values(_template_id,_tenant_id,btrim(_supplier_name),v_recipients,btrim(_subject),btrim(_body),_is_active,auth.uid(),auth.uid())
      returning * into v_template;
  end if;
  perform public._log_entity_audit(_tenant_id,'delivery_receipt_email_template',v_template.id,
    case when v_before is null then 'created' else 'updated' end,v_before,to_jsonb(v_template),'save_delivery_receipt_email_template_v1');
  return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'template',to_jsonb(v_template),'confirmed',true);
exception when unique_violation then raise exception 'delivery_receipt_template_supplier_conflict' using errcode='23505';
end;$function$;
revoke all on function public.save_delivery_receipt_email_template_v1(uuid,uuid,text,text[],text,text,boolean,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.save_delivery_receipt_email_template_v1(uuid,uuid,text,text[],text,text,boolean,timestamptz) to authenticated;

create or replace function public.replace_delivery_receipt_v1(
  _tenant_id uuid,_receipt_id uuid,_request_id uuid,_path text,_reason text,_expected_updated_at timestamptz
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_old public.delivery_receipts%rowtype;v_new public.delivery_receipts%rowtype;v_existing public.delivery_receipt_replacements%rowtype;
  v_hash text;v_response jsonb;v_mime text;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'delivery_receipt_replacement_not_authorized' using errcode='42501';end if;
  if _request_id is null or length(coalesce(btrim(_reason),'')) not between 5 and 1000
    or _path is null or _path not like _tenant_id::text||'/delivery-replacements/%'
    or _path like '%..%' or _path like '%\%' then
    raise exception 'invalid_delivery_receipt_replacement' using errcode='22023';end if;
  v_hash:=encode(sha256(convert_to(concat_ws('|',_tenant_id,_receipt_id,_path,btrim(_reason)),'UTF8')),'hex');
  select * into v_existing from public.delivery_receipt_replacements where request_id=_request_id for update;
  if found then
    if v_existing.tenant_id<>_tenant_id or v_existing.actor_id<>auth.uid() or v_existing.payload_hash<>v_hash then
      raise exception 'delivery_receipt_replacement_request_conflict' using errcode='23514';end if;
    return v_existing.response;
  end if;
  select lower(coalesce(metadata->>'mimetype','')) into v_mime from storage.objects where bucket_id='receipts' and name=_path for share;
  if not found or v_mime not in('application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif') then
    raise exception 'delivery_receipt_replacement_file_invalid' using errcode='23514';end if;
  if exists(select 1 from public.delivery_receipts where tenant_id=_tenant_id and _path in(original_path,processed_path,pdf_path)) then
    raise exception 'delivery_receipt_replacement_file_used' using errcode='23514';end if;
  select * into v_old from public.delivery_receipts where id=_receipt_id and tenant_id=_tenant_id and is_active for update;
  if not found then raise exception 'delivery_receipt_not_found' using errcode='P0002';end if;
  if _expected_updated_at is null or v_old.updated_at is distinct from _expected_updated_at then
    raise exception 'delivery_receipt_changed' using errcode='40001';end if;
  update public.delivery_receipts set is_active=false,digital_status='superseded',updated_at=clock_timestamp() where id=v_old.id;
  insert into public.delivery_receipts(tenant_id,delivery_event_id,dispatch_trip_id,dispatch_stop_id,driver_id,vehicle_id,
    previous_receipt_id,version,is_active,digital_status,physical_status,storage_bucket,original_path,processed_path,pdf_path,
    signature_path,scan_mode,scan_quality,receiver_name,receiver_document,receiver_role,captured_at,delivered_at,latitude,
    longitude,accuracy_m,email_status,created_by)
  values(v_old.tenant_id,v_old.delivery_event_id,v_old.dispatch_trip_id,v_old.dispatch_stop_id,v_old.driver_id,v_old.vehicle_id,
    v_old.id,v_old.version+1,true,'pending_validation',v_old.physical_status,'receipts',
    case when v_mime<>'application/pdf' then _path else null end,
    case when v_mime<>'application/pdf' then _path else null end,
    case when v_mime='application/pdf' then _path else null end,
    v_old.signature_path,'operator_replacement',jsonb_build_object('replacement_reason',btrim(_reason)),v_old.receiver_name,
    v_old.receiver_document,v_old.receiver_role,clock_timestamp(),v_old.delivered_at,v_old.latitude,v_old.longitude,
    v_old.accuracy_m,'not_sent',auth.uid()) returning * into v_new;
  insert into public.delivery_receipt_documents(receipt_id,document_reference_id,tenant_id,document_snapshot)
    select v_new.id,document_reference_id,tenant_id,document_snapshot from public.delivery_receipt_documents where receipt_id=v_old.id;
  v_response:=jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'request_id',_request_id,
    'previous_receipt_id',v_old.id,'replacement_receipt_id',v_new.id,'digital_status',v_new.digital_status,
    'updated_at',v_new.updated_at,'confirmed',true);
  insert into public.delivery_receipt_replacements(request_id,tenant_id,actor_id,previous_receipt_id,replacement_receipt_id,payload_hash,response)
    values(_request_id,_tenant_id,auth.uid(),v_old.id,v_new.id,v_hash,v_response);
  perform public._log_entity_audit(_tenant_id,'delivery_receipt',v_old.id,'superseded',to_jsonb(v_old),
    jsonb_build_object('replacement_receipt_id',v_new.id,'reason',btrim(_reason)),'replace_delivery_receipt_v1');
  perform public._log_entity_audit(_tenant_id,'delivery_receipt',v_new.id,'replacement_created',null,to_jsonb(v_new),'replace_delivery_receipt_v1');
  return v_response;
end;$function$;
revoke all on function public.replace_delivery_receipt_v1(uuid,uuid,uuid,text,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.replace_delivery_receipt_v1(uuid,uuid,uuid,text,text,timestamptz) to authenticated;

create or replace function public.get_delivery_receipt_operations_v1(_tenant_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare v_templates jsonb;v_batches jsonb;v_receipts jsonb;v_emails jsonb;v_expenses jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'delivery_receipt_operations_not_authorized' using errcode='42501';end if;
  select coalesce(jsonb_agg(to_jsonb(template) order by template.supplier_name),'[]'::jsonb) into v_templates
    from public.delivery_receipt_email_templates template where template.tenant_id=_tenant_id;
  select coalesce(jsonb_agg(to_jsonb(page) order by page.created_at desc,page.id desc),'[]'::jsonb) into v_batches from(
    select batch.id,batch.supplier_name,batch.receipt_ids,batch.recipients,batch.subject,batch.body_text,batch.status,
      batch.attempt_count,batch.last_error,batch.retry_after_at,batch.created_at,batch.updated_at,batch.sent_at,
      batch.delivered_at,batch.bounced_at
    from public.delivery_receipt_email_batches batch where batch.tenant_id=_tenant_id
    order by batch.created_at desc,batch.id desc limit 50) page;
  select jsonb_build_object('total',count(*),'pending_validation',count(*) filter(where digital_status in('uploaded','pending_validation')),
    'rejected',count(*) filter(where digital_status='rejected'),'without_pdf',count(*) filter(where pdf_path is null),
    'physical_pending',count(*) filter(where physical_status in('pending_return','missing')),
    'replaced',count(*) filter(where previous_receipt_id is not null)) into v_receipts
    from public.delivery_receipts where tenant_id=_tenant_id and is_active;
  select jsonb_build_object('queued',count(*) filter(where status='queued'),'sending',count(*) filter(where status='sending'),
    'sent',count(*) filter(where status='sent'),'delivered',count(*) filter(where status='delivered'),
    'bounced',count(*) filter(where status='bounced'),'failed',count(*) filter(where status='failed'),
    'retryable',count(*) filter(where status='failed' and coalesce(retry_after_at,'-infinity')<=clock_timestamp())) into v_emails
    from public.delivery_receipt_email_batches where tenant_id=_tenant_id;
  select jsonb_build_object('pending',count(*) filter(where approval_status='pending'),
    'approved',count(*) filter(where approval_status='approved'),'rejected',count(*) filter(where approval_status='rejected'),
    'without_receipt',count(*) filter(where coalesce(no_receipt,false) or receipt_url is null)) into v_expenses
    from public.driver_expenses where tenant_id=_tenant_id;
  return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'generated_at',clock_timestamp(),
    'receipts',v_receipts,'emails',v_emails,'expenses',v_expenses,'templates',v_templates,'batches',v_batches);
end;$function$;
revoke all on function public.get_delivery_receipt_operations_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_delivery_receipt_operations_v1(uuid) to authenticated;

create or replace function public.list_delivery_receipts_v1(
  _tenant_id uuid,_filters jsonb default '{}'::jsonb,_limit integer default 50,_offset integer default 0
)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare v_rows jsonb;v_total integer;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'delivery_receipt_not_authorized' using errcode='42501';end if;
  if _filters is null or jsonb_typeof(_filters)<>'object' or _limit not between 1 and 100 or _offset<0
    or (_filters-array['search','date_from','date_to','digital_status','physical_status','email_status','scan_mode',
      'supplier_id','driver_id','vehicle_id','document_kind','has_pdf'])<>'{}'::jsonb then
    raise exception 'invalid_delivery_receipt_filters' using errcode='22023';end if;
  if coalesce(_filters->>'date_from','')<>'' and (_filters->>'date_from')!~'^\d{4}-\d{2}-\d{2}$'
    or coalesce(_filters->>'date_to','')<>'' and (_filters->>'date_to')!~'^\d{4}-\d{2}-\d{2}$'
    or exists(select 1 from jsonb_each_text(_filters) entry where entry.key in('supplier_id','driver_id','vehicle_id')
      and entry.value<>'' and entry.value!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    or nullif(_filters->>'digital_status','') is not null and _filters->>'digital_status' not in('pending_upload','uploaded','pending_validation','validated','rejected','superseded')
    or nullif(_filters->>'physical_status','') is not null and _filters->>'physical_status' not in('pending_return','received','missing','waived')
    or nullif(_filters->>'email_status','') is not null and _filters->>'email_status' not in('not_sent','queued','sent','delivered','bounced','failed')
    or nullif(_filters->>'scan_mode','') is not null and _filters->>'scan_mode' not in('document_scan','native_document_scan','manual_crop','legacy_photo','operator_replacement')
    or nullif(_filters->>'document_kind','') is not null and _filters->>'document_kind' not in('nfe','nfse','cte','other_fiscal','operational_reference')
    or _filters?'has_pdf' and jsonb_typeof(_filters->'has_pdf')<>'boolean' then
    raise exception 'invalid_delivery_receipt_filters' using errcode='22023';end if;
  with filtered as(
    select receipt.* from public.delivery_receipts receipt
    left join public.drivers driver on driver.id=receipt.driver_id and driver.tenant_id=receipt.tenant_id
    left join public.vehicles vehicle on vehicle.id=receipt.vehicle_id and vehicle.tenant_id=receipt.tenant_id
    left join public.dispatch_stops stop on stop.id=receipt.dispatch_stop_id and stop.tenant_id=receipt.tenant_id
    where receipt.tenant_id=_tenant_id and receipt.is_active
      and (nullif(_filters->>'digital_status','') is null or receipt.digital_status=_filters->>'digital_status')
      and (nullif(_filters->>'physical_status','') is null or receipt.physical_status=_filters->>'physical_status')
      and (nullif(_filters->>'email_status','') is null or receipt.email_status=_filters->>'email_status')
      and (nullif(_filters->>'scan_mode','') is null or receipt.scan_mode=_filters->>'scan_mode')
      and (nullif(_filters->>'driver_id','') is null or receipt.driver_id=(_filters->>'driver_id')::uuid)
      and (nullif(_filters->>'vehicle_id','') is null or receipt.vehicle_id=(_filters->>'vehicle_id')::uuid)
      and (not (_filters?'has_pdf') or (receipt.pdf_path is not null)=(_filters->>'has_pdf')::boolean)
      and (nullif(_filters->>'date_from','') is null or receipt.delivered_at>=(_filters->>'date_from')::date)
      and (nullif(_filters->>'date_to','') is null or receipt.delivered_at<((_filters->>'date_to')::date+1))
      and (nullif(_filters->>'supplier_id','') is null or exists(select 1 from public.delivery_receipt_documents link
        join public.delivery_document_references reference on reference.id=link.document_reference_id
        where link.receipt_id=receipt.id and link.tenant_id=receipt.tenant_id and reference.supplier_id=(_filters->>'supplier_id')::uuid))
      and (nullif(_filters->>'document_kind','') is null or exists(select 1 from public.delivery_receipt_documents link
        join public.delivery_document_references reference on reference.id=link.document_reference_id
        where link.receipt_id=receipt.id and link.tenant_id=receipt.tenant_id and reference.document_kind=_filters->>'document_kind'))
      and (nullif(btrim(_filters->>'search'),'') is null or concat_ws(' ',driver.name,vehicle.plate,stop.destination,receipt.receiver_name) ilike '%'||btrim(_filters->>'search')||'%'
        or exists(select 1 from public.delivery_receipt_documents link join public.delivery_document_references reference on reference.id=link.document_reference_id
          where link.receipt_id=receipt.id and link.tenant_id=receipt.tenant_id and concat_ws(' ',reference.document_number,reference.access_key,
            reference.issuer_name,reference.issuer_tax_id,reference.recipient_name,reference.operational_reference) ilike '%'||btrim(_filters->>'search')||'%'))
  ),page as(select * from filtered order by delivered_at desc,id desc limit _limit offset _offset)
  select coalesce(jsonb_agg(jsonb_build_object('id',receipt.id,'delivery_event_id',receipt.delivery_event_id,
    'trip_id',receipt.dispatch_trip_id,'stop_id',receipt.dispatch_stop_id,'previous_receipt_id',receipt.previous_receipt_id,
    'version',receipt.version,'delivered_at',receipt.delivered_at,'captured_at',receipt.captured_at,'digital_status',receipt.digital_status,
    'physical_status',receipt.physical_status,'email_status',receipt.email_status,'scan_mode',receipt.scan_mode,
    'rejection_reason',receipt.rejection_reason,'has_original',receipt.original_path is not null,'has_processed',receipt.processed_path is not null,
    'has_pdf',receipt.pdf_path is not null,'receiver_name',receipt.receiver_name,
    'driver',case when driver.id is null then null else jsonb_build_object('id',driver.id,'name',driver.name) end,
    'vehicle',case when vehicle.id is null then null else jsonb_build_object('id',vehicle.id,'plate',vehicle.plate) end,
    'destination',stop.destination,'documents',coalesce((select jsonb_agg(jsonb_build_object('id',reference.id,'kind',reference.document_kind,
      'number',reference.document_number,'series',reference.document_series,'access_key',reference.access_key,'issue_date',reference.issue_date,
      'issuer_name',reference.issuer_name,'issuer_tax_id',reference.issuer_tax_id,'recipient_name',reference.recipient_name,
      'supplier_id',reference.supplier_id,'operational_reference',reference.operational_reference) order by reference.document_kind,reference.document_number,reference.id)
      from public.delivery_receipt_documents link join public.delivery_document_references reference on reference.id=link.document_reference_id
      where link.receipt_id=receipt.id and link.tenant_id=receipt.tenant_id),'[]'::jsonb),'updated_at',receipt.updated_at)
      order by receipt.delivered_at desc,receipt.id desc),'[]'::jsonb) into v_rows from page receipt
    left join public.drivers driver on driver.id=receipt.driver_id and driver.tenant_id=receipt.tenant_id
    left join public.vehicles vehicle on vehicle.id=receipt.vehicle_id and vehicle.tenant_id=receipt.tenant_id
    left join public.dispatch_stops stop on stop.id=receipt.dispatch_stop_id and stop.tenant_id=receipt.tenant_id;
  with filtered as(select receipt.id from public.delivery_receipts receipt
    left join public.drivers driver on driver.id=receipt.driver_id and driver.tenant_id=receipt.tenant_id
    left join public.vehicles vehicle on vehicle.id=receipt.vehicle_id and vehicle.tenant_id=receipt.tenant_id
    left join public.dispatch_stops stop on stop.id=receipt.dispatch_stop_id and stop.tenant_id=receipt.tenant_id
    where receipt.tenant_id=_tenant_id and receipt.is_active
      and (nullif(_filters->>'digital_status','') is null or receipt.digital_status=_filters->>'digital_status')
      and (nullif(_filters->>'physical_status','') is null or receipt.physical_status=_filters->>'physical_status')
      and (nullif(_filters->>'email_status','') is null or receipt.email_status=_filters->>'email_status')
      and (nullif(_filters->>'scan_mode','') is null or receipt.scan_mode=_filters->>'scan_mode')
      and (nullif(_filters->>'driver_id','') is null or receipt.driver_id=(_filters->>'driver_id')::uuid)
      and (nullif(_filters->>'vehicle_id','') is null or receipt.vehicle_id=(_filters->>'vehicle_id')::uuid)
      and (not (_filters?'has_pdf') or (receipt.pdf_path is not null)=(_filters->>'has_pdf')::boolean)
      and (nullif(_filters->>'date_from','') is null or receipt.delivered_at>=(_filters->>'date_from')::date)
      and (nullif(_filters->>'date_to','') is null or receipt.delivered_at<((_filters->>'date_to')::date+1))
      and (nullif(_filters->>'supplier_id','') is null or exists(select 1 from public.delivery_receipt_documents link join public.delivery_document_references reference on reference.id=link.document_reference_id where link.receipt_id=receipt.id and link.tenant_id=receipt.tenant_id and reference.supplier_id=(_filters->>'supplier_id')::uuid))
      and (nullif(_filters->>'document_kind','') is null or exists(select 1 from public.delivery_receipt_documents link join public.delivery_document_references reference on reference.id=link.document_reference_id where link.receipt_id=receipt.id and link.tenant_id=receipt.tenant_id and reference.document_kind=_filters->>'document_kind'))
      and (nullif(btrim(_filters->>'search'),'') is null or concat_ws(' ',driver.name,vehicle.plate,stop.destination,receipt.receiver_name) ilike '%'||btrim(_filters->>'search')||'%'
        or exists(select 1 from public.delivery_receipt_documents link join public.delivery_document_references reference on reference.id=link.document_reference_id where link.receipt_id=receipt.id and link.tenant_id=receipt.tenant_id and concat_ws(' ',reference.document_number,reference.access_key,reference.issuer_name,reference.issuer_tax_id,reference.recipient_name,reference.operational_reference) ilike '%'||btrim(_filters->>'search')||'%'))
  ) select count(*)::integer into v_total from filtered;
  return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'rows',v_rows,'total',v_total,'limit',_limit,'offset',_offset);
end;$function$;
revoke all on function public.list_delivery_receipts_v1(uuid,jsonb,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_delivery_receipts_v1(uuid,jsonb,integer,integer) to authenticated;
