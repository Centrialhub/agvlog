-- Prepared only: immutable observations of CURRENT recorded fiscal facts.
-- Does not issue fiscal documents, update emissions, run projection, or create receivables.
set local lock_timeout='3s';set local statement_timeout='60s';
lock table public.hub_fiscal_emissions,public.cte_documents,public.fiscal_documents,public.nfse_documents in share mode nowait;
do $guard$
declare body text;jobs_active boolean;
begin
 select replace(prosrc,E'\r\n',E'\n') into body from pg_proc where oid=to_regprocedure('finance_private.capture_fiscal_observation()');
 if body is null or md5(body)<>'da41aa6d3e38ff9449dc00a90a4d7346' then raise exception 'finance_fiscal_capture_contract_changed';end if;
 if to_regclass('cron.job') is not null then
 execute 'select exists(select 1 from cron.job where jobname=''finance-fiscal-projection-every-minute'' and active)' into jobs_active;
 if jobs_active then raise exception 'finance_fiscal_capture_requires_paused_worker';end if;end if;
end;$guard$;
do $capture$
declare emission public.hub_fiscal_emissions%rowtype;
e jsonb;snapshot jsonb;hash text;observation uuid;previous jsonb;
 cte jsonb;outbound jsonb;nfse jsonb;
begin
 for emission in select * from public.hub_fiscal_emissions where environment='production' and doc_type in('cte','nfse') and to_jsonb(hub_fiscal_emissions)->>'dispatch_state'='recorded' and status in('authorized','cancel_processing','cancel_rejected','cancelled','rejected','denied','inutilized') order by tenant_id,id loop
  e:=to_jsonb(emission);
 if emission.environment<>'production' or emission.doc_type not in('cte','nfse') or e->>'dispatch_state' is distinct from 'recorded'
  or emission.status not in('authorized','cancel_processing','cancel_rejected','cancelled','rejected','denied','inutilized') then continue;end if;
 select jsonb_build_object('id',d.id,'client_id',d.client_id,'freight_value',d.freight_value,'net_value',d.net_value,
  'fiscal_document_ids',d.fiscal_document_ids,'payer_cnpj',d.payer_cnpj) into cte
 from public.cte_documents d where d.tenant_id=emission.tenant_id and d.id=emission.cte_document_id;
 select jsonb_build_object('id',f.id,'client_id',f.client_id,'freight_value',f.freight_value,
  'source_document_ids',to_jsonb(f)->'source_document_ids','payer_cnpj',to_jsonb(f)->'payer_cnpj') into outbound
 from public.fiscal_documents f where f.tenant_id=emission.tenant_id and f.id=emission.fiscal_document_id;
 select jsonb_build_object('id',n.id,'client_id',n.cliente_id,'payer_cnpj',n.pagador_cnpj,'client_cnpj',n.cliente_cnpj,
  'service_amount',n.valor_servicos,'net_amount',n.valor_liquido,'total_amount',n.valor_total,
  'iss_withheld',n.iss_retido,'iss_amount',n.valor_iss,'other_withholdings',n.outras_retencoes,
  'pis',n.valor_pis,'cofins',n.valor_cofins,'inss',n.valor_inss,'ir',n.valor_ir,'csll',n.valor_csll,
  'fiscal_document_ids',n.fiscal_document_ids,'is_preview',n.is_preview) into nfse
 from public.nfse_documents n where n.tenant_id=emission.tenant_id and n.id=emission.nfse_document_id;
 snapshot:=jsonb_build_object('version',1,'emission_id',emission.id,'tenant_id',emission.tenant_id,'doc_type',emission.doc_type,
  'environment',emission.environment,'status',emission.status,'dispatch_state',e->>'dispatch_state',
  'hub_document_id',emission.hub_document_id,'id_integracao',emission.id_integracao,'emitter_cnpj',emission.emitter_cnpj,
  'access_key',emission.access_key,'authorization_protocol',emission.authorization_protocol,'number',emission.number,'series',emission.series,
  'provider_document_version',e->'provider_document_version','provider_effect_id',e->'provider_effect_id','provider_occurred_at',e->'provider_occurred_at',
  'request_payload_hash',md5(coalesce(emission.request_payload,'{}')::text),
  'cte_document_id',emission.cte_document_id,'fiscal_document_id',emission.fiscal_document_id,'nfse_document_id',emission.nfse_document_id,
  'cte',cte,'outbound',outbound,'nfse',nfse);
 hash:=md5(snapshot::text);
 insert into public.finance_fiscal_observations(tenant_id,emission_id,snapshot_hash,snapshot,observed_by)
 values(emission.tenant_id,emission.id,hash,snapshot,auth.uid()) on conflict(tenant_id,emission_id,snapshot_hash) do nothing returning id into observation;
 if observation is null then
  select id,o.snapshot into observation,previous from public.finance_fiscal_observations o
   where tenant_id=emission.tenant_id and emission_id=emission.id and snapshot_hash=hash;
  if previous is distinct from snapshot then raise exception 'finance_fiscal_snapshot_hash_collision';end if;
 end if;
 insert into public.finance_fiscal_projection_jobs(observation_id,tenant_id) values(observation,emission.tenant_id) on conflict(observation_id) do nothing;
 continue;
 end loop;
end;$capture$;
