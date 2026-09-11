-- Canonical custody dossier for the physical cargo lifecycle of one dispatch trip.
-- Fiscal references are peers: NF-e, NFS-e, CT-e and operational manifests are
-- all conferable, but none owns the trip or its proof-of-delivery receipts.

create table public.trip_cargo_controls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  dispatch_trip_id uuid not null references public.dispatch_trips(id) on delete restrict,
  driver_id uuid not null references public.drivers(id) on delete restrict,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  status text not null default 'pending_acceptance' check (status in (
    'pending_acceptance','accepted','loading','ready_to_depart','departed','returned','closed'
  )),
  vehicle_checked boolean not null default false,
  tie_down_confirmed boolean not null default false,
  seal_not_applicable_reason text,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  loading_started_at timestamptz,
  loading_started_by uuid references auth.users(id),
  cargo_confirmed_at timestamptz,
  cargo_confirmed_by uuid references auth.users(id),
  departed_at timestamptz,
  departed_by uuid references auth.users(id),
  returned_at timestamptz,
  returned_by uuid references auth.users(id),
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  close_override_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, dispatch_trip_id),
  unique (id, tenant_id),
  check (seal_not_applicable_reason is null or length(btrim(seal_not_applicable_reason)) between 5 and 500),
  check (close_override_reason is null or length(btrim(close_override_reason)) between 10 and 1000)
);

create table public.trip_cargo_load_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  control_id uuid not null,
  load_id uuid not null references public.loads(id) on delete restrict,
  expected_volume_count numeric,
  expected_pallet_count integer,
  expected_weight_kg numeric,
  confirmed_volume_count numeric,
  confirmed_pallet_count integer,
  confirmed_weight_kg numeric,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (control_id, tenant_id) references public.trip_cargo_controls(id, tenant_id) on delete cascade,
  unique (control_id, load_id),
  check (coalesce(expected_volume_count,0) >= 0 and coalesce(expected_pallet_count,0) >= 0 and coalesce(expected_weight_kg,0) >= 0),
  check (confirmed_volume_count is null or confirmed_volume_count >= 0),
  check (confirmed_pallet_count is null or confirmed_pallet_count >= 0),
  check (confirmed_weight_kg is null or confirmed_weight_kg >= 0)
);

create table public.trip_cargo_document_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  control_id uuid not null,
  load_id uuid references public.loads(id) on delete restrict,
  source_kind text not null check (source_kind in ('nfe','nfse','cte','operational_reference')),
  source_id uuid,
  reference_number text not null,
  driver_confirmed boolean not null default false,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (control_id, tenant_id) references public.trip_cargo_controls(id, tenant_id) on delete cascade,
  check (length(btrim(reference_number)) between 1 and 300),
  check (notes is null or length(notes) <= 1000)
);
create unique index trip_cargo_document_identity_idx on public.trip_cargo_document_checks(
  control_id, source_kind, coalesce(source_id,'00000000-0000-0000-0000-000000000000'::uuid), reference_number
);

create table public.trip_cargo_seals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  control_id uuid not null,
  seal_number text not null,
  status text not null default 'installed' check (status in ('installed','removed','broken','missing')),
  installed_at timestamptz not null default now(),
  installed_by uuid not null references auth.users(id),
  removed_at timestamptz,
  removed_by uuid references auth.users(id),
  notes text,
  foreign key (control_id, tenant_id) references public.trip_cargo_controls(id, tenant_id) on delete cascade,
  unique (control_id, seal_number),
  check (length(btrim(seal_number)) between 2 and 100),
  check (notes is null or length(notes) <= 1000)
);

create table public.trip_cargo_evidence (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  control_id uuid not null,
  evidence_kind text not null check (evidence_kind in ('loading','tie_down','seal','damage','shortage','surplus','return','other')),
  storage_bucket text not null default 'receipts' check (storage_bucket = 'receipts'),
  storage_path text not null,
  captured_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (control_id, tenant_id) references public.trip_cargo_controls(id, tenant_id) on delete cascade,
  unique (control_id, storage_path),
  check (length(storage_path) between 20 and 500 and storage_path not like '%..%' and storage_path not like '%\\%')
);

create table public.trip_cargo_divergences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  control_id uuid not null,
  load_id uuid references public.loads(id) on delete restrict,
  divergence_kind text not null check (divergence_kind in (
    'document','volume','pallet','weight','seal','damage','shortage','surplus','other'
  )),
  description text not null,
  expected_value text,
  observed_value text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','resolved')),
  reported_at timestamptz not null default now(),
  reported_by uuid not null references auth.users(id),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (control_id, tenant_id) references public.trip_cargo_controls(id, tenant_id) on delete cascade,
  check (length(btrim(description)) between 5 and 2000),
  check (review_reason is null or length(btrim(review_reason)) between 5 and 1000)
);

create table public.trip_cargo_commands (
  request_id uuid primary key,
  tenant_id uuid not null,
  control_id uuid not null,
  actor_id uuid not null references auth.users(id),
  action text not null,
  payload_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (control_id, tenant_id) references public.trip_cargo_controls(id, tenant_id) on delete cascade,
  check (length(action) between 2 and 80),
  check (payload_hash ~ '^[0-9a-f]{32}$')
);

create index trip_cargo_controls_tenant_status_idx on public.trip_cargo_controls(tenant_id,status,updated_at desc);
create index trip_cargo_divergences_review_idx on public.trip_cargo_divergences(tenant_id,status,reported_at desc);
create index trip_cargo_documents_control_idx on public.trip_cargo_document_checks(control_id,driver_confirmed,source_kind);

