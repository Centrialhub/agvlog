-- Storage object deletion is permanent. RLS alone is insufficient because the
-- Storage gateway uses service_role and therefore bypasses RLS. Keep the
-- business reference check in a private schema and enforce it with a trigger
-- on storage.objects; the authenticated cleanup RPC is an additional explicit
-- actor/tenant authorization boundary, not the final integrity boundary.

do $preflight$
declare v_missing text;
begin
  select string_agg(required.object_name, ', ' order by required.object_name)
    into v_missing
  from (values
    ('public.tenant_memberships'),('public.drivers'),('public.dispatch_trips'),
    ('public.dispatch_stops'),('public.proof_of_delivery'),('public.dispatch_events'),
    ('public.operational_events'),('public.driver_expenses'),
    ('public.driver_settlement_payments'),('public.payables'),
    ('public.occurrence_return_sheets'),('public.pallet_return_protocols'),
    ('storage.objects')
  ) required(object_name)
  where to_regclass(required.object_name) is null;
  if v_missing is not null then
    raise exception 'storage evidence retention requires: %',v_missing;
  end if;
end;
$preflight$;

create schema if not exists storage_evidence_private;
revoke all on schema storage_evidence_private from public,anon,authenticated,service_role;

-- Scalar references are the common path and must not make a Storage DELETE
-- scan whole business tables. JSON attachment arrays remain a conservative
-- fallback for legacy events and usually have a matching scalar POD reference.
create index if not exists proof_of_delivery_storage_object_idx
  on public.proof_of_delivery(storage_bucket,storage_path) where storage_path is not null;
create index if not exists driver_expenses_receipt_object_idx
  on public.driver_expenses(receipt_url) where receipt_url is not null;
create index if not exists driver_settlement_payments_receipt_object_idx
  on public.driver_settlement_payments(receipt_url) where receipt_url is not null;
create index if not exists payables_receipt_object_idx
  on public.payables(receipt_url) where receipt_url is not null;
create index if not exists occurrence_return_sheets_proof_object_idx
  on public.occurrence_return_sheets(signed_proof_url) where signed_proof_url is not null;
create index if not exists pallet_return_protocols_proof_object_idx
  on public.pallet_return_protocols(signed_proof_url) where signed_proof_url is not null;

create or replace function storage_evidence_private.array_contains_path(_value jsonb,_path text)
returns boolean language sql immutable security invoker set search_path=''
as $fn$
  select case when jsonb_typeof(_value)='array' then exists(
    select 1 from jsonb_array_elements_text(_value) item(value) where item.value=_path
  ) else false end;
$fn$;
revoke all on function storage_evidence_private.array_contains_path(jsonb,text)
  from public,anon,authenticated,service_role;

