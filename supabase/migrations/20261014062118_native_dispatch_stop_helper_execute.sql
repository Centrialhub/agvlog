-- The invoker dispatch-stop trigger calls this pure text normalizer under the
-- authenticated actor. Keep client reads subject to that actor's existing RLS.
-- Fail closed if the helper no longer matches the reviewed, data-free body.
do $migration$
declare
  v_helper oid := to_regprocedure('private.normalized_address_text(text)');
begin
  if v_helper is null or not exists (
    select 1
    from pg_proc p
    join pg_language l on l.oid = p.prolang
    where p.oid = v_helper
      and pg_get_userbyid(p.proowner) = 'postgres'
      and not p.prosecdef
      and p.provolatile = 'i'
      and l.lanname = 'sql'
      and p.prokind = 'f'
      and not p.proretset
      and p.prorettype = 'text'::regtype
      and p.proconfig = array['search_path=""']::text[]
      and md5(p.prosrc) = '0a2360738d481c4e9edf4a8be45c0c43'
  ) then
    raise exception 'dispatch_stop_normalizer_definition_mismatch';
  end if;

  if has_function_privilege('anon', v_helper, 'EXECUTE')
    or has_function_privilege('service_role', v_helper, 'EXECUTE')
    or has_function_privilege('authenticated', v_helper, 'EXECUTE WITH GRANT OPTION') then
    raise exception 'dispatch_stop_normalizer_unexpected_acl';
  end if;

  grant execute on function private.normalized_address_text(text) to authenticated;

  if not has_function_privilege('authenticated', v_helper, 'EXECUTE') then
    raise exception 'dispatch_stop_normalizer_execute_grant_missing';
  end if;
end;
$migration$;