alter table public.trip_cargo_controls enable row level security;
alter table public.trip_cargo_load_checks enable row level security;
alter table public.trip_cargo_document_checks enable row level security;
alter table public.trip_cargo_seals enable row level security;
alter table public.trip_cargo_evidence enable row level security;
alter table public.trip_cargo_divergences enable row level security;
alter table public.trip_cargo_commands enable row level security;

revoke all on table public.trip_cargo_controls,public.trip_cargo_load_checks,
  public.trip_cargo_document_checks,public.trip_cargo_seals,public.trip_cargo_evidence,
  public.trip_cargo_divergences,public.trip_cargo_commands from public,anon,authenticated,service_role;
grant select on table public.trip_cargo_controls,public.trip_cargo_load_checks,
  public.trip_cargo_document_checks,public.trip_cargo_seals,public.trip_cargo_evidence,
  public.trip_cargo_divergences to authenticated;
grant all on table public.trip_cargo_controls,public.trip_cargo_load_checks,
  public.trip_cargo_document_checks,public.trip_cargo_seals,public.trip_cargo_evidence,
  public.trip_cargo_divergences,public.trip_cargo_commands to service_role;

create or replace function private.can_access_trip_cargo(_control_id uuid)
returns boolean language sql stable security definer set search_path='' as $function$
  select auth.uid() is not null and exists(
    select 1 from public.trip_cargo_controls control
    where control.id=_control_id and control.tenant_id=private.request_tenant_id() and (
      exists(select 1 from public.drivers driver where driver.id=control.driver_id
        and driver.tenant_id=control.tenant_id and driver.user_id=auth.uid() and driver.active)
      or exists(select 1 from public.tenant_memberships membership where membership.tenant_id=control.tenant_id
        and membership.user_id=auth.uid() and membership.active and membership.role in('owner','admin','operator'))
    )
  )
$function$;
revoke all on function private.can_access_trip_cargo(uuid) from public,anon,authenticated,service_role;
grant execute on function private.can_access_trip_cargo(uuid) to authenticated,service_role;

create policy trip_cargo_controls_read on public.trip_cargo_controls for select to authenticated
  using(private.can_access_trip_cargo(id));
create policy trip_cargo_load_checks_read on public.trip_cargo_load_checks for select to authenticated
  using(private.can_access_trip_cargo(control_id));
create policy trip_cargo_document_checks_read on public.trip_cargo_document_checks for select to authenticated
  using(private.can_access_trip_cargo(control_id));
create policy trip_cargo_seals_read on public.trip_cargo_seals for select to authenticated
  using(private.can_access_trip_cargo(control_id));
create policy trip_cargo_evidence_read on public.trip_cargo_evidence for select to authenticated
  using(private.can_access_trip_cargo(control_id));
create policy trip_cargo_divergences_read on public.trip_cargo_divergences for select to authenticated
  using(private.can_access_trip_cargo(control_id));

create or replace function private.require_trip_cargo_actor(_tenant_id uuid,_trip_id uuid,_operator boolean default false)
returns public.dispatch_trips language plpgsql stable security definer set search_path='' as $function$
declare v_trip public.dispatch_trips%rowtype;
begin
  if auth.uid() is null then raise exception 'trip_cargo_not_authorized' using errcode='42501';end if;
  if private.request_tenant_id() is distinct from _tenant_id then raise exception 'trip_cargo_not_authorized' using errcode='42501';end if;
  select * into v_trip from public.dispatch_trips where id=_trip_id and tenant_id=_tenant_id;
  if not found then raise exception 'trip_cargo_trip_not_found' using errcode='P0002';end if;
  if _operator then
    if not exists(select 1 from public.tenant_memberships membership where membership.tenant_id=_tenant_id
      and membership.user_id=auth.uid() and membership.active and membership.role in('owner','admin','operator')) then
      raise exception 'trip_cargo_not_authorized' using errcode='42501';
    end if;
  elsif not exists(select 1 from public.drivers driver where driver.id=v_trip.driver_id
    and driver.tenant_id=_tenant_id and driver.user_id=auth.uid() and driver.active) then
    raise exception 'trip_cargo_not_authorized' using errcode='42501';
  end if;
  return v_trip;
end;$function$;
revoke all on function private.require_trip_cargo_actor(uuid,uuid,boolean) from public,anon,authenticated,service_role;

