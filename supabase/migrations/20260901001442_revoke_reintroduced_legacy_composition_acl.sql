-- The canonical browser surface is the pair of _v2 wrappers. A later
-- composition migration recreated the legacy implementations and accidentally
-- granted them to authenticated again. The wrappers are SECURITY DEFINER and
-- therefore continue to call these owner-owned helpers after this revocation.

do $preflight$
begin
  if md5(replace(pg_get_functiondef(
    'public.assign_fiscal_documents_to_load(uuid,uuid,uuid[])'::regprocedure
  ), E'\r\n', E'\n')) <> '5ad09d2beee5b419d9af5ebd5eb96753' then
    raise exception 'assign_fiscal_documents_to_load changed before ACL repair';
  end if;

  if md5(replace(pg_get_functiondef(
    'public.remove_fiscal_documents_from_load(uuid,uuid,uuid[])'::regprocedure
  ), E'\r\n', E'\n')) <> 'cb97d4e58d535240efc9be062cbd1593' then
    raise exception 'remove_fiscal_documents_from_load changed before ACL repair';
  end if;

  if md5(replace(pg_get_functiondef(
    'public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])'::regprocedure
  ), E'\r\n', E'\n')) <> '1dfac4d7f001d60ac388f7767609a3cf'
  or md5(replace(pg_get_functiondef(
    'public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])'::regprocedure
  ), E'\r\n', E'\n')) <> '385f77f83284de737f01eeba4d466f53' then
    raise exception 'canonical composition wrapper changed before ACL repair';
  end if;
end;
$preflight$;

revoke all privileges on function
  public.assign_fiscal_documents_to_load(uuid, uuid, uuid[])
from public, anon, authenticated;

revoke all privileges on function
  public.remove_fiscal_documents_from_load(uuid, uuid, uuid[])
from public, anon, authenticated;

comment on function public.assign_fiscal_documents_to_load(uuid, uuid, uuid[]) is
  'Internal compatibility implementation. Browser callers must use assign_fiscal_documents_to_load_v2.';
comment on function public.remove_fiscal_documents_from_load(uuid, uuid, uuid[]) is
  'Internal compatibility implementation. Browser callers must use remove_fiscal_documents_from_load_v2.';
