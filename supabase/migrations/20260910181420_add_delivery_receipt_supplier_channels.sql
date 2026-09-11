-- Supplier delivery channels and automatic portal delivery foundation.
--
-- The generic portal adapter is intentionally registered as unavailable. This
-- migration creates a safe configuration/verification boundary and durable
-- queue, but it cannot transmit a receipt until a later, supplier-specific
-- adapter is implemented, enabled and verified by a trusted service.

alter table public.delivery_receipt_email_templates
  add column template_version integer not null default 1
    check (template_version > 0);

alter table public.delivery_receipt_email_batches
  add column template_id uuid references public.delivery_receipt_email_templates(id) on delete set null,
  add column template_version integer,
  add column template_snapshot jsonb,
  add column template_customized boolean not null default false,
  add column planned_source_bytes bigint,
  add column planned_attachment_bytes bigint,
  add column size_plan_snapshot jsonb,
  add constraint delivery_receipt_email_batch_template_version_check
    check ((template_id is null and template_version is null and template_snapshot is null)
      or (template_id is not null and template_version > 0 and jsonb_typeof(template_snapshot) = 'object'));

alter table public.delivery_receipt_email_batches
  add constraint delivery_receipt_email_batch_size_plan_check check (
    (planned_source_bytes is null and planned_attachment_bytes is null and size_plan_snapshot is null)
    or (planned_source_bytes between 1 and 26214400 and planned_attachment_bytes between planned_source_bytes and 26214400
      and jsonb_typeof(size_plan_snapshot)='array')
  );

create or replace function delivery_private.version_delivery_receipt_email_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if row(new.supplier_key,new.supplier_name,new.recipients,new.subject_template,new.body_template,new.cover_config,new.is_active)
    is distinct from
    row(old.supplier_key,old.supplier_name,old.recipients,old.subject_template,old.body_template,old.cover_config,old.is_active) then
    new.template_version := old.template_version + 1;
  else
    new.template_version := old.template_version;
  end if;
  return new;
end;
$function$;
revoke all on function delivery_private.version_delivery_receipt_email_template()
  from public, anon, authenticated, service_role;

create trigger version_delivery_receipt_email_template
before update on public.delivery_receipt_email_templates
for each row execute function delivery_private.version_delivery_receipt_email_template();

create or replace function delivery_private.snapshot_delivery_receipt_email_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare v_template public.delivery_receipt_email_templates%rowtype;
begin
  if new.template_snapshot is not null then return new; end if;
  select * into v_template
  from public.delivery_receipt_email_templates
  where tenant_id = new.tenant_id and supplier_key = new.supplier_key and is_active
  order by updated_at desc, id desc limit 1;
  if found then
    new.template_id := v_template.id;
    new.template_version := v_template.template_version;
    new.template_snapshot := jsonb_build_object(
      'id',v_template.id,'version',v_template.template_version,
      'supplier_key',v_template.supplier_key,'supplier_name',v_template.supplier_name,
      'recipients',to_jsonb(v_template.recipients),'subject_template',v_template.subject_template,
      'body_template',v_template.body_template,'cover_config',v_template.cover_config
    );
    new.template_customized := new.recipients is distinct from v_template.recipients
      or new.subject is distinct from v_template.subject_template
      or new.body_text is distinct from v_template.body_template
      or new.cover_config is distinct from v_template.cover_config;
  end if;
  return new;
end;
$function$;
revoke all on function delivery_private.snapshot_delivery_receipt_email_template()
  from public, anon, authenticated, service_role;

create trigger snapshot_delivery_receipt_email_template
before insert on public.delivery_receipt_email_batches
for each row execute function delivery_private.snapshot_delivery_receipt_email_template();

create or replace function delivery_private.snapshot_delivery_receipt_email_sizes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare v_receipt_id uuid;v_path text;v_size bigint;v_source bigint:=0;v_projected bigint:=0;v_reserve bigint;v_provider_bytes bigint;v_snapshot jsonb:='[]'::jsonb;
begin
  v_reserve:=case when coalesce((new.cover_config->>'enabled')::boolean,false) then 524288 else 0 end;
  foreach v_receipt_id in array new.receipt_ids loop
    select receipt.pdf_path into v_path from public.delivery_receipts receipt
      where receipt.id=v_receipt_id and receipt.tenant_id=new.tenant_id;
    select case when coalesce(object.metadata->>'size','')~'^[1-9][0-9]{0,8}$' then (object.metadata->>'size')::bigint end
      into v_size from storage.objects object where object.bucket_id='receipts' and object.name=v_path;
    if v_size is null then raise exception 'delivery_receipt_email_pdf_size_unavailable' using errcode='23514';end if;
    if v_size+v_reserve>5242880 then raise exception 'delivery_receipt_email_attachment_too_large' using errcode='22001';end if;
    v_provider_bytes:=((v_size+v_reserve+2)/3)*4;
    v_source:=v_source+v_size;v_projected:=v_projected+v_provider_bytes;
    v_snapshot:=v_snapshot||jsonb_build_array(jsonb_build_object('receipt_id',v_receipt_id,'path',v_path,
      'source_bytes',v_size,'cover_reserve_bytes',v_reserve,'projected_provider_bytes',v_provider_bytes));
  end loop;
  if v_projected>26214400 then raise exception 'delivery_receipt_email_batch_too_large' using errcode='22001';end if;
  update public.delivery_receipt_email_batches set planned_source_bytes=v_source,
    planned_attachment_bytes=v_projected,size_plan_snapshot=v_snapshot where id=new.id;
  return new;
end;
$function$;
revoke all on function delivery_private.snapshot_delivery_receipt_email_sizes()
  from public,anon,authenticated,service_role;

