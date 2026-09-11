create or replace function private.request_tenant_id()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_headers jsonb;
  v_header_raw text;
  v_claim_raw text;
  v_raw text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception
    when invalid_text_representation then
      raise exception 'tenant_context_invalid_headers' using errcode = '22023';
  end;

  v_header_raw := nullif(btrim(v_headers ->> 'x-agvlog-tenant-id'), '');
  v_claim_raw := nullif(btrim(auth.jwt() ->> 'active_tenant_id'), '');

  if v_header_raw is not null and v_claim_raw is not null and v_header_raw <> v_claim_raw then
    raise exception 'tenant_context_claim_mismatch' using errcode = '42501';
  end if;

  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated' and v_claim_raw is null then
    raise exception 'tenant_context_claim_required' using errcode = '42501';
  end if;

  v_raw := coalesce(v_header_raw, v_claim_raw);
  if v_raw is null then
    raise exception 'tenant_context_required' using errcode = '22023';
  end if;

  begin
    return v_raw::uuid;
  exception
    when invalid_text_representation then
      raise exception 'tenant_context_invalid' using errcode = '22023';
  end;
end;
$function$;

revoke all on function private.request_tenant_id()
from public, anon, authenticated, service_role;
grant execute on function private.request_tenant_id()
to authenticated, service_role;

comment on function private.request_tenant_id() is
  'Returns the active tenant only when the request header and signed JWT context agree; authenticated requests require the signed claim.';
