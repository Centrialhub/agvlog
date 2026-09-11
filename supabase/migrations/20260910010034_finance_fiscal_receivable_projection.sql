alter table public.finance_fiscal_projection_jobs add column result jsonb;
create table public.finance_fiscal_receivable_origins (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 doc_type text not null check(doc_type in('cte','nfse')),source_id uuid not null,
 fiscal_identity text not null,emission_id uuid not null references public.hub_fiscal_emissions(id),
 receivable_id uuid not null unique references public.receivables(id),
 observation_id uuid not null references public.finance_fiscal_observations(id),
 state text not null check(state in('active','suspended','cancelled','credit_pending','review')),
 basis jsonb not null,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,doc_type,source_id),unique(tenant_id,doc_type,fiscal_identity)
);
create table public.finance_fiscal_projection_events (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 observation_id uuid not null references public.finance_fiscal_observations(id),origin_id uuid references public.finance_fiscal_receivable_origins(id),
 actor_id uuid,action text not null,before_data jsonb,after_data jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.finance_fiscal_receivable_origins enable row level security;
alter table public.finance_fiscal_projection_events enable row level security;
revoke all on public.finance_fiscal_receivable_origins,public.finance_fiscal_projection_events from public,anon,authenticated,service_role;
grant select on public.finance_fiscal_receivable_origins,public.finance_fiscal_projection_events to authenticated,service_role;
create policy finance_fiscal_origins_read on public.finance_fiscal_receivable_origins for select to authenticated using(finance_private.can_access(tenant_id));
create policy finance_fiscal_projection_events_read on public.finance_fiscal_projection_events for select to authenticated using(finance_private.can_access(tenant_id));
create trigger preserve_finance_fiscal_projection_event before update or delete on public.finance_fiscal_projection_events for each row execute function finance_private.preserve_event();

create function finance_private.process_fiscal_observation(_tenant uuid,_observation uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
<<projection>>
declare o public.finance_fiscal_observations%rowtype;j public.finance_fiscal_projection_jobs%rowtype;
 e public.hub_fiscal_emissions%rowtype;origin public.finance_fiscal_receivable_origins%rowtype;r public.receivables%rowtype;
 s jsonb;basis jsonb;result jsonb;before_origin jsonb;identity text;job_state text:='applied';issue text;paid numeric;title uuid;origin_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||_tenant::text,0));
 perform pg_advisory_xact_lock(hashtextextended(_tenant::text||':finance',0));
 select * into j from public.finance_fiscal_projection_jobs where observation_id=_observation and tenant_id=_tenant for update;
 if not found then raise exception 'finance_fiscal_job_not_found' using errcode='22023';end if;
 if j.status in('applied','superseded') and j.result is not null then return j.result;end if;
 select * into o from public.finance_fiscal_observations where id=_observation and tenant_id=_tenant;
 s:=o.snapshot;
 select * into e from public.hub_fiscal_emissions where id=o.emission_id and tenant_id=_tenant for share;
 if not found then raise exception 'finance_fiscal_emission_not_found' using errcode='22023';end if;
 -- Do not materialize an obsolete authorization after a newer cancellation.
 if e.status is distinct from s->>'status' or to_jsonb(e)->>'dispatch_state' is distinct from 'recorded'
  or e.environment is distinct from s->>'environment' or e.doc_type is distinct from s->>'doc_type'
  or e.access_key is distinct from s->>'access_key' or e.authorization_protocol is distinct from s->>'authorization_protocol'
  or e.cte_document_id::text is distinct from s->>'cte_document_id' or e.fiscal_document_id::text is distinct from s->>'fiscal_document_id'
  or e.nfse_document_id::text is distinct from s->>'nfse_document_id'
  or to_jsonb(e)->'provider_document_version' is distinct from s->'provider_document_version'
  or md5(coalesce(e.request_payload,'{}')::text) is distinct from s->>'request_payload_hash' then
  job_state:='superseded';issue:='newer_fiscal_state';
 else
  select * into origin from public.finance_fiscal_receivable_origins where tenant_id=_tenant and emission_id=e.id for update;
  before_origin:=case when origin.id is null then null else to_jsonb(origin) end;origin_id:=origin.id;
  if e.status in('authorized','cancel_rejected') then
   basis:=finance_private.fiscal_receivable_basis_internal(_tenant,_observation);
   identity:=case when e.doc_type='cte' then e.access_key else nullif(e.hub_document_id,'') end;
   if not coalesce((basis->>'ready')::boolean,false) then job_state:='review';issue:=array_to_string(array(select jsonb_array_elements_text(basis->'issues')),',');
   elsif identity is null then job_state:='review';issue:='fiscal_identity_missing';
   elsif not exists(select 1 from public.clients where tenant_id=_tenant and id=(basis->>'payer_id')::uuid and active for share) then
    job_state:='review';issue:='payer_unavailable';
   else
    if origin.id is null then
     select * into origin from public.finance_fiscal_receivable_origins where tenant_id=_tenant and doc_type=e.doc_type
      and (source_id=(projection.basis->>'source_id')::uuid or fiscal_identity=identity) for update;
     before_origin:=case when origin.id is null then null else to_jsonb(origin) end;origin_id:=origin.id;
    end if;
    if origin.id is not null then
     if origin.state in('cancelled','credit_pending') or origin.emission_id<>e.id or origin.fiscal_identity<>identity or origin.source_id<>(basis->>'source_id')::uuid
       or origin.basis->>'payer_id' is distinct from basis->>'payer_id'
       or origin.basis->>'amount_cents' is distinct from basis->>'amount_cents' then
      job_state:='review';issue:='fiscal_origin_changed';
     else
      update public.finance_fiscal_receivable_origins set state='active',observation_id=_observation,updated_at=clock_timestamp() where id=origin.id;
      title:=origin.receivable_id;
     end if;
    elsif exists(select 1 from public.receivables where tenant_id=_tenant and
      ((e.cte_document_id is not null and cte_document_id=e.cte_document_id) or (e.fiscal_document_id is not null and fiscal_document_id=e.fiscal_document_id))) then
     job_state:='review';issue:='existing_receivable_requires_adoption';
    else
     -- No payment is inferred. Due date remains unknown until commercial terms
     -- are supplied; a document date is not a contractual due date.
     insert into public.receivables(tenant_id,client_id,cte_document_id,fiscal_document_id,description,amount,status,received_amount,created_by)
     values(_tenant,(basis->>'payer_id')::uuid,e.cte_document_id,e.fiscal_document_id,
      case when e.doc_type='cte' then 'CT-e ' else 'NFS-e ' end||coalesce(e.number,identity),
      (basis->>'amount_cents')::numeric/100,'pending',0,auth.uid()) returning id into title;
     insert into public.finance_fiscal_receivable_origins(tenant_id,doc_type,source_id,fiscal_identity,emission_id,receivable_id,observation_id,state,basis)
     values(_tenant,e.doc_type,(projection.basis->>'source_id')::uuid,identity,e.id,title,_observation,'active',projection.basis) returning id into origin_id;
    end if;
   end if;
  elsif origin.id is not null then
   title:=origin.receivable_id;
   if e.status='cancel_processing' then
    update public.finance_fiscal_receivable_origins set state='suspended',observation_id=_observation,updated_at=clock_timestamp() where id=origin.id;
   elsif e.status in('cancelled','rejected','denied','inutilized') then
    select * into r from public.receivables where id=title and tenant_id=_tenant for update;
    select coalesce(sum(p.amount),0) into paid from public.receivables_payments p where p.tenant_id=_tenant and p.receivable_id=title
     and not exists(select 1 from public.receivable_payment_reversals rv where rv.tenant_id=_tenant and rv.payment_id=p.id);
    if paid<>0 or coalesce(r.received_amount,0)<>0 then
     job_state:='review';issue:='cancelled_document_has_receipts';
     update public.finance_fiscal_receivable_origins set state='credit_pending',observation_id=_observation,updated_at=clock_timestamp() where id=origin.id;
    elsif r.client_invoice_id is not null or r.closing_report_id is not null then
     job_state:='review';issue:='cancelled_document_in_billing_group';
     update public.finance_fiscal_receivable_origins set state='review',observation_id=_observation,updated_at=clock_timestamp() where id=origin.id;
    else
     update public.receivables set status='cancelled',updated_at=now() where id=title and tenant_id=_tenant;
     update public.finance_fiscal_receivable_origins set state='cancelled',observation_id=_observation,updated_at=clock_timestamp() where id=origin.id;
    end if;
   end if;
  elsif exists(select 1 from public.receivables where tenant_id=_tenant and
    ((e.cte_document_id is not null and cte_document_id=e.cte_document_id) or (e.fiscal_document_id is not null and fiscal_document_id=e.fiscal_document_id))) then
   job_state:='review';issue:='existing_receivable_requires_adoption';
  end if;
 end if;
 if job_state='review' and origin_id is not null then
  update public.finance_fiscal_receivable_origins set state='review',updated_at=clock_timestamp()
   where id=origin_id and state not in('cancelled','credit_pending');
 end if;
 result:=jsonb_build_object('version',1,'tenant_id',_tenant,'observation_id',_observation,'status',job_state,'issue',issue,'origin_id',origin_id,'receivable_id',title,'basis',basis);
 update public.finance_fiscal_projection_jobs set status=job_state,issue=projection.issue,result=projection.result,attempts=attempts+1,updated_at=clock_timestamp()
 where observation_id=_observation and tenant_id=_tenant;
 insert into public.finance_fiscal_projection_events(tenant_id,observation_id,origin_id,actor_id,action,before_data,after_data)
 values(_tenant,_observation,projection.origin_id,auth.uid(),job_state,before_origin,projection.result);
 return result;