create trigger validate_delivery_receipt_email_batch_sizes
after insert on public.delivery_receipt_email_batches
for each row execute function delivery_private.snapshot_delivery_receipt_email_sizes();

create or replace function public.plan_delivery_receipt_email_batches_v1(
  _tenant_id uuid,_supplier_key text,_supplier_name text,_receipt_ids uuid[],_cover_config jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare v_item record;v_batches jsonb:='[]'::jsonb;v_current jsonb:='[]'::jsonb;v_current_source bigint:=0;v_current_projected bigint:=0;v_provider_bytes bigint;
  v_total_source bigint:=0;v_count integer:=0;v_total_count integer:=0;v_reserve bigint;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'delivery_receipt_email_not_authorized' using errcode='42501';end if;
  if coalesce(_supplier_key,'')!~'^(tax:[0-9]{8,14}|id:[0-9a-f-]{36}|name:[a-z0-9][a-z0-9-]{1,159})$'
    or length(coalesce(btrim(_supplier_name),'')) not between 2 and 200
    or coalesce(cardinality(_receipt_ids),0) not between 1 and 100
    or cardinality(_receipt_ids)<>(select count(distinct value) from unnest(_receipt_ids) value)
    or not delivery_private.valid_cover_config(_cover_config) then
    raise exception 'invalid_delivery_receipt_email_plan' using errcode='22023';end if;
  v_reserve:=case when coalesce((_cover_config->>'enabled')::boolean,false) then 524288 else 0 end;
  for v_item in
    select receipt.id,receipt.pdf_path,(object.metadata->>'size')::bigint as source_bytes
    from public.delivery_receipts receipt
    join storage.objects object on object.bucket_id='receipts' and object.name=receipt.pdf_path
      and coalesce(object.metadata->>'size','')~'^[1-9][0-9]{0,8}$'
    where receipt.tenant_id=_tenant_id and receipt.id=any(_receipt_ids) and receipt.is_active
      and receipt.digital_status='validated' and receipt.pdf_path is not null
      and exists(select 1 from public.delivery_receipt_documents link
        join public.delivery_document_references reference on reference.id=link.document_reference_id
        where link.receipt_id=receipt.id and link.tenant_id=receipt.tenant_id
          and delivery_private.reference_matches_supplier(reference,_supplier_key,_supplier_name))
    order by receipt.id
  loop
    if v_item.source_bytes+v_reserve>5242880 then
      raise exception 'delivery_receipt_email_attachment_too_large' using errcode='22001';end if;
    v_provider_bytes:=((v_item.source_bytes+v_reserve+2)/3)*4;
    if v_count>0 and (v_count=5 or v_current_projected+v_provider_bytes>26214400) then
      v_batches:=v_batches||jsonb_build_array(jsonb_build_object('items',v_current,'source_bytes',v_current_source,
        'projected_bytes',v_current_projected));v_current:='[]'::jsonb;v_current_source:=0;v_current_projected:=0;v_count:=0;
    end if;
    v_current:=v_current||jsonb_build_array(jsonb_build_object('receipt_id',v_item.id,'source_bytes',v_item.source_bytes,
      'cover_reserve_bytes',v_reserve,'projected_bytes',v_provider_bytes));
    v_current_source:=v_current_source+v_item.source_bytes;v_current_projected:=v_current_projected+v_provider_bytes;
    v_total_source:=v_total_source+v_item.source_bytes;v_count:=v_count+1;v_total_count:=v_total_count+1;
  end loop;
  if v_total_count<>cardinality(_receipt_ids) then raise exception 'delivery_receipt_email_pdf_size_unavailable' using errcode='23514';end if;
  if v_count>0 then v_batches:=v_batches||jsonb_build_array(jsonb_build_object('items',v_current,'source_bytes',v_current_source,
    'projected_bytes',v_current_projected));end if;
  return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'supplier_key',_supplier_key,
    'receipt_count',v_total_count,'source_bytes',v_total_source,'cover_reserve_bytes_per_file',v_reserve,
    'max_attachments_per_batch',5,'max_attachment_bytes',5242880,'max_batch_bytes',26214400,'batches',v_batches);
