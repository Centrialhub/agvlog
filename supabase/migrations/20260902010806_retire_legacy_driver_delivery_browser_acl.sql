-- The current and published driver frontends no longer call these compatibility
-- writers. Browser delivery results use driver_record_delivery_outcome and
-- informational notes use driver_record_delivery_note. Keep service_role access
-- because the service-only finalize_driver_delivery alias still delegates to
-- driver_finalize_delivery.
-- PostgreSQL stores these bodies with LF while the Windows PGlite fixture can
-- preserve CRLF. Normalize only CRLF pairs to LF so line-ending transport is
-- portable without ignoring a standalone CR inside a token, literal or other
-- control-flow content.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $preflight$
declare
  contract record;
  target_oid oid;
  source_hash text;
  is_definer boolean;
  config text[];
  dependency_count integer;
  replacement text;
  alias_oid oid;
  alias_is_definer boolean;
  alias_config text[];
begin
  for contract in select * from (values
    ('public.driver_finalize_delivery(uuid,text,text,text[],text,text,text)', 'b94b098acff621dddcfbfd0232565c07'),
    ('public.driver_update_stop_status(uuid,text,text)', 'ed77f6d5eea53eeb282edfc9a4736c50')
  ) expected(signature, expected_canonical_source_hash)
  loop
    target_oid := pg_catalog.to_regprocedure(contract.signature);
    if target_oid is null then
      raise exception 'Legacy driver delivery ACL target is missing: %', contract.signature;
    end if;

    select pg_catalog.md5(pg_catalog.replace(
             proc.prosrc,
             pg_catalog.chr(13) || pg_catalog.chr(10),
             pg_catalog.chr(10)
           )),
           proc.prosecdef, proc.proconfig
      into source_hash, is_definer, config
    from pg_catalog.pg_proc as proc
    where proc.oid = target_oid;

    if source_hash <> contract.expected_canonical_source_hash
       or not is_definer
       or not ('search_path=""' = any(coalesce(config, array[]::text[]))) then
      raise exception 'Legacy driver delivery wrapper changed before ACL closure: %', contract.signature;
    end if;

    if not pg_catalog.has_function_privilege('authenticated', target_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', target_oid, 'EXECUTE')
       or not pg_catalog.has_function_privilege('service_role', target_oid, 'EXECUTE') then
      raise exception 'Legacy driver delivery wrapper ACL changed before closure: %', contract.signature;
    end if;

    select count(*)::integer
      into dependency_count
    from pg_catalog.pg_depend as dependency
    where dependency.refclassid = 'pg_proc'::pg_catalog.regclass
      and dependency.refobjid = target_oid
      and dependency.deptype in ('n', 'a')
      and dependency.classid in (
        'pg_policy'::pg_catalog.regclass,
        'pg_rewrite'::pg_catalog.regclass,
        'pg_trigger'::pg_catalog.regclass
      );
    if dependency_count <> 0 then
      raise exception 'Legacy driver delivery wrapper gained a database dependency: %', contract.signature;
    end if;
  end loop;

  foreach replacement in array array[
    'public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text)',
    'public.driver_record_delivery_note(uuid,text,jsonb,uuid)'
  ]
  loop
    target_oid := pg_catalog.to_regprocedure(replacement);
    if target_oid is null
       or not pg_catalog.has_function_privilege('authenticated', target_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', target_oid, 'EXECUTE')
       or not pg_catalog.has_function_privilege('service_role', target_oid, 'EXECUTE') then
      raise exception 'Canonical driver delivery RPC is not ready: %', replacement;
    end if;
  end loop;

  alias_oid := pg_catalog.to_regprocedure(
    'public.finalize_driver_delivery(uuid,text,text,text[],uuid)'
  );
  select proc.prosecdef, proc.proconfig
    into alias_is_definer, alias_config
  from pg_catalog.pg_proc as proc
  where proc.oid = alias_oid;
  if alias_oid is null
     or (select pg_catalog.md5(pg_catalog.replace(
           proc.prosrc,
           pg_catalog.chr(13) || pg_catalog.chr(10),
           pg_catalog.chr(10)
         ))
         from pg_catalog.pg_proc as proc where proc.oid = alias_oid)
       <> '0fc748c47fa464c9781d77518f2c1434'
     or not alias_is_definer
     or not ('search_path=""' = any(coalesce(alias_config, array[]::text[])))
     or pg_catalog.has_function_privilege('authenticated', alias_oid, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', alias_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', alias_oid, 'EXECUTE') then
    raise exception 'Service-only delivery alias changed before browser ACL closure';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as proc
    where proc.oid <> alias_oid
      and proc.prosrc ~ '(^|[^[:alnum:]_])driver_finalize_delivery[[:space:]]*\('
  ) or exists (
    select 1
    from pg_catalog.pg_proc as proc
    where proc.prosrc ~ '(^|[^[:alnum:]_])driver_update_stop_status[[:space:]]*\('
  ) then
    raise exception 'Legacy driver delivery wrapper gained an SQL function caller';
  end if;
end;
$preflight$;

revoke all privileges on function
  public.driver_finalize_delivery(uuid,text,text,text[],text,text,text),
  public.driver_update_stop_status(uuid,text,text)
from public, anon, authenticated;

comment on function public.driver_finalize_delivery(uuid,text,text,text[],text,text,text) is
  'Service compatibility wrapper; browser drivers use driver_record_delivery_outcome(jsonb details).';
comment on function public.driver_update_stop_status(uuid,text,text) is
  'Service compatibility wrapper; browser drivers use scoped arrival, departure and delivery RPCs.';

do $postflight$
declare
  signature text;
  target_oid oid;
begin
  foreach signature in array array[
    'public.driver_finalize_delivery(uuid,text,text,text[],text,text,text)',
    'public.driver_update_stop_status(uuid,text,text)'
  ]
  loop
    target_oid := pg_catalog.to_regprocedure(signature);
    if target_oid is null
       or pg_catalog.has_function_privilege('authenticated', target_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege('anon', target_oid, 'EXECUTE')
       or not pg_catalog.has_function_privilege('service_role', target_oid, 'EXECUTE') then
      raise exception 'Legacy driver delivery browser ACL closure failed: %', signature;
    end if;
  end loop;
end;
$postflight$;

commit;
