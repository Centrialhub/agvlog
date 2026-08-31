-- Official ICMS taxpayer registry (CadConsultaCadastro4) and A1 certificates.
-- Secret certificate material is service-only: authenticated users interact
-- through authenticated Edge Functions and never select the ciphertext.

create table public.fiscal_certificates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  emitter_id uuid not null,
  label text not null default 'Certificado A1',
  certificate_ciphertext text not null,
  thumbprint_sha256 text not null check (thumbprint_sha256 ~ '^[a-f0-9]{64}$'),
  serial_number text,
  subject_name text,
  certificate_cnpj text check (certificate_cnpj is null or certificate_cnpj ~ '^[0-9]{14}$'),
  valid_from timestamptz not null,
  valid_to timestamptz not null,
  status text not null default 'active' check (status in ('active','inactive','expired','revoked','invalid')),
  uploaded_by uuid references auth.users(id) on delete set null,
  last_tested_at timestamptz,
  last_test_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fiscal_certificates_emitter_fk foreign key (tenant_id, emitter_id)
    references public.tenant_emitters(tenant_id, id) on delete cascade,
  constraint fiscal_certificates_validity check (valid_to > valid_from)
);

create unique index fiscal_certificates_one_active_per_emitter
  on public.fiscal_certificates(tenant_id, emitter_id) where status = 'active';
create index fiscal_certificates_expiry_idx
  on public.fiscal_certificates(valid_to) where status = 'active';

create table public.tax_registry_queries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  emitter_id uuid not null,
  certificate_id uuid references public.fiscal_certificates(id) on delete set null,
  uf text not null check (uf ~ '^[A-Z]{2}$'),
  lookup_type text not null check (lookup_type in ('CNPJ','CPF','IE')),
  lookup_value text not null,
  endpoint text not null,
  result_status text not null check (result_status in ('success','not_found','rejected','unavailable','invalid_response','error')),
  c_stat integer,
  reason text,
  response_payload jsonb,
  response_hash text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint tax_registry_queries_emitter_fk foreign key (tenant_id, emitter_id)
    references public.tenant_emitters(tenant_id, id) on delete cascade
);

create index tax_registry_queries_lookup_idx
  on public.tax_registry_queries(tenant_id, uf, lookup_type, lookup_value, created_at desc);

create table public.fiscal_party_registry (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'),
  uf text not null check (uf ~ '^[A-Z]{2}$'),
  state_registration text,
  legal_name text,
  trade_name text,
  registry_status text not null default 'unknown',
  status_code text,
  tax_regime text,
  economic_activity_code text,
  official_address jsonb not null default '{}'::jsonb,
  source text not null default 'SEFAZ_CADCONSULTACADASTRO4',
  source_query_id uuid references public.tax_registry_queries(id) on delete set null,
  verified_at timestamptz not null,
  raw_record jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (tenant_id, cnpj, uf, state_registration)
);

create index fiscal_party_registry_cnpj_idx
  on public.fiscal_party_registry(tenant_id, cnpj, verified_at desc);

create table public.tax_registry_applied_changes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  query_id uuid not null references public.tax_registry_queries(id) on delete restrict,
  registry_id uuid not null references public.fiscal_party_registry(id) on delete restrict,
  target_table text not null check (target_table in ('clients','tenant_emitters')),
  target_id uuid not null,
  before_data jsonb not null,
  after_data jsonb not null,
  applied_by uuid references auth.users(id) on delete set null,
  applied_at timestamptz not null default now()
);

alter table public.clients
  add column if not exists registry_verified_at timestamptz,
  add column if not exists registry_source text,
  add column if not exists registry_status text,
  add column if not exists registry_profile_id uuid references public.fiscal_party_registry(id) on delete set null;

alter table public.tenant_emitters
  add column if not exists registry_verified_at timestamptz,
  add column if not exists registry_source text,
  add column if not exists registry_status text,
  add column if not exists registry_profile_id uuid references public.fiscal_party_registry(id) on delete set null;

alter table public.fiscal_certificates enable row level security;
alter table public.tax_registry_queries enable row level security;
alter table public.fiscal_party_registry enable row level security;
alter table public.tax_registry_applied_changes enable row level security;

revoke all on public.fiscal_certificates from anon, authenticated;
grant select on public.tax_registry_queries, public.fiscal_party_registry,
  public.tax_registry_applied_changes to authenticated;

create policy "Tenant members read tax registry queries"
  on public.tax_registry_queries for select to authenticated
  using (exists (
    select 1 from public.tenant_memberships membership
    where membership.tenant_id = tax_registry_queries.tenant_id
      and membership.user_id = (select auth.uid()) and membership.active
  ));

create policy "Tenant members read official party registry"
  on public.fiscal_party_registry for select to authenticated
  using (exists (
    select 1 from public.tenant_memberships membership
    where membership.tenant_id = fiscal_party_registry.tenant_id
      and membership.user_id = (select auth.uid()) and membership.active
  ));

create policy "Tenant members read registry change audit"
  on public.tax_registry_applied_changes for select to authenticated
  using (exists (
    select 1 from public.tenant_memberships membership
    where membership.tenant_id = tax_registry_applied_changes.tenant_id
      and membership.user_id = (select auth.uid()) and membership.active
  ));

