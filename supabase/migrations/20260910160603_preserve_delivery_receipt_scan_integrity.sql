alter table public.delivery_receipts
  add column if not exists thumbnail_hash text,
  add column if not exists scan_corners jsonb,
  add column if not exists scan_rotation smallint not null default 0,
  add column if not exists quality_confirmed boolean not null default false;

alter table public.delivery_receipts
  drop constraint if exists delivery_receipts_original_hash_check,
  add constraint delivery_receipts_original_hash_check
    check (original_hash is null or original_hash ~ '^[a-f0-9]{64}$'),
  drop constraint if exists delivery_receipts_processed_hash_check,
  add constraint delivery_receipts_processed_hash_check
    check (processed_hash is null or processed_hash ~ '^[a-f0-9]{64}$'),
  drop constraint if exists delivery_receipts_thumbnail_hash_check,
  add constraint delivery_receipts_thumbnail_hash_check
    check (thumbnail_hash is null or thumbnail_hash ~ '^[a-f0-9]{64}$'),
  drop constraint if exists delivery_receipts_scan_rotation_check,
  add constraint delivery_receipts_scan_rotation_check
    check (scan_rotation in (0,90,180,270)),
  drop constraint if exists delivery_receipts_scan_corners_check,
  add constraint delivery_receipts_scan_corners_check
    check (scan_corners is null or jsonb_typeof(scan_corners)='object');

create or replace function public._sync_delivery_receipt_from_proof_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_receipt_id uuid;
  v_event_id uuid;
begin
  v_receipt_id := public._sync_delivery_receipt_from_proof(new.id);
  if v_receipt_id is null or jsonb_typeof(new.metadata)<>'object' then return new;end if;
  v_event_id := case when coalesce(new.metadata->>'event_id','') ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (new.metadata->>'event_id')::uuid else null end;
  if v_event_id is null then return new;end if;

  update public.delivery_receipts set
    thumbnail_path=coalesce(thumbnail_path,nullif(new.metadata->>'receipt_thumbnail_path','')),
    original_hash=coalesce(original_hash,case when coalesce(new.metadata->>'receipt_original_hash','')~'^[a-f0-9]{64}$'
      then new.metadata->>'receipt_original_hash' end),
    processed_hash=coalesce(processed_hash,case when coalesce(new.metadata->>'receipt_processed_hash','')~'^[a-f0-9]{64}$'
      then new.metadata->>'receipt_processed_hash' end),
    thumbnail_hash=coalesce(thumbnail_hash,case when coalesce(new.metadata->>'receipt_thumbnail_hash','')~'^[a-f0-9]{64}$'
      then new.metadata->>'receipt_thumbnail_hash' end),
    scan_corners=coalesce(scan_corners,case when jsonb_typeof(new.metadata->'receipt_corners')='object'
      then new.metadata->'receipt_corners' end),
    scan_rotation=case when coalesce(new.metadata->>'receipt_rotation','')~'^(0|90|180|270)$'
      then (new.metadata->>'receipt_rotation')::smallint else scan_rotation end,
    quality_confirmed=quality_confirmed or lower(coalesce(new.metadata->>'receipt_quality_confirmed','false'))='true',
    updated_at=clock_timestamp()
  where id=v_receipt_id and tenant_id=new.tenant_id and delivery_event_id=v_event_id;
  return new;
end;
$function$;

revoke all on function public._sync_delivery_receipt_from_proof_trigger() from public,anon,authenticated;
grant execute on function public._sync_delivery_receipt_from_proof_trigger() to service_role;

comment on column public.delivery_receipts.thumbnail_hash is
  'SHA-256 of the immutable driver-generated thumbnail; original and processed hashes are stored separately.';
comment on column public.delivery_receipts.scan_corners is
  'Normalized four-corner polygon used for the perspective-corrected document scan.';
