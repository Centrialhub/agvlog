-- Supplier identity and PDF cover snapshots for delivery receipt exports.
-- Fiscal document kinds remain peers; grouping never assumes CT-e ownership.
alter table public.delivery_receipt_email_templates
  add column supplier_key text,
  add column cover_config jsonb not null default '{"enabled":true,"title":"Comprovante de entrega","subtitle":null,"footer":null,"fields":["delivery_date","destination","driver","vehicle","receiver","documents"]}'::jsonb;
update public.delivery_receipt_email_templates set supplier_key='name:'||left(regexp_replace(lower(btrim(supplier_name)),'[^a-z0-9]+','-','g'),160)
 where supplier_key is null;
alter table public.delivery_receipt_email_templates add constraint delivery_receipt_email_template_supplier_key_check
  check(supplier_key is null or supplier_key~'^(tax:[0-9]{8,14}|id:[0-9a-f-]{36}|name:[a-z0-9][a-z0-9-]{1,159})$');
create unique index delivery_receipt_email_templates_key_unique on public.delivery_receipt_email_templates(tenant_id,supplier_key);

alter table public.delivery_receipt_email_batches
  add column supplier_key text,
  add column cover_config jsonb not null default '{"enabled":true,"title":"Comprovante de entrega","subtitle":null,"footer":null,"fields":["delivery_date","destination","driver","vehicle","receiver","documents"]}'::jsonb;
update public.delivery_receipt_email_batches set supplier_key='name:'||left(regexp_replace(lower(btrim(supplier_name)),'[^a-z0-9]+','-','g'),160)
 where supplier_key is null;
alter table public.delivery_receipt_email_batches add constraint delivery_receipt_email_batch_supplier_key_check
  check(supplier_key is null or supplier_key~'^(tax:[0-9]{8,14}|id:[0-9a-f-]{36}|name:[a-z0-9][a-z0-9-]{1,159})$');
alter table public.delivery_receipt_email_items add column cover_snapshot jsonb not null default '{}'::jsonb;

create schema if not exists delivery_private;
revoke all on schema delivery_private from public,anon,authenticated,service_role;
create function delivery_private.valid_cover_config(value jsonb) returns boolean language sql immutable set search_path=''
as $function$select jsonb_typeof(value)='object'
 and (value-array['enabled','title','subtitle','footer','fields'])='{}'::jsonb
 and jsonb_typeof(value->'enabled')='boolean'
 and length(btrim(coalesce(value->>'title',''))) between 3 and 120
 and (value->'subtitle'='null'::jsonb or jsonb_typeof(value->'subtitle')='string' and length(value->>'subtitle')<=240)
 and (value->'footer'='null'::jsonb or jsonb_typeof(value->'footer')='string' and length(value->>'footer')<=500)
 and jsonb_typeof(value->'fields')='array' and jsonb_array_length(value->'fields') between 1 and 6
 and not exists(select 1 from jsonb_array_elements_text(value->'fields') field where field not in('delivery_date','destination','driver','vehicle','receiver','documents'))
 and jsonb_array_length(value->'fields')=(select count(distinct field) from jsonb_array_elements_text(value->'fields') field)$function$;
revoke all on function delivery_private.valid_cover_config(jsonb) from public,anon,authenticated,service_role;
alter table public.delivery_receipt_email_templates add constraint delivery_receipt_email_template_cover_check
  check(delivery_private.valid_cover_config(cover_config));
alter table public.delivery_receipt_email_batches add constraint delivery_receipt_email_batch_cover_check
  check(delivery_private.valid_cover_config(cover_config));

create function delivery_private.reference_matches_supplier(reference public.delivery_document_references,key text,name text)
returns boolean language sql stable set search_path=''
as $function$select case
 when key like 'tax:%' then regexp_replace(coalesce(reference.issuer_tax_id,''),'[^0-9]','','g')=substr(key,5)
 when key like 'id:%' then reference.supplier_id::text=substr(key,4)
 when key like 'name:%' then lower(btrim(coalesce(reference.issuer_name,'')))=lower(btrim(name))
 else false end$function$;
revoke all on function delivery_private.reference_matches_supplier(public.delivery_document_references,text,text)
  from public,anon,authenticated,service_role;