create or replace function storage_evidence_private.is_retained(
  _bucket text,_path text,_tenant_id uuid default null
)
returns boolean language plpgsql stable security definer set search_path=''
as $fn$
begin
  if _bucket='receipts' then
    return
      exists(select 1 from public.proof_of_delivery p
        where (_tenant_id is null or p.tenant_id=_tenant_id)
          and coalesce(nullif(p.storage_bucket,''),'receipts')='receipts'
          and (p.storage_path=_path or p.photo_url=_path or p.signature_url=_path
            or p.metadata->>'signature_path'=_path
            or storage_evidence_private.array_contains_path(p.metadata->'photo_paths',_path)))
      or exists(select 1 from public.dispatch_events e
        where (_tenant_id is null or e.tenant_id=_tenant_id) and (
          e.payload->>'signature_path'=_path
          or storage_evidence_private.array_contains_path(e.payload->'photo_paths',_path)
          or e.payload#>>'{details,signature_path}'=_path
          or storage_evidence_private.array_contains_path(e.payload#>'{details,photo_paths}',_path)
          or e.payload#>>'{delivery_request,details,signature_path}'=_path
          or storage_evidence_private.array_contains_path(e.payload#>'{delivery_request,details,photo_paths}',_path)))
      or exists(select 1 from public.operational_events e
        where (_tenant_id is null or e.tenant_id=_tenant_id) and (
          e.report_details->>'signature_path'=_path
          or storage_evidence_private.array_contains_path(e.report_details->'photo_paths',_path)
          or e.payload->>'signature_path'=_path
          or storage_evidence_private.array_contains_path(e.payload->'photo_paths',_path)))
      or exists(select 1 from public.driver_expenses e
        where (_tenant_id is null or e.tenant_id=_tenant_id) and e.receipt_url=_path)
      or exists(select 1 from public.driver_settlement_payments p
        where (_tenant_id is null or p.tenant_id=_tenant_id) and p.receipt_url=_path)
      or exists(select 1 from public.payables p
        where (_tenant_id is null or p.tenant_id=_tenant_id) and p.receipt_url=_path);
  elsif _bucket='occurrence-return-proofs' then
    return exists(select 1 from public.occurrence_return_sheets s
      where (_tenant_id is null or s.tenant_id=_tenant_id) and s.signed_proof_url=_path);
  elsif _bucket='pallet-return-proofs' then
    return exists(select 1 from public.pallet_return_protocols p
      where (_tenant_id is null or p.tenant_id=_tenant_id) and p.signed_proof_url=_path);
  end if;
  return false;
end;
$fn$;
revoke all on function storage_evidence_private.is_retained(text,text,uuid)
  from public,anon,authenticated,service_role;

create or replace function storage_evidence_private.block_retained_delete()
returns trigger language plpgsql security definer set search_path=''
as $fn$
begin
  if old.bucket_id in('receipts','occurrence-return-proofs','pallet-return-proofs')
    and storage_evidence_private.is_retained(old.bucket_id,old.name,null) then
    raise exception 'storage_evidence_retention_required' using errcode='23514';
  end if;
  return old;
end;
$fn$;
revoke all on function storage_evidence_private.block_retained_delete()
  from public,anon,authenticated,service_role;

drop trigger if exists block_retained_storage_evidence_delete on storage.objects;
create trigger block_retained_storage_evidence_delete
before delete on storage.objects for each row
execute function storage_evidence_private.block_retained_delete();

-- This is the only browser-callable cleanup authorization surface. It returns
-- no evidence data and cannot delete anything. The Edge Function must compare
-- the complete receipt before using its service credential with Storage.
create or replace function public.authorize_secure_upload_cleanup_v1(
  _tenant_id uuid,_bucket text,_paths text[]
)
returns jsonb language plpgsql stable security definer set search_path=''
as $fn$
declare
  v_actor uuid:=auth.uid();v_role text;v_path text;v_trip uuid;v_stop uuid;
begin
  if v_actor is null or _tenant_id is null or _bucket not in('receipts','occurrence-return-proofs','pallet-return-proofs')
    or coalesce(cardinality(_paths),0) not between 1 and 10
    or cardinality(_paths)<>(select count(distinct p) from unnest(_paths) p) then
    raise exception 'secure_cleanup_not_authorized' using errcode='42501';
  end if;
  select m.role::text into v_role from public.tenant_memberships m
    where m.tenant_id=_tenant_id and m.user_id=v_actor and m.active;
  if v_role is null
    or (_bucket='receipts' and v_role not in('owner','admin','operator','driver'))
    or (_bucket<>'receipts' and v_role not in('owner','admin','operator')) then
    raise exception 'secure_cleanup_not_authorized' using errcode='42501';
  end if;
  foreach v_path in array _paths loop
    if v_path is null or length(v_path)>500 or position(E'\\' in v_path)>0 or position('%' in v_path)>0
      or position('..' in v_path)>0 or split_part(v_path,'/',1)<>_tenant_id::text
      or exists(select 1 from unnest(string_to_array(v_path,'/')) segment where segment in('','.'))
      or (_bucket='receipts' and split_part(v_path,'/',2)='expense-receipts') then
      raise exception 'secure_cleanup_not_authorized' using errcode='42501';
    end if;
    if v_role='driver' then
      if split_part(v_path,'/',2)<>'deliveries'
        or split_part(v_path,'/',3)!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or split_part(v_path,'/',4)!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'secure_cleanup_not_authorized' using errcode='42501';
      end if;
      v_trip:=split_part(v_path,'/',3)::uuid;v_stop:=split_part(v_path,'/',4)::uuid;
      if not exists(select 1 from public.dispatch_trips t
        join public.drivers d on d.id=t.driver_id and d.tenant_id=t.tenant_id and d.active
        join public.dispatch_stops s on s.dispatch_trip_id=t.id and s.tenant_id=t.tenant_id
        where t.id=v_trip and s.id=v_stop and t.tenant_id=_tenant_id and d.user_id=v_actor) then
        raise exception 'secure_cleanup_not_authorized' using errcode='42501';
      end if;
    end if;
    if storage_evidence_private.is_retained(_bucket,v_path,_tenant_id) then
      raise exception 'storage_evidence_retention_required' using errcode='23514';
    end if;
  end loop;
  return jsonb_build_object('version',1,'authorized',true,'tenant_id',_tenant_id,
    'actor_id',v_actor,'bucket',_bucket,'paths',to_jsonb(_paths));
end;
$fn$;
revoke all on function public.authorize_secure_upload_cleanup_v1(uuid,text,text[])
  from public,anon,authenticated,service_role;
grant execute on function public.authorize_secure_upload_cleanup_v1(uuid,text,text[])
  to authenticated;
comment on function public.authorize_secure_upload_cleanup_v1(uuid,text,text[]) is
  'Authorizes tenant-scoped orphan cleanup. Storage deletion remains guarded by immutable evidence trigger.';

-- All receipt deletion now passes through secure-upload. The trigger still
-- protects linked evidence from service-role calls and future policies.
drop policy if exists receipts_tenant_delete on storage.objects;
