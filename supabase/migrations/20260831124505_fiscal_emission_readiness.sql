-- Durable fiscal preparation and dispatch. Apply with fiscal traffic contained.
alter table public.hub_fiscal_emissions add column dispatch_key text;
alter table public.hub_fiscal_emissions add column dispatch_state text not null default 'legacy'
 check(dispatch_state in('legacy','in_flight','uncertain','recorded'));
create index hub_emission_dispatch_lookup on public.hub_fiscal_emissions(tenant_id,dispatch_key,created_at desc);
create table public.fiscal_source_reservations(
 tenant_id uuid not null references public.tenants(id), environment text not null check(environment in('sandbox','homologation','production')),
 source_id uuid not null references public.fiscal_documents(id), outbound_id uuid references public.fiscal_documents(id), nfse_id uuid references public.nfse_documents(id),
 check(num_nonnulls(outbound_id,nfse_id)=1),
 primary key(tenant_id,environment,source_id)
);
alter table public.fiscal_source_reservations enable row level security;
revoke all on public.fiscal_source_reservations from public,anon,authenticated;
grant select on public.fiscal_source_reservations to authenticated;
grant all on public.fiscal_source_reservations to service_role;
create policy fiscal_reservation_service on public.fiscal_source_reservations for all to service_role using(true) with check(true);
create policy fiscal_reservation_operator on public.fiscal_source_reservations for select to authenticated
 using(public.is_tenant_operator_or_admin(tenant_id));

create function public.prepare_cte_issue(_tenant_id uuid,_emitter_id uuid,_environment text,_source_ids uuid[],_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare ids uuid[]; source uuid; previous uuid; existing_ids uuid[]; d public.fiscal_documents%rowtype; v public.fiscal_documents%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||_tenant_id::text,0));
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'fiscal_not_authorized' using errcode='42501';end if;
 if _environment is null or _environment not in('sandbox','homologation','production') then raise exception 'fiscal_environment_required';end if;
 if not exists(select 1 from public.tenant_emitters where id=_emitter_id and tenant_id=_tenant_id and active) then raise exception 'fiscal_emitter_invalid';end if;
 select array_agg(distinct x order by x) into ids from unnest(_source_ids) x;
 if cardinality(ids) is null or cardinality(ids) not between 1 and 500 or array_position(ids,null) is not null then raise exception 'fiscal_sources_required';end if;
 if jsonb_typeof(_snapshot) is distinct from 'object' or octet_length(_snapshot::text)>1000000
  or _snapshot->'cte_payload'->>'environment' is distinct from _environment then raise exception 'fiscal_snapshot_invalid';end if;
 -- Sorted row locks also serialize overlapping groups and membership revocation.
 perform 1 from public.tenant_memberships where tenant_id=_tenant_id and user_id=auth.uid() and active and role in('owner','admin','operator') for share;
 if not found then raise exception 'fiscal_not_authorized' using errcode='42501';end if;
 foreach source in array ids loop
  perform 1 from public.fiscal_documents where id=source and tenant_id=_tenant_id and document_type='inbound' and deleted_at is null for update;
  if not found then raise exception 'fiscal_source_invalid';end if;
 end loop;
 if exists(select 1 from public.fiscal_source_reservations where tenant_id=_tenant_id and environment=_environment and source_id=any(ids) and nfse_id is not null) then raise exception 'fiscal_sources_reserved';end if;
 select array_agg(distinct outbound_id) into existing_ids from public.fiscal_source_reservations where tenant_id=_tenant_id and environment=_environment and source_id=any(ids);
 if cardinality(existing_ids)>1 then raise exception 'fiscal_sources_reserved';end if;
 previous:=existing_ids[1];
 if previous is not null then
  select * into d from public.fiscal_documents where id=previous and tenant_id=_tenant_id for update;
  if (select array_agg(source_id order by source_id) from public.fiscal_source_reservations where outbound_id=previous and environment=_environment) is distinct from ids
   or d.emitter_id is distinct from _emitter_id then raise exception 'fiscal_sources_reserved';end if;
  -- Only a provider-confirmed rejection permits a corrected new operation.
  if not exists(select 1 from public.hub_fiscal_emissions where fiscal_document_id=d.id and tenant_id=_tenant_id
    and status in('rejected','rejeitado','cancelled') and hub_document_id is not null and dispatch_state='recorded') then
   if d.cte_payload is distinct from _snapshot->'cte_payload' or d.client_id is distinct from (_snapshot->>'client_id')::uuid or d.freight_value is distinct from (_snapshot->>'freight_value')::numeric then
    raise exception 'fiscal_snapshot_changed_reconcile_first';
   end if;
   return to_jsonb(d)||jsonb_build_object('recovered',true);
  end if;
  delete from public.fiscal_source_reservations where outbound_id=previous;
 end if;
 if exists(select 1 from public.fiscal_documents where id=any(ids) and (nfse_emitted_at is not null
    or (cte_emitted_outbound_id is not null and cte_emitted_outbound_id is distinct from previous))) then raise exception 'fiscal_source_already_issued';end if;
 v:=jsonb_populate_record(null::public.fiscal_documents,_snapshot);
 if v.client_id is not null and not exists(select 1 from public.clients where id=v.client_id and tenant_id=_tenant_id) then raise exception 'fiscal_client_invalid';end if;
 if v.freight_value is null or v.freight_value<=0 then raise exception 'fiscal_amount_invalid';end if;
 insert into public.fiscal_documents(tenant_id,created_by,document_type,invoice_number,client_id,remitter,remitter_cnpj,recipient,recipient_cnpj,
  recipient_city,recipient_state,pallet_count,weight_kg,value,freight_value,freight_value_original,product_summary,status,issue_date,
  cbs_base,cbs_rate,cbs_value,ibs_base,ibs_rate,ibs_value,emitter_id,cte_payload,cte_taker_role,cte_driver_id,cte_vehicle_id,cte_consignee_client_id,
  insurer_name,insurer_cnpj,insurer_policy,insurer_endorsement,insured_amount,insurance_premium)
 values(_tenant_id,auth.uid(),'outbound','PENDENTE',v.client_id,v.remitter,v.remitter_cnpj,v.recipient,v.recipient_cnpj,
  v.recipient_city,v.recipient_state,coalesce(v.pallet_count,0),coalesce(v.weight_kg,0),v.freight_value,v.freight_value,v.freight_value,
  v.product_summary,'transmitting',current_date,v.cbs_base,v.cbs_rate,v.cbs_value,v.ibs_base,v.ibs_rate,v.ibs_value,_emitter_id,
  v.cte_payload,v.cte_taker_role,v.cte_driver_id,v.cte_vehicle_id,v.cte_consignee_client_id,
  v.insurer_name,v.insurer_cnpj,v.insurer_policy,v.insurer_endorsement,v.insured_amount,v.insurance_premium) returning * into d;
 update public.fiscal_documents set invoice_number='agvlog-cte-'||d.id where id=d.id returning * into d;
 insert into public.fiscal_source_reservations(tenant_id,environment,source_id,outbound_id) select _tenant_id,_environment,x,d.id from unnest(ids) x;
 return to_jsonb(d)||jsonb_build_object('recovered',false);