end;
$$;
revoke all on function finance_private.process_fiscal_observation(uuid,uuid) from public,anon,authenticated,service_role;

create function public.process_finance_fiscal_observation(_tenant_id uuid,_observation_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$begin
 return finance_private.process_fiscal_observation_as_user(_tenant_id,_observation_id);
end;$$;
create function finance_private.process_fiscal_observation_as_user(_tenant uuid,_observation uuid) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 return finance_private.process_fiscal_observation(_tenant,_observation);
end;$$;
revoke all on function finance_private.process_fiscal_observation_as_user(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.process_finance_fiscal_observation(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function finance_private.process_fiscal_observation_as_user(uuid,uuid),public.process_finance_fiscal_observation(uuid,uuid) to authenticated;

-- Recheck the fiscal source at insertion, including before its queued job runs.
create function finance_private.guard_fiscal_receipt() returns trigger
language plpgsql security definer set search_path='' as $$
declare origin public.finance_fiscal_receivable_origins%rowtype;legacy_cte uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||new.tenant_id::text,0));
 select * into origin from public.finance_fiscal_receivable_origins where tenant_id=new.tenant_id and receivable_id=new.receivable_id;
 if found and (origin.state<>'active' or not exists(select 1 from public.hub_fiscal_emissions e where e.tenant_id=new.tenant_id and e.id=origin.emission_id
  and e.environment='production' and e.status in('authorized','cancel_rejected') and to_jsonb(e)->>'dispatch_state'='recorded')) then
  raise exception 'financial_fiscal_source_not_collectible' using errcode='22023';end if;
 if origin.id is null then
  select cte_document_id into legacy_cte from public.receivables where id=new.receivable_id and tenant_id=new.tenant_id;
  if legacy_cte is not null and not exists(select 1 from public.hub_fiscal_emissions e where e.tenant_id=new.tenant_id and e.cte_document_id=legacy_cte
    and e.environment='production' and e.status in('authorized','cancel_rejected') and to_jsonb(e)->>'dispatch_state'='recorded') then
   raise exception 'financial_fiscal_source_not_collectible' using errcode='22023';end if;
 end if;
 return new;
end;$$;
revoke all on function finance_private.guard_fiscal_receipt() from public,anon,authenticated,service_role;
create trigger finance_guard_fiscal_receipt before insert on public.receivables_payments for each row execute function finance_private.guard_fiscal_receipt();
