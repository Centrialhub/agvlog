-- Durable command envelope for multi-source NFS-e emission. The Edge proxy calls
-- this before any provider POST, so all sources are reserved atomically and a
-- retry cannot create a second set of fiscal intentions.
create schema if not exists private;
-- `authenticated` already has explicit USAGE on this shared private schema for
-- driver RLS helpers/readers. Revoking it here would break those existing
-- policies and RPCs. Remove only inherited/public access; the new batch tables
-- remain service-only through their own table ACLs below.
revoke all on schema private from public,anon;
grant usage on schema private to service_role;
grant usage on schema extensions to service_role;
grant execute on function extensions.digest(bytea,text) to service_role;

create table if not exists private.nfse_issue_batches(
  tenant_id uuid not null references public.tenants(id),
  request_id text not null,
  actor_id uuid not null,
  mode text not null check(mode in('individual','unified')),
  environment text not null check(environment in('sandbox','homologation','production')),
  emitter_id uuid not null references public.tenant_emitters(id),
  snapshot_hash bytea not null,
  source_ids uuid[] not null,
  nfse_ids uuid[] not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(tenant_id,request_id),
  check(length(request_id) between 1 and 128),
  check(cardinality(source_ids) between 1 and 500),
  check(cardinality(nfse_ids) between 1 and 100)
);

create table if not exists private.nfse_issue_batch_items(
  tenant_id uuid not null,
  request_id text not null,
  ordinal integer not null check(ordinal between 0 and 99),
  nfse_id uuid not null references public.nfse_documents(id),
  source_ids uuid[] not null check(cardinality(source_ids) between 1 and 500),
  primary key(tenant_id,request_id,ordinal),
  unique(tenant_id,request_id,nfse_id),
  foreign key(tenant_id,request_id) references private.nfse_issue_batches(tenant_id,request_id) on delete cascade
);

create index if not exists nfse_issue_batches_emitter_idx on private.nfse_issue_batches(emitter_id);
create index if not exists nfse_issue_batch_items_nfse_idx on private.nfse_issue_batch_items(nfse_id);

revoke all on private.nfse_issue_batches,private.nfse_issue_batch_items from public,anon,authenticated;
grant select,insert,update on private.nfse_issue_batches to service_role;
grant select,insert on private.nfse_issue_batch_items to service_role;