create function public.save_delivery_receipt_email_template_v2(
  _tenant_id uuid,_template_id uuid,_supplier_key text,_supplier_name text,_recipients text[],_subject text,_body text,
  _cover_config jsonb,_is_active boolean,_expected_updated_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_template public.delivery_receipt_email_templates%rowtype;v_before jsonb;v_recipients text[];
begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'delivery_receipt_template_not_authorized' using errcode='42501';end if;
 v_recipients:=array(select lower(btrim(value)) from unnest(_recipients) value order by 1);
 if _template_id is null or coalesce(_supplier_key,'')!~'^(tax:[0-9]{8,14}|id:[0-9a-f-]{36}|name:[a-z0-9][a-z0-9-]{1,159})$'
  or length(coalesce(btrim(_supplier_name),'')) not between 2 and 200 or coalesce(cardinality(_recipients),0) not between 1 and 10
  or cardinality(_recipients)<>(select count(distinct lower(btrim(value))) from unnest(_recipients) value)
  or exists(select 1 from unnest(_recipients) value where btrim(value)!~*'^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9.-]+[.][A-Z]{2,63}$')
  or length(coalesce(btrim(_subject),'')) not between 3 and 200 or length(coalesce(btrim(_body),'')) not between 3 and 5000
  or not delivery_private.valid_cover_config(_cover_config) or _is_active is null then raise exception 'invalid_delivery_receipt_template' using errcode='22023';end if;
 select * into v_template from public.delivery_receipt_email_templates where id=_template_id and tenant_id=_tenant_id for update;
 if found then
  if v_template.supplier_key=_supplier_key and v_template.supplier_name=btrim(_supplier_name) and v_template.recipients=v_recipients
   and v_template.subject_template=btrim(_subject) and v_template.body_template=btrim(_body) and v_template.cover_config=_cover_config and v_template.is_active=_is_active then
   return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'template',to_jsonb(v_template),'confirmed',true,'replayed',true);end if;
  if _expected_updated_at is null or v_template.updated_at is distinct from _expected_updated_at then raise exception 'delivery_receipt_template_changed' using errcode='40001';end if;
  v_before:=to_jsonb(v_template);
  update public.delivery_receipt_email_templates set supplier_key=_supplier_key,supplier_name=btrim(_supplier_name),recipients=v_recipients,
   subject_template=btrim(_subject),body_template=btrim(_body),cover_config=_cover_config,is_active=_is_active,updated_by=auth.uid(),updated_at=clock_timestamp()
   where id=v_template.id returning * into v_template;
 else
  if _expected_updated_at is not null then raise exception 'delivery_receipt_template_not_found' using errcode='P0002';end if;
  insert into public.delivery_receipt_email_templates(id,tenant_id,supplier_key,supplier_name,recipients,subject_template,body_template,cover_config,is_active,created_by,updated_by)
   values(_template_id,_tenant_id,_supplier_key,btrim(_supplier_name),v_recipients,btrim(_subject),btrim(_body),_cover_config,_is_active,auth.uid(),auth.uid()) returning * into v_template;
 end if;
 perform public._log_entity_audit(_tenant_id,'delivery_receipt_email_template',v_template.id,case when v_before is null then 'created' else 'updated' end,
  v_before,to_jsonb(v_template),'save_delivery_receipt_email_template_v2');
 return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'template',to_jsonb(v_template),'confirmed',true);
