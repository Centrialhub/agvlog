create table public.delivery_receipt_email_batches(
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  supplier_name text not null,
  receipt_ids uuid[] not null,
  recipients text[] not null,
  subject text not null,
  body_text text not null,
  status text not null default 'queued' check(status in('queued','sending','sent','delivered','bounced','failed')),
  provider_message_id text,
  provider_event_at timestamptz,
  attempt_count integer not null default 0 check(attempt_count>=0),
  lease_token uuid,
  lease_expires_at timestamptz,
  retry_after_at timestamptz,
  last_error text,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  constraint delivery_receipt_email_receipts_check check(cardinality(receipt_ids) between 1 and 5),
  constraint delivery_receipt_email_recipients_check check(cardinality(recipients) between 1 and 10),
  constraint delivery_receipt_email_provider_unique unique(provider_message_id),
  constraint delivery_receipt_email_lease_check check(
    (lease_token is null and lease_expires_at is null) or (lease_token is not null and lease_expires_at is not null)
  )
);

create table public.delivery_receipt_email_items(
  batch_id uuid not null references public.delivery_receipt_email_batches(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  receipt_id uuid not null references public.delivery_receipts(id) on delete restrict,
  pdf_path text not null,
  file_name text not null,
  document_snapshot jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  primary key(batch_id,receipt_id),
  constraint delivery_receipt_email_item_path_check check(position('..' in pdf_path)=0 and position(E'\\' in pdf_path)=0)
);

create table public.delivery_receipt_email_webhook_events(
  svix_id text primary key check(length(svix_id) between 5 and 200),
  batch_id uuid not null references public.delivery_receipt_email_batches(id) on delete restrict,
  provider_message_id text not null,
  event_status text not null check(event_status in('delivered','bounced','failed')),
  occurred_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp()
);

create index delivery_receipt_email_batches_operation_idx on public.delivery_receipt_email_batches(tenant_id,status,created_at desc);
create index delivery_receipt_email_items_receipt_idx on public.delivery_receipt_email_items(tenant_id,receipt_id,batch_id);
create index delivery_receipt_email_webhook_batch_idx on public.delivery_receipt_email_webhook_events(batch_id,occurred_at desc);

alter table public.delivery_receipt_email_batches enable row level security;
alter table public.delivery_receipt_email_items enable row level security;
alter table public.delivery_receipt_email_webhook_events enable row level security;
revoke all on table public.delivery_receipt_email_batches,public.delivery_receipt_email_items,
  public.delivery_receipt_email_webhook_events from public,anon,authenticated,service_role;
grant select on table public.delivery_receipt_email_batches,public.delivery_receipt_email_items to authenticated;
grant all on table public.delivery_receipt_email_batches,public.delivery_receipt_email_items,
  public.delivery_receipt_email_webhook_events to service_role;
create policy delivery_receipt_email_batches_operator_read on public.delivery_receipt_email_batches for select to authenticated
  using(coalesce(public.is_tenant_operator_or_admin(tenant_id),false));
create policy delivery_receipt_email_items_operator_read on public.delivery_receipt_email_items for select to authenticated
  using(coalesce(public.is_tenant_operator_or_admin(tenant_id),false));

create or replace function public._refresh_delivery_receipt_email_status(_receipt_id uuid)
returns void language plpgsql security definer set search_path=''
as $function$
declare v_status text;
begin
  select case
    when bool_or(batch.status='delivered') then 'delivered'
    when bool_or(batch.status='bounced') then 'bounced'
    when bool_or(batch.status='sent') then 'sent'
    when bool_or(batch.status in('queued','sending')) then 'queued'
    when bool_or(batch.status='failed') then 'failed'
    else 'not_sent'
  end into v_status
  from public.delivery_receipt_email_items item
  join public.delivery_receipt_email_batches batch on batch.id=item.batch_id and batch.tenant_id=item.tenant_id
  where item.receipt_id=_receipt_id;
  update public.delivery_receipts set email_status=coalesce(v_status,'not_sent'),updated_at=clock_timestamp()
    where id=_receipt_id;
end;$function$;
revoke all on function public._refresh_delivery_receipt_email_status(uuid) from public,anon,authenticated,service_role;

create or replace function public.queue_delivery_receipt_email_v1(
  _tenant_id uuid,_request_id uuid,_supplier_name text,_receipt_ids uuid[],_recipients text[],_subject text,_body_text text
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_batch public.delivery_receipt_email_batches%rowtype;
  v_receipt record;
  v_count integer;
  v_receipt_ids uuid[];
  v_recipients text[];
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'delivery_receipt_email_not_authorized' using errcode='42501';
  end if;
  v_receipt_ids:=array(select value from unnest(_receipt_ids) value order by value);
  v_recipients:=array(select lower(btrim(value)) from unnest(_recipients) value order by 1);
  if _request_id is null or length(coalesce(btrim(_supplier_name),'')) not between 2 and 200
    or coalesce(cardinality(_receipt_ids),0) not between 1 and 5
    or cardinality(_receipt_ids)<>(select count(distinct value) from unnest(_receipt_ids) value)
    or coalesce(cardinality(_recipients),0) not between 1 and 10
    or cardinality(_recipients)<>(select count(distinct lower(btrim(value))) from unnest(_recipients) value)
    or exists(select 1 from unnest(_recipients) value where btrim(value)!~*'^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9.-]+[.][A-Z]{2,63}$')
    or length(coalesce(btrim(_subject),'')) not between 3 and 200
    or length(coalesce(btrim(_body_text),'')) not between 3 and 5000 then
    raise exception 'invalid_delivery_receipt_email' using errcode='22023';
  end if;

  select count(*) into v_count from public.delivery_receipts receipt
    where receipt.tenant_id=_tenant_id and receipt.id=any(v_receipt_ids) and receipt.is_active
      and receipt.digital_status='validated' and receipt.pdf_path is not null
      and exists(select 1 from public.delivery_receipt_documents link
        join public.delivery_document_references reference on reference.id=link.document_reference_id
        where link.receipt_id=receipt.id and link.tenant_id=receipt.tenant_id
          and lower(btrim(reference.issuer_name))=lower(btrim(_supplier_name)));
  if v_count<>cardinality(v_receipt_ids) then
    raise exception 'delivery_receipt_email_not_ready' using errcode='23514';
  end if;

  insert into public.delivery_receipt_email_batches(
    id,tenant_id,supplier_name,receipt_ids,recipients,subject,body_text,created_by
  ) values(
    _request_id,_tenant_id,btrim(_supplier_name),v_receipt_ids,v_recipients,btrim(_subject),btrim(_body_text),auth.uid()
  ) on conflict(id) do nothing;
  select * into v_batch from public.delivery_receipt_email_batches where id=_request_id for update;
  if v_batch.tenant_id<>_tenant_id or v_batch.created_by<>auth.uid() or v_batch.supplier_name<>btrim(_supplier_name)
    or v_batch.receipt_ids<>v_receipt_ids or v_batch.recipients<>v_recipients
    or v_batch.subject<>btrim(_subject) or v_batch.body_text<>btrim(_body_text) then
    raise exception 'delivery_receipt_email_request_conflict' using errcode='23514';
  end if;
  if not exists(select 1 from public.delivery_receipt_email_items where batch_id=v_batch.id) then
    for v_receipt in select receipt.* from public.delivery_receipts receipt
      where receipt.tenant_id=_tenant_id and receipt.id=any(v_batch.receipt_ids) order by receipt.id loop
      insert into public.delivery_receipt_email_items(batch_id,tenant_id,receipt_id,pdf_path,file_name,document_snapshot)
      values(v_batch.id,_tenant_id,v_receipt.id,v_receipt.pdf_path,
        'CANHOTO_'||regexp_replace(upper(left(btrim(_supplier_name),40)),'[^A-Z0-9]+','-','g')||'_'||to_char(v_receipt.delivered_at,'YYYY-MM-DD')||'_'||left(v_receipt.dispatch_trip_id::text,8)||'_'||left(v_receipt.dispatch_stop_id::text,8)||'.pdf',
        coalesce((select jsonb_agg(jsonb_build_object('kind',reference.document_kind,'number',reference.document_number,
          'series',reference.document_series,'issuer_name',reference.issuer_name) order by reference.document_kind,reference.document_number)
          from public.delivery_receipt_documents link join public.delivery_document_references reference on reference.id=link.document_reference_id
          where link.receipt_id=v_receipt.id and link.tenant_id=v_receipt.tenant_id),'[]'::jsonb));
      perform public._refresh_delivery_receipt_email_status(v_receipt.id);
    end loop;
    perform public._log_entity_audit(_tenant_id,'delivery_receipt_email',v_batch.id,'queued',null,
      jsonb_build_object('supplier_name',v_batch.supplier_name,'receipt_ids',to_jsonb(v_batch.receipt_ids),'recipients',to_jsonb(v_batch.recipients)),
      'queue_delivery_receipt_email_v1');
  end if;
  return jsonb_build_object('version',1,'batch_id',v_batch.id,'status',v_batch.status,
    'receipt_count',cardinality(v_batch.receipt_ids),'confirmed',true);
end;$function$;
revoke all on function public.queue_delivery_receipt_email_v1(uuid,uuid,text,uuid[],text[],text,text) from public,anon,authenticated,service_role;
grant execute on function public.queue_delivery_receipt_email_v1(uuid,uuid,text,uuid[],text[],text,text) to authenticated;

create or replace function public.claim_delivery_receipt_email_v1(_tenant_id uuid,_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_batch public.delivery_receipt_email_batches%rowtype;
  v_items jsonb:='[]'::jsonb;
  v_lease_token uuid;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'delivery_receipt_email_not_authorized' using errcode='42501';
  end if;
  select * into v_batch from public.delivery_receipt_email_batches where id=_batch_id and tenant_id=_tenant_id for update;
  if not found or v_batch.created_by<>auth.uid() then
    raise exception 'delivery_receipt_email_not_found' using errcode='P0002';
  end if;
  if v_batch.status in('sent','delivered','bounced') and v_batch.provider_message_id is not null then
    return jsonb_build_object('version',1,'tenant_id',v_batch.tenant_id,'actor_id',auth.uid(),'batch_id',v_batch.id,
      'status',v_batch.status,'provider_message_id',v_batch.provider_message_id,'lease_token',null,
      'retry_after_at',null,'items','[]'::jsonb);
  end if;
  if v_batch.status='sending' and v_batch.lease_expires_at>clock_timestamp() then
    return jsonb_build_object('version',1,'tenant_id',v_batch.tenant_id,'actor_id',auth.uid(),'batch_id',v_batch.id,
      'status','busy','provider_message_id',v_batch.provider_message_id,'lease_token',null,
      'retry_after_at',v_batch.lease_expires_at,'items','[]'::jsonb);
  end if;
  if v_batch.retry_after_at>clock_timestamp() then
    return jsonb_build_object('version',1,'tenant_id',v_batch.tenant_id,'actor_id',auth.uid(),'batch_id',v_batch.id,
      'status','rate_limited','provider_message_id',v_batch.provider_message_id,'lease_token',null,
      'retry_after_at',v_batch.retry_after_at,'items','[]'::jsonb);
  end if;
  v_lease_token:=gen_random_uuid();
  update public.delivery_receipt_email_batches set status='sending',attempt_count=attempt_count+1,
    lease_token=v_lease_token,lease_expires_at=clock_timestamp()+interval '10 minutes',retry_after_at=null,
    last_error=null,updated_at=clock_timestamp() where id=v_batch.id returning * into v_batch;
  perform public._log_entity_audit(_tenant_id,'delivery_receipt_email',v_batch.id,'send_attempt',null,
    jsonb_build_object('attempt_count',v_batch.attempt_count,'lease_expires_at',v_batch.lease_expires_at),
    'claim_delivery_receipt_email_v1');
  select jsonb_agg(jsonb_build_object('receipt_id',item.receipt_id,'path',item.pdf_path,'file_name',item.file_name,
    'documents',item.document_snapshot) order by item.file_name,item.receipt_id) into v_items
    from public.delivery_receipt_email_items item where item.batch_id=v_batch.id and item.tenant_id=v_batch.tenant_id;
  return jsonb_build_object('version',1,'tenant_id',v_batch.tenant_id,'actor_id',auth.uid(),'batch_id',v_batch.id,
    'supplier_name',v_batch.supplier_name,'recipients',to_jsonb(v_batch.recipients),'subject',v_batch.subject,'body_text',v_batch.body_text,
    'status',v_batch.status,'provider_message_id',v_batch.provider_message_id,'lease_token',v_batch.lease_token,
    'retry_after_at',v_batch.retry_after_at,'items',coalesce(v_items,'[]'::jsonb));
end;$function$;
revoke all on function public.claim_delivery_receipt_email_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_delivery_receipt_email_v1(uuid,uuid) to authenticated;

create or replace function public.complete_delivery_receipt_email_v1(
  _tenant_id uuid,_batch_id uuid,_lease_token uuid,_provider_message_id text
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_batch public.delivery_receipt_email_batches%rowtype;v_receipt_id uuid;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'delivery_receipt_email_not_authorized' using errcode='42501';
  end if;
  select * into v_batch from public.delivery_receipt_email_batches where id=_batch_id and tenant_id=_tenant_id for update;
  if not found or v_batch.created_by<>auth.uid() or length(coalesce(_provider_message_id,'')) not between 5 and 200 then
    raise exception 'delivery_receipt_email_completion_invalid' using errcode='23514';
  end if;
  if v_batch.status in('sent','delivered','bounced') and v_batch.provider_message_id=_provider_message_id then
    return jsonb_build_object('version',1,'batch_id',v_batch.id,'status',v_batch.status,
      'provider_message_id',v_batch.provider_message_id,'confirmed',true,'replayed',true);
  end if;
  if v_batch.status<>'sending' or v_batch.lease_token is distinct from _lease_token then
    raise exception 'delivery_receipt_email_lease_invalid' using errcode='23514';
  end if;
  update public.delivery_receipt_email_batches set status='sent',provider_message_id=_provider_message_id,
    lease_token=null,lease_expires_at=null,retry_after_at=null,sent_at=coalesce(sent_at,clock_timestamp()),updated_at=clock_timestamp()
    where id=v_batch.id returning * into v_batch;
  for v_receipt_id in select receipt_id from public.delivery_receipt_email_items where batch_id=v_batch.id loop
    perform public._refresh_delivery_receipt_email_status(v_receipt_id);
  end loop;
  perform public._log_entity_audit(_tenant_id,'delivery_receipt_email',v_batch.id,'sent',null,
    jsonb_build_object('provider_message_id',_provider_message_id),'complete_delivery_receipt_email_v1');
  return jsonb_build_object('version',1,'batch_id',v_batch.id,'status',v_batch.status,
    'provider_message_id',v_batch.provider_message_id,'confirmed',true,'replayed',false);
end;$function$;
revoke all on function public.complete_delivery_receipt_email_v1(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.complete_delivery_receipt_email_v1(uuid,uuid,uuid,text) to authenticated;

create or replace function public.fail_delivery_receipt_email_v1(
  _tenant_id uuid,_batch_id uuid,_lease_token uuid,_error_code text,_retry_after_at timestamptz
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_batch public.delivery_receipt_email_batches%rowtype;v_receipt_id uuid;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'delivery_receipt_email_not_authorized' using errcode='42501';
  end if;
  update public.delivery_receipt_email_batches set status='failed',lease_token=null,lease_expires_at=null,
    retry_after_at=case when _retry_after_at>clock_timestamp() then _retry_after_at else null end,
    last_error=left(coalesce(_error_code,'provider_failure'),200),updated_at=clock_timestamp()
    where id=_batch_id and tenant_id=_tenant_id and created_by=auth.uid() and status='sending' and lease_token=_lease_token
    returning * into v_batch;
  if not found then
    raise exception 'delivery_receipt_email_failure_invalid' using errcode='23514';
  end if;
  for v_receipt_id in select receipt_id from public.delivery_receipt_email_items where batch_id=v_batch.id loop
    perform public._refresh_delivery_receipt_email_status(v_receipt_id);
  end loop;
  perform public._log_entity_audit(_tenant_id,'delivery_receipt_email',v_batch.id,'send_failed',null,
    jsonb_build_object('error_code',v_batch.last_error,'retry_after_at',v_batch.retry_after_at),
    'fail_delivery_receipt_email_v1');
  return jsonb_build_object('version',1,'batch_id',v_batch.id,'status',v_batch.status,
    'retry_after_at',v_batch.retry_after_at,'confirmed',true);
end;$function$;
revoke all on function public.fail_delivery_receipt_email_v1(uuid,uuid,uuid,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.fail_delivery_receipt_email_v1(uuid,uuid,uuid,text,timestamptz) to authenticated;

create or replace function public.apply_delivery_receipt_email_webhook_v1(
  _svix_id text,_provider_message_id text,_status text,_occurred_at timestamptz
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_batch public.delivery_receipt_email_batches%rowtype;
  v_receipt_id uuid;
  v_inserted integer;
  v_should_apply boolean;
begin
  if length(coalesce(_svix_id,'')) not between 5 and 200
    or length(coalesce(_provider_message_id,'')) not between 5 and 200
    or _status not in('delivered','bounced','failed') or _occurred_at is null then
    raise exception 'invalid_delivery_receipt_email_webhook' using errcode='22023';
  end if;
  select * into v_batch from public.delivery_receipt_email_batches
    where provider_message_id=_provider_message_id for update;
  if not found then return jsonb_build_object('version',1,'matched',false,'duplicate',false);end if;

  insert into public.delivery_receipt_email_webhook_events(svix_id,batch_id,provider_message_id,event_status,occurred_at)
    values(_svix_id,v_batch.id,_provider_message_id,_status,_occurred_at) on conflict(svix_id) do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=0 then
    return jsonb_build_object('version',1,'matched',true,'duplicate',true,'batch_id',v_batch.id,'status',v_batch.status);
  end if;

  v_should_apply:=v_batch.provider_event_at is null or _occurred_at>v_batch.provider_event_at
    or (_occurred_at=v_batch.provider_event_at and case _status when 'bounced' then 3 when 'failed' then 2 else 1 end>
      case v_batch.status when 'bounced' then 3 when 'failed' then 2 when 'delivered' then 1 else 0 end);
  if v_batch.status='bounced' or (v_batch.status='delivered' and _status='failed') then v_should_apply:=false;end if;
  if not v_should_apply then
    return jsonb_build_object('version',1,'matched',true,'duplicate',false,'ignored',true,
      'batch_id',v_batch.id,'status',v_batch.status);
  end if;

  update public.delivery_receipt_email_batches set status=_status,provider_event_at=_occurred_at,
    delivered_at=case when _status='delivered' then coalesce(delivered_at,_occurred_at) else delivered_at end,
    bounced_at=case when _status='bounced' then coalesce(bounced_at,_occurred_at) else bounced_at end,
    updated_at=clock_timestamp() where id=v_batch.id returning * into v_batch;
  for v_receipt_id in select receipt_id from public.delivery_receipt_email_items where batch_id=v_batch.id loop
    perform public._refresh_delivery_receipt_email_status(v_receipt_id);
  end loop;
  perform public._log_entity_audit(v_batch.tenant_id,'delivery_receipt_email',v_batch.id,'provider_'||_status,null,
    jsonb_build_object('svix_id',_svix_id,'provider_message_id',_provider_message_id,'occurred_at',_occurred_at),
    'apply_delivery_receipt_email_webhook_v1');
  return jsonb_build_object('version',1,'matched',true,'duplicate',false,'ignored',false,
    'batch_id',v_batch.id,'status',v_batch.status);
end;$function$;
revoke all on function public.apply_delivery_receipt_email_webhook_v1(text,text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.apply_delivery_receipt_email_webhook_v1(text,text,text,timestamptz) to service_role;

comment on table public.delivery_receipt_email_batches is 'Idempotent supplier-grouped email queue for up to five one-PDF-per-delivery canhotos.';
comment on table public.delivery_receipt_email_webhook_events is 'Durable svix-id deduplication for Resend delivery receipt events.';