create or replace function public.prepare_nfse_issue_batch_v1(
  _tenant uuid,
  _actor uuid,
  _request_id text,
  _mode text,
  _environment text,
  _emitter uuid,
  _snapshot jsonb
) returns jsonb
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_hash bytea;
  v_existing private.nfse_issue_batches%rowtype;
  v_entry jsonb;
  v_nfse uuid;
  v_sources uuid[];
  v_all_sources uuid[] := '{}';
  v_nfse_ids uuid[] := '{}';
  v_ordinal integer := 0;
  v_document public.nfse_documents%rowtype;
  v_source uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('fiscal:'||_tenant::text,0));
  if _request_id is null or length(trim(_request_id)) not between 1 and 128
    or _mode not in('individual','unified')
    or _environment not in('sandbox','homologation','production')
    or jsonb_typeof(_snapshot) is distinct from 'object'
    or jsonb_typeof(_snapshot->'entries') is distinct from 'array'
    or jsonb_array_length(_snapshot->'entries') not between 1 and 100
    or octet_length(_snapshot::text)>1000000 then
    raise exception 'nfse_batch_invalid';
  end if;
  if _mode='unified' and jsonb_array_length(_snapshot->'entries')<>1 then
    raise exception 'nfse_batch_unified_requires_one_document';
  end if;
  perform 1 from public.tenant_memberships
   where tenant_id=_tenant and user_id=_actor and active and role in('owner','admin','operator') for share;
  if not found then raise exception 'fiscal_not_authorized' using errcode='42501';end if;
  perform 1 from public.tenant_emitters where tenant_id=_tenant and id=_emitter and active for share;
  if not found then raise exception 'fiscal_emitter_invalid';end if;

  v_hash:=extensions.digest(convert_to(_snapshot::text,'UTF8'),'sha256');
  select * into v_existing from private.nfse_issue_batches
   where tenant_id=_tenant and request_id=trim(_request_id) for update;
  if found then
    if v_existing.snapshot_hash is distinct from v_hash
      or v_existing.actor_id is distinct from _actor
      or v_existing.mode is distinct from _mode
      or v_existing.environment is distinct from _environment
      or v_existing.emitter_id is distinct from _emitter then
      raise exception 'nfse_batch_request_conflict';
    end if;
    return jsonb_build_object('recovered',true,'requestId',v_existing.request_id,'mode',v_existing.mode);
  end if;

  for v_entry in select value from jsonb_array_elements(_snapshot->'entries') loop
    begin v_nfse:=(v_entry->>'nfseDocumentId')::uuid;
    exception when others then raise exception 'nfse_batch_document_invalid';end;
    if v_nfse=any(v_nfse_ids) then raise exception 'nfse_batch_document_duplicate';end if;
    select * into v_document from public.nfse_documents
     where tenant_id=_tenant and id=v_nfse and emitter_id=_emitter and not cancelled and not is_preview for update;
    if not found or v_document.status not in('draft','rejected') then raise exception 'nfse_batch_document_invalid';end if;
    select array_agg(distinct x order by x) into v_sources from unnest(v_document.fiscal_document_ids) x;
    if cardinality(v_sources) is null or cardinality(v_sources)>500
      or (_mode='individual' and cardinality(v_sources)<>1) then
      raise exception 'nfse_batch_source_cardinality_invalid';
    end if;
    if v_all_sources && v_sources then raise exception 'nfse_batch_source_duplicate';end if;
    v_nfse_ids:=array_append(v_nfse_ids,v_nfse);
    v_all_sources:=v_all_sources||v_sources;
    v_ordinal:=v_ordinal+1;
  end loop;
  if cardinality(v_all_sources)>500 then raise exception 'nfse_batch_too_many_sources';end if;

  foreach v_source in array v_all_sources loop
    perform 1 from public.fiscal_documents
     where tenant_id=_tenant and id=v_source and document_type='inbound' and deleted_at is null for update;
    if not found then raise exception 'fiscal_source_invalid';end if;
    if exists(select 1 from public.fiscal_source_reservations
      where tenant_id=_tenant and environment=_environment and source_id=v_source)
      or exists(select 1 from public.fiscal_documents where id=v_source and
        (cte_emitted_at is not null or nfse_emitted_document_id is not null)) then
      raise exception 'fiscal_sources_reserved';
    end if;
  end loop;

  insert into private.nfse_issue_batches(tenant_id,request_id,actor_id,mode,environment,emitter_id,snapshot_hash,source_ids,nfse_ids)
  values(_tenant,trim(_request_id),_actor,_mode,_environment,_emitter,v_hash,v_all_sources,v_nfse_ids);
  v_ordinal:=0;
  for v_entry in select value from jsonb_array_elements(_snapshot->'entries') loop
    v_nfse:=(v_entry->>'nfseDocumentId')::uuid;
    select array_agg(distinct x order by x) into v_sources from unnest(
      (select fiscal_document_ids from public.nfse_documents where tenant_id=_tenant and id=v_nfse)
    ) x;
    insert into private.nfse_issue_batch_items(tenant_id,request_id,ordinal,nfse_id,source_ids)
    values(_tenant,trim(_request_id),v_ordinal,v_nfse,v_sources);
    insert into public.fiscal_source_reservations(tenant_id,environment,source_id,nfse_id)
    select _tenant,_environment,x,v_nfse from unnest(v_sources) x;
    v_ordinal:=v_ordinal+1;
  end loop;
  return jsonb_build_object('recovered',false,'requestId',trim(_request_id),'mode',_mode);
end;$fn$;

revoke all on function public.prepare_nfse_issue_batch_v1(uuid,uuid,text,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_nfse_issue_batch_v1(uuid,uuid,text,text,text,uuid,jsonb) to service_role;