create trigger trg_fiscal_certificates_updated before update on public.fiscal_certificates
  for each row execute function public.update_updated_at_column();
create trigger trg_fiscal_party_registry_updated before update on public.fiscal_party_registry
  for each row execute function public.update_updated_at_column();



create or replace function public.activate_fiscal_certificate(
  _tenant uuid, _emitter uuid, _certificate uuid
) returns void language plpgsql security definer set search_path = pg_catalog, public as $function$
begin
  if not exists (
    select 1 from public.fiscal_certificates
    where id = _certificate and tenant_id = _tenant and emitter_id = _emitter
      and valid_to > now()
  ) then raise exception 'fiscal_certificate_invalid'; end if;
  update public.fiscal_certificates set status = 'inactive'
    where tenant_id = _tenant and emitter_id = _emitter and status = 'active';
  update public.fiscal_certificates set status = 'active', last_test_error = null
    where id = _certificate and tenant_id = _tenant and emitter_id = _emitter;
end;
$function$;
revoke all on function public.activate_fiscal_certificate(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.activate_fiscal_certificate(uuid,uuid,uuid) to service_role;

create or replace function public.apply_tax_registry_profile(
  _tenant uuid, _registry uuid, _query uuid, _target_table text, _target_id uuid, _user uuid
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $function$
declare
  profile public.fiscal_party_registry%rowtype;
  before_value jsonb;
  after_value jsonb;
  address jsonb;
begin
  select * into profile from public.fiscal_party_registry
    where id = _registry and tenant_id = _tenant and source_query_id = _query;
  if not found then raise exception 'tax_registry_profile_invalid'; end if;
  address := coalesce(profile.official_address, '{}'::jsonb);

  if _target_table = 'clients' then
    select to_jsonb(client) into before_value from public.clients client
      where client.id = _target_id and client.tenant_id = _tenant
        and regexp_replace(coalesce(client.tax_id,''),'[^0-9]','','g') = profile.cnpj for update;
    if before_value is null then raise exception 'tax_registry_client_cnpj_mismatch'; end if;
    update public.clients set
      state_registration = coalesce(nullif(profile.state_registration,''), state_registration),
      legal_name = coalesce(nullif(profile.legal_name,''), legal_name),
      company_name = coalesce(nullif(profile.legal_name,''), company_name),
      trade_name = coalesce(nullif(profile.trade_name,''), trade_name),
      address_street = coalesce(nullif(address->>'street',''), address_street),
      address_number = coalesce(nullif(address->>'number',''), address_number),
      address_complement = coalesce(nullif(address->>'complement',''), address_complement),
      address_neighborhood = coalesce(nullif(address->>'neighborhood',''), address_neighborhood),
      address_city = coalesce(nullif(address->>'city',''), address_city),
      address_city_ibge_code = coalesce(nullif(address->>'cityCode',''), address_city_ibge_code),
      address_state = coalesce(nullif(address->>'state',''), address_state),
      address_zip = coalesce(nullif(address->>'zip',''), address_zip),
      registry_verified_at = profile.verified_at,
      registry_source = profile.source,
      registry_status = profile.registry_status,
      registry_profile_id = profile.id,
      updated_by = _user
    where id = _target_id and tenant_id = _tenant;
    select to_jsonb(client) into after_value from public.clients client where client.id = _target_id;
  elsif _target_table = 'tenant_emitters' then
    select to_jsonb(emitter) into before_value from public.tenant_emitters emitter
      where emitter.id = _target_id and emitter.tenant_id = _tenant
        and regexp_replace(emitter.cnpj,'[^0-9]','','g') = profile.cnpj for update;
    if before_value is null then raise exception 'tax_registry_emitter_cnpj_mismatch'; end if;
    update public.tenant_emitters set
      ie = coalesce(nullif(profile.state_registration,''), ie),
      razao_social = coalesce(nullif(profile.legal_name,''), razao_social),
      nome_fantasia = coalesce(nullif(profile.trade_name,''), nome_fantasia),
      city_code = coalesce(nullif(address->>'cityCode',''), city_code),
      endereco = coalesce(endereco, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'logradouro', nullif(address->>'street',''), 'numero', nullif(address->>'number',''),
        'complemento', nullif(address->>'complement',''), 'bairro', nullif(address->>'neighborhood',''),
        'municipio', nullif(address->>'city',''), 'uf', nullif(address->>'state',''),
        'cep', nullif(address->>'zip','')
      )),
      registry_verified_at = profile.verified_at,
      registry_source = profile.source,
      registry_status = profile.registry_status,
      registry_profile_id = profile.id
    where id = _target_id and tenant_id = _tenant;
    select to_jsonb(emitter) into after_value from public.tenant_emitters emitter where emitter.id = _target_id;
  else
    raise exception 'tax_registry_target_invalid';
  end if;

  insert into public.tax_registry_applied_changes(
    tenant_id, query_id, registry_id, target_table, target_id, before_data, after_data, applied_by
  ) values (_tenant, _query, _registry, _target_table, _target_id, before_value, after_value, _user);
  return after_value;
end;
$function$;
revoke all on function public.apply_tax_registry_profile(uuid,uuid,uuid,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.apply_tax_registry_profile(uuid,uuid,uuid,text,uuid,uuid) to service_role;