end;
$function$;
revoke all on function public.plan_delivery_receipt_email_batches_v1(uuid,text,text,uuid[],jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.plan_delivery_receipt_email_batches_v1(uuid,text,text,uuid[],jsonb) to authenticated;

create table public.delivery_receipt_channel_adapters (
  adapter_key text primary key check (adapter_key ~ '^[a-z][a-z0-9_]{2,63}$'),
  channel_kind text not null check (channel_kind in ('email','portal')),
  display_name text not null check (length(btrim(display_name)) between 3 and 120),
  is_implemented boolean not null default false,
  is_enabled boolean not null default false,
  supported_capabilities jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint delivery_receipt_channel_adapter_activation_check
    check (not is_enabled or is_implemented),
  constraint delivery_receipt_channel_adapter_capabilities_check
    check (jsonb_typeof(supported_capabilities) = 'object')
);

insert into public.delivery_receipt_channel_adapters(
  adapter_key,channel_kind,display_name,is_implemented,is_enabled,supported_capabilities
) values
  ('resend_email_v1','email','E-mail transacional Resend',true,true,
   '{"receipt_upload":true,"document_metadata":true,"supports_idempotency":true,"multi_receipt_batch":true,"max_files_per_request":5}'::jsonb),
  ('supplier_portal_generic_v1','portal','Portal genérico (não implementado)',false,false,
   '{"receipt_upload":false,"document_metadata":false,"supports_idempotency":false,"multi_receipt_batch":false,"max_files_per_request":1}'::jsonb);

create or replace function delivery_private.valid_supplier_channel_configuration(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce(jsonb_typeof(value) = 'object'
    and (value - array['portal_origin','account_reference','credential_reference','upload_path_hint']) = '{}'::jsonb
    and coalesce(value->>'portal_origin','') ~ '^https://[A-Za-z0-9.-]+(?::[0-9]{2,5})?$'
    and lower(value->>'portal_origin') !~ '^https://(localhost|127[.]|0[.]|10[.]|192[.]168[.]|169[.]254[.]|172[.](1[6-9]|2[0-9]|3[01])[.]|\[?::1\]?)(:|$)'
    and (value->'account_reference' = 'null'::jsonb
      or jsonb_typeof(value->'account_reference') = 'string'
        and length(value->>'account_reference') between 1 and 120)
    and jsonb_typeof(value->'credential_reference') = 'string'
    and coalesce(value->>'credential_reference','') ~ '^[A-Z][A-Z0-9_]{5,119}$'
    and (value->'upload_path_hint' = 'null'::jsonb
      or jsonb_typeof(value->'upload_path_hint') = 'string'
        and length(value->>'upload_path_hint') between 1 and 240),false);
$function$;
revoke all on function delivery_private.valid_supplier_channel_configuration(jsonb)
  from public, anon, authenticated, service_role;

create or replace function delivery_private.valid_supplier_channel_capabilities(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce(jsonb_typeof(value) = 'object'
    and (value - array['receipt_upload','document_metadata','supports_idempotency','multi_receipt_batch','max_files_per_request','accepted_document_kinds']) = '{}'::jsonb
    and jsonb_typeof(value->'receipt_upload') = 'boolean'
    and jsonb_typeof(value->'document_metadata') = 'boolean'
    and jsonb_typeof(value->'supports_idempotency') = 'boolean'
    and jsonb_typeof(value->'multi_receipt_batch') = 'boolean'
    and jsonb_typeof(value->'max_files_per_request') = 'number'
    and coalesce(value->>'max_files_per_request','') ~ '^[1-5]$'
    and jsonb_typeof(value->'accepted_document_kinds') = 'array'
    and jsonb_array_length(value->'accepted_document_kinds') between 1 and 5
    and jsonb_array_length(value->'accepted_document_kinds') = (
      select count(distinct kind) from jsonb_array_elements_text(value->'accepted_document_kinds') kind
    )
    and not exists (
      select 1 from jsonb_array_elements_text(value->'accepted_document_kinds') kind
      where kind not in ('nfe','nfse','cte','other_fiscal','operational_reference')
    ),false);
$function$;
revoke all on function delivery_private.valid_supplier_channel_capabilities(jsonb)
  from public, anon, authenticated, service_role;

create or replace function delivery_private.safe_delivery_receipt_provider_metadata(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce(jsonb_typeof(value) = 'object'
    and octet_length(value::text) <= 32768
    and value::text !~* '"[^" ]*(secret|password|token|authorization|cookie|credential)[^"]*"[[:space:]]*:',false);
$function$;
revoke all on function delivery_private.safe_delivery_receipt_provider_metadata(jsonb)
  from public, anon, authenticated, service_role;

create table public.delivery_receipt_supplier_channels (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  supplier_key text not null,
  supplier_name text not null check (length(btrim(supplier_name)) between 2 and 200),
  channel_kind text not null default 'portal' check (channel_kind = 'portal'),
  adapter_key text not null references public.delivery_receipt_channel_adapters(adapter_key) on delete restrict,
  lifecycle_status text not null default 'draft' check (lifecycle_status in ('draft','verified','suspended')),
  safe_configuration jsonb not null,
  requested_capabilities jsonb not null,
  verified_capabilities jsonb,
  auto_enqueue_requested boolean not null default false,
  auto_enqueue boolean not null default false,
  verification_reference text,
  verified_at timestamptz,
  verified_by text,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint delivery_receipt_supplier_channel_key_check
    check (supplier_key ~ '^(tax:[0-9]{8,14}|id:[0-9a-f-]{36}|name:[a-z0-9][a-z0-9-]{1,159})$'),
  constraint delivery_receipt_supplier_channel_configuration_check
    check (delivery_private.valid_supplier_channel_configuration(safe_configuration)),
  constraint delivery_receipt_supplier_channel_requested_capabilities_check
    check (delivery_private.valid_supplier_channel_capabilities(requested_capabilities)),
  constraint delivery_receipt_supplier_channel_verified_capabilities_check
    check (verified_capabilities is null or delivery_private.valid_supplier_channel_capabilities(verified_capabilities)),
  constraint delivery_receipt_supplier_channel_verification_check check (
    (lifecycle_status = 'verified' and verified_capabilities is not null
      and verification_reference is not null and verified_at is not null and verified_by is not null)
    or (lifecycle_status <> 'verified' and not auto_enqueue)
  ),
  unique (tenant_id,id),
  unique (tenant_id,supplier_key,channel_kind)
);

create table public.delivery_receipt_channel_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel_id uuid not null,
  receipt_id uuid not null,
  supplier_key text not null,
  channel_kind text not null default 'portal' check (channel_kind = 'portal'),
  adapter_key text not null,
  evidence_fingerprint text not null check (evidence_fingerprint ~ '^[a-f0-9]{64}$'),
  idempotency_key text not null check (idempotency_key ~ '^delivery-receipt-portal:[a-f0-9]{64}$'),
  payload_snapshot jsonb not null check (jsonb_typeof(payload_snapshot) = 'object'),
  status text not null default 'queued' check (status in ('queued','processing','succeeded','failed','unavailable','cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  retry_after_at timestamptz,
  external_reference text,
  response_metadata jsonb,
  last_error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  constraint delivery_receipt_channel_job_channel_fkey
    foreign key (tenant_id,channel_id) references public.delivery_receipt_supplier_channels(tenant_id,id) on delete restrict,
  constraint delivery_receipt_channel_job_receipt_fkey
    foreign key (tenant_id,receipt_id) references public.delivery_receipts(tenant_id,id) on delete restrict,
  constraint delivery_receipt_channel_job_adapter_fkey
    foreign key (adapter_key) references public.delivery_receipt_channel_adapters(adapter_key) on delete restrict,
  constraint delivery_receipt_channel_job_lease_check
    check ((lease_token is null and lease_expires_at is null) or (lease_token is not null and lease_expires_at is not null)),
  constraint delivery_receipt_channel_job_response_check
    check (response_metadata is null or delivery_private.safe_delivery_receipt_provider_metadata(response_metadata)),
  unique (tenant_id,id),
  unique (channel_id,receipt_id,evidence_fingerprint),
  unique (tenant_id,idempotency_key)
);

create table public.delivery_receipt_channel_job_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_id uuid not null,
  event_type text not null check (event_type in ('queued','claimed','succeeded','failed','unavailable','cancelled','retry_queued')),
  detail jsonb not null default '{}'::jsonb
    check (delivery_private.safe_delivery_receipt_provider_metadata(detail)),
  created_at timestamptz not null default clock_timestamp(),
  constraint delivery_receipt_channel_job_event_job_fkey
    foreign key (tenant_id,job_id) references public.delivery_receipt_channel_jobs(tenant_id,id) on delete restrict
);

create index delivery_receipt_supplier_channels_operation_idx
  on public.delivery_receipt_supplier_channels(tenant_id,lifecycle_status,supplier_name);
create index delivery_receipt_channel_jobs_worker_idx
  on public.delivery_receipt_channel_jobs(status,retry_after_at,created_at,id);
create index delivery_receipt_channel_jobs_operation_idx
  on public.delivery_receipt_channel_jobs(tenant_id,status,created_at desc,id desc);
create index delivery_receipt_channel_job_events_job_idx
  on public.delivery_receipt_channel_job_events(tenant_id,job_id,created_at,id);

alter table public.delivery_receipt_channel_adapters enable row level security;
alter table public.delivery_receipt_supplier_channels enable row level security;
alter table public.delivery_receipt_channel_jobs enable row level security;
alter table public.delivery_receipt_channel_job_events enable row level security;

revoke all on table public.delivery_receipt_channel_adapters,
  public.delivery_receipt_supplier_channels,public.delivery_receipt_channel_jobs,
  public.delivery_receipt_channel_job_events from public,anon,authenticated,service_role;
grant select on table public.delivery_receipt_supplier_channels,public.delivery_receipt_channel_jobs,
  public.delivery_receipt_channel_job_events to authenticated;
grant all on table public.delivery_receipt_channel_adapters,public.delivery_receipt_supplier_channels,
  public.delivery_receipt_channel_jobs,public.delivery_receipt_channel_job_events to service_role;
grant usage,select on sequence public.delivery_receipt_channel_job_events_id_seq to service_role;

create policy delivery_receipt_supplier_channels_operator_read
  on public.delivery_receipt_supplier_channels for select to authenticated
  using (coalesce(public.is_tenant_operator_or_admin(tenant_id),false));
create policy delivery_receipt_channel_jobs_operator_read
  on public.delivery_receipt_channel_jobs for select to authenticated
  using (coalesce(public.is_tenant_operator_or_admin(tenant_id),false));
create policy delivery_receipt_channel_job_events_operator_read
  on public.delivery_receipt_channel_job_events for select to authenticated
  using (coalesce(public.is_tenant_operator_or_admin(tenant_id),false));

create or replace function public.save_delivery_receipt_supplier_channel_v1(
  _tenant_id uuid,_channel_id uuid,_supplier_key text,_supplier_name text,_adapter_key text,
  _safe_configuration jsonb,_requested_capabilities jsonb,_auto_enqueue_requested boolean,
  _expected_updated_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_channel public.delivery_receipt_supplier_channels%rowtype;v_before jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'delivery_receipt_channel_not_authorized' using errcode='42501';
  end if;
  if _channel_id is null or coalesce(_supplier_key,'') !~ '^(tax:[0-9]{8,14}|id:[0-9a-f-]{36}|name:[a-z0-9][a-z0-9-]{1,159})$'
    or length(coalesce(btrim(_supplier_name),'')) not between 2 and 200
    or not delivery_private.valid_supplier_channel_configuration(_safe_configuration)
    or not delivery_private.valid_supplier_channel_capabilities(_requested_capabilities)
    or _auto_enqueue_requested is null
    or not exists (select 1 from public.delivery_receipt_channel_adapters adapter
      where adapter.adapter_key=_adapter_key and adapter.channel_kind='portal') then
    raise exception 'invalid_delivery_receipt_supplier_channel' using errcode='22023';
  end if;
  select * into v_channel from public.delivery_receipt_supplier_channels
    where id=_channel_id and tenant_id=_tenant_id for update;
  if found then
    if v_channel.supplier_key=_supplier_key and v_channel.supplier_name=btrim(_supplier_name)
      and v_channel.adapter_key=_adapter_key and v_channel.safe_configuration=_safe_configuration
      and v_channel.requested_capabilities=_requested_capabilities
      and v_channel.auto_enqueue_requested=_auto_enqueue_requested then
      return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),
        'channel',to_jsonb(v_channel),'confirmed',true,'replayed',true);
    end if;
    if _expected_updated_at is null or v_channel.updated_at is distinct from _expected_updated_at then
      raise exception 'delivery_receipt_supplier_channel_changed' using errcode='40001';
    end if;
    v_before:=to_jsonb(v_channel);
    update public.delivery_receipt_supplier_channels set
      supplier_key=_supplier_key,supplier_name=btrim(_supplier_name),adapter_key=_adapter_key,
      lifecycle_status='draft',safe_configuration=_safe_configuration,
      requested_capabilities=_requested_capabilities,verified_capabilities=null,
      auto_enqueue_requested=_auto_enqueue_requested,auto_enqueue=false,
      verification_reference=null,verified_at=null,verified_by=null,
      updated_by=auth.uid(),updated_at=clock_timestamp()
      where id=v_channel.id returning * into v_channel;
  else
    if _expected_updated_at is not null then
      raise exception 'delivery_receipt_supplier_channel_not_found' using errcode='P0002';
    end if;
    insert into public.delivery_receipt_supplier_channels(
      id,tenant_id,supplier_key,supplier_name,adapter_key,safe_configuration,
      requested_capabilities,auto_enqueue_requested,created_by,updated_by
    ) values (
      _channel_id,_tenant_id,_supplier_key,btrim(_supplier_name),_adapter_key,_safe_configuration,
      _requested_capabilities,_auto_enqueue_requested,auth.uid(),auth.uid()
    ) returning * into v_channel;
  end if;
  perform public._log_entity_audit(_tenant_id,'delivery_receipt_supplier_channel',v_channel.id,
    case when v_before is null then 'created_draft' else 'updated_reset_verification' end,
    v_before,to_jsonb(v_channel)-'safe_configuration','save_delivery_receipt_supplier_channel_v1');
  return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),
    'channel',to_jsonb(v_channel),'confirmed',true,'replayed',false);
exception when unique_violation then
  raise exception 'delivery_receipt_supplier_channel_conflict' using errcode='23505';
end;
$function$;
revoke all on function public.save_delivery_receipt_supplier_channel_v1(uuid,uuid,text,text,text,jsonb,jsonb,boolean,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.save_delivery_receipt_supplier_channel_v1(uuid,uuid,text,text,text,jsonb,jsonb,boolean,timestamptz)
  to authenticated;

create or replace function delivery_private.enqueue_delivery_receipt_portal_jobs(_receipt_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare v_receipt public.delivery_receipts%rowtype;v_channel record;v_documents jsonb;v_fingerprint text;v_job_id uuid;v_count integer:=0;
begin
  select * into v_receipt from public.delivery_receipts where id=_receipt_id;
  if not found or not v_receipt.is_active or v_receipt.digital_status<>'validated' or v_receipt.pdf_path is null then return 0;end if;
  for v_channel in
    select channel.* from public.delivery_receipt_supplier_channels channel
    join public.delivery_receipt_channel_adapters adapter on adapter.adapter_key=channel.adapter_key
    where channel.tenant_id=v_receipt.tenant_id and channel.lifecycle_status='verified' and channel.auto_enqueue
      and channel.channel_kind='portal' and adapter.is_implemented and adapter.is_enabled
  loop
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',reference.id,'kind',reference.document_kind,'number',reference.document_number,
      'series',reference.document_series,'access_key',reference.access_key,'issue_date',reference.issue_date,
      'issuer_name',reference.issuer_name,'issuer_tax_id',reference.issuer_tax_id,
      'recipient_name',reference.recipient_name,'supplier_id',reference.supplier_id,
      'operational_reference',reference.operational_reference
    ) order by reference.document_kind,reference.document_number,reference.id),'[]'::jsonb)
    into v_documents
    from public.delivery_receipt_documents link
    join public.delivery_document_references reference on reference.id=link.document_reference_id
    where link.receipt_id=v_receipt.id and link.tenant_id=v_receipt.tenant_id
      and delivery_private.reference_matches_supplier(reference,v_channel.supplier_key,v_channel.supplier_name);
    if jsonb_array_length(v_documents)=0 then continue;end if;
    if exists(select 1 from jsonb_array_elements(v_documents) document
      where not (v_channel.verified_capabilities->'accepted_document_kinds') ? (document->>'kind')) then
      continue;
    end if;
    v_fingerprint:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(concat_ws('|',v_receipt.id::text,v_receipt.pdf_path,
      coalesce(v_receipt.processed_hash,''),v_channel.id::text),'UTF8'),'sha256'),'hex');
    insert into public.delivery_receipt_channel_jobs(
      tenant_id,channel_id,receipt_id,supplier_key,adapter_key,evidence_fingerprint,idempotency_key,payload_snapshot
    ) values (
      v_receipt.tenant_id,v_channel.id,v_receipt.id,v_channel.supplier_key,v_channel.adapter_key,v_fingerprint,
      'delivery-receipt-portal:'||v_fingerprint,
      jsonb_build_object('version',1,'receipt_id',v_receipt.id,'delivery_event_id',v_receipt.delivery_event_id,
        'supplier_key',v_channel.supplier_key,'supplier_name',v_channel.supplier_name,
        'pdf',jsonb_build_object('bucket',v_receipt.storage_bucket,'path',v_receipt.pdf_path),
        'delivered_at',v_receipt.delivered_at,'documents',v_documents,
        'capabilities',v_channel.verified_capabilities)
    ) on conflict(channel_id,receipt_id,evidence_fingerprint) do nothing returning id into v_job_id;
    if v_job_id is not null then
      insert into public.delivery_receipt_channel_job_events(tenant_id,job_id,event_type,detail)
        values(v_receipt.tenant_id,v_job_id,'queued',jsonb_build_object('source','automatic_receipt_readiness'));
      perform public._log_entity_audit(v_receipt.tenant_id,'delivery_receipt_channel_job',v_job_id,'queued',null,
        jsonb_build_object('channel_id',v_channel.id,'receipt_id',v_receipt.id,'supplier_key',v_channel.supplier_key),
        'enqueue_delivery_receipt_portal_jobs');
      v_count:=v_count+1;
    end if;
    v_job_id:=null;
  end loop;
  return v_count;