end;$fn$;
revoke all on function public.prepare_cte_issue(uuid,uuid,text,uuid[],jsonb) from public,anon,service_role;
grant execute on function public.prepare_cte_issue(uuid,uuid,text,uuid[],jsonb) to authenticated;

-- Service-only: the Edge has authenticated the actor; the DB rechecks tenant/resource ownership.
create function public.claim_hub_fiscal_emission(_tenant uuid,_actor uuid,_emitter uuid,_type text,_environment text,_body jsonb,
 _fiscal_id uuid default null,_cte_id uuid default null,_nfse_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare k text; e public.hub_fiscal_emissions%rowtype; eid uuid:=gen_random_uuid(); request jsonb; local_id uuid; scoped_cnpj text; source uuid; source_ids uuid[];
begin
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||_tenant::text,0));
 if _environment is null or _environment not in('sandbox','homologation','production') or _type not in('cte','nfse','mdfe','nfe','nfce','nfcom') then raise exception 'fiscal_environment_or_type_invalid';end if;
 perform 1 from public.tenant_memberships where tenant_id=_tenant and user_id=_actor and active and role in('owner','admin','operator') for share;
 if not found then raise exception 'fiscal_not_authorized' using errcode='42501';end if;
 select regexp_replace(cnpj,'[^0-9]','','g') into scoped_cnpj from public.tenant_emitters where tenant_id=_tenant and id=_emitter and active;
 if scoped_cnpj is null or scoped_cnpj is distinct from regexp_replace(_body->>'emitterCnpj','[^0-9]','','g') then raise exception 'fiscal_emitter_invalid';end if;
 if num_nonnulls(_fiscal_id,_cte_id,_nfse_id)>1 then raise exception 'fiscal_link_ambiguous';end if;
 if _fiscal_id is not null and not exists(select 1 from public.fiscal_documents where tenant_id=_tenant and id=_fiscal_id and emitter_id=_emitter and document_type='outbound' and deleted_at is null) then raise exception 'fiscal_document_invalid';end if;
 if _cte_id is not null and (_type<>'cte' or not exists(select 1 from public.cte_documents where tenant_id=_tenant and id=_cte_id and emitter_id=_emitter)) then raise exception 'fiscal_document_invalid';end if;
 if _nfse_id is not null and (_type<>'nfse' or not exists(select 1 from public.nfse_documents where tenant_id=_tenant and id=_nfse_id and emitter_id=_emitter and not cancelled and not is_preview)) then raise exception 'fiscal_document_invalid';end if;
 local_id:=coalesce(_fiscal_id,_cte_id,_nfse_id);
 k:=_type||':'||_environment||':'||_emitter||':'||coalesce(local_id::text,nullif(_body->>'externalId',''),nullif(_body->>'idIntegracao',''));
 if k is null or length(k)>500 then raise exception 'fiscal_identity_required';end if;
 perform pg_advisory_xact_lock(hashtextextended(_tenant::text||k,0));
 select * into e from public.hub_fiscal_emissions where tenant_id=_tenant and
  (dispatch_key=k or (local_id is not null and (fiscal_document_id=_fiscal_id or cte_document_id=_cte_id or nfse_document_id=_nfse_id)))
  order by created_at desc,id desc limit 1 for update;
 if found then
  if e.environment is distinct from _environment or e.emitter_id is distinct from _emitter or e.doc_type is distinct from _type then raise exception 'fiscal_existing_environment_mismatch';end if;
  -- Definitive rejected + changed payload allows correction. An unknown/error result never does.
  if not(e.status in('rejected','rejeitado') and e.hub_document_id is not null and e.dispatch_state='recorded'
    and ((e.request_payload->'payload')-'idIntegracao') is distinct from ((_body->'payload')-'idIntegracao')) then
   return jsonb_build_object('dispatch',false,'emission',to_jsonb(e));
  end if;
 end if;
 if _type='cte' and _fiscal_id is not null and not exists(select 1 from public.fiscal_source_reservations where tenant_id=_tenant and outbound_id=_fiscal_id and environment=_environment) then raise exception 'fiscal_preparation_required';end if;
 if _nfse_id is not null then
  select array(select distinct x from unnest(fiscal_document_ids) x order by x) into source_ids from public.nfse_documents where id=_nfse_id and tenant_id=_tenant for update;
  if cardinality(source_ids)>500 then raise exception 'fiscal_too_many_sources';end if;
  foreach source in array coalesce(source_ids,'{}'::uuid[]) loop
   perform 1 from public.fiscal_documents where tenant_id=_tenant and id=source and document_type='inbound' and deleted_at is null for update;
   if not found then raise exception 'fiscal_source_invalid';end if;
   if exists(select 1 from public.fiscal_source_reservations where tenant_id=_tenant and environment=_environment and source_id=source and nfse_id is distinct from _nfse_id) then raise exception 'fiscal_sources_reserved';end if;
   if exists(select 1 from public.fiscal_documents where id=source and (cte_emitted_at is not null or (nfse_emitted_document_id is not null and nfse_emitted_document_id<>_nfse_id))) then raise exception 'fiscal_source_already_issued';end if;
   insert into public.fiscal_source_reservations(tenant_id,environment,source_id,nfse_id) values(_tenant,_environment,source,_nfse_id) on conflict do nothing;
  end loop;
 end if;
 request:=_body||jsonb_build_object('externalId','agvlog-'||eid,'idIntegracao','agvlog-'||eid);
 request:=jsonb_set(request,'{payload}',coalesce(request->'payload','{}')||jsonb_build_object('idIntegracao','agvlog-'||eid));
 if _type='nfse' then request:=jsonb_set(request,'{payload,ambiente}',to_jsonb(case when _environment='production' then 'producao' else 'homologacao' end));end if;
 insert into public.hub_fiscal_emissions(id,tenant_id,emitter_id,doc_type,environment,emitter_cnpj,external_id,id_integracao,status,
  dispatch_key,dispatch_state,fiscal_document_id,cte_document_id,nfse_document_id,request_payload,created_by,created_at)
 values(eid,_tenant,_emitter,_type,_environment,scoped_cnpj,'agvlog-'||eid,'agvlog-'||eid,'pending',k,'in_flight',_fiscal_id,_cte_id,_nfse_id,request,_actor,clock_timestamp())
 returning * into e;
 if _nfse_id is not null then update public.nfse_documents set status='submitted',provider='hub_fiscal' where id=_nfse_id and tenant_id=_tenant;end if;
 return jsonb_build_object('dispatch',true,'emission',to_jsonb(e));
