-- Original documents received from another carrier. Never own issued CT-e/NF-e.
begin;
create schema if not exists contractor_cte_private;
revoke all on schema contractor_cte_private from public, anon, authenticated;

create function contractor_cte_private.valid_key(value text, model text default '57') returns boolean
language plpgsql immutable set search_path='' as $$
declare total integer:=0; weight integer:=2; pos integer; digit integer;
begin
  if value is null or value !~ '^\d{44}$' or substr(value,21,2)<>model then return false; end if;
  for pos in reverse 43..1 loop
    total:=total+substr(value,pos,1)::integer*weight;
    weight:=case when weight=9 then 2 else weight+1 end;
  end loop;
  digit:=11-(total%11); if digit>=10 then digit:=0; end if;
  return digit=substr(value,44,1)::integer;
end $$;

create table public.contractor_cte_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  access_key text not null check(contractor_cte_private.valid_key(access_key)),
  environment text not null check(environment in ('production','homologation')),
  source_format text not null check(source_format in ('xml','pdf')),
  document jsonb not null check(jsonb_typeof(document)='object' and octet_length(document::text)<=32768),
  original_path text not null unique,
  original_sha256 text not null check(original_sha256 ~ '^[a-f0-9]{64}$'),
  original_size integer not null check(original_size between 1 and 10485760),
  original_name text not null check(length(original_name) between 1 and 255),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(tenant_id,environment,access_key,source_format)
);
create index contractor_cte_sources_tenant_created on public.contractor_cte_sources(tenant_id,created_at desc);
create index contractor_cte_sources_created_by on public.contractor_cte_sources(created_by);
alter table public.contractor_cte_sources enable row level security;
revoke all on public.contractor_cte_sources from public,anon,authenticated;
grant select on public.contractor_cte_sources to authenticated;
grant select,insert,update,delete on public.contractor_cte_sources to service_role;
create policy contractor_cte_sources_read on public.contractor_cte_sources for select to authenticated
using(private.is_request_tenant_member(tenant_id) and public.is_tenant_operator_or_admin(tenant_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('contractor-cte-originals','contractor-cte-originals',false,10485760,array['application/xml','application/pdf']);

-- Restrictive boundaries also protect against permissive policies added elsewhere.
create policy contractor_cte_storage_boundary on storage.objects as restrictive for all to authenticated
using(bucket_id<>'contractor-cte-originals' or
  (split_part(name,'/',1)=private.request_tenant_id()::text and public.is_tenant_operator_or_admin(private.request_tenant_id())
   and private.is_request_tenant_member(private.request_tenant_id())))
with check(bucket_id<>'contractor-cte-originals' or
  (split_part(name,'/',1)=private.request_tenant_id()::text and split_part(name,'/',2)=auth.uid()::text
   and private.is_request_tenant_member(private.request_tenant_id()) and public.is_tenant_operator_or_admin(private.request_tenant_id())
   and name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9]{64}\.(xml|pdf)$'));
create policy contractor_cte_storage_insert on storage.objects for insert to authenticated
with check(bucket_id='contractor-cte-originals');
create policy contractor_cte_storage_read on storage.objects for select to authenticated
using(bucket_id='contractor-cte-originals');
create policy contractor_cte_storage_no_update on storage.objects as restrictive for update to authenticated
using(bucket_id<>'contractor-cte-originals') with check(bucket_id<>'contractor-cte-originals');
create policy contractor_cte_storage_no_delete on storage.objects as restrictive for delete to authenticated
using(bucket_id<>'contractor-cte-originals');
create policy contractor_cte_storage_no_anon on storage.objects as restrictive for all to anon
using(bucket_id<>'contractor-cte-originals') with check(bucket_id<>'contractor-cte-originals');

create function public.register_contractor_cte_source_v1(
  _tenant_id uuid,_document jsonb,_sha256 text,_size integer,_name text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); key text:=_document->>'access_key'; fmt text:=_document->>'source_format';
  env text:=_document->>'environment'; path text; saved public.contractor_cte_sources;
begin
  if actor is null or not private.is_request_tenant_member(_tenant_id)
    or not public.is_tenant_operator_or_admin(_tenant_id) then
    raise exception 'contractor_cte_not_authorized' using errcode='42501';
  end if;
  if _document is null or jsonb_typeof(_document)<>'object' or octet_length(_document::text)>32768
    or not contractor_cte_private.valid_key(key) or fmt not in ('xml','pdf') or fmt is null
    or env not in ('production','homologation') or env is null
    or _sha256 is null or _sha256 !~ '^[a-f0-9]{64}$' or _size is null or _size not between 1 and 10485760
    or _name is null or length(_name) not between 1 and 255
    or (_document->>'issuer_cnpj') is distinct from substr(key,7,14)
    or coalesce(_document->>'number','') !~ '^\d{1,9}$' or coalesce(_document->>'series','') !~ '^\d{1,3}$'
    or coalesce(_document->>'issuer_name','')='' or coalesce(_document->>'issuer_ie','')=''
    or coalesce(_document->>'issuer_state','') !~ '^[A-Z]{2}$'
    or coalesce(_document->>'issue_date','') !~ '^\d{4}-\d{2}-\d{2}$'
    or coalesce(_document->>'origin_city_code','') !~ '^\d{7}$'
    or coalesce(_document->>'destination_city_code','') !~ '^\d{7}$'
    or jsonb_typeof(_document->'issuer_address') is distinct from 'object'
    or jsonb_typeof(_document->'referenced_nfe_keys') is distinct from 'array'
    or jsonb_typeof(_document->'authorization_declared') is distinct from 'boolean'
    or (fmt='pdf' and (_document->'authorization_declared'<>'false'::jsonb or _document->'authorization_protocol' is distinct from 'null'::jsonb)) then
    raise exception 'contractor_cte_invalid_document' using errcode='22023';
  end if;
  if not (_document ?& array['access_key','number','series','issue_date','environment','issuer_name','issuer_cnpj',
      'issuer_ie','issuer_state','issuer_address','origin_city_code','destination_city_code','referenced_nfe_keys',
      'authorization_protocol','authorization_declared','source_format'])
    or (_document-array['access_key','number','series','issue_date','environment','issuer_name','issuer_cnpj',
      'issuer_ie','issuer_state','issuer_address','origin_city_code','destination_city_code','referenced_nfe_keys',
      'authorization_protocol','authorization_declared','source_format'])<>'{}'::jsonb
    or exists(select 1 from jsonb_each(_document) field where field.key not in
      ('issuer_address','referenced_nfe_keys','authorization_protocol','authorization_declared') and jsonb_typeof(field.value)<>'string')
    or jsonb_typeof(_document->'authorization_protocol') not in ('string','null')
    or not ((_document->'issuer_address') ?& array['street','number','neighborhood','city','city_code','state','zip'])
    or ((_document->'issuer_address')-array['street','number','neighborhood','city','city_code','state','zip'])<>'{}'::jsonb
    or exists(select 1 from jsonb_each(_document->'issuer_address') field where jsonb_typeof(field.value)<>'string')
    or length(btrim(_document->>'issuer_name')) not between 1 and 255
    or length(btrim(_document->>'issuer_ie')) not between 1 and 20 then
    raise exception 'contractor_cte_invalid_document_shape' using errcode='22023';
  end if;
  if (_document->>'number')::bigint<>substr(key,26,9)::bigint
    or (_document->>'series')::integer<>substr(key,23,3)::integer then
    raise exception 'contractor_cte_identity_mismatch' using errcode='22023';
  end if;
  if jsonb_array_length(_document->'referenced_nfe_keys')>2000
    or exists(select 1 from jsonb_array_elements(_document->'referenced_nfe_keys') n(value)
      where jsonb_typeof(n.value)<>'string' or not contractor_cte_private.valid_key(n.value#>>'{}','55'))
    or (_document->>'authorization_declared')::boolean is true
      and (fmt<>'xml' or coalesce(_document->>'authorization_protocol','') !~ '^\d{15}$')
    or (_document->>'authorization_declared')::boolean is false
      and _document->'authorization_protocol' is distinct from 'null'::jsonb then
    raise exception 'contractor_cte_invalid_references' using errcode='22023';
  end if;
  perform (_document->>'issue_date')::date;
  path:=_tenant_id::text||'/'||actor::text||'/'||_sha256||'.'||fmt;
  if not exists(select 1 from storage.objects o where o.bucket_id='contractor-cte-originals' and o.name=path
    and (o.metadata->>'size')::bigint=_size
    and o.metadata->>'mimetype'=case when fmt='pdf' then 'application/pdf' else 'application/xml' end) then
    raise exception 'contractor_cte_original_unconfirmed' using errcode='22023';
  end if;
  insert into public.contractor_cte_sources(tenant_id,access_key,environment,source_format,document,
    original_path,original_sha256,original_size,original_name,created_by)
  values(_tenant_id,key,env,fmt,_document,path,_sha256,_size,_name,actor)
  on conflict(tenant_id,environment,access_key,source_format) do nothing;
  select * into strict saved from public.contractor_cte_sources s
    where s.tenant_id=_tenant_id and s.environment=env and s.access_key=key and s.source_format=fmt;
  if saved.document<>_document or saved.original_sha256<>_sha256 or saved.original_size<>_size then
    raise exception 'contractor_cte_conflicting_original' using errcode='23505';
  end if;
  return saved.id;
end $$;
revoke all on function public.register_contractor_cte_source_v1(uuid,jsonb,text,integer,text) from public,anon,authenticated;
grant execute on function public.register_contractor_cte_source_v1(uuid,jsonb,text,integer,text) to authenticated;
revoke all on all functions in schema contractor_cte_private from public,anon,authenticated;
comment on table public.contractor_cte_sources is 'Original CT-e from a contractor, isolated from own-issued fiscal documents and accounting. Authorization is declared by the supplied file, not independently verified.';
commit;
