create table if not exists public.portal_download_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  actor_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  parent_id uuid,
  file_format text not null,
  outcome text not null check (outcome in ('authorized','served','failed')),
  response_status integer,
  source_host text,
  user_agent text,
  requested_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);

alter table public.portal_download_audit enable row level security;
revoke all on public.portal_download_audit from public,anon,authenticated;

create index if not exists portal_download_audit_tenant_requested_idx
  on public.portal_download_audit(tenant_id,requested_at desc);
create index if not exists portal_download_audit_actor_requested_idx
  on public.portal_download_audit(actor_id,requested_at desc);

create or replace function public.portal_authorize_download_v1(
  _tenant_id uuid,
  _resource_type text,
  _resource_id uuid,
  _parent_id uuid default null,
  _format text default 'pdf'
) returns jsonb
language plpgsql
stable
security invoker
set search_path=''
set row_security='on'
as $function$
declare
  v_file jsonb;
begin
  if auth.uid() is null then raise exception 'not_authorized' using errcode='42501'; end if;

  if _resource_type in ('cte','nfse') then
    if _parent_id is null or _format not in ('pdf','xml') then
      raise exception 'invalid_file_request' using errcode='22023';
    end if;
    v_file:=private.portal_read_fiscal_bundle(
      _tenant_id,_parent_id,_resource_type,_resource_id,_format
    );
  elsif _resource_type='financial_title' then
    if _parent_id is not null or _format<>'pdf' then
      raise exception 'invalid_file_request' using errcode='22023';
    end if;
    v_file:=private.portal_read_financial_titles(
      _tenant_id,null,null,1,0,_resource_id
    );
  else
    raise exception 'invalid_file_request' using errcode='22023';
  end if;

  return jsonb_build_object(
    'tenant_id',_tenant_id,
    'actor_id',auth.uid(),
    'resource_type',_resource_type,
    'resource_id',_resource_id,
    'parent_id',_parent_id,
    'format',_format,
    'filename',v_file->>'filename',
    'content_type',case when _format='pdf' then 'application/pdf' else 'application/xml; charset=utf-8' end
  );
end
$function$;

revoke all on function public.portal_authorize_download_v1(uuid,text,uuid,uuid,text)
from public,anon,authenticated,service_role;
grant execute on function public.portal_authorize_download_v1(uuid,text,uuid,uuid,text)
to authenticated,service_role;

revoke all on function public.portal_get_fiscal_file(uuid,uuid,text,uuid,text),
  public.portal_get_financial_title_file(uuid,uuid)
from public,anon,authenticated;
grant execute on function public.portal_get_fiscal_file(uuid,uuid,text,uuid,text),
  public.portal_get_financial_title_file(uuid,uuid)
to service_role;

comment on table public.portal_download_audit is
  'Append-only audit trail for authenticated portal downloads served by the proxy.';
comment on function public.portal_authorize_download_v1(uuid,text,uuid,uuid,text) is
  'Rechecks current portal grants and returns metadata only; never exposes persisted provider URLs.';