end;$fn$;
revoke all on function public.claim_hub_fiscal_emission(uuid,uuid,uuid,text,text,jsonb,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_hub_fiscal_emission(uuid,uuid,uuid,text,text,jsonb,uuid,uuid,uuid) to service_role;

-- A failed transaction preserves the intent. Replaying never submits another document.
create function public.complete_hub_fiscal_emission(_tenant uuid,_emission uuid,_response jsonb,_http_status integer)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare e public.hub_fiscal_emissions%rowtype; d jsonb; s text; local_status text;
begin
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||_tenant::text,0));
 select * into e from public.hub_fiscal_emissions where tenant_id=_tenant and id=_emission for update;
 if not found then raise exception 'fiscal_emission_not_found';end if;
 d:=coalesce(_response->'document','{}');
 s:=lower(coalesce(d->>'status',d->>'plugnotasStatus',''));
 s:=case when s in('authorized','autorizado','issued','concluido') then 'authorized' when s in('rejected','rejeitado') then 'rejected'
  when s in('cancelled','canceled','cancelado') then 'cancelled' else 'processing' end;
 if e.hub_document_id is not null and nullif(d->>'id','') is not null and e.hub_document_id is distinct from d->>'id' then raise exception 'fiscal_provider_identity_mismatch';end if;
 if _http_status>=400 or nullif(d->>'id','') is null or _response->>'success'='false' or (_response->'error' is not null and _response->'error'<>'null'::jsonb) then
  update public.hub_fiscal_emissions set dispatch_state='uncertain',last_response=_response,updated_at=clock_timestamp() where id=e.id;
  return jsonb_build_object('confirmed',false,'emission_id',e.id);
 end if;
 -- Late HTTP responses must not overwrite a terminal callback.
 if e.status='cancelled' or (e.status='authorized' and s<>'cancelled') or (e.status='rejected' and s='processing') then s:=e.status;end if;
 update public.hub_fiscal_emissions set dispatch_state='recorded',hub_document_id=d->>'id',status=s,
  access_key=coalesce(nullif(d->>'accessKey',''),access_key),authorization_protocol=coalesce(d->>'authorizationProtocol',d->>'plugnotasProtocol',authorization_protocol),
  plugnotas_id=coalesce(d->>'plugnotasId',plugnotas_id),c_stat=case when d->>'cStat' ~ '^[0-9]{1,6}$' then (d->>'cStat')::integer else c_stat end,
  number=coalesce(d->>'number',number),series=coalesce(d->>'series',series),message=coalesce(d->>'message',message),
  pdf_url=coalesce(d->>'pdfUrl',pdf_url),xml_url=coalesce(d->>'xmlUrl',xml_url),last_response=_response,updated_at=clock_timestamp()
 where id=e.id returning * into e;
 local_status:=case s when 'authorized' then 'authorized' when 'rejected' then 'rejected' when 'cancelled' then 'cancelled' else 'transmitting' end;
 if e.fiscal_document_id is not null then
  update public.fiscal_documents set hub_document_id=e.hub_document_id,emission_id=e.id,status=local_status,sefaz_status=s,
   access_key=coalesce(e.access_key,access_key),sefaz_protocol=coalesce(e.authorization_protocol,sefaz_protocol),sefaz_message=e.message
   where tenant_id=_tenant and id=e.fiscal_document_id;
  if not found then raise exception 'fiscal_mirror_missing';end if;
  -- Homologation has reservations, but must not consume production source flags.
  if e.doc_type='cte' and e.environment='production' then
   update public.fiscal_documents set cte_emitted_at=case when s in('rejected','cancelled') then null else clock_timestamp() end,
    cte_emitted_outbound_id=case when s in('rejected','cancelled') then null else e.fiscal_document_id end
   where tenant_id=_tenant and id in(select source_id from public.fiscal_source_reservations where tenant_id=_tenant and environment=e.environment and outbound_id=e.fiscal_document_id);
  end if;
 end if;
 if e.cte_document_id is not null then
  update public.cte_documents set status=local_status,sefaz_status=s,sefaz_environment=e.environment,access_key=e.access_key,
   protocol_number=e.authorization_protocol,cte_number=e.number,cte_series=e.series,pdf_url=e.pdf_url,xml_url=e.xml_url
   where tenant_id=_tenant and id=e.cte_document_id;
  if not found then raise exception 'fiscal_mirror_missing';end if;
 end if;
 if e.nfse_document_id is not null then
  update public.nfse_documents set status=case when s='authorized' then 'issued' when s='processing' then 'submitted' else s end,
   cancelled=(s='cancelled'),cancellation_date=case when s='cancelled' then coalesce(cancellation_date,clock_timestamp()) else cancellation_date end,
   provider='hub_fiscal',protocol_number=e.authorization_protocol,nfse_number=e.number,verification_code=e.access_key,
   pdf_url=e.pdf_url,xml_url=e.xml_url,authorization_date=case when s='authorized' then coalesce(authorization_date,clock_timestamp()) else authorization_date end,
   rejection_messages=case when s='rejected' then jsonb_build_object('message',e.message) else null end
   where tenant_id=_tenant and id=e.nfse_document_id;
  if not found then raise exception 'fiscal_mirror_missing';end if;
  if e.environment='production' then
   update public.fiscal_documents set nfse_emitted_at=case when s in('rejected','cancelled') then null else clock_timestamp() end,
    nfse_emitted_document_id=case when s in('rejected','cancelled') then null else e.nfse_document_id end
   where tenant_id=_tenant and id in(select source_id from public.fiscal_source_reservations where tenant_id=_tenant and environment=e.environment and nfse_id=e.nfse_document_id);
  end if;
  if s in('rejected','cancelled') then delete from public.fiscal_source_reservations where tenant_id=_tenant and nfse_id=e.nfse_document_id;end if;
 end if;
 return jsonb_build_object('confirmed',true,'emission_id',e.id,'status',s);
