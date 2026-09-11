-- Audited, tenant-scoped PDF exports for canonical delivery receipts.
-- Storage remains private; the browser receives a path only after an operator
-- authorization check and downloads it with its authenticated Storage session.

create table public.delivery_receipt_exports (
  request_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  receipt_id uuid not null references public.delivery_receipts(id) on delete restrict,
  requested_by uuid not null,
  export_kind text not null check (export_kind = 'pdf'),
  file_name text not null,
  status text not null default 'requested' check (status in ('requested','completed','failed')),
  storage_path text,
  error_code text,
  requested_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  constraint delivery_receipt_export_path_check check (
    storage_path is null or (position('..' in storage_path)=0 and position(E'\\' in storage_path)=0)
  )
);

create index delivery_receipt_exports_operation_idx
  on public.delivery_receipt_exports(tenant_id,receipt_id,requested_at desc);

alter table public.delivery_receipt_exports enable row level security;
revoke all on table public.delivery_receipt_exports from public,anon,authenticated,service_role;
grant select on table public.delivery_receipt_exports to authenticated;
grant all on table public.delivery_receipt_exports to service_role;

create policy delivery_receipt_exports_operator_read
  on public.delivery_receipt_exports for select to authenticated
  using(coalesce(public.is_tenant_operator_or_admin(tenant_id),false));

create or replace function public.prepare_delivery_receipt_pdf_v1(
  _tenant_id uuid,_receipt_id uuid,_request_id uuid,_file_name text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare v_receipt public.delivery_receipts%rowtype;v_export public.delivery_receipt_exports%rowtype;
  v_path text;v_source text;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'delivery_receipt_export_not_authorized' using errcode='42501';
  end if;
  if _request_id is null or _file_name is null or length(_file_name) not between 5 and 180
    or _file_name !~ '^[A-Za-z0-9._-]+[.]pdf$' or position('..' in _file_name)>0 then
    raise exception 'invalid_delivery_receipt_export' using errcode='22023';
  end if;
  select * into v_receipt from public.delivery_receipts
    where tenant_id=_tenant_id and id=_receipt_id and is_active;
  if not found then raise exception 'delivery_receipt_not_found' using errcode='P0002';end if;
  v_path:=coalesce(v_receipt.pdf_path,v_receipt.processed_path);
  v_source:=case when v_receipt.pdf_path is not null then 'pdf' else 'processed_image' end;
  if v_path is null then raise exception 'delivery_receipt_processed_scan_missing' using errcode='23514';end if;

  insert into public.delivery_receipt_exports(request_id,tenant_id,receipt_id,requested_by,export_kind,file_name)
  values(_request_id,_tenant_id,_receipt_id,auth.uid(),'pdf',_file_name)
  on conflict(request_id) do nothing;
  select * into v_export from public.delivery_receipt_exports where request_id=_request_id;
  if v_export.tenant_id<>_tenant_id or v_export.receipt_id<>_receipt_id
    or v_export.requested_by<>auth.uid() or v_export.file_name<>_file_name then
    raise exception 'delivery_receipt_export_request_conflict' using errcode='23514';
  end if;
  return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),
    'request_id',_request_id,'receipt_id',_receipt_id,'bucket',v_receipt.storage_bucket,
    'source_kind',v_source,'path',v_path,'file_name',_file_name,'receipt_updated_at',v_receipt.updated_at);
end;
$function$;

revoke all on function public.prepare_delivery_receipt_pdf_v1(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.prepare_delivery_receipt_pdf_v1(uuid,uuid,uuid,text)
  to authenticated;

create or replace function public.attach_delivery_receipt_pdf_v1(
  _tenant_id uuid,_receipt_id uuid,_request_id uuid,_path text,_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare v_receipt public.delivery_receipts%rowtype;v_object record;v_before jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'delivery_receipt_export_not_authorized' using errcode='42501';
  end if;
  if _path is null or length(_path)>500 or position('..' in _path)>0 or position(E'\\' in _path)>0
    or _path not like _tenant_id::text||'/delivery-pdfs/'||_receipt_id::text||'/%' then
    raise exception 'invalid_delivery_receipt_pdf_path' using errcode='22023';
  end if;
  select * into v_receipt from public.delivery_receipts
    where tenant_id=_tenant_id and id=_receipt_id and is_active for update;
  if not found then raise exception 'delivery_receipt_not_found' using errcode='P0002';end if;
  if v_receipt.updated_at is distinct from _expected_updated_at then
    raise exception 'delivery_receipt_changed' using errcode='40001';
  end if;
  if not exists(select 1 from public.delivery_receipt_exports e where e.request_id=_request_id
      and e.tenant_id=_tenant_id and e.receipt_id=_receipt_id and e.requested_by=auth.uid()) then
    raise exception 'delivery_receipt_export_request_missing' using errcode='P0002';
  end if;
  select o.* into v_object from storage.objects o
    where o.bucket_id='receipts' and o.name=_path for share;
  if not found or coalesce(v_object.metadata->>'mimetype','')<>'application/pdf' then
    raise exception 'delivery_receipt_pdf_not_found' using errcode='23514';
  end if;
  v_before:=to_jsonb(v_receipt);
  update public.delivery_receipts set pdf_path=_path,updated_at=clock_timestamp()
    where id=v_receipt.id returning * into v_receipt;
  update public.delivery_receipt_exports set storage_path=_path where request_id=_request_id;
  perform public._log_entity_audit(_tenant_id,'delivery_receipt',v_receipt.id,
    'pdf_generated',v_before,to_jsonb(v_receipt),'attach_delivery_receipt_pdf_v1');
  return jsonb_build_object('version',1,'receipt_id',v_receipt.id,'path',v_receipt.pdf_path,
    'updated_at',v_receipt.updated_at,'confirmed',true);
end;
$function$;

revoke all on function public.attach_delivery_receipt_pdf_v1(uuid,uuid,uuid,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.attach_delivery_receipt_pdf_v1(uuid,uuid,uuid,text,timestamptz)
  to authenticated;

create or replace function public.complete_delivery_receipt_pdf_download_v1(
  _tenant_id uuid,_receipt_id uuid,_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare v_export public.delivery_receipt_exports%rowtype;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'delivery_receipt_export_not_authorized' using errcode='42501';
  end if;
  select * into v_export from public.delivery_receipt_exports
    where request_id=_request_id and tenant_id=_tenant_id and receipt_id=_receipt_id
      and requested_by=auth.uid() for update;
  if not found then raise exception 'delivery_receipt_export_request_missing' using errcode='P0002';end if;
  if v_export.status<>'completed' then
    update public.delivery_receipt_exports set status='completed',completed_at=clock_timestamp()
      where request_id=_request_id returning * into v_export;
    perform public._log_entity_audit(_tenant_id,'delivery_receipt',_receipt_id,
      'pdf_downloaded',null,jsonb_build_object('request_id',_request_id,'file_name',v_export.file_name),
      'complete_delivery_receipt_pdf_download_v1');
  end if;
  return jsonb_build_object('version',1,'request_id',_request_id,'receipt_id',_receipt_id,
    'status',v_export.status,'completed_at',v_export.completed_at,'confirmed',true);
end;
$function$;

revoke all on function public.complete_delivery_receipt_pdf_download_v1(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.complete_delivery_receipt_pdf_download_v1(uuid,uuid,uuid)
  to authenticated;

comment on table public.delivery_receipt_exports is
  'Idempotent audit receipts for operator PDF downloads; the canhoto remains owned by its delivery event, independently of document type.';
