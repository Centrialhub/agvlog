-- Canonical paper delivery receipts ("canhotos").
-- A receipt belongs to one delivery event. Fiscal and operational documents are
-- references attached to that delivery; CT-e is optional and never the owner.

create table public.delivery_document_references (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_kind text not null check (document_kind in (
    'nfe', 'nfse', 'cte', 'other_fiscal', 'operational_reference'
  )),
  fiscal_document_id uuid references public.fiscal_documents(id) on delete restrict,
  nfse_document_id uuid references public.nfse_documents(id) on delete restrict,
  cte_document_id uuid references public.cte_documents(id) on delete restrict,
  operational_reference text,
  document_number text,
  document_series text,
  access_key text,
  issue_date date,
  issuer_name text,
  issuer_tax_id text,
  recipient_name text,
  supplier_id uuid references public.clients(id) on delete set null,
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint delivery_document_reference_source_check check (
    num_nonnulls(fiscal_document_id, nfse_document_id, cte_document_id, operational_reference) = 1
  ),
  constraint delivery_document_reference_operational_check check (
    (document_kind = 'operational_reference') = (operational_reference is not null)
  ),
  unique (tenant_id, fiscal_document_id),
  unique (tenant_id, nfse_document_id),
  unique (tenant_id, cte_document_id),
  unique (tenant_id, operational_reference)
);

alter table public.delivery_document_references
  add constraint delivery_document_references_tenant_id_unique unique (tenant_id, id);

create table public.delivery_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  delivery_event_id uuid not null references public.dispatch_events(id) on delete restrict,
  dispatch_trip_id uuid not null references public.dispatch_trips(id) on delete restrict,
  dispatch_stop_id uuid not null references public.dispatch_stops(id) on delete restrict,
  driver_id uuid references public.drivers(id) on delete restrict,
  vehicle_id uuid references public.vehicles(id) on delete restrict,
  previous_receipt_id uuid references public.delivery_receipts(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  is_active boolean not null default true,
  digital_status text not null default 'pending_upload' check (digital_status in (
    'pending_upload', 'uploaded', 'pending_validation', 'validated', 'rejected', 'superseded'
  )),
  physical_status text not null default 'pending_return' check (physical_status in (
    'pending_return', 'received', 'missing', 'waived'
  )),
  storage_bucket text not null default 'receipts' check (storage_bucket = 'receipts'),
  original_path text,
  processed_path text,
  thumbnail_path text,
  pdf_path text,
  signature_path text,
  original_hash text,
  processed_hash text,
  scan_mode text not null default 'document_scan' check (scan_mode in (
    'document_scan', 'native_document_scan', 'manual_crop', 'legacy_photo', 'operator_replacement'
  )),
  scan_quality jsonb not null default '{}'::jsonb,
  receiver_name text,
  receiver_document text,
  receiver_role text,
  captured_at timestamptz,
  delivered_at timestamptz not null,
  latitude numeric(10,8),
  longitude numeric(11,8),
  accuracy_m numeric,
  validated_at timestamptz,
  validated_by uuid,
  rejection_reason text,
  physical_received_at timestamptz,
  physical_received_by uuid,
  email_status text not null default 'not_sent' check (email_status in (
    'not_sent', 'queued', 'sent', 'delivered', 'bounced', 'failed'
  )),
  created_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, delivery_event_id, version),
  constraint delivery_receipt_paths_check check (
    original_path is null or position('..' in original_path) = 0
  )
);

alter table public.delivery_receipts
  add constraint delivery_receipts_tenant_id_unique unique (tenant_id, id);

create unique index delivery_receipts_one_active_event_idx
  on public.delivery_receipts(tenant_id, delivery_event_id)
  where is_active;
create index delivery_receipts_operation_idx
  on public.delivery_receipts(tenant_id, delivered_at desc, digital_status, physical_status);
create index delivery_receipts_trip_idx
  on public.delivery_receipts(dispatch_trip_id, dispatch_stop_id);