create or replace function private.sync_trip_cargo_expected(_control_id uuid)
returns void language plpgsql security definer set search_path='' as $function$
declare v_control public.trip_cargo_controls%rowtype;
begin
  select * into v_control from public.trip_cargo_controls where id=_control_id;
  if not found then raise exception 'trip_cargo_control_not_found' using errcode='P0002';end if;

  insert into public.trip_cargo_load_checks(tenant_id,control_id,load_id,expected_volume_count,expected_pallet_count,expected_weight_kg)
  select v_control.tenant_id,v_control.id,load.id,load.total_volume_m3,load.total_pallet_count,load.total_weight_kg
  from public.dispatch_trip_loads link join public.loads load on load.id=link.load_id and load.tenant_id=link.tenant_id
  where link.dispatch_trip_id=v_control.dispatch_trip_id and link.tenant_id=v_control.tenant_id
  on conflict(control_id,load_id) do update set expected_volume_count=excluded.expected_volume_count,
    expected_pallet_count=excluded.expected_pallet_count,expected_weight_kg=excluded.expected_weight_kg,updated_at=clock_timestamp();

  insert into public.trip_cargo_document_checks(tenant_id,control_id,load_id,source_kind,source_id,reference_number)
  select v_control.tenant_id,v_control.id,document.load_id,'nfe',document.id,
    coalesce(nullif(btrim(document.invoice_number),''),nullif(btrim(document.reference_number),''),document.id::text)
  from public.fiscal_documents document join public.trip_cargo_load_checks check_row
    on check_row.control_id=v_control.id and check_row.load_id=document.load_id
  where document.tenant_id=v_control.tenant_id and document.deleted_at is null
  on conflict do nothing;

  insert into public.trip_cargo_document_checks(tenant_id,control_id,load_id,source_kind,source_id,reference_number)
  select distinct v_control.tenant_id,v_control.id,check_row.load_id,'cte',document.id,
    coalesce(nullif(btrim(document.cte_number),''),nullif(btrim(document.reference_number),''),document.id::text)
  from public.cte_documents document join public.trip_cargo_load_checks check_row
    on check_row.control_id=v_control.id and (
      check_row.load_id=any(coalesce(document.load_ids,array[]::uuid[]))
      or exists(select 1 from public.fiscal_documents fiscal where fiscal.tenant_id=v_control.tenant_id
        and fiscal.load_id=check_row.load_id and fiscal.id=any(coalesce(document.fiscal_document_ids,array[]::uuid[])))
    )
  where document.tenant_id=v_control.tenant_id and document.status='authorized'
    and document.cancelled_at is null and not coalesce(document.is_voided,false)
  on conflict do nothing;

  insert into public.trip_cargo_document_checks(tenant_id,control_id,load_id,source_kind,source_id,reference_number)
  select distinct v_control.tenant_id,v_control.id,check_row.load_id,'nfse',document.id,
    coalesce(nullif(btrim(document.nfse_number),''),nullif(btrim(document.invoice_number),''),nullif(btrim(document.rps_number),''),document.id::text)
  from public.nfse_documents document join public.trip_cargo_load_checks check_row
    on check_row.control_id=v_control.id and (document.load_id=check_row.load_id or document.trip_id=v_control.dispatch_trip_id
      or exists(select 1 from public.fiscal_documents fiscal where fiscal.tenant_id=v_control.tenant_id
        and fiscal.load_id=check_row.load_id and fiscal.id=any(coalesce(document.fiscal_document_ids,array[]::uuid[])))
      or exists(select 1 from public.cte_documents cte where cte.tenant_id=v_control.tenant_id
        and cte.id=any(coalesce(document.related_cte_ids,array[]::uuid[]))
        and (check_row.load_id=any(coalesce(cte.load_ids,array[]::uuid[])) or exists(select 1 from public.fiscal_documents fiscal
          where fiscal.tenant_id=v_control.tenant_id and fiscal.load_id=check_row.load_id
            and fiscal.id=any(coalesce(cte.fiscal_document_ids,array[]::uuid[])))))
    )
  where document.tenant_id=v_control.tenant_id and document.status in('issued','authorized')
    and not coalesce(document.cancelled,false) and not coalesce(document.is_preview,false)
  on conflict do nothing;

  insert into public.trip_cargo_document_checks(tenant_id,control_id,load_id,source_kind,reference_number)
  select v_control.tenant_id,v_control.id,load.id,'operational_reference',reference.value
  from public.trip_cargo_load_checks check_row join public.loads load on load.id=check_row.load_id
  cross join lateral(values(load.supplier_manifest),(load.distribution_manifest),(load.shipment_manifest),
    (load.origin_manifest),(load.os_number),(load.external_load_number),(load.control_load_number)) reference(value)
  where check_row.control_id=v_control.id and nullif(btrim(reference.value),'') is not null
  on conflict do nothing;
end;$function$;
revoke all on function private.sync_trip_cargo_expected(uuid) from public,anon,authenticated,service_role;

