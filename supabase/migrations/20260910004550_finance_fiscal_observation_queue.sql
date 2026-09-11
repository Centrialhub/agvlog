-- Capture fiscal facts independently of receivable projection. A downstream
-- mapping problem must remain visible and retryable, not erase authorization.
create table public.finance_fiscal_observations (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 observed_order bigint generated always as identity unique,
 emission_id uuid not null references public.hub_fiscal_emissions(id),
 snapshot_hash text not null,snapshot jsonb not null,
 observed_by uuid,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,emission_id,snapshot_hash)
);
create table public.finance_fiscal_projection_jobs (
 observation_id uuid primary key references public.finance_fiscal_observations(id),
 tenant_id uuid not null references public.tenants(id),
 status text not null default 'pending' check(status in('pending','review','applied','superseded')),
 attempts integer not null default 0 check(attempts>=0),issue text,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create index finance_fiscal_jobs_pending on public.finance_fiscal_projection_jobs(tenant_id,status,created_at,observation_id);
alter table public.finance_fiscal_observations enable row level security;
alter table public.finance_fiscal_projection_jobs enable row level security;
revoke all on public.finance_fiscal_observations,public.finance_fiscal_projection_jobs from public,anon,authenticated,service_role;
grant select on public.finance_fiscal_observations,public.finance_fiscal_projection_jobs to authenticated,service_role;
create policy finance_fiscal_observations_read on public.finance_fiscal_observations for select to authenticated using(finance_private.can_access(tenant_id));
create policy finance_fiscal_jobs_read on public.finance_fiscal_projection_jobs for select to authenticated using(finance_private.can_access(tenant_id));
create trigger preserve_finance_fiscal_observation before update or delete on public.finance_fiscal_observations for each row execute function finance_private.preserve_event();

create function finance_private.capture_fiscal_observation() returns trigger
language plpgsql security definer set search_path='' as $$
declare e jsonb:=to_jsonb(new);snapshot jsonb;hash text;observation uuid;previous jsonb;
 cte jsonb;outbound jsonb;nfse jsonb;
begin
 if new.environment<>'production' or new.doc_type not in('cte','nfse') or e->>'dispatch_state' is distinct from 'recorded'
  or new.status not in('authorized','cancel_processing','cancel_rejected','cancelled','rejected','denied','inutilized') then return new;end if;
 select jsonb_build_object('id',d.id,'client_id',d.client_id,'freight_value',d.freight_value,'net_value',d.net_value,
  'fiscal_document_ids',d.fiscal_document_ids,'payer_cnpj',d.payer_cnpj) into cte
 from public.cte_documents d where d.tenant_id=new.tenant_id and d.id=new.cte_document_id;
 select jsonb_build_object('id',f.id,'client_id',f.client_id,'freight_value',f.freight_value,
  'source_document_ids',to_jsonb(f)->'source_document_ids','payer_cnpj',to_jsonb(f)->'payer_cnpj') into outbound
 from public.fiscal_documents f where f.tenant_id=new.tenant_id and f.id=new.fiscal_document_id;
 select jsonb_build_object('id',n.id,'client_id',n.cliente_id,'payer_cnpj',n.pagador_cnpj,'client_cnpj',n.cliente_cnpj,
  'service_amount',n.valor_servicos,'net_amount',n.valor_liquido,'total_amount',n.valor_total,
  'iss_withheld',n.iss_retido,'iss_amount',n.valor_iss,'other_withholdings',n.outras_retencoes,
  'pis',n.valor_pis,'cofins',n.valor_cofins,'inss',n.valor_inss,'ir',n.valor_ir,'csll',n.valor_csll,
  'fiscal_document_ids',n.fiscal_document_ids,'is_preview',n.is_preview) into nfse
 from public.nfse_documents n where n.tenant_id=new.tenant_id and n.id=new.nfse_document_id;
 snapshot:=jsonb_build_object('version',1,'emission_id',new.id,'tenant_id',new.tenant_id,'doc_type',new.doc_type,
  'environment',new.environment,'status',new.status,'dispatch_state',e->>'dispatch_state',
  'hub_document_id',new.hub_document_id,'id_integracao',new.id_integracao,'emitter_cnpj',new.emitter_cnpj,
  'access_key',new.access_key,'authorization_protocol',new.authorization_protocol,'number',new.number,'series',new.series,
  'provider_document_version',e->'provider_document_version','provider_effect_id',e->'provider_effect_id','provider_occurred_at',e->'provider_occurred_at',
  'request_payload_hash',md5(coalesce(new.request_payload,'{}')::text),
  'cte_document_id',new.cte_document_id,'fiscal_document_id',new.fiscal_document_id,'nfse_document_id',new.nfse_document_id,
  'cte',cte,'outbound',outbound,'nfse',nfse);
 hash:=md5(snapshot::text);
 insert into public.finance_fiscal_observations(tenant_id,emission_id,snapshot_hash,snapshot,observed_by)
 values(new.tenant_id,new.id,hash,snapshot,auth.uid()) on conflict(tenant_id,emission_id,snapshot_hash) do nothing returning id into observation;
 if observation is null then
  select id,o.snapshot into observation,previous from public.finance_fiscal_observations o
   where tenant_id=new.tenant_id and emission_id=new.id and snapshot_hash=hash;
  if previous is distinct from snapshot then raise exception 'finance_fiscal_snapshot_hash_collision';end if;
 end if;
 insert into public.finance_fiscal_projection_jobs(observation_id,tenant_id) values(observation,new.tenant_id) on conflict(observation_id) do nothing;
 return new;
end;
$$;
revoke all on function finance_private.capture_fiscal_observation() from public,anon,authenticated,service_role;
create trigger finance_capture_fiscal_observation after insert or update on public.hub_fiscal_emissions
 for each row execute function finance_private.capture_fiscal_observation();
