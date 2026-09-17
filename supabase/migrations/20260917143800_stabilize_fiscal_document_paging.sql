create table if not exists private.fiscal_document_list_revisions(
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  revision bigint not null default 1 check(revision > 0),
  updated_at timestamptz not null default clock_timestamp()
);
revoke all on table private.fiscal_document_list_revisions from public,anon,authenticated,service_role;

insert into private.fiscal_document_list_revisions(tenant_id)
select distinct tenant_id from public.fiscal_documents
on conflict(tenant_id) do nothing;

create or replace function private.bump_fiscal_document_list_revision(_tenant_id uuid)
returns void language sql security definer set search_path='' as $function$
  insert into private.fiscal_document_list_revisions(tenant_id,revision,updated_at)
  values(_tenant_id,1,clock_timestamp())
  on conflict(tenant_id) do update set
    revision=private.fiscal_document_list_revisions.revision+1,
    updated_at=clock_timestamp()
$function$;
revoke all on function private.bump_fiscal_document_list_revision(uuid) from public,anon,authenticated,service_role;

create or replace function private.bump_fiscal_document_list_revision_trigger()
returns trigger language plpgsql security definer set search_path='' as $function$
declare
  v_tenant_id uuid;
begin
  v_tenant_id:=case when tg_op='DELETE' then old.tenant_id else new.tenant_id end;
  perform private.bump_fiscal_document_list_revision(v_tenant_id);
  if tg_op='UPDATE' and new.tenant_id is distinct from old.tenant_id then
    perform private.bump_fiscal_document_list_revision(old.tenant_id);
  end if;
  return null;
end;
$function$;
revoke all on function private.bump_fiscal_document_list_revision_trigger() from public,anon,authenticated,service_role;

create or replace function private.current_fiscal_document_list_revision(_tenant_id uuid)
returns bigint
language sql
stable
security definer
set search_path=''
as $function$
  select coalesce(
    (select tracked.revision
       from private.fiscal_document_list_revisions tracked
      where tracked.tenant_id=_tenant_id),
    1::bigint
  )
$function$;
revoke all on function private.current_fiscal_document_list_revision(uuid) from public,anon,authenticated,service_role;
grant execute on function private.current_fiscal_document_list_revision(uuid) to authenticated,service_role;

drop trigger if exists bump_fiscal_document_list_revision on public.fiscal_documents;
create trigger bump_fiscal_document_list_revision
after insert or update or delete on public.fiscal_documents
for each row execute function private.bump_fiscal_document_list_revision_trigger();

drop trigger if exists bump_fiscal_document_client_revision on public.clients;
create trigger bump_fiscal_document_client_revision
after update of company_name on public.clients
for each row when (new.company_name is distinct from old.company_name)
execute function private.bump_fiscal_document_list_revision_trigger();

drop function if exists public.get_fiscal_documents_page_v1(uuid,integer,integer,text,text,text,text);
create function public.get_fiscal_documents_page_v1(
  _tenant_id uuid,
  _cursor_created_at timestamptz default null,
  _cursor_id uuid default null,
  _page_limit integer default 50,
  _expected_revision bigint default null,
  _search text default null,
  _document_type text default null,
  _status text default null,
  _load_filter text default null
) returns table(
  items jsonb,
  total_count bigint,
  revision text,
  next_cursor_created_at timestamptz,
  next_cursor_id uuid,
  has_more boolean
)
language plpgsql
stable
security invoker
set search_path to ''
as $function$
declare
  v_revision bigint;
begin
  if _tenant_id is null or _page_limit < 1 or _page_limit > 200
    or ((_cursor_created_at is null) <> (_cursor_id is null)) then
    raise exception 'invalid_fiscal_document_cursor' using errcode = '22023';
  end if;
  if _load_filter is not null and _load_filter not in ('no_load', 'with_load') then
    raise exception 'invalid_fiscal_document_load_filter' using errcode = '22023';
  end if;

  v_revision:=private.current_fiscal_document_list_revision(_tenant_id);
  if _expected_revision is not null and _expected_revision<>v_revision then
    raise exception 'fiscal_document_list_changed' using errcode='40001';
  end if;

  return query
  with filtered as materialized (
    select f.*
    from public.fiscal_documents f
    left join public.clients c on c.id=f.client_id and c.tenant_id=f.tenant_id
    where f.tenant_id=_tenant_id
      and f.deleted_at is null
      and (_document_type is null or f.document_type=_document_type)
      and (_status is null or f.status=_status)
      and (_load_filter is null
        or (_load_filter='no_load' and f.load_id is null)
        or (_load_filter='with_load' and f.load_id is not null))
      and (nullif(btrim(_search),'') is null
        or f.invoice_number ilike '%'||btrim(_search)||'%'
        or f.remitter ilike '%'||btrim(_search)||'%'
        or f.recipient ilike '%'||btrim(_search)||'%'
        or f.access_key ilike '%'||btrim(_search)||'%'
        or c.company_name ilike '%'||btrim(_search)||'%')
  ), candidates as materialized (
    select f.*,c.company_name client_company_name,l.load_number related_load_number,o.order_number related_order_number
    from filtered f
    left join public.clients c on c.id=f.client_id and c.tenant_id=f.tenant_id
    left join public.loads l on l.id=f.load_id and l.tenant_id=f.tenant_id
    left join public.orders o on o.id=f.order_id and o.tenant_id=f.tenant_id
    where _cursor_created_at is null or (f.created_at,f.id)<(_cursor_created_at,_cursor_id)
    order by f.created_at desc,f.id desc
    limit _page_limit+1
  ), visible as materialized (
    select * from candidates order by created_at desc,id desc limit _page_limit
  ), continuation as (
    select created_at,id from visible order by created_at,id limit 1
  )
  select coalesce((select jsonb_agg(
      (to_jsonb(row)-'client_company_name'-'related_load_number'-'related_order_number')
      ||jsonb_build_object(
        'clients',case when row.client_company_name is null then null else jsonb_build_object('company_name',row.client_company_name) end,
        'loads',case when row.related_load_number is null then null else jsonb_build_object('load_number',row.related_load_number) end,
        'orders',case when row.related_order_number is null then null else jsonb_build_object('order_number',row.related_order_number) end)
      order by row.created_at desc,row.id desc) from visible row),'[]'::jsonb),
    (select count(*) from filtered),v_revision::text,
    case when (select count(*) from candidates)>_page_limit then (select created_at from continuation) end,
    case when (select count(*) from candidates)>_page_limit then (select id from continuation) end,
    (select count(*) from candidates)>_page_limit;
end;
$function$;

create index if not exists fiscal_documents_tenant_created_cursor
  on public.fiscal_documents(tenant_id,created_at desc,id desc) where deleted_at is null;

revoke all on function public.get_fiscal_documents_page_v1(uuid,timestamptz,uuid,integer,bigint,text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.get_fiscal_documents_page_v1(uuid,timestamptz,uuid,integer,bigint,text,text,text,text)
  to authenticated,service_role;

comment on function public.get_fiscal_documents_page_v1(uuid,timestamptz,uuid,integer,bigint,text,text,text,text) is
  'Keyset-pages fiscal documents and rejects later pages when any searchable or filterable source revision changes.';