create or replace function private.trip_cargo_snapshot(_tenant_id uuid,_trip_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_trip public.dispatch_trips%rowtype;v_control public.trip_cargo_controls%rowtype;v_result jsonb;
begin
  if auth.uid() is null then raise exception 'trip_cargo_not_authorized' using errcode='42501';end if;
  if private.request_tenant_id() is distinct from _tenant_id then raise exception 'trip_cargo_not_authorized' using errcode='42501';end if;
  select * into v_trip from public.dispatch_trips where id=_trip_id and tenant_id=_tenant_id;
  if not found then raise exception 'trip_cargo_trip_not_found' using errcode='P0002';end if;
  if not (
    exists(select 1 from public.drivers driver where driver.id=v_trip.driver_id and driver.tenant_id=_tenant_id
      and driver.user_id=auth.uid() and driver.active)
    or exists(select 1 from public.tenant_memberships membership where membership.tenant_id=_tenant_id
      and membership.user_id=auth.uid() and membership.active and membership.role in('owner','admin','operator'))
  ) then raise exception 'trip_cargo_not_authorized' using errcode='42501';end if;
  select * into v_control from public.trip_cargo_controls where tenant_id=_tenant_id and dispatch_trip_id=_trip_id;
  if not found then return jsonb_build_object('version',1,'trip_id',_trip_id,'tenant_id',_tenant_id,
    'available',false,'trip_status',v_trip.status,'driver_id',v_trip.driver_id,'vehicle_id',v_trip.vehicle_id);end if;
  select jsonb_build_object('version',1,'available',true,'trip_id',v_trip.id,'trip_status',v_trip.status,
    'control',to_jsonb(v_control),
    'loads',coalesce((select jsonb_agg(to_jsonb(row) order by row.load_id) from public.trip_cargo_load_checks row where row.control_id=v_control.id),'[]'::jsonb),
    'documents',coalesce((select jsonb_agg(to_jsonb(row) order by row.source_kind,row.reference_number) from public.trip_cargo_document_checks row where row.control_id=v_control.id),'[]'::jsonb),
    'seals',coalesce((select jsonb_agg(to_jsonb(row) order by row.installed_at,row.id) from public.trip_cargo_seals row where row.control_id=v_control.id),'[]'::jsonb),
    'evidence',coalesce((select jsonb_agg(to_jsonb(row) order by row.captured_at,row.id) from public.trip_cargo_evidence row where row.control_id=v_control.id),'[]'::jsonb),
    'divergences',coalesce((select jsonb_agg(to_jsonb(row) order by row.reported_at,row.id) from public.trip_cargo_divergences row where row.control_id=v_control.id),'[]'::jsonb),
    'physical_receipts',jsonb_build_object(
      'required_count',(select count(*) from public.delivery_receipts receipt where receipt.tenant_id=_tenant_id and receipt.dispatch_trip_id=_trip_id and receipt.is_active),
      'pending_count',(select count(*) from public.delivery_receipts receipt where receipt.tenant_id=_tenant_id and receipt.dispatch_trip_id=_trip_id and receipt.is_active and receipt.physical_status<>'received'),
      'missing_count',(select count(*) from public.dispatch_stops stop where stop.tenant_id=_tenant_id and stop.dispatch_trip_id=_trip_id
        and stop.status in('delivered','partial_delivery') and not exists(select 1 from public.delivery_receipts receipt
          where receipt.tenant_id=_tenant_id and receipt.dispatch_stop_id=stop.id and receipt.is_active)))) into v_result;
  return v_result;
end;$function$;
revoke all on function private.trip_cargo_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.trip_cargo_snapshot(uuid,uuid) to authenticated;

create or replace function public.get_trip_cargo_control_v1(_tenant_id uuid,_trip_id uuid)
returns jsonb language sql stable security invoker set search_path='' set row_security='on' as $function$
  select private.trip_cargo_snapshot(_tenant_id,_trip_id)
$function$;
revoke all on function public.get_trip_cargo_control_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_trip_cargo_control_v1(uuid,uuid) to authenticated;

create or replace function private.list_trip_cargo_controls(_tenant_id uuid,_status text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_result jsonb;
begin
  if auth.uid() is null or private.request_tenant_id() is distinct from _tenant_id
    or not exists(select 1 from public.tenant_memberships membership
    where membership.tenant_id=_tenant_id and membership.user_id=auth.uid() and membership.active
      and membership.role in('owner','admin','operator')) then
    raise exception 'trip_cargo_not_authorized' using errcode='42501';end if;
  if _status is not null and _status not in('pending_acceptance','accepted','loading','ready_to_depart','departed','returned','closed') then
    raise exception 'trip_cargo_status_invalid' using errcode='22023';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',control.id,'trip_id',control.dispatch_trip_id,
    'driver_id',control.driver_id,'vehicle_id',control.vehicle_id,'status',control.status,
    'updated_at',control.updated_at,'pending_divergences',(select count(*) from public.trip_cargo_divergences divergence
      where divergence.control_id=control.id and divergence.status in('pending','rejected')),
    'pending_physical_receipts',(select count(*) from public.delivery_receipts receipt where receipt.tenant_id=_tenant_id
      and receipt.dispatch_trip_id=control.dispatch_trip_id and receipt.is_active and receipt.physical_status<>'received'))
    order by control.updated_at desc,control.id),'[]'::jsonb) into v_result
  from public.trip_cargo_controls control where control.tenant_id=_tenant_id and (_status is null or control.status=_status);
  return jsonb_build_object('version',1,'tenant_id',_tenant_id,'items',v_result);
