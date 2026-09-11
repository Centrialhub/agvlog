create table public.dispatch_stop_nfse_documents (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  dispatch_stop_id uuid not null references public.dispatch_stops(id) on delete cascade,
  nfse_document_id uuid not null references public.nfse_documents(id) on delete restrict,
  load_id uuid references public.loads(id) on delete restrict,
  linked_at timestamptz not null default now(),
  linked_by uuid references auth.users(id),
  primary key(tenant_id,dispatch_stop_id,nfse_document_id)
);
alter table public.dispatch_stop_nfse_documents enable row level security;
revoke all on table public.dispatch_stop_nfse_documents from public,anon,authenticated,service_role;
grant select on table public.dispatch_stop_nfse_documents to authenticated;
grant all on table public.dispatch_stop_nfse_documents to service_role;
create policy dispatch_stop_nfse_documents_operator_read on public.dispatch_stop_nfse_documents
for select to authenticated using(public.is_tenant_operator_or_admin(tenant_id));

create or replace function delivery_private.sync_delivery_receipt_nfse_peers_v1(_receipt_id uuid)
returns integer language plpgsql security definer set search_path='' as $function$
declare v_receipt public.delivery_receipts%rowtype;v_nfse record;v_reference uuid;v_count integer:=0;
begin
  select * into v_receipt from public.delivery_receipts where id=_receipt_id and is_active;
  if not found then return 0; end if;
  for v_nfse in
    select distinct nfse.* from public.nfse_documents as nfse
    where nfse.tenant_id=v_receipt.tenant_id and nfse.status in('issued','authorized') and (
      exists(select 1 from public.dispatch_stop_nfse_documents as link
        where link.tenant_id=v_receipt.tenant_id and link.dispatch_stop_id=v_receipt.dispatch_stop_id
          and link.nfse_document_id=nfse.id)
      or (nfse.trip_id=v_receipt.dispatch_trip_id and 1=(select count(*) from public.dispatch_stops as stop
        where stop.tenant_id=v_receipt.tenant_id and stop.dispatch_trip_id=v_receipt.dispatch_trip_id))
      or (nfse.load_id is not null and nfse.load_id in (
          select trip_load.load_id from public.dispatch_trip_loads as trip_load
          where trip_load.tenant_id=v_receipt.tenant_id and trip_load.dispatch_trip_id=v_receipt.dispatch_trip_id
        ) and 1=(select count(distinct stop.id) from public.dispatch_stops as stop
          where stop.tenant_id=v_receipt.tenant_id and stop.dispatch_trip_id=v_receipt.dispatch_trip_id))
    )
  loop
    insert into public.delivery_document_references(tenant_id,document_kind,nfse_document_id,document_number,
      document_series,issue_date,issuer_name,issuer_tax_id,recipient_name,source_snapshot)
    values(v_receipt.tenant_id,'nfse',v_nfse.id,coalesce(v_nfse.nfse_number,v_nfse.rps_number,v_nfse.invoice_number),
      v_nfse.series,v_nfse.issue_date,v_nfse.pagador_nome,v_nfse.pagador_cnpj,v_nfse.cliente_nome,
      jsonb_build_object('source','nfse_documents','id',v_nfse.id,'status',v_nfse.status,
        'load_id',v_nfse.load_id,'trip_id',v_nfse.trip_id,'direct_stop_link',exists(select 1
          from public.dispatch_stop_nfse_documents as link where link.tenant_id=v_receipt.tenant_id
            and link.dispatch_stop_id=v_receipt.dispatch_stop_id and link.nfse_document_id=v_nfse.id)))
    on conflict(tenant_id,nfse_document_id) do update set document_number=excluded.document_number,
      document_series=excluded.document_series,issue_date=excluded.issue_date,issuer_name=excluded.issuer_name,
      issuer_tax_id=excluded.issuer_tax_id,recipient_name=excluded.recipient_name,
      source_snapshot=excluded.source_snapshot,updated_at=clock_timestamp()
    returning id into v_reference;
    insert into public.delivery_receipt_documents(receipt_id,document_reference_id,tenant_id,document_snapshot)
    values(v_receipt.id,v_reference,v_receipt.tenant_id,jsonb_build_object('kind','nfse',
      'number',coalesce(v_nfse.nfse_number,v_nfse.rps_number,v_nfse.invoice_number),'series',v_nfse.series,
      'issue_date',v_nfse.issue_date,'issuer_name',v_nfse.pagador_nome,'issuer_tax_id',v_nfse.pagador_cnpj,
      'recipient_name',v_nfse.cliente_nome)) on conflict do nothing;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;$function$;
revoke all on function delivery_private.sync_delivery_receipt_nfse_peers_v1(uuid) from public,anon,authenticated,service_role;

create or replace function delivery_private.sync_delivery_receipt_nfse_after_insert_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
begin perform delivery_private.sync_delivery_receipt_nfse_peers_v1(new.id);return new;end;$function$;
revoke all on function delivery_private.sync_delivery_receipt_nfse_after_insert_v1() from public,anon,authenticated,service_role;
create trigger sync_delivery_receipt_nfse_after_insert_v1 after insert on public.delivery_receipts
for each row execute function delivery_private.sync_delivery_receipt_nfse_after_insert_v1();

create or replace function public.link_nfse_to_delivery_stop_v1(_tenant_id uuid,_stop_id uuid,_nfse_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_trip uuid;v_load uuid;v_receipt uuid;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'delivery_nfse_link_access_denied' using errcode='42501';end if;
  select dispatch_trip_id into v_trip from public.dispatch_stops where id=_stop_id and tenant_id=_tenant_id;
  if not found or not exists(select 1 from public.nfse_documents where id=_nfse_id and tenant_id=_tenant_id) then
    raise exception 'delivery_nfse_link_invalid' using errcode='23514';end if;
  select load_id into v_load from public.nfse_documents where id=_nfse_id and tenant_id=_tenant_id;
  insert into public.dispatch_stop_nfse_documents(tenant_id,dispatch_stop_id,nfse_document_id,load_id,linked_by)
    values(_tenant_id,_stop_id,_nfse_id,v_load,auth.uid()) on conflict do nothing;
  select id into v_receipt from public.delivery_receipts where tenant_id=_tenant_id and dispatch_stop_id=_stop_id and is_active;
  if v_receipt is not null then perform delivery_private.sync_delivery_receipt_nfse_peers_v1(v_receipt);end if;
  return jsonb_build_object('version',1,'tenant_id',_tenant_id,'stop_id',_stop_id,'nfse_document_id',_nfse_id,
    'receipt_id',v_receipt,'linked',true);
end;$function$;
revoke all on function public.link_nfse_to_delivery_stop_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.link_nfse_to_delivery_stop_v1(uuid,uuid,uuid) to authenticated;

comment on table public.dispatch_stop_nfse_documents is
  'Explicit many-to-many stop association for NFS-e deliveries; NF-e and CT-e are not required.';