end;
$function$;
revoke all on function delivery_private.enqueue_delivery_receipt_portal_jobs(uuid)
  from public,anon,authenticated,service_role;

create or replace function delivery_private.enqueue_delivery_receipt_portal_receipt_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform delivery_private.enqueue_delivery_receipt_portal_jobs(new.id);
  return new;
end;
$function$;
revoke all on function delivery_private.enqueue_delivery_receipt_portal_receipt_trigger()
  from public,anon,authenticated,service_role;

create or replace function delivery_private.enqueue_delivery_receipt_portal_document_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform delivery_private.enqueue_delivery_receipt_portal_jobs(new.receipt_id);
  return new;
end;
$function$;
revoke all on function delivery_private.enqueue_delivery_receipt_portal_document_trigger()
  from public,anon,authenticated,service_role;

create trigger enqueue_delivery_receipt_portal_on_receipt
after insert or update of digital_status,pdf_path,is_active,processed_hash on public.delivery_receipts
for each row execute function delivery_private.enqueue_delivery_receipt_portal_receipt_trigger();
create trigger enqueue_delivery_receipt_portal_on_document
after insert on public.delivery_receipt_documents
for each row execute function delivery_private.enqueue_delivery_receipt_portal_document_trigger();

create or replace function public.verify_delivery_receipt_supplier_channel_v1(
  _tenant_id uuid,_channel_id uuid,_verification_reference text,_verified_by text,_verified_capabilities jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_channel public.delivery_receipt_supplier_channels%rowtype;v_adapter public.delivery_receipt_channel_adapters%rowtype;v_receipt_id uuid;v_queued integer:=0;
begin
  if length(coalesce(btrim(_verification_reference),'')) not between 8 and 200
    or length(coalesce(btrim(_verified_by),'')) not between 3 and 120
    or not delivery_private.valid_supplier_channel_capabilities(_verified_capabilities) then
    raise exception 'invalid_delivery_receipt_channel_verification' using errcode='22023';
  end if;
  select * into v_channel from public.delivery_receipt_supplier_channels
    where id=_channel_id and tenant_id=_tenant_id for update;
  if not found then raise exception 'delivery_receipt_supplier_channel_not_found' using errcode='P0002';end if;
  select * into v_adapter from public.delivery_receipt_channel_adapters
    where adapter_key=v_channel.adapter_key and channel_kind='portal';
  if not found or not v_adapter.is_implemented or not v_adapter.is_enabled then
    raise exception 'delivery_receipt_channel_adapter_unavailable' using errcode='55000';
  end if;
  if not coalesce((_verified_capabilities->>'receipt_upload')::boolean,false)
    or not coalesce((_verified_capabilities->>'supports_idempotency')::boolean,false)
    or _verified_capabilities is distinct from v_channel.requested_capabilities
    or not coalesce((v_adapter.supported_capabilities->>'receipt_upload')::boolean,false)
    or not coalesce((v_adapter.supported_capabilities->>'supports_idempotency')::boolean,false)
    or (_verified_capabilities->>'max_files_per_request')::integer>
      coalesce((v_adapter.supported_capabilities->>'max_files_per_request')::integer,0) then
    raise exception 'delivery_receipt_channel_capabilities_insufficient' using errcode='23514';
  end if;
  update public.delivery_receipt_supplier_channels set lifecycle_status='verified',
    verified_capabilities=_verified_capabilities,auto_enqueue=auto_enqueue_requested,
    verification_reference=btrim(_verification_reference),verified_at=clock_timestamp(),verified_by=btrim(_verified_by),
    updated_at=clock_timestamp() where id=v_channel.id returning * into v_channel;
  for v_receipt_id in select receipt.id from public.delivery_receipts receipt
    where receipt.tenant_id=_tenant_id and receipt.is_active and receipt.digital_status='validated' and receipt.pdf_path is not null
  loop v_queued:=v_queued+delivery_private.enqueue_delivery_receipt_portal_jobs(v_receipt_id);end loop;
  perform public._log_entity_audit(_tenant_id,'delivery_receipt_supplier_channel',v_channel.id,'verified',null,
    to_jsonb(v_channel)-'safe_configuration','verify_delivery_receipt_supplier_channel_v1');
  return jsonb_build_object('version',1,'channel_id',v_channel.id,'status',v_channel.lifecycle_status,
    'auto_enqueue',v_channel.auto_enqueue,'queued_jobs',v_queued,'confirmed',true);
end;
$function$;
revoke all on function public.verify_delivery_receipt_supplier_channel_v1(uuid,uuid,text,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.verify_delivery_receipt_supplier_channel_v1(uuid,uuid,text,text,jsonb)
  to service_role;

create or replace function public.claim_delivery_receipt_channel_jobs_v1(_limit integer default 10,_job_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_jobs jsonb;
begin
  if _limit not between 1 and 25 then raise exception 'invalid_delivery_receipt_channel_claim' using errcode='22023';end if;
  with candidates as (
    select job.id from public.delivery_receipt_channel_jobs job
    join public.delivery_receipt_supplier_channels channel on channel.id=job.channel_id and channel.tenant_id=job.tenant_id
    join public.delivery_receipt_channel_adapters adapter on adapter.adapter_key=job.adapter_key
    where (_job_id is null or job.id=_job_id)
      and (job.status in('queued','failed') or job.status='processing' and job.lease_expires_at<=clock_timestamp())
      and (job.retry_after_at is null or job.retry_after_at<=clock_timestamp())
      and channel.lifecycle_status='verified' and channel.auto_enqueue
      and adapter.is_implemented and adapter.is_enabled
    order by job.created_at,job.id for update of job skip locked limit _limit
  ), claimed as (
    update public.delivery_receipt_channel_jobs job set status='processing',attempt_count=attempt_count+1,
      lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '10 minutes',
      retry_after_at=null,last_error_code=null,updated_at=clock_timestamp()
    from candidates where job.id=candidates.id returning job.*
  ), events as (
    insert into public.delivery_receipt_channel_job_events(tenant_id,job_id,event_type,detail)
    select tenant_id,id,'claimed',jsonb_build_object('attempt_count',attempt_count,'lease_expires_at',lease_expires_at)
    from claimed returning job_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'job_id',claimed.id,'tenant_id',claimed.tenant_id,'channel_id',claimed.channel_id,
    'receipt_id',claimed.receipt_id,'supplier_key',claimed.supplier_key,'adapter_key',claimed.adapter_key,
    'idempotency_key',claimed.idempotency_key,'payload',claimed.payload_snapshot,
    'lease_token',claimed.lease_token,'lease_expires_at',claimed.lease_expires_at,
    'safe_configuration',channel.safe_configuration,'verified_capabilities',channel.verified_capabilities
  ) order by claimed.created_at,claimed.id),'[]'::jsonb) into v_jobs
  from claimed join public.delivery_receipt_supplier_channels channel
    on channel.id=claimed.channel_id and channel.tenant_id=claimed.tenant_id;
  return jsonb_build_object('version',1,'jobs',v_jobs,'claimed_count',jsonb_array_length(v_jobs));
end;
$function$;
revoke all on function public.claim_delivery_receipt_channel_jobs_v1(integer,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.claim_delivery_receipt_channel_jobs_v1(integer,uuid) to service_role;

create or replace function public.complete_delivery_receipt_channel_job_v1(
  _tenant_id uuid,_job_id uuid,_lease_token uuid,_external_reference text,_response_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_job public.delivery_receipt_channel_jobs%rowtype;
begin
  if length(coalesce(btrim(_external_reference),'')) not between 3 and 200
    or not delivery_private.safe_delivery_receipt_provider_metadata(_response_metadata) then
    raise exception 'invalid_delivery_receipt_channel_completion' using errcode='22023';
  end if;
  select * into v_job from public.delivery_receipt_channel_jobs where id=_job_id and tenant_id=_tenant_id for update;
  if not found then raise exception 'delivery_receipt_channel_job_not_found' using errcode='P0002';end if;
  if v_job.status='succeeded' and v_job.external_reference=btrim(_external_reference) then
    return jsonb_build_object('version',1,'job_id',v_job.id,'status',v_job.status,'confirmed',true,'replayed',true);
  end if;
  if v_job.status<>'processing' or v_job.lease_token is distinct from _lease_token then
    raise exception 'delivery_receipt_channel_job_lease_invalid' using errcode='23514';
  end if;
  update public.delivery_receipt_channel_jobs set status='succeeded',lease_token=null,lease_expires_at=null,
    external_reference=btrim(_external_reference),response_metadata=_response_metadata,
    completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_job.id returning * into v_job;
  insert into public.delivery_receipt_channel_job_events(tenant_id,job_id,event_type,detail)
    values(v_job.tenant_id,v_job.id,'succeeded',jsonb_build_object('external_reference',v_job.external_reference));
  perform public._log_entity_audit(v_job.tenant_id,'delivery_receipt_channel_job',v_job.id,'succeeded',null,
    jsonb_build_object('external_reference',v_job.external_reference),'complete_delivery_receipt_channel_job_v1');
  return jsonb_build_object('version',1,'job_id',v_job.id,'status',v_job.status,'confirmed',true,'replayed',false);
end;
$function$;
revoke all on function public.complete_delivery_receipt_channel_job_v1(uuid,uuid,uuid,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.complete_delivery_receipt_channel_job_v1(uuid,uuid,uuid,text,jsonb) to service_role;

create or replace function public.fail_delivery_receipt_channel_job_v1(
  _tenant_id uuid,_job_id uuid,_lease_token uuid,_status text,_error_code text,_retry_after_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_job public.delivery_receipt_channel_jobs%rowtype;
begin
  if _status not in('failed','unavailable') or length(coalesce(btrim(_error_code),'')) not between 3 and 200
    or (_status='unavailable' and _retry_after_at is not null) then
    raise exception 'invalid_delivery_receipt_channel_failure' using errcode='22023';
  end if;
  update public.delivery_receipt_channel_jobs set status=_status,lease_token=null,lease_expires_at=null,
    retry_after_at=case when _status='failed' and _retry_after_at>clock_timestamp() then _retry_after_at else null end,
    last_error_code=btrim(_error_code),updated_at=clock_timestamp()
    where id=_job_id and tenant_id=_tenant_id and status='processing' and lease_token=_lease_token
    returning * into v_job;
  if not found then raise exception 'delivery_receipt_channel_job_lease_invalid' using errcode='23514';end if;
  insert into public.delivery_receipt_channel_job_events(tenant_id,job_id,event_type,detail)
    values(v_job.tenant_id,v_job.id,_status,jsonb_build_object('error_code',v_job.last_error_code,'retry_after_at',v_job.retry_after_at));
  perform public._log_entity_audit(v_job.tenant_id,'delivery_receipt_channel_job',v_job.id,_status,null,
    jsonb_build_object('error_code',v_job.last_error_code,'retry_after_at',v_job.retry_after_at),'fail_delivery_receipt_channel_job_v1');
  return jsonb_build_object('version',1,'job_id',v_job.id,'status',v_job.status,
    'retry_after_at',v_job.retry_after_at,'confirmed',true);
end;
$function$;
revoke all on function public.fail_delivery_receipt_channel_job_v1(uuid,uuid,uuid,text,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.fail_delivery_receipt_channel_job_v1(uuid,uuid,uuid,text,text,timestamptz) to service_role;

create or replace function public.retry_delivery_receipt_channel_job_v1(
  _tenant_id uuid,_job_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_job public.delivery_receipt_channel_jobs%rowtype;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'delivery_receipt_channel_not_authorized' using errcode='42501';end if;
  update public.delivery_receipt_channel_jobs job set status='queued',retry_after_at=null,last_error_code=null,updated_at=clock_timestamp()
  where job.id=_job_id and job.tenant_id=_tenant_id and job.status in('failed','unavailable')
    and exists(select 1 from public.delivery_receipt_supplier_channels channel
      join public.delivery_receipt_channel_adapters adapter on adapter.adapter_key=channel.adapter_key
      where channel.id=job.channel_id and channel.tenant_id=job.tenant_id and channel.lifecycle_status='verified'
        and channel.auto_enqueue and adapter.is_implemented and adapter.is_enabled)
  returning * into v_job;
  if not found then raise exception 'delivery_receipt_channel_job_not_retryable' using errcode='23514';end if;
  insert into public.delivery_receipt_channel_job_events(tenant_id,job_id,event_type,detail)
    values(v_job.tenant_id,v_job.id,'retry_queued',jsonb_build_object('actor_id',auth.uid()));
  perform public._log_entity_audit(v_job.tenant_id,'delivery_receipt_channel_job',v_job.id,'retry_queued',null,
    jsonb_build_object('actor_id',auth.uid()),'retry_delivery_receipt_channel_job_v1');
  return jsonb_build_object('version',1,'tenant_id',v_job.tenant_id,'actor_id',auth.uid(),
    'job_id',v_job.id,'status',v_job.status,'confirmed',true);
end;
$function$;
revoke all on function public.retry_delivery_receipt_channel_job_v1(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.retry_delivery_receipt_channel_job_v1(uuid,uuid) to authenticated;

create or replace function public.get_delivery_receipt_supplier_channels_v1(_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare v_channels jsonb;v_jobs jsonb;v_metrics jsonb;v_adapters jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'delivery_receipt_channel_not_authorized' using errcode='42501';end if;
  select coalesce(jsonb_agg(jsonb_build_object('adapter_key',adapter.adapter_key,'channel_kind',adapter.channel_kind,
    'display_name',adapter.display_name,'is_implemented',adapter.is_implemented,'is_enabled',adapter.is_enabled,
    'supported_capabilities',adapter.supported_capabilities) order by adapter.channel_kind,adapter.display_name),'[]'::jsonb)
    into v_adapters from public.delivery_receipt_channel_adapters adapter;
  select coalesce(jsonb_agg(to_jsonb(channel) order by channel.supplier_name,channel.id),'[]'::jsonb)
    into v_channels from public.delivery_receipt_supplier_channels channel where channel.tenant_id=_tenant_id;
  select coalesce(jsonb_agg(to_jsonb(page) order by page.created_at desc,page.id desc),'[]'::jsonb) into v_jobs from(
    select job.id,job.channel_id,job.receipt_id,job.supplier_key,job.adapter_key,job.status,job.attempt_count,
      job.retry_after_at,job.external_reference,job.last_error_code,job.created_at,job.updated_at,job.completed_at
    from public.delivery_receipt_channel_jobs job where job.tenant_id=_tenant_id
    order by job.created_at desc,job.id desc limit 100
  ) page;
  select jsonb_build_object('queued',count(*) filter(where status='queued'),'processing',count(*) filter(where status='processing'),
    'succeeded',count(*) filter(where status='succeeded'),'failed',count(*) filter(where status='failed'),
    'unavailable',count(*) filter(where status='unavailable'),'cancelled',count(*) filter(where status='cancelled'))
    into v_metrics from public.delivery_receipt_channel_jobs where tenant_id=_tenant_id;
  return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'generated_at',clock_timestamp(),
    'adapters',v_adapters,'channels',v_channels,'jobs',v_jobs,'metrics',v_metrics);
end;
$function$;
revoke all on function public.get_delivery_receipt_supplier_channels_v1(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_delivery_receipt_supplier_channels_v1(uuid) to authenticated;

comment on table public.delivery_receipt_supplier_channels is
  'Non-secret supplier portal configuration. A channel cannot auto-enqueue until a trusted service verifies an implemented adapter.';
comment on table public.delivery_receipt_channel_jobs is
  'Durable, idempotent supplier portal delivery queue. One job contains one canhoto and only that supplier documents; NF-e, NFS-e and CT-e are peers.';
comment on column public.delivery_receipt_supplier_channels.safe_configuration is
  'Contains only an HTTPS origin and references. Credentials must live in Edge Function secrets or an external vault, never in this table.';
comment on column public.delivery_receipt_email_batches.template_snapshot is
  'Immutable provenance snapshot of the supplier template used when the batch was queued; operator edits remain allowed and are marked as customized.';