create table public.delivery_receipt_documents (
  receipt_id uuid not null references public.delivery_receipts(id) on delete cascade,
  document_reference_id uuid not null references public.delivery_document_references(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  primary key (receipt_id, document_reference_id)
);

alter table public.delivery_receipt_documents
  add constraint delivery_receipt_documents_receipt_tenant_fkey
    foreign key (tenant_id, receipt_id)
    references public.delivery_receipts(tenant_id, id) on delete cascade,
  add constraint delivery_receipt_documents_reference_tenant_fkey
    foreign key (tenant_id, document_reference_id)
    references public.delivery_document_references(tenant_id, id) on delete restrict;

create index delivery_receipt_documents_reference_idx
  on public.delivery_receipt_documents(document_reference_id, receipt_id);
create index delivery_receipt_documents_tenant_idx
  on public.delivery_receipt_documents(tenant_id, receipt_id);

alter table public.delivery_document_references enable row level security;
alter table public.delivery_receipts enable row level security;
alter table public.delivery_receipt_documents enable row level security;

revoke all on table public.delivery_document_references from public, anon, authenticated, service_role;
revoke all on table public.delivery_receipts from public, anon, authenticated, service_role;
revoke all on table public.delivery_receipt_documents from public, anon, authenticated, service_role;
grant select on table public.delivery_document_references to authenticated;
grant select on table public.delivery_receipts to authenticated;
grant select on table public.delivery_receipt_documents to authenticated;
grant all on table public.delivery_document_references to service_role;
grant all on table public.delivery_receipts to service_role;
grant all on table public.delivery_receipt_documents to service_role;

create policy delivery_document_references_operator_read
  on public.delivery_document_references for select to authenticated
  using (public.is_tenant_operator_or_admin(tenant_id));

create policy delivery_document_references_assigned_driver_read
  on public.delivery_document_references for select to authenticated
  using (exists (
    select 1
    from public.delivery_receipt_documents as link
    join public.delivery_receipts as receipt on receipt.id = link.receipt_id
    join public.drivers as driver on driver.id = receipt.driver_id
    where link.document_reference_id = delivery_document_references.id
      and link.tenant_id = delivery_document_references.tenant_id
      and receipt.tenant_id = delivery_document_references.tenant_id
      and driver.user_id = auth.uid()
      and driver.active = true
  ));

create policy delivery_receipts_operator_read
  on public.delivery_receipts for select to authenticated
  using (public.is_tenant_operator_or_admin(tenant_id));

create policy delivery_receipts_assigned_driver_read
  on public.delivery_receipts for select to authenticated
  using (exists (
    select 1
    from public.drivers as driver
    where driver.id = delivery_receipts.driver_id
      and driver.tenant_id = delivery_receipts.tenant_id
      and driver.user_id = auth.uid()
      and driver.active = true
  ));

create policy delivery_receipt_documents_operator_read
  on public.delivery_receipt_documents for select to authenticated
  using (public.is_tenant_operator_or_admin(tenant_id));

create policy delivery_receipt_documents_assigned_driver_read
  on public.delivery_receipt_documents for select to authenticated
  using (exists (
    select 1
    from public.delivery_receipts as receipt
    join public.drivers as driver on driver.id = receipt.driver_id
    where receipt.id = delivery_receipt_documents.receipt_id
      and receipt.tenant_id = delivery_receipt_documents.tenant_id
      and driver.user_id = auth.uid()
      and driver.active = true
  ));

create or replace function public._sync_delivery_receipt_from_proof(_proof_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_proof public.proof_of_delivery%rowtype;
  v_event public.dispatch_events%rowtype;
  v_trip public.dispatch_trips%rowtype;
  v_receipt_id uuid;
  v_reference_id uuid;
  v_original_path text;
  v_processed_path text;
  v_signature_path text;
  v_event_id uuid;
  v_document record;
  v_nfse record;
  v_cte record;
begin
  select * into v_proof
  from public.proof_of_delivery
  where id = _proof_id;

  if not found or v_proof.status not in ('uploaded', 'validated')
    or jsonb_typeof(v_proof.metadata) <> 'object'
    or coalesce(v_proof.metadata->>'event_id', '') !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;

  v_event_id := (v_proof.metadata->>'event_id')::uuid;
  select * into v_event
  from public.dispatch_events
  where id = v_event_id
    and tenant_id = v_proof.tenant_id
    and dispatch_trip_id = v_proof.dispatch_trip_id
    and dispatch_stop_id = v_proof.dispatch_stop_id;
  if not found then return null; end if;

  select * into v_trip
  from public.dispatch_trips
  where id = v_event.dispatch_trip_id and tenant_id = v_event.tenant_id;
  if not found then return null; end if;

  v_original_path := nullif(v_proof.metadata->>'receipt_original_path', '');
  if v_original_path is null and jsonb_typeof(v_proof.metadata->'photo_paths') = 'array' then
    v_original_path := nullif(v_proof.metadata->'photo_paths'->>0, '');
  end if;
  v_processed_path := coalesce(
    nullif(v_proof.metadata->>'receipt_processed_path', ''),
    v_original_path
  );
  v_signature_path := coalesce(
    nullif(v_proof.metadata->>'signature_path', ''),
    v_proof.signature_url,
    v_proof.storage_path
  );

  select id into v_receipt_id
  from public.delivery_receipts
  where tenant_id = v_event.tenant_id
    and delivery_event_id = v_event.id
    and is_active
  for update;

  if not found then
    insert into public.delivery_receipts (
      tenant_id, delivery_event_id, dispatch_trip_id, dispatch_stop_id,
      driver_id, vehicle_id, digital_status, physical_status,
      original_path, processed_path, signature_path, scan_mode, scan_quality,
      receiver_name, receiver_document, receiver_role, captured_at, delivered_at,
      latitude, longitude, accuracy_m, validated_at, validated_by, created_by
    ) values (
      v_event.tenant_id, v_event.id, v_event.dispatch_trip_id, v_event.dispatch_stop_id,
      v_trip.driver_id, v_trip.vehicle_id,
      case when v_proof.status = 'validated' then 'validated' else 'uploaded' end,
      'pending_return', v_original_path, v_processed_path, v_signature_path,
      case when v_proof.metadata ? 'receipt_processed_path' then 'document_scan' else 'legacy_photo' end,
      coalesce(v_proof.metadata->'receipt_scan_quality', '{}'::jsonb),
      v_proof.receiver_name, v_proof.receiver_document, v_proof.receiver_role,
      coalesce((v_proof.metadata->>'captured_at')::timestamptz, v_proof.received_at),
      coalesce(v_proof.received_at, v_event.event_at),
      v_proof.latitude, v_proof.longitude, v_proof.accuracy,
      v_proof.validated_at, v_proof.validated_by, v_proof.created_by
    ) returning id into v_receipt_id;
  else
    update public.delivery_receipts set
      digital_status = case when v_proof.status = 'validated' then 'validated' else digital_status end,
      original_path = coalesce(original_path, v_original_path),
      processed_path = coalesce(processed_path, v_processed_path),
      signature_path = coalesce(signature_path, v_signature_path),
      validated_at = coalesce(validated_at, v_proof.validated_at),
      validated_by = coalesce(validated_by, v_proof.validated_by),
      updated_at = clock_timestamp()
    where id = v_receipt_id;
  end if;

  -- Every NF-e/fiscal allocation in the stop is linked to the single receipt.
  for v_document in
    select fiscal.*
    from public.dispatch_stop_documents as allocation
    join public.fiscal_documents as fiscal on fiscal.id = allocation.fiscal_document_id
    where allocation.dispatch_stop_id = v_event.dispatch_stop_id
      and allocation.tenant_id = v_event.tenant_id
      and fiscal.tenant_id = v_event.tenant_id
  loop
    insert into public.delivery_document_references (
      tenant_id, document_kind, fiscal_document_id, document_number,
      document_series, access_key, issue_date, issuer_name, issuer_tax_id,
      recipient_name, supplier_id, source_snapshot
    ) values (
      v_event.tenant_id,
      case when lower(coalesce(v_document.fiscal_model, '')) in ('57', 'cte', 'ct-e')
        then 'cte' else 'nfe' end,
      v_document.id, coalesce(v_document.invoice_number, v_document.reference_number),
      v_document.invoice_series, v_document.access_key, v_document.issue_date,
      v_document.remitter, v_document.remitter_cnpj, v_document.recipient,
      v_document.supplier_id,
      jsonb_build_object('source', 'fiscal_documents', 'id', v_document.id,
        'status', v_document.status, 'load_id', v_document.load_id)
    )
    on conflict (tenant_id, fiscal_document_id) do update set
      document_number = excluded.document_number,
      document_series = excluded.document_series,
      access_key = excluded.access_key,
      issue_date = excluded.issue_date,
      issuer_name = excluded.issuer_name,
      issuer_tax_id = excluded.issuer_tax_id,
      recipient_name = excluded.recipient_name,
      supplier_id = excluded.supplier_id,
      source_snapshot = excluded.source_snapshot,
      updated_at = clock_timestamp()
    returning id into v_reference_id;

    insert into public.delivery_receipt_documents (
      receipt_id, document_reference_id, tenant_id, document_snapshot
    ) values (
      v_receipt_id, v_reference_id, v_event.tenant_id,
      jsonb_build_object('kind', case when lower(coalesce(v_document.fiscal_model, '')) in ('57', 'cte', 'ct-e') then 'cte' else 'nfe' end,
        'number', coalesce(v_document.invoice_number, v_document.reference_number),
        'series', v_document.invoice_series, 'access_key', v_document.access_key,
        'issue_date', v_document.issue_date, 'issuer_name', v_document.remitter,
        'issuer_tax_id', v_document.remitter_cnpj, 'recipient_name', v_document.recipient,
        'supplier_id', v_document.supplier_id)
    ) on conflict do nothing;
  end loop;

  -- NFS-e references are optional peers, discovered through their explicit
  -- fiscal_document_ids relationship. They do not replace the NF-e allocation.
  for v_nfse in
    select distinct nfse.*
    from public.nfse_documents as nfse
    join public.dispatch_stop_documents as allocation
      on allocation.fiscal_document_id = any(coalesce(nfse.fiscal_document_ids, array[]::uuid[]))
    where allocation.dispatch_stop_id = v_event.dispatch_stop_id
      and allocation.tenant_id = v_event.tenant_id
      and nfse.tenant_id = v_event.tenant_id
  loop
    insert into public.delivery_document_references (
      tenant_id, document_kind, nfse_document_id, document_number,
      document_series, issue_date, issuer_name, issuer_tax_id,
      recipient_name, source_snapshot
    ) values (
      v_event.tenant_id, 'nfse', v_nfse.id,
      coalesce(v_nfse.nfse_number, v_nfse.rps_number, v_nfse.invoice_number),
      v_nfse.series, v_nfse.issue_date, v_nfse.pagador_nome,
      v_nfse.pagador_cnpj, v_nfse.cliente_nome,
      jsonb_build_object('source', 'nfse_documents', 'id', v_nfse.id,
        'status', v_nfse.status, 'load_id', v_nfse.load_id, 'trip_id', v_nfse.trip_id)
    )
    on conflict (tenant_id, nfse_document_id) do update set
      document_number = excluded.document_number,
      document_series = excluded.document_series,
      issue_date = excluded.issue_date,
      issuer_name = excluded.issuer_name,
      issuer_tax_id = excluded.issuer_tax_id,
      recipient_name = excluded.recipient_name,
      source_snapshot = excluded.source_snapshot,
      updated_at = clock_timestamp()
    returning id into v_reference_id;

    insert into public.delivery_receipt_documents (
      receipt_id, document_reference_id, tenant_id, document_snapshot
    ) values (
      v_receipt_id, v_reference_id, v_event.tenant_id,
      jsonb_build_object('kind', 'nfse',
        'number', coalesce(v_nfse.nfse_number, v_nfse.rps_number, v_nfse.invoice_number),
        'series', v_nfse.series, 'issue_date', v_nfse.issue_date,
        'issuer_name', v_nfse.pagador_nome, 'issuer_tax_id', v_nfse.pagador_cnpj,
        'recipient_name', v_nfse.cliente_nome)
    ) on conflict do nothing;
  end loop;

  -- CT-e is linked only when the existing load_documents graph says it is
  -- related to a fiscal allocation in this delivery.
  for v_cte in
    select distinct cte.*
    from public.load_documents as link
    join public.cte_documents as cte on cte.id = link.cte_document_id
    join public.dispatch_stop_documents as allocation
      on allocation.fiscal_document_id = link.fiscal_document_id
    where allocation.dispatch_stop_id = v_event.dispatch_stop_id
      and allocation.tenant_id = v_event.tenant_id
      and cte.tenant_id = v_event.tenant_id
  loop
    insert into public.delivery_document_references (
      tenant_id, document_kind, cte_document_id, document_number,
      document_series, access_key, issue_date, issuer_name, issuer_tax_id,
      recipient_name, source_snapshot
    ) values (
      v_event.tenant_id, 'cte', v_cte.id, v_cte.cte_number,
      v_cte.cte_series, v_cte.access_key, v_cte.issued_at::date,
      v_cte.remitter, v_cte.remitter_cnpj, v_cte.recipient,
      jsonb_build_object('source', 'cte_documents', 'id', v_cte.id,
        'status', v_cte.status, 'batch_id', v_cte.batch_id)
    )
    on conflict (tenant_id, cte_document_id) do update set
      document_number = excluded.document_number,
      document_series = excluded.document_series,
      access_key = excluded.access_key,
      issue_date = excluded.issue_date,
      issuer_name = excluded.issuer_name,
      issuer_tax_id = excluded.issuer_tax_id,
      recipient_name = excluded.recipient_name,
      source_snapshot = excluded.source_snapshot,
      updated_at = clock_timestamp()
    returning id into v_reference_id;

    insert into public.delivery_receipt_documents (
      receipt_id, document_reference_id, tenant_id, document_snapshot
    ) values (
      v_receipt_id, v_reference_id, v_event.tenant_id,
      jsonb_build_object('kind', 'cte', 'number', v_cte.cte_number,
        'series', v_cte.cte_series, 'access_key', v_cte.access_key,
        'issue_date', v_cte.issued_at::date, 'issuer_name', v_cte.remitter,
        'issuer_tax_id', v_cte.remitter_cnpj, 'recipient_name', v_cte.recipient)
    ) on conflict do nothing;
  end loop;

  return v_receipt_id;
end;
$function$;

revoke all on function public._sync_delivery_receipt_from_proof(uuid)
  from public, anon, authenticated, service_role;

create or replace function public._sync_delivery_receipt_from_proof_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform public._sync_delivery_receipt_from_proof(new.id);
  return new;
end;
$function$;

revoke all on function public._sync_delivery_receipt_from_proof_trigger()
  from public, anon, authenticated, service_role;

create trigger sync_delivery_receipt_from_proof
after insert or update of status, metadata, storage_path, signature_url
on public.proof_of_delivery
for each row
when (new.status in ('uploaded', 'validated'))
execute function public._sync_delivery_receipt_from_proof_trigger();

-- Backfill only proofs that already carry an immutable delivery event identity.
do $backfill_delivery_receipts$
declare v_proof record;
begin
  for v_proof in
    select id from public.proof_of_delivery
    where status in ('uploaded', 'validated')
      and jsonb_typeof(metadata) = 'object'
      and coalesce(metadata->>'event_id', '') ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    order by id
  loop
    perform public._sync_delivery_receipt_from_proof(v_proof.id);
  end loop;
end;
$backfill_delivery_receipts$;

create or replace function public.list_delivery_receipts_v1(
  _tenant_id uuid,
  _filters jsonb default '{}'::jsonb,
  _limit integer default 50,
  _offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare v_rows jsonb; v_total integer;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'delivery_receipt_not_authorized' using errcode = '42501';
  end if;
  if _filters is null or jsonb_typeof(_filters) <> 'object'
    or _limit not between 1 and 100 or _offset < 0 then
    raise exception 'invalid_delivery_receipt_filters' using errcode = '22023';
  end if;
  if coalesce(_filters->>'date_from', '') <> '' and (_filters->>'date_from') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(_filters->>'date_to', '') <> '' and (_filters->>'date_to') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(_filters->>'supplier_id', '') <> '' and (_filters->>'supplier_id') !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid_delivery_receipt_filters' using errcode = '22023';
  end if;

  with filtered as (
    select receipt.*
    from public.delivery_receipts as receipt
    where receipt.tenant_id = _tenant_id and receipt.is_active
      and (nullif(_filters->>'digital_status','') is null or receipt.digital_status = _filters->>'digital_status')
      and (nullif(_filters->>'physical_status','') is null or receipt.physical_status = _filters->>'physical_status')
      and (nullif(_filters->>'date_from','') is null or receipt.delivered_at >= (_filters->>'date_from')::date)
      and (nullif(_filters->>'date_to','') is null or receipt.delivered_at < ((_filters->>'date_to')::date + 1))
      and (nullif(_filters->>'supplier_id','') is null or exists (
        select 1 from public.delivery_receipt_documents link
        join public.delivery_document_references reference on reference.id = link.document_reference_id
        where link.receipt_id = receipt.id and link.tenant_id = receipt.tenant_id
          and reference.supplier_id = (_filters->>'supplier_id')::uuid
      ))
      and (nullif(btrim(_filters->>'search'),'') is null or exists (
        select 1 from public.delivery_receipt_documents link
        join public.delivery_document_references reference on reference.id = link.document_reference_id
        where link.receipt_id = receipt.id and link.tenant_id = receipt.tenant_id
          and concat_ws(' ',reference.document_number,reference.access_key,reference.issuer_name,
            reference.issuer_tax_id,reference.recipient_name,reference.operational_reference)
            ilike '%' || btrim(_filters->>'search') || '%'
      ))
  ), page as (
    select * from filtered order by delivered_at desc, id desc limit _limit offset _offset
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', receipt.id, 'delivery_event_id', receipt.delivery_event_id,
    'trip_id', receipt.dispatch_trip_id, 'stop_id', receipt.dispatch_stop_id,
    'delivered_at', receipt.delivered_at, 'captured_at', receipt.captured_at,
    'digital_status', receipt.digital_status, 'physical_status', receipt.physical_status,
    'email_status', receipt.email_status, 'scan_mode', receipt.scan_mode,
    'has_original', receipt.original_path is not null,
    'has_processed', receipt.processed_path is not null,
    'has_pdf', receipt.pdf_path is not null,
    'receiver_name', receipt.receiver_name,
    'driver', case when driver.id is null then null else jsonb_build_object('id',driver.id,'name',driver.name) end,
    'vehicle', case when vehicle.id is null then null else jsonb_build_object('id',vehicle.id,'plate',vehicle.plate) end,
    'destination', stop.destination,
    'documents', coalesce((select jsonb_agg(jsonb_build_object(
      'id', reference.id, 'kind', reference.document_kind,
      'number', reference.document_number, 'series', reference.document_series,
      'access_key', reference.access_key, 'issue_date', reference.issue_date,
      'issuer_name', reference.issuer_name, 'issuer_tax_id', reference.issuer_tax_id,
      'recipient_name', reference.recipient_name, 'supplier_id', reference.supplier_id,
      'operational_reference', reference.operational_reference
    ) order by reference.document_kind, reference.document_number, reference.id)
      from public.delivery_receipt_documents link
      join public.delivery_document_references reference on reference.id = link.document_reference_id
      where link.receipt_id = receipt.id and link.tenant_id = receipt.tenant_id), '[]'::jsonb),
    'updated_at', receipt.updated_at
  ) order by receipt.delivered_at desc, receipt.id desc), '[]'::jsonb)
  into v_rows
  from page receipt
  left join public.drivers driver on driver.id = receipt.driver_id and driver.tenant_id = receipt.tenant_id
  left join public.vehicles vehicle on vehicle.id = receipt.vehicle_id and vehicle.tenant_id = receipt.tenant_id
  left join public.dispatch_stops stop on stop.id = receipt.dispatch_stop_id and stop.tenant_id = receipt.tenant_id;

  with filtered as (
    select receipt.id
    from public.delivery_receipts as receipt
    where receipt.tenant_id = _tenant_id and receipt.is_active
      and (nullif(_filters->>'digital_status','') is null or receipt.digital_status = _filters->>'digital_status')
      and (nullif(_filters->>'physical_status','') is null or receipt.physical_status = _filters->>'physical_status')
      and (nullif(_filters->>'date_from','') is null or receipt.delivered_at >= (_filters->>'date_from')::date)
      and (nullif(_filters->>'date_to','') is null or receipt.delivered_at < ((_filters->>'date_to')::date + 1))
      and (nullif(_filters->>'supplier_id','') is null or exists (
        select 1 from public.delivery_receipt_documents link
        join public.delivery_document_references reference on reference.id = link.document_reference_id
        where link.receipt_id = receipt.id and link.tenant_id = receipt.tenant_id
          and reference.supplier_id = (_filters->>'supplier_id')::uuid
      ))
      and (nullif(btrim(_filters->>'search'),'') is null or exists (
        select 1 from public.delivery_receipt_documents link
        join public.delivery_document_references reference on reference.id = link.document_reference_id
        where link.receipt_id = receipt.id and link.tenant_id = receipt.tenant_id
          and concat_ws(' ',reference.document_number,reference.access_key,reference.issuer_name,
            reference.issuer_tax_id,reference.recipient_name,reference.operational_reference)
            ilike '%' || btrim(_filters->>'search') || '%'
      ))
  ) select count(*)::integer into v_total from filtered;

  return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),
    'rows',v_rows,'total',v_total,'limit',_limit,'offset',_offset);
