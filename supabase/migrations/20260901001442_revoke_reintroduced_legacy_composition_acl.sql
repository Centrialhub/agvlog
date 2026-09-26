-- The canonical browser surface is the pair of _v2 wrappers. A later
-- composition migration recreated the legacy implementations and accidentally
-- granted them to authenticated again. The wrappers are SECURITY DEFINER and
-- therefore continue to call these owner-owned helpers after this revocation.

do $preflight$
declare
  v_contract record;
  v_observed_hash text;
begin
  -- Historical preflight compatibility only: the earlier document-composition
  -- migration rewrote all four bodies. Accept only both reviewed hashes for
  -- each signature; the ACL revocation below and all function DDL stay intact.
  for v_contract in select * from (values
    ('public.assign_fiscal_documents_to_load(uuid,uuid,uuid[])',
      '5ad09d2beee5b419d9af5ebd5eb96753','73793256599bf96b8232ddc15a68d166'),
    ('public.remove_fiscal_documents_from_load(uuid,uuid,uuid[])',
      'cb97d4e58d535240efc9be062cbd1593','151cc5f78065f8cbce15464d9d088933'),
    ('public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])',
      '1dfac4d7f001d60ac388f7767609a3cf','6ee516b30bc6d8fb5acdfd3a7820c9a4'),
    ('public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])',
      '385f77f83284de737f01eeba4d466f53','c2220961533993d755e6cae225c402ca')
  ) expected(signature,previous_hash,replay_hash) loop
    v_observed_hash := md5(replace(pg_get_functiondef(to_regprocedure(v_contract.signature)),
      E'\r\n', E'\n'));
    if v_observed_hash is distinct from v_contract.previous_hash
      and v_observed_hash is distinct from v_contract.replay_hash then
      raise exception 'Composition ACL dependency changed: %; observed hash %',
        v_contract.signature,v_observed_hash;
    end if;
  end loop;
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
