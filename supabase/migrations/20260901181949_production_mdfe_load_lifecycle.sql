-- Promote the former local load manifest into the durable MDF-e aggregate.
-- Legacy rows remain readable; only rows with external_id participate in the
-- fiscal lifecycle and in the one-MDF-e-per-load invariant.
alter table public.load_manifests
  add column if not exists emitter_id uuid references public.tenant_emitters(id),
  add column if not exists environment text,
  add column if not exists external_id text,
  add column if not exists request_payload jsonb,
  add column if not exists hub_emission_id uuid,
  add column if not exists hub_document_id text,
  add column if not exists access_key text,
  add column if not exists authorization_protocol text,
  add column if not exists document_number text,
  add column if not exists document_series text,
  add column if not exists status_message text,
  add column if not exists pdf_url text,
  add column if not exists xml_url text,
  add column if not exists issued_at timestamptz,
  add column if not exists closure_requested_at timestamptz,
  add column if not exists closure_requested_by uuid,
  add column if not exists closure_dispatch_state text,
  add column if not exists closure_protocol text,
  add column if not exists closed_at timestamptz,
  add column if not exists last_event_response jsonb,
  add column if not exists attempt_count integer not null default 0;

alter table public.hub_fiscal_emissions
  add column if not exists load_manifest_id uuid;

do $ddl$
begin
  if not exists (select 1 from pg_constraint where conname='load_manifests_load_id_fkey') then
    alter table public.load_manifests add constraint load_manifests_load_id_fkey
      foreign key(load_id) references public.loads(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='load_manifests_tenant_id_fkey') then
    alter table public.load_manifests add constraint load_manifests_tenant_id_fkey
      foreign key(tenant_id) references public.tenants(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='load_manifests_hub_emission_id_fkey') then
    alter table public.load_manifests add constraint load_manifests_hub_emission_id_fkey
      foreign key(hub_emission_id) references public.hub_fiscal_emissions(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='hub_fiscal_emissions_load_manifest_id_fkey') then
    alter table public.hub_fiscal_emissions add constraint hub_fiscal_emissions_load_manifest_id_fkey
      foreign key(load_manifest_id) references public.load_manifests(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname='load_manifests_environment_check') then
    alter table public.load_manifests add constraint load_manifests_environment_check
      check(environment is null or environment in('sandbox','homologation','production'));
  end if;
  if not exists (select 1 from pg_constraint where conname='load_manifests_closure_dispatch_state_check') then
    alter table public.load_manifests add constraint load_manifests_closure_dispatch_state_check
      check(closure_dispatch_state is null or closure_dispatch_state in('idle','in_flight','recorded','uncertain'));
  end if;
end$ddl$;

create unique index if not exists load_manifests_one_fiscal_mdfe_per_load
  on public.load_manifests(tenant_id,load_id) where external_id is not null;
create unique index if not exists load_manifests_external_id_unique
  on public.load_manifests(tenant_id,external_id) where external_id is not null;
create index if not exists load_manifests_fiscal_history
  on public.load_manifests(tenant_id,created_at desc) where external_id is not null;
create index if not exists hub_fiscal_emissions_load_manifest
  on public.hub_fiscal_emissions(tenant_id,load_manifest_id,created_at desc)
  where load_manifest_id is not null;

-- A browser cannot create or mutate a fiscal manifest directly. All writes go
-- through the functions below (or the service-role reconciliation path).
revoke insert,update,delete on public.load_manifests from authenticated;
grant select on public.load_manifests to authenticated;