end;$function$;
revoke all on function private.list_trip_cargo_controls(uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.list_trip_cargo_controls(uuid,text) to authenticated;
create or replace function public.list_trip_cargo_controls_v1(_tenant_id uuid,_status text default null)
returns jsonb language sql stable security invoker set search_path='' set row_security='on' as $function$
  select private.list_trip_cargo_controls(_tenant_id,_status)
$function$;
revoke all on function public.list_trip_cargo_controls_v1(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.list_trip_cargo_controls_v1(uuid,text) to authenticated;

create or replace function private.driver_update_trip_cargo(_tenant_id uuid,_trip_id uuid,_request_id uuid,_action text,_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_trip public.dispatch_trips%rowtype;v_control public.trip_cargo_controls%rowtype;v_existing public.trip_cargo_commands%rowtype;
  v_hash text;v_result jsonb;v_item jsonb;v_load public.trip_cargo_load_checks%rowtype;v_kind text;v_description text;
begin
  if _request_id is null or _action is null or jsonb_typeof(coalesce(_payload,'{}'::jsonb))<>'object'
    or pg_catalog.octet_length(coalesce(_payload,'{}'::jsonb)::text)>262144 then
    raise exception 'invalid_trip_cargo_command' using errcode='22023';end if;
  v_trip:=private.require_trip_cargo_actor(_tenant_id,_trip_id,false);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('trip_cargo:'||_tenant_id::text||':'||_trip_id::text,0));
  v_hash:=md5(_action||':'||coalesce(_payload,'{}'::jsonb)::text);
  select * into v_existing from public.trip_cargo_commands where request_id=_request_id;
  if found then
    if v_existing.tenant_id<>_tenant_id or v_existing.actor_id<>auth.uid() or v_existing.action<>_action or v_existing.payload_hash<>v_hash then
      raise exception 'trip_cargo_request_conflict' using errcode='23505';end if;
    return v_existing.result;
  end if;
  select * into v_control from public.trip_cargo_controls where tenant_id=_tenant_id and dispatch_trip_id=_trip_id for update;
  if not found then
    if _action<>'accept' then raise exception 'trip_cargo_acceptance_required' using errcode='23514';end if;
    if v_trip.vehicle_id is null or (_payload->>'vehicle_id') is distinct from v_trip.vehicle_id::text then
      raise exception 'trip_cargo_vehicle_mismatch' using errcode='23514';end if;
    if v_trip.status not in('planned','loading','dispatched') then raise exception 'trip_cargo_acceptance_closed' using errcode='23514';end if;
    insert into public.trip_cargo_controls(tenant_id,dispatch_trip_id,driver_id,vehicle_id,status,accepted_at,accepted_by)
      values(_tenant_id,_trip_id,v_trip.driver_id,v_trip.vehicle_id,'accepted',clock_timestamp(),auth.uid()) returning * into v_control;
    perform private.sync_trip_cargo_expected(v_control.id);
  elsif v_control.driver_id<>v_trip.driver_id or v_control.vehicle_id<>v_trip.vehicle_id then
    raise exception 'trip_cargo_assignment_changed' using errcode='23514';
  elsif _action='accept' and v_control.status='pending_acceptance' then
    update public.trip_cargo_controls set status='accepted',accepted_at=clock_timestamp(),accepted_by=auth.uid(),updated_at=clock_timestamp()
      where id=v_control.id returning * into v_control;
  elsif _action='start_loading' then
    if v_control.status not in('accepted','loading') then raise exception 'trip_cargo_invalid_state' using errcode='23514';end if;
    update public.trip_cargo_controls set status='loading',loading_started_at=coalesce(loading_started_at,clock_timestamp()),
      loading_started_by=coalesce(loading_started_by,auth.uid()),updated_at=clock_timestamp() where id=v_control.id returning * into v_control;
  elsif _action='confirm_cargo' then
    if v_control.status not in('accepted','loading','ready_to_depart') then raise exception 'trip_cargo_invalid_state' using errcode='23514';end if;
    if jsonb_typeof(_payload->'loads')<>'array' or jsonb_array_length(_payload->'loads')<>(select count(*) from public.trip_cargo_load_checks where control_id=v_control.id)
      or not coalesce((_payload->>'vehicle_checked')::boolean,false) or not coalesce((_payload->>'tie_down_confirmed')::boolean,false) then
      raise exception 'trip_cargo_confirmation_incomplete' using errcode='23514';end if;
    update public.trip_cargo_document_checks set driver_confirmed=false,confirmed_at=null,confirmed_by=null,updated_at=clock_timestamp() where control_id=v_control.id;
    update public.trip_cargo_load_checks set confirmed_volume_count=null,confirmed_pallet_count=null,
      confirmed_weight_kg=null,confirmed_at=null,confirmed_by=null,updated_at=clock_timestamp() where control_id=v_control.id;
    for v_item in select value from jsonb_array_elements(_payload->'documents') loop
      update public.trip_cargo_document_checks set driver_confirmed=true,confirmed_at=clock_timestamp(),confirmed_by=auth.uid(),updated_at=clock_timestamp()
      where control_id=v_control.id and id=(v_item#>>'{}')::uuid;
      if not found then raise exception 'trip_cargo_document_outside_trip' using errcode='23514';end if;
    end loop;
    if exists(select 1 from public.trip_cargo_document_checks where control_id=v_control.id and not driver_confirmed) then
      raise exception 'trip_cargo_documents_incomplete' using errcode='23514';end if;
    for v_item in select value from jsonb_array_elements(_payload->'loads') loop
      select * into v_load from public.trip_cargo_load_checks where control_id=v_control.id and load_id=(v_item->>'load_id')::uuid for update;
      if not found or v_item->'volume_count' is null or v_item->'pallet_count' is null or v_item->'weight_kg' is null
        or (v_item->>'volume_count')::numeric<0 or (v_item->>'pallet_count')::integer<0 or (v_item->>'weight_kg')::numeric<0 then
        raise exception 'trip_cargo_load_confirmation_invalid' using errcode='22023';end if;
      update public.trip_cargo_load_checks set confirmed_volume_count=(v_item->>'volume_count')::numeric,
        confirmed_pallet_count=(v_item->>'pallet_count')::integer,confirmed_weight_kg=(v_item->>'weight_kg')::numeric,
        confirmed_at=clock_timestamp(),confirmed_by=auth.uid(),updated_at=clock_timestamp() where id=v_load.id;
      if coalesce(v_load.expected_volume_count,0)<>(v_item->>'volume_count')::numeric then
        insert into public.trip_cargo_divergences(tenant_id,control_id,load_id,divergence_kind,description,expected_value,observed_value,reported_by)
          values(_tenant_id,v_control.id,v_load.load_id,'volume','Quantidade de volumes divergente da carga planejada',v_load.expected_volume_count::text,v_item->>'volume_count',auth.uid());end if;
      if coalesce(v_load.expected_pallet_count,0)<>(v_item->>'pallet_count')::integer then
        insert into public.trip_cargo_divergences(tenant_id,control_id,load_id,divergence_kind,description,expected_value,observed_value,reported_by)
          values(_tenant_id,v_control.id,v_load.load_id,'pallet','Quantidade de pallets divergente da carga planejada',v_load.expected_pallet_count::text,v_item->>'pallet_count',auth.uid());end if;
      if abs(coalesce(v_load.expected_weight_kg,0)-(v_item->>'weight_kg')::numeric)>1 then
        insert into public.trip_cargo_divergences(tenant_id,control_id,load_id,divergence_kind,description,expected_value,observed_value,reported_by)
          values(_tenant_id,v_control.id,v_load.load_id,'weight','Peso divergente da carga planejada',v_load.expected_weight_kg::text,v_item->>'weight_kg',auth.uid());end if;
    end loop;
    if exists(select 1 from public.trip_cargo_load_checks where control_id=v_control.id and confirmed_at is null) then
      raise exception 'trip_cargo_loads_incomplete' using errcode='23514';end if;
    if jsonb_typeof(coalesce(_payload->'divergences','[]'::jsonb))<>'array' then raise exception 'trip_cargo_divergences_invalid' using errcode='22023';end if;
    for v_item in select value from jsonb_array_elements(coalesce(_payload->'divergences','[]'::jsonb)) loop
      v_kind:=v_item->>'kind';v_description:=btrim(v_item->>'description');
      if v_kind not in('document','seal','damage','shortage','surplus','other') or length(v_description)<5 then
        raise exception 'trip_cargo_divergence_invalid' using errcode='22023';end if;
      insert into public.trip_cargo_divergences(tenant_id,control_id,load_id,divergence_kind,description,observed_value,reported_by)
        values(_tenant_id,v_control.id,nullif(v_item->>'load_id','')::uuid,v_kind,v_description,nullif(v_item->>'observed_value',''),auth.uid());
    end loop;
    if jsonb_typeof(coalesce(_payload->'seals','[]'::jsonb))<>'array' then raise exception 'trip_cargo_seals_invalid' using errcode='22023';end if;
    for v_item in select value from jsonb_array_elements(coalesce(_payload->'seals','[]'::jsonb)) loop
      insert into public.trip_cargo_seals(tenant_id,control_id,seal_number,installed_by)
        values(_tenant_id,v_control.id,btrim(v_item#>>'{}'),auth.uid()) on conflict(control_id,seal_number) do nothing;
    end loop;
    if not exists(select 1 from public.trip_cargo_seals where control_id=v_control.id)
      and length(btrim(coalesce(_payload->>'seal_not_applicable_reason','')))<5 then
      raise exception 'trip_cargo_seal_confirmation_required' using errcode='23514';end if;
    if jsonb_typeof(coalesce(_payload->'evidence','[]'::jsonb))<>'array' then raise exception 'trip_cargo_evidence_invalid' using errcode='22023';end if;
    for v_item in select value from jsonb_array_elements(coalesce(_payload->'evidence','[]'::jsonb)) loop
      if v_item->>'kind' not in('loading','tie_down','seal','damage','shortage','surplus','other')
        or (v_item->>'path') not like _tenant_id::text||'/trip-cargo/'||_trip_id::text||'/%' then
        raise exception 'trip_cargo_evidence_invalid' using errcode='22023';end if;
      insert into public.trip_cargo_evidence(tenant_id,control_id,evidence_kind,storage_path,created_by)
        values(_tenant_id,v_control.id,v_item->>'kind',v_item->>'path',auth.uid()) on conflict(control_id,storage_path) do nothing;
    end loop;
    if not exists(select 1 from public.trip_cargo_evidence where control_id=v_control.id and evidence_kind='loading')
      or not exists(select 1 from public.trip_cargo_evidence where control_id=v_control.id and evidence_kind='tie_down') then
      raise exception 'trip_cargo_loading_photos_required' using errcode='23514';end if;
    if exists(select 1 from public.trip_cargo_divergences divergence where divergence.control_id=v_control.id
      and divergence.status='pending' and divergence.divergence_kind in('damage','shortage','surplus')
      and not exists(select 1 from public.trip_cargo_evidence proof where proof.control_id=v_control.id
        and proof.evidence_kind=divergence.divergence_kind)) then
      raise exception 'trip_cargo_divergence_photo_required' using errcode='23514';end if;
    update public.trip_cargo_controls set vehicle_checked=true,tie_down_confirmed=true,
      seal_not_applicable_reason=nullif(btrim(_payload->>'seal_not_applicable_reason'),''),
      cargo_confirmed_at=clock_timestamp(),cargo_confirmed_by=auth.uid(),
      status=case when exists(select 1 from public.trip_cargo_divergences where control_id=v_control.id and status in('pending','rejected')) then 'loading' else 'ready_to_depart' end,
      updated_at=clock_timestamp() where id=v_control.id returning * into v_control;
  elsif _action='mark_departed' then
    if v_control.status not in('ready_to_depart','departed') then raise exception 'trip_cargo_departure_blocked' using errcode='23514';end if;
    if not exists(select 1 from public.dispatch_events event where event.tenant_id=_tenant_id
      and event.dispatch_trip_id=_trip_id and event.created_by=auth.uid() and event.event_type='checklist_pre'
      and jsonb_typeof(event.payload->'checked_items')='array' and jsonb_array_length(event.payload->'checked_items')=8
      and event.event_at>coalesce((select max(boundary.event_at) from public.dispatch_events boundary
        where boundary.tenant_id=_tenant_id and boundary.created_by=auth.uid() and boundary.event_type='end_shift'),'-infinity'::timestamptz)) then
      raise exception 'trip_cargo_pre_checklist_required' using errcode='23514';end if;
    update public.trip_cargo_controls set status='departed',departed_at=coalesce(departed_at,clock_timestamp()),
      departed_by=coalesce(departed_by,auth.uid()),updated_at=clock_timestamp() where id=v_control.id returning * into v_control;
  elsif _action='mark_returned' then
    if v_control.status not in('departed','returned') then raise exception 'trip_cargo_return_blocked' using errcode='23514';end if;
    if exists(select 1 from public.dispatch_stops stop where stop.tenant_id=_tenant_id and stop.dispatch_trip_id=_trip_id
      and stop.status not in('delivered','completed','partial_delivery','returned','refused','failed','cancelled','skipped')) then
      raise exception 'trip_cargo_stops_pending' using errcode='23514';end if;
    if not exists(select 1 from public.dispatch_events event where event.tenant_id=_tenant_id
      and event.dispatch_trip_id=_trip_id and event.created_by=auth.uid() and event.event_type='checklist_post'
      and jsonb_typeof(event.payload->'checked_items')='array' and jsonb_array_length(event.payload->'checked_items')=5
      and event.event_at>coalesce((select max(boundary.event_at) from public.dispatch_events boundary
        where boundary.tenant_id=_tenant_id and boundary.created_by=auth.uid() and boundary.event_type='start_shift'),'-infinity'::timestamptz)) then
      raise exception 'trip_cargo_post_checklist_required' using errcode='23514';end if;
    update public.trip_cargo_controls set status='returned',returned_at=coalesce(returned_at,clock_timestamp()),
      returned_by=coalesce(returned_by,auth.uid()),updated_at=clock_timestamp() where id=v_control.id returning * into v_control;
  else
    raise exception 'trip_cargo_action_invalid' using errcode='22023';
  end if;
  v_result:=jsonb_build_object('version',1,'confirmed',true,'request_id',_request_id,'trip_id',_trip_id,
    'control_id',v_control.id,'status',v_control.status,'updated_at',v_control.updated_at);
  insert into public.trip_cargo_commands(request_id,tenant_id,control_id,actor_id,action,payload_hash,result)
    values(_request_id,_tenant_id,v_control.id,auth.uid(),_action,v_hash,v_result);
  perform public._log_entity_audit(_tenant_id,'trip_cargo_control',v_control.id,_action,null,v_result,'driver_app');
  return v_result;
end;$function$;
revoke all on function private.driver_update_trip_cargo(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.driver_update_trip_cargo(uuid,uuid,uuid,text,jsonb) to authenticated;

create or replace function public.driver_update_trip_cargo_v1(_tenant_id uuid,_trip_id uuid,_request_id uuid,_action text,_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' set row_security='on' as $function$
  select private.driver_update_trip_cargo(_tenant_id,_trip_id,_request_id,_action,_payload)
$function$;
revoke all on function public.driver_update_trip_cargo_v1(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.driver_update_trip_cargo_v1(uuid,uuid,uuid,text,jsonb) to authenticated;

create or replace function private.review_trip_cargo_divergence(_tenant_id uuid,_divergence_id uuid,_status text,_reason text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_row public.trip_cargo_divergences%rowtype;v_trip uuid;v_control_status text;
begin
  if _status not in('approved','rejected','resolved') or length(btrim(coalesce(_reason,'')))<5 then
    raise exception 'trip_cargo_review_invalid' using errcode='22023';end if;
  select divergence.* into v_row from public.trip_cargo_divergences divergence where divergence.id=_divergence_id and divergence.tenant_id=_tenant_id for update;
  if not found then raise exception 'trip_cargo_divergence_not_found' using errcode='P0002';end if;
  select dispatch_trip_id into v_trip from public.trip_cargo_controls where id=v_row.control_id;
  perform private.require_trip_cargo_actor(_tenant_id,v_trip,true);
  update public.trip_cargo_divergences set status=_status,review_reason=btrim(_reason),reviewed_at=clock_timestamp(),
    reviewed_by=auth.uid(),updated_at=clock_timestamp() where id=v_row.id returning * into v_row;
  if not exists(select 1 from public.trip_cargo_divergences where control_id=v_row.control_id and status in('pending','rejected'))
    and not exists(select 1 from public.trip_cargo_load_checks where control_id=v_row.control_id and confirmed_at is null)
    and not exists(select 1 from public.trip_cargo_document_checks where control_id=v_row.control_id and not driver_confirmed) then
    update public.trip_cargo_controls set status='ready_to_depart',updated_at=clock_timestamp()
      where id=v_row.control_id and status='loading' returning status into v_control_status;
  end if;
  perform public._log_entity_audit(_tenant_id,'trip_cargo_divergence',v_row.id,'review',null,to_jsonb(v_row),'operational');
  return jsonb_build_object('version',1,'confirmed',true,'id',v_row.id,'status',v_row.status,
    'control_status',coalesce(v_control_status,(select status from public.trip_cargo_controls where id=v_row.control_id)),'updated_at',v_row.updated_at);
end;$function$;
revoke all on function private.review_trip_cargo_divergence(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function private.review_trip_cargo_divergence(uuid,uuid,text,text) to authenticated;

create or replace function public.review_trip_cargo_divergence_v1(_tenant_id uuid,_divergence_id uuid,_status text,_reason text)
returns jsonb language sql security invoker set search_path='' set row_security='on' as $function$
  select private.review_trip_cargo_divergence(_tenant_id,_divergence_id,_status,_reason)
$function$;
revoke all on function public.review_trip_cargo_divergence_v1(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.review_trip_cargo_divergence_v1(uuid,uuid,text,text) to authenticated;

create or replace function private.close_trip_cargo(_tenant_id uuid,_trip_id uuid,_override_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_trip public.dispatch_trips%rowtype;v_control public.trip_cargo_controls%rowtype;v_role text;v_pending bigint;v_missing bigint;v_override boolean;
begin
  v_trip:=private.require_trip_cargo_actor(_tenant_id,_trip_id,true);
  select membership.role into v_role from public.tenant_memberships membership where membership.tenant_id=_tenant_id
    and membership.user_id=auth.uid() and membership.active;
  select * into v_control from public.trip_cargo_controls where tenant_id=_tenant_id and dispatch_trip_id=_trip_id for update;
  if not found or v_control.status not in('returned','closed') then raise exception 'trip_cargo_return_required' using errcode='23514';end if;
  if v_control.status='closed' then return jsonb_build_object('version',1,'confirmed',true,'trip_id',_trip_id,'control_id',v_control.id,'status','closed','changed',false);end if;
  if exists(select 1 from public.trip_cargo_divergences where control_id=v_control.id and status in('pending','rejected')) then
    raise exception 'trip_cargo_divergences_pending' using errcode='23514';end if;
  select count(*) into v_pending from public.delivery_receipts receipt where receipt.tenant_id=_tenant_id
    and receipt.dispatch_trip_id=_trip_id and receipt.is_active and receipt.physical_status<>'received';
  select count(*) into v_missing from public.dispatch_stops stop where stop.tenant_id=_tenant_id and stop.dispatch_trip_id=_trip_id
    and stop.status in('delivered','partial_delivery') and not exists(select 1 from public.delivery_receipts receipt
      where receipt.tenant_id=_tenant_id and receipt.dispatch_stop_id=stop.id and receipt.is_active);
  v_override:=v_pending+v_missing>0;
  if v_override and (v_role not in('owner','admin') or length(btrim(coalesce(_override_reason,'')))<10) then
    raise exception 'trip_cargo_physical_receipts_pending' using errcode='23514',detail=jsonb_build_object('pending',v_pending,'missing',v_missing)::text;
  end if;
  update public.trip_cargo_controls set status='closed',closed_at=clock_timestamp(),closed_by=auth.uid(),
    close_override_reason=case when v_override then btrim(_override_reason) else null end,updated_at=clock_timestamp()
    where id=v_control.id returning * into v_control;
  perform public._log_entity_audit(_tenant_id,'trip_cargo_control',v_control.id,
    case when v_override then 'supervisor_close_override' else 'close_after_physical_reconciliation' end,
    null,jsonb_build_object('pending_receipts',v_pending,'missing_receipts',v_missing,'reason',v_control.close_override_reason),'operational');
  return jsonb_build_object('version',1,'confirmed',true,'trip_id',_trip_id,'control_id',v_control.id,'status','closed',
    'changed',true,'override',v_override,'pending_receipts',v_pending,'missing_receipts',v_missing,'updated_at',v_control.updated_at);
end;$function$;
revoke all on function private.close_trip_cargo(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.close_trip_cargo(uuid,uuid,text) to authenticated;

create or replace function public.close_trip_cargo_v1(_tenant_id uuid,_trip_id uuid,_override_reason text default null)
returns jsonb language sql security invoker set search_path='' set row_security='on' as $function$
  select private.close_trip_cargo(_tenant_id,_trip_id,_override_reason)
$function$;
revoke all on function public.close_trip_cargo_v1(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.close_trip_cargo_v1(uuid,uuid,text) to authenticated;

create or replace function private.require_trip_cargo_before_departure()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if new.status in('in_transit','in_progress') and old.status not in('in_transit','in_progress')
    and not exists(select 1 from public.trip_cargo_controls control where control.tenant_id=new.tenant_id
      and control.dispatch_trip_id=new.id and control.driver_id=new.driver_id and control.vehicle_id=new.vehicle_id
      and control.status='departed') then
    raise exception 'trip_cargo_departure_confirmation_required' using errcode='23514';
  end if;
  return new;
end;$function$;
revoke all on function private.require_trip_cargo_before_departure() from public,anon,authenticated,service_role;
create trigger dispatch_trip_requires_cargo_custody before update of status on public.dispatch_trips
  for each row execute function private.require_trip_cargo_before_departure();

comment on table public.trip_cargo_controls is 'One auditable physical cargo custody dossier per dispatch trip.';
comment on table public.trip_cargo_document_checks is 'Driver conference of NF-e, NFS-e, CT-e and operational references without CT-e ownership assumptions.';
comment on function public.close_trip_cargo_v1(uuid,uuid,text) is 'Closes returned cargo custody only after physical canhoto reconciliation; owner/admin exception requires an audited reason.';