end;
$function$;

revoke all on function public.list_delivery_receipts_v1(uuid,jsonb,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_delivery_receipts_v1(uuid,jsonb,integer,integer)
  to authenticated;

create or replace function public.review_delivery_receipt_v1(
  _tenant_id uuid,
  _receipt_id uuid,
  _decision text,
  _reason text default null,
  _expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_receipt public.delivery_receipts%rowtype; v_before jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'delivery_receipt_not_authorized' using errcode = '42501';
  end if;
  if _decision not in ('validated','rejected')
    or (_decision = 'rejected' and length(coalesce(btrim(_reason),'')) < 3)
    or length(coalesce(_reason,'')) > 1000 then
    raise exception 'invalid_delivery_receipt_review' using errcode = '22023';
  end if;
  select * into v_receipt from public.delivery_receipts
    where id = _receipt_id and tenant_id = _tenant_id and is_active for update;
  if not found then raise exception 'delivery_receipt_not_found' using errcode = 'P0002'; end if;
  if _expected_updated_at is not null and v_receipt.updated_at is distinct from _expected_updated_at then
    raise exception 'delivery_receipt_changed' using errcode = '40001';
  end if;
  v_before := to_jsonb(v_receipt);
  update public.delivery_receipts set
    digital_status = _decision,
    validated_at = case when _decision='validated' then clock_timestamp() else null end,
    validated_by = auth.uid(),
    rejection_reason = case when _decision='rejected' then btrim(_reason) else null end,
    updated_at = clock_timestamp()
  where id = v_receipt.id returning * into v_receipt;
  perform public._log_entity_audit(_tenant_id,'delivery_receipt',v_receipt.id,
    'review',v_before,to_jsonb(v_receipt),'review_delivery_receipt_v1');
  return jsonb_build_object('id',v_receipt.id,'digital_status',v_receipt.digital_status,
    'updated_at',v_receipt.updated_at,'confirmed',true);
end;
$function$;

revoke all on function public.review_delivery_receipt_v1(uuid,uuid,text,text,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.review_delivery_receipt_v1(uuid,uuid,text,text,timestamptz)
  to authenticated;

create or replace function public.receive_physical_delivery_receipt_v1(
  _tenant_id uuid,
  _receipt_id uuid,
  _expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_receipt public.delivery_receipts%rowtype; v_before jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'delivery_receipt_not_authorized' using errcode = '42501';
  end if;
  select * into v_receipt from public.delivery_receipts
    where id = _receipt_id and tenant_id = _tenant_id and is_active for update;
  if not found then raise exception 'delivery_receipt_not_found' using errcode = 'P0002'; end if;
  if _expected_updated_at is not null and v_receipt.updated_at is distinct from _expected_updated_at then
    raise exception 'delivery_receipt_changed' using errcode = '40001';
  end if;
  v_before := to_jsonb(v_receipt);
  update public.delivery_receipts set physical_status='received',physical_received_at=clock_timestamp(),
    physical_received_by=auth.uid(),updated_at=clock_timestamp()
  where id=v_receipt.id returning * into v_receipt;
  perform public._log_entity_audit(_tenant_id,'delivery_receipt',v_receipt.id,
    'physical_received',v_before,to_jsonb(v_receipt),'receive_physical_delivery_receipt_v1');
  return jsonb_build_object('id',v_receipt.id,'physical_status',v_receipt.physical_status,
    'updated_at',v_receipt.updated_at,'confirmed',true);
end;
$function$;

revoke all on function public.receive_physical_delivery_receipt_v1(uuid,uuid,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.receive_physical_delivery_receipt_v1(uuid,uuid,timestamptz)
  to authenticated;

comment on table public.delivery_receipts is
  'One physical paper-receipt scan per immutable delivery event; digital and physical custody states are independent.';
comment on table public.delivery_document_references is
  'Canonical delivery document registry. NF-e, NFS-e, CT-e and operational references are peers; none owns the receipt.';
comment on table public.delivery_receipt_documents is
  'Many-to-many immutable document snapshots attached to a delivery receipt.';