exception when unique_violation then raise exception 'delivery_receipt_template_supplier_conflict' using errcode='23505';
end;$function$;
revoke all on function public.save_delivery_receipt_email_template_v2(uuid,uuid,text,text,text[],text,text,jsonb,boolean,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.save_delivery_receipt_email_template_v2(uuid,uuid,text,text,text[],text,text,jsonb,boolean,timestamptz) to authenticated;

create function public.queue_delivery_receipt_email_v2(
 _tenant_id uuid,_request_id uuid,_supplier_key text,_supplier_name text,_receipt_ids uuid[],_recipients text[],_subject text,_body_text text,_cover_config jsonb
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_batch public.delivery_receipt_email_batches%rowtype;v_receipt record;v_count integer;v_receipt_ids uuid[];v_recipients text[];v_documents jsonb;
begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'delivery_receipt_email_not_authorized' using errcode='42501';end if;
 v_receipt_ids:=array(select value from unnest(_receipt_ids) value order by value);v_recipients:=array(select lower(btrim(value)) from unnest(_recipients) value order by 1);
 if _request_id is null or coalesce(_supplier_key,'')!~'^(tax:[0-9]{8,14}|id:[0-9a-f-]{36}|name:[a-z0-9][a-z0-9-]{1,159})$'
  or length(coalesce(btrim(_supplier_name),'')) not between 2 and 200 or coalesce(cardinality(_receipt_ids),0) not between 1 and 5
  or cardinality(_receipt_ids)<>(select count(distinct value) from unnest(_receipt_ids) value) or coalesce(cardinality(_recipients),0) not between 1 and 10
  or cardinality(_recipients)<>(select count(distinct lower(btrim(value))) from unnest(_recipients) value)
  or exists(select 1 from unnest(_recipients) value where btrim(value)!~*'^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9.-]+[.][A-Z]{2,63}$')
  or length(coalesce(btrim(_subject),'')) not between 3 and 200 or length(coalesce(btrim(_body_text),'')) not between 3 and 5000
  or not delivery_private.valid_cover_config(_cover_config) then raise exception 'invalid_delivery_receipt_email' using errcode='22023';end if;
 select count(*) into v_count from public.delivery_receipts receipt where receipt.tenant_id=_tenant_id and receipt.id=any(v_receipt_ids)
  and receipt.is_active and receipt.digital_status='validated' and receipt.pdf_path is not null and exists(
   select 1 from public.delivery_receipt_documents link join public.delivery_document_references reference on reference.id=link.document_reference_id
   where link.receipt_id=receipt.id and link.tenant_id=receipt.tenant_id and delivery_private.reference_matches_supplier(reference,_supplier_key,_supplier_name));
 if v_count<>cardinality(v_receipt_ids) then raise exception 'delivery_receipt_email_not_ready' using errcode='23514';end if;
 insert into public.delivery_receipt_email_batches(id,tenant_id,supplier_key,supplier_name,receipt_ids,recipients,subject,body_text,cover_config,created_by)
  values(_request_id,_tenant_id,_supplier_key,btrim(_supplier_name),v_receipt_ids,v_recipients,btrim(_subject),btrim(_body_text),_cover_config,auth.uid()) on conflict(id) do nothing;
 select * into v_batch from public.delivery_receipt_email_batches where id=_request_id for update;
 if v_batch.tenant_id<>_tenant_id or v_batch.created_by<>auth.uid() or v_batch.supplier_key<>_supplier_key or v_batch.supplier_name<>btrim(_supplier_name)
  or v_batch.receipt_ids<>v_receipt_ids or v_batch.recipients<>v_recipients or v_batch.subject<>btrim(_subject) or v_batch.body_text<>btrim(_body_text)
  or v_batch.cover_config<>_cover_config then raise exception 'delivery_receipt_email_request_conflict' using errcode='23514';end if;
 if not exists(select 1 from public.delivery_receipt_email_items where batch_id=v_batch.id) then
  for v_receipt in select receipt.* from public.delivery_receipts receipt where receipt.tenant_id=_tenant_id and receipt.id=any(v_batch.receipt_ids) order by receipt.id loop
   select coalesce(jsonb_agg(jsonb_build_object('kind',reference.document_kind,'number',reference.document_number,'series',reference.document_series,
    'issuer_name',reference.issuer_name,'issuer_tax_id',reference.issuer_tax_id) order by reference.document_kind,reference.document_number,reference.id),'[]'::jsonb)
    into v_documents from public.delivery_receipt_documents link join public.delivery_document_references reference on reference.id=link.document_reference_id
    where link.receipt_id=v_receipt.id and link.tenant_id=v_receipt.tenant_id and delivery_private.reference_matches_supplier(reference,_supplier_key,_supplier_name);
   insert into public.delivery_receipt_email_items(batch_id,tenant_id,receipt_id,pdf_path,file_name,document_snapshot,cover_snapshot)
   values(v_batch.id,_tenant_id,v_receipt.id,v_receipt.pdf_path,
    'CANHOTO_'||regexp_replace(upper(left(btrim(_supplier_name),40)),'[^A-Z0-9]+','-','g')||'_'||to_char(v_receipt.delivered_at,'YYYY-MM-DD')||'_'||left(v_receipt.dispatch_trip_id::text,8)||'_'||left(v_receipt.dispatch_stop_id::text,8)||'.pdf',v_documents,
    jsonb_build_object('config',_cover_config,'supplier_key',_supplier_key,'supplier_name',btrim(_supplier_name),'delivered_at',v_receipt.delivered_at,
     'destination',(select stop.destination from public.dispatch_stops stop where stop.id=v_receipt.dispatch_stop_id and stop.tenant_id=v_receipt.tenant_id),
     'driver_name',(select driver.name from public.drivers driver where driver.id=v_receipt.driver_id and driver.tenant_id=v_receipt.tenant_id),
     'vehicle_plate',(select vehicle.plate from public.vehicles vehicle where vehicle.id=v_receipt.vehicle_id and vehicle.tenant_id=v_receipt.tenant_id),
     'receiver_name',v_receipt.receiver_name,'documents',v_documents));
   perform public._refresh_delivery_receipt_email_status(v_receipt.id);
  end loop;
  perform public._log_entity_audit(_tenant_id,'delivery_receipt_email',v_batch.id,'queued',null,
   jsonb_build_object('supplier_key',v_batch.supplier_key,'supplier_name',v_batch.supplier_name,'receipt_ids',to_jsonb(v_batch.receipt_ids),'cover_config',v_batch.cover_config),
   'queue_delivery_receipt_email_v2');
 end if;
 return jsonb_build_object('version',1,'batch_id',v_batch.id,'status',v_batch.status,'receipt_count',cardinality(v_batch.receipt_ids),'confirmed',true);
end;$function$;
revoke all on function public.queue_delivery_receipt_email_v2(uuid,uuid,text,text,uuid[],text[],text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.queue_delivery_receipt_email_v2(uuid,uuid,text,text,uuid[],text[],text,text,jsonb) to authenticated;

create or replace function public.claim_delivery_receipt_email_v1(_tenant_id uuid,_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_batch public.delivery_receipt_email_batches%rowtype;v_items jsonb:='[]'::jsonb;v_lease_token uuid;
begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'delivery_receipt_email_not_authorized' using errcode='42501';end if;
 select * into v_batch from public.delivery_receipt_email_batches where id=_batch_id and tenant_id=_tenant_id for update;
 if not found or v_batch.created_by<>auth.uid() then raise exception 'delivery_receipt_email_not_found' using errcode='P0002';end if;
 if v_batch.status in('sent','delivered','bounced') and v_batch.provider_message_id is not null then
  return jsonb_build_object('version',1,'tenant_id',v_batch.tenant_id,'actor_id',auth.uid(),'batch_id',v_batch.id,'status',v_batch.status,
   'provider_message_id',v_batch.provider_message_id,'lease_token',null,'retry_after_at',null,'items','[]'::jsonb);end if;
 if v_batch.status='sending' and v_batch.lease_expires_at>clock_timestamp() then
  return jsonb_build_object('version',1,'tenant_id',v_batch.tenant_id,'actor_id',auth.uid(),'batch_id',v_batch.id,'status','busy',
   'provider_message_id',v_batch.provider_message_id,'lease_token',null,'retry_after_at',v_batch.lease_expires_at,'items','[]'::jsonb);end if;
 if v_batch.retry_after_at>clock_timestamp() then
  return jsonb_build_object('version',1,'tenant_id',v_batch.tenant_id,'actor_id',auth.uid(),'batch_id',v_batch.id,'status','rate_limited',
   'provider_message_id',v_batch.provider_message_id,'lease_token',null,'retry_after_at',v_batch.retry_after_at,'items','[]'::jsonb);end if;
 v_lease_token:=gen_random_uuid();
 update public.delivery_receipt_email_batches set status='sending',attempt_count=attempt_count+1,lease_token=v_lease_token,
  lease_expires_at=clock_timestamp()+interval '10 minutes',retry_after_at=null,last_error=null,updated_at=clock_timestamp()
  where id=v_batch.id returning * into v_batch;
 perform public._log_entity_audit(_tenant_id,'delivery_receipt_email',v_batch.id,'send_attempt',null,
  jsonb_build_object('attempt_count',v_batch.attempt_count,'lease_expires_at',v_batch.lease_expires_at),'claim_delivery_receipt_email_v1');
 select jsonb_agg(jsonb_build_object('receipt_id',item.receipt_id,'path',item.pdf_path,'file_name',item.file_name,
  'documents',item.document_snapshot,'cover',item.cover_snapshot) order by item.file_name,item.receipt_id) into v_items
  from public.delivery_receipt_email_items item where item.batch_id=v_batch.id and item.tenant_id=v_batch.tenant_id;
 return jsonb_build_object('version',1,'tenant_id',v_batch.tenant_id,'actor_id',auth.uid(),'batch_id',v_batch.id,
  'supplier_key',v_batch.supplier_key,'supplier_name',v_batch.supplier_name,'recipients',to_jsonb(v_batch.recipients),'subject',v_batch.subject,
  'body_text',v_batch.body_text,'cover_config',v_batch.cover_config,'status',v_batch.status,'provider_message_id',v_batch.provider_message_id,
  'lease_token',v_batch.lease_token,'retry_after_at',v_batch.retry_after_at,'items',coalesce(v_items,'[]'::jsonb));
end;$function$;
revoke all on function public.claim_delivery_receipt_email_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_delivery_receipt_email_v1(uuid,uuid) to authenticated;

comment on column public.delivery_receipt_email_batches.cover_config is 'Immutable cover configuration snapshot used for every retry of the provider batch.';
comment on column public.delivery_receipt_email_items.cover_snapshot is 'Supplier-scoped delivery and NF-e/NFS-e/CT-e metadata rendered into the attachment cover.';