end;$fn$;
revoke all on function public.complete_hub_fiscal_emission(uuid,uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.complete_hub_fiscal_emission(uuid,uuid,jsonb,integer) to service_role;


-- Keep the CT-e Hub and financial CT-e catalog connected, including polling/webhook updates.
create function public.mirror_hub_cte_for_billing() returns trigger language plpgsql security definer set search_path='' as $fn$
declare e public.hub_fiscal_emissions%rowtype; ids uuid[]; cargo numeric; v_status text;
begin
 if new.document_type<>'outbound' then return new;end if;
 select * into e from public.hub_fiscal_emissions where tenant_id=new.tenant_id and fiscal_document_id=new.id and doc_type='cte'
  order by created_at desc,id desc limit 1;
 if not found then return new;end if;
 select array_agg(source_id order by source_id) into ids from public.fiscal_source_reservations where tenant_id=new.tenant_id and outbound_id=new.id and environment=e.environment;
 if cardinality(ids) is null then return new;end if;
 v_status:=case when new.status in('authorized','confirmed') then 'authorized' when new.status in('cancelled','rejected') then new.status else 'transmitting' end;
 if v_status='authorized' and e.status='authorized' then
  select coalesce(sum(value),0) into cargo from public.fiscal_documents where tenant_id=new.tenant_id and id=any(ids);
  insert into public.cte_batches(id,tenant_id,client_id,grouping_mode,grouping_mode_label,source_type,fiscal_document_ids,
   total_documents,total_value,total_freight,status,created_by,emitter_id)
  values(new.id,new.tenant_id,new.client_id,1,'CT-e Hub','fiscal_documents',ids,cardinality(ids),cargo,new.freight_value,'issued',new.created_by,new.emitter_id)
  on conflict(id) do nothing;
  insert into public.cte_documents(id,tenant_id,batch_id,client_id,cte_number,cte_series,remitter,recipient,recipient_city,recipient_state,
   fiscal_document_ids,invoice_count,pallet_count,weight_kg,cargo_value,freight_value,net_value,status,sefaz_status,sefaz_environment,issued_at,
   access_key,protocol_number,emitter_id,created_by,pdf_url,xml_url)
  values(new.id,new.tenant_id,new.id,new.client_id,e.number,e.series,new.remitter,new.recipient,new.recipient_city,new.recipient_state,
   ids,cardinality(ids),coalesce(new.pallet_count,0),coalesce(new.weight_kg,0),cargo,new.freight_value,new.freight_value,
   'authorized','authorized',e.environment,clock_timestamp(),e.access_key,e.authorization_protocol,new.emitter_id,new.created_by,e.pdf_url,e.xml_url)
  on conflict(id) do nothing;
 end if;
 update public.cte_documents set status=v_status,sefaz_status=v_status,sefaz_environment=e.environment,
  access_key=coalesce(e.access_key,access_key),protocol_number=coalesce(e.authorization_protocol,protocol_number),
  cte_number=coalesce(e.number,cte_number),pdf_url=coalesce(e.pdf_url,pdf_url),xml_url=coalesce(e.xml_url,xml_url),
  cancelled_at=case when v_status='cancelled' then coalesce(cancelled_at,clock_timestamp()) else cancelled_at end
 where tenant_id=new.tenant_id and id=new.id;
 return new;
end;$fn$;
revoke all on function public.mirror_hub_cte_for_billing() from public,anon,authenticated,service_role;
create trigger mirror_hub_cte_for_billing after update of status,access_key,sefaz_status on public.fiscal_documents
 for each row execute function public.mirror_hub_cte_for_billing();

-- Fiscal proof comes from the service-owned emission ledger, never from editable browser flags.
revoke insert,update,delete on public.hub_fiscal_emissions from authenticated,anon;
create function public.fiscal_source_is_billable(_tenant uuid,_type text,_id uuid) returns boolean
 language sql stable security invoker set search_path='' as $fn$
 select coalesce(
 case when _type='cte_document' then
  exists(select 1 from public.cte_documents d where d.tenant_id=_tenant and d.id=_id and d.status='authorized'
   and d.cancelled_at is null and not d.is_voided and d.sefaz_environment='production')
 when _type='nfse_document' then
  exists(select 1 from public.nfse_documents d where d.tenant_id=_tenant and d.id=_id and d.status='issued' and not d.cancelled and not d.is_preview)
 else false end
 and (select e.environment='production' and e.status='authorized' and e.hub_document_id is not null
  from public.hub_fiscal_emissions e where e.tenant_id=_tenant and
   ((_type='cte_document' and e.doc_type='cte' and (e.cte_document_id=_id or e.fiscal_document_id=_id))
    or (_type='nfse_document' and e.doc_type='nfse' and e.nfse_document_id=_id))
  order by e.created_at desc,e.id desc limit 1),false);
$fn$;
revoke all on function public.fiscal_source_is_billable(uuid,text,uuid) from public,anon,authenticated,service_role;

create function public.filter_billable_fiscal_sources(_tenant uuid,_type text,_ids uuid[]) returns uuid[]
 language plpgsql stable security definer set search_path='' as $fn$
begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant),false) then raise exception 'fiscal_not_authorized' using errcode='42501';end if;
 if coalesce(cardinality(_ids),0)>500 or _type not in('cte_document','nfse_document') then raise exception 'fiscal_source_filter_invalid';end if;
 return array(select distinct id from unnest(_ids) id where public.fiscal_source_is_billable(_tenant,_type,id));
end;$fn$;
revoke all on function public.filter_billable_fiscal_sources(uuid,text,uuid[]) from public,anon,service_role;
grant execute on function public.filter_billable_fiscal_sources(uuid,text,uuid[]) to authenticated;

create function public.guard_nfse_dispatched_document() returns trigger language plpgsql security invoker set search_path='' as $fn$
declare final_status text;
begin
 if current_user not in('authenticated','anon') then return coalesce(new,old);end if;
 select status into final_status from public.hub_fiscal_emissions where tenant_id=old.tenant_id and nfse_document_id=old.id order by created_at desc,id desc limit 1;
 if found and final_status not in('rejected','rejeitado') then raise exception 'fiscal_document_locked_until_reconciled' using errcode='55000';end if;
 return coalesce(new,old);
end;$fn$;
revoke all on function public.guard_nfse_dispatched_document() from public,anon,authenticated,service_role;
create trigger guard_nfse_dispatched_document before update or delete on public.nfse_documents for each row execute function public.guard_nfse_dispatched_document();