create or replace function public.prepare_mdfe_issue(
  _tenant_id uuid,
  _load_id uuid,
  _emitter_id uuid,
  _environment text,
  _cte_ids uuid[],
  _snapshot jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $fn$
declare
  l public.loads%rowtype;
  m public.load_manifests%rowtype;
  ids uuid[];
  valid_ids uuid[];
  new_id uuid:=gen_random_uuid();
  integration_id text;
  request jsonb;
  driver_doc text;
  vehicle_plate text;
  snapshot_driver text;
  snapshot_plate text;
begin
  if _environment is null or _environment not in('sandbox','homologation','production') then
    raise exception 'fiscal_environment_invalid';
  end if;
  perform 1 from public.tenant_memberships
    where tenant_id=_tenant_id and user_id=auth.uid() and active and role in('owner','admin','operator') for share;
  if not found then raise exception 'fiscal_not_authorized' using errcode='42501';end if;

  perform pg_advisory_xact_lock(hashtextextended('mdfe-load:'||_tenant_id::text||':'||_load_id::text,0));
  select * into l from public.loads where id=_load_id and tenant_id=_tenant_id for update;
  if not found then raise exception 'mdfe_load_invalid';end if;
  if l.status not in('ready','loading','loaded','in_transit') then raise exception 'mdfe_load_not_ready';end if;
  if l.driver_id is null then raise exception 'mdfe_driver_required';end if;
  if l.vehicle_id is null then raise exception 'mdfe_vehicle_required';end if;
  if not exists(select 1 from public.tenant_emitters where id=_emitter_id and tenant_id=_tenant_id and active) then
    raise exception 'fiscal_emitter_invalid';
  end if;

  select array_agg(distinct value order by value) into ids from unnest(coalesce(_cte_ids,'{}'::uuid[])) value;
  if cardinality(ids) is null or cardinality(ids)=0 then raise exception 'mdfe_cte_required';end if;
  if cardinality(ids)>500 then raise exception 'mdfe_too_many_ctes';end if;
  select array_agg(id order by id) into valid_ids
    from public.cte_documents
    where tenant_id=_tenant_id and id=any(ids) and not coalesce(is_voided,false)
      and load_ids @> array[_load_id]::uuid[]
      and lower(coalesce(sefaz_status,status,'')) in('authorized','autorizado')
      and regexp_replace(coalesce(access_key,''),'[^0-9]','','g') ~ '^[0-9]{44}$';
  if valid_ids is distinct from ids then raise exception 'mdfe_cte_not_authorized_for_load';end if;

  if jsonb_typeof(_snapshot)<>'object' or jsonb_typeof(_snapshot->'payload')<>'object' then
    raise exception 'mdfe_snapshot_invalid';
  end if;
  if nullif(_snapshot#>>'{payload,modalidadeDeTransporte}','') is null then raise exception 'mdfe_transport_mode_required';end if;
  if nullif(_snapshot#>>'{payload,produtoPredominante,descricao}','') is null then raise exception 'mdfe_predominant_product_required';end if;

  select regexp_replace(coalesce(cpf,''),'[^0-9]','','g') into driver_doc
    from public.drivers where id=l.driver_id and tenant_id=_tenant_id and active;
  select upper(regexp_replace(coalesce(plate,''),'[^A-Za-z0-9]','','g')) into vehicle_plate
    from public.vehicles where id=l.vehicle_id and tenant_id=_tenant_id and active;
  snapshot_driver:=regexp_replace(coalesce(_snapshot#>>'{payload,infModal,rodo,condutor,0,CPF}',''),'[^0-9]','','g');
  snapshot_plate:=upper(regexp_replace(coalesce(_snapshot#>>'{payload,infModal,rodo,veicTracao,placa}',''),'[^A-Za-z0-9]','','g'));
  if driver_doc is null or length(driver_doc)<>11 or snapshot_driver is distinct from driver_doc then raise exception 'mdfe_driver_snapshot_mismatch';end if;
  if vehicle_plate is null or length(vehicle_plate)<>7 or snapshot_plate is distinct from vehicle_plate then raise exception 'mdfe_vehicle_snapshot_mismatch';end if;

  select * into m from public.load_manifests
    where tenant_id=_tenant_id and load_id=_load_id and external_id is not null
    order by created_at desc,id desc limit 1 for update;

  if found then
    if m.emitter_id is distinct from _emitter_id or m.environment is distinct from _environment then
      raise exception 'mdfe_existing_scope_mismatch';
    end if;
    if m.status in('processing','provider_unknown','authorized','closing','closed') then
      -- idIntegracao is injected by this function after the business snapshot
      -- is validated. Ignore only that technical key during safe recovery.
      if ((m.request_payload->'payload')-'idIntegracao') is distinct from (_snapshot->'payload') then
        raise exception 'mdfe_snapshot_changed_reconcile_first';
      end if;
      return to_jsonb(m)||jsonb_build_object('recovered',true);
    end if;
    integration_id:=m.external_id;
    request:=_snapshot||jsonb_build_object('externalId',integration_id,'idIntegracao',integration_id);
    request:=jsonb_set(request,'{payload}',coalesce(request->'payload','{}'::jsonb)||jsonb_build_object('idIntegracao',integration_id));
    update public.load_manifests set
      request_payload=request,cte_document_ids=ids,status='draft',status_message=null,
      hub_emission_id=null,hub_document_id=null,access_key=null,authorization_protocol=null,
      document_number=null,document_series=null,pdf_url=null,xml_url=null,issued_at=null,
      closure_requested_at=null,closure_requested_by=null,closure_dispatch_state='idle',
      closure_protocol=null,closed_at=null,last_event_response=null,
      attempt_count=attempt_count+1,updated_at=clock_timestamp()
      where id=m.id returning * into m;
    return to_jsonb(m)||jsonb_build_object('recovered',false);
  end if;

  integration_id:='agvlog-mdfe-load-'||new_id::text;
  request:=_snapshot||jsonb_build_object('externalId',integration_id,'idIntegracao',integration_id);
  request:=jsonb_set(request,'{payload}',coalesce(request->'payload','{}'::jsonb)||jsonb_build_object('idIntegracao',integration_id));
  insert into public.load_manifests(
    id,tenant_id,load_id,manifest_number,fiscal_document_ids,cte_document_ids,status,created_by,
    origin,destination,emitter_id,environment,external_id,request_payload,closure_dispatch_state,attempt_count
  ) values(
    new_id,_tenant_id,_load_id,'MDFE-'||l.load_number||'-'||upper(substr(replace(new_id::text,'-',''),1,8)),
    '{}'::uuid[],ids,'draft',auth.uid(),l.origin,l.destination,_emitter_id,_environment,integration_id,request,'idle',1
  ) returning * into m;
  return to_jsonb(m)||jsonb_build_object('recovered',false);
end$fn$;
revoke all on function public.prepare_mdfe_issue(uuid,uuid,uuid,text,uuid[],jsonb) from public,anon,service_role;
grant execute on function public.prepare_mdfe_issue(uuid,uuid,uuid,text,uuid[],jsonb) to authenticated;

-- Service-only wrapper: it binds the generic durable Hub intent to the MDF-e
-- aggregate before the provider response is committed.
create or replace function public.claim_mdfe_fiscal_emission(
  _tenant uuid,_actor uuid,_emitter uuid,_environment text,_body jsonb,_load_manifest_id uuid
) returns jsonb
language plpgsql security invoker set search_path=''
as $fn$
declare m public.load_manifests%rowtype; claim jsonb; eid uuid; e public.hub_fiscal_emissions%rowtype;
begin
  perform 1 from public.tenant_memberships where tenant_id=_tenant and user_id=_actor and active and role in('owner','admin','operator') for share;
  if not found then raise exception 'fiscal_not_authorized' using errcode='42501';end if;
  select * into m from public.load_manifests where id=_load_manifest_id and tenant_id=_tenant and external_id is not null for update;
  if not found then raise exception 'mdfe_manifest_invalid';end if;
  if m.emitter_id is distinct from _emitter or m.environment is distinct from _environment then raise exception 'mdfe_manifest_scope_mismatch';end if;
  if m.request_payload is distinct from _body then raise exception 'mdfe_snapshot_mismatch';end if;
  claim:=public.claim_hub_fiscal_emission(_tenant,_actor,_emitter,'mdfe',_environment,_body,null,null,null);
  eid:=nullif(claim#>>'{emission,id}','')::uuid;
  if eid is null then raise exception 'mdfe_emission_claim_invalid';end if;
  update public.hub_fiscal_emissions set load_manifest_id=m.id where id=eid and tenant_id=_tenant returning * into e;
  if not found then raise exception 'mdfe_emission_link_failed';end if;
  update public.load_manifests set hub_emission_id=e.id,
    status=case when e.status in('authorized') then 'authorized'
      when e.status in('rejected','denied','inutilized') then 'rejected'
      when e.status='cancelled' then 'cancelled'
      when e.dispatch_state='uncertain' then 'provider_unknown' else 'processing' end,
    updated_at=clock_timestamp() where id=m.id;
  return claim;
end$fn$;
revoke all on function public.claim_mdfe_fiscal_emission(uuid,uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.claim_mdfe_fiscal_emission(uuid,uuid,uuid,text,jsonb,uuid) to service_role;

create or replace function public.begin_mdfe_closure(_tenant uuid,_actor uuid,_load_manifest_id uuid)
returns jsonb language plpgsql security invoker set search_path=''
as $fn$
declare m public.load_manifests%rowtype; l public.loads%rowtype;
begin
  perform 1 from public.tenant_memberships where tenant_id=_tenant and user_id=_actor and active and role in('owner','admin','operator') for share;
  if not found then raise exception 'fiscal_not_authorized' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended('mdfe-close:'||_tenant::text||':'||_load_manifest_id::text,0));
  select * into m from public.load_manifests where id=_load_manifest_id and tenant_id=_tenant and external_id is not null for update;
  if not found or m.hub_document_id is null then raise exception 'mdfe_not_authorized';end if;
  select * into l from public.loads where id=m.load_id and tenant_id=_tenant for share;
  if not found then raise exception 'mdfe_load_invalid';end if;
  if l.arrival_at is null and l.status not in('delivered','partial_delivery','returned','refused','failed') then
    raise exception 'mdfe_load_not_returned';
  end if;
  if m.status='closed' then return jsonb_build_object('dispatch',false,'status','closed','manifest',to_jsonb(m));end if;
  if m.status='closing' then return jsonb_build_object('dispatch',false,'status','closing','manifest',to_jsonb(m));end if;
  if m.status<>'authorized' then raise exception 'mdfe_not_authorized';end if;
  update public.load_manifests set status='closing',closure_dispatch_state='in_flight',
    closure_requested_at=clock_timestamp(),closure_requested_by=_actor,updated_at=clock_timestamp()
    where id=m.id returning * into m;
  return jsonb_build_object('dispatch',true,'status','closing','manifest',to_jsonb(m));
end$fn$;
revoke all on function public.begin_mdfe_closure(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_mdfe_closure(uuid,uuid,uuid) to service_role;

create or replace function public.record_mdfe_closure_response(
  _tenant uuid,_load_manifest_id uuid,_response jsonb,_http_status integer
) returns jsonb language plpgsql security invoker set search_path=''
as $fn$
declare m public.load_manifests%rowtype;
begin
  update public.load_manifests set
    last_event_response=_response,
    closure_dispatch_state=case when _http_status<400 then 'recorded' else 'uncertain' end,
    status='closing',updated_at=clock_timestamp()
    where id=_load_manifest_id and tenant_id=_tenant and external_id is not null returning * into m;
  if not found then raise exception 'mdfe_manifest_invalid';end if;
  return to_jsonb(m);
end$fn$;
revoke all on function public.record_mdfe_closure_response(uuid,uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.record_mdfe_closure_response(uuid,uuid,jsonb,integer) to service_role;

-- Mirrors every provider receipt/callback into the load aggregate. Keeping this
-- as a trigger avoids forking the generic fiscal completion function.
create or replace function public.mirror_hub_mdfe_to_load_manifest()
returns trigger language plpgsql security definer set search_path=''
as $fn$
declare d jsonb; fiscal jsonb; is_closed boolean; close_protocol text; mapped text;
begin
  if new.doc_type<>'mdfe' or new.load_manifest_id is null then return new;end if;
  d:=coalesce(new.last_callback->'document',new.last_response->'document','{}'::jsonb);
  fiscal:=coalesce(d#>'{raw_response_json,fiscal}',d->'fiscal',new.last_callback->'fiscal','{}'::jsonb);
  is_closed:=lower(coalesce(d->>'status','')) in('closed','encerrado')
    or lower(coalesce(fiscal->>'closed','false'))='true'
    or (lower(coalesce(new.last_callback#>>'{fiscalEvent,kind}',''))='encerramento'
       and lower(coalesce(new.last_callback#>>'{fiscalEvent,status}','')) in('authorized','concluido','concluído','closed'));
  close_protocol:=coalesce(nullif(fiscal->>'closingProtocol',''),nullif(fiscal->>'protocoloEncerramento',''),
    nullif(new.last_callback#>>'{fiscalEvent,protocol}',''));
  mapped:=case
    when is_closed then 'closed'
    when new.status='authorized' then 'authorized'
    when new.status in('rejected','denied','inutilized') then 'rejected'
    when new.status='cancelled' then 'cancelled'
    when new.status in('provider_unknown','interrupted','error') or new.dispatch_state='uncertain' then 'provider_unknown'
    else 'processing' end;
  update public.load_manifests set
    hub_emission_id=new.id,hub_document_id=coalesce(new.hub_document_id,hub_document_id),
    access_key=coalesce(new.access_key,access_key),authorization_protocol=coalesce(new.authorization_protocol,authorization_protocol),
    document_number=coalesce(new.number,document_number),document_series=coalesce(new.series,document_series),
    status=case when status='closing' and mapped='authorized' then 'closing' else mapped end,
    status_message=coalesce(new.message,status_message),pdf_url=coalesce(new.pdf_url,pdf_url),xml_url=coalesce(new.xml_url,xml_url),
    issued_at=case when mapped in('authorized','closed') then coalesce(issued_at,clock_timestamp()) else issued_at end,
    closure_protocol=coalesce(close_protocol,closure_protocol),
    closed_at=case when is_closed then coalesce(closed_at,clock_timestamp()) else closed_at end,
    closure_dispatch_state=case when is_closed then 'recorded' else closure_dispatch_state end,
    updated_at=clock_timestamp()
    where id=new.load_manifest_id and tenant_id=new.tenant_id;
  return new;
end$fn$;

drop trigger if exists trg_mirror_hub_mdfe_to_load_manifest on public.hub_fiscal_emissions;
create trigger trg_mirror_hub_mdfe_to_load_manifest
after insert or update of load_manifest_id,hub_document_id,status,dispatch_state,access_key,authorization_protocol,number,series,message,pdf_url,xml_url,last_response,last_callback
on public.hub_fiscal_emissions for each row execute function public.mirror_hub_mdfe_to_load_manifest();

revoke all on function public.mirror_hub_mdfe_to_load_manifest() from public,anon,authenticated;
