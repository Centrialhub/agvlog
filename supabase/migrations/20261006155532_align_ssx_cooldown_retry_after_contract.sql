-- Align existing SSX 86400-second retry contract; no new history/cadence policy or grants.
-- Source a19399268f77831dbe45f9ca61021b311b474639; exact PL/pgSQL body fingerprints, CRLF normalized only.
-- Account: 1 hour -> 24 elapsed hours. Unit: calendar day -> 24 elapsed hours (DST independent).
DO $ssx_cooldown_contract$
DECLARE
  item record; function_oid oid; predecessor pg_catalog.pg_proc%ROWTYPE;
  successor pg_catalog.pg_proc%ROWTYPE; definition text; actual_hash text;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout','3s',true);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('agvlog:ssx-cooldown-contract-v1',0));
  FOR item IN SELECT * FROM (VALUES
    ('public.record_ssx_account_cooldown_v1(uuid,uuid,timestamptz,timestamptz,text)',5,'1beba355817d8d2f84bc2b03ebbd8e1a','ad385a5fa7b2db14364b3d6ef4de3922',$fragment$interval '1 hour'$fragment$,$fragment$interval '24 hours'$fragment$),
    ('public.record_ssx_poll_error_v1(uuid,uuid,uuid,uuid,uuid,timestamptz,text,timestamptz,jsonb)',9,'192986fdf6b499ad98e4190bb22752ab','744cf7391b0a9d8f9287d307ef347ef1',$fragment$interval '1 day'$fragment$,$fragment$interval '24 hours'$fragment$)
  ) v(signature,nargs,source_hash,target_hash,source_fragment,target_fragment) LOOP
    function_oid:=pg_catalog.to_regprocedure(item.signature);
    IF function_oid IS NULL THEN RAISE EXCEPTION 'ssx_cooldown_function_missing' USING ERRCODE='55000'; END IF;
    SELECT * INTO predecessor FROM pg_catalog.pg_proc WHERE oid=function_oid;
    actual_hash:=pg_catalog.md5(pg_catalog.replace(predecessor.prosrc,E'\r\n',E'\n'));
    IF predecessor.prokind<>'f' OR predecessor.pronargs<>item.nargs
      OR predecessor.prorettype<>'pg_catalog.jsonb'::pg_catalog.regtype OR predecessor.proretset
      OR predecessor.prosecdef OR predecessor.proisstrict OR predecessor.proleakproof
      OR predecessor.provolatile<>'v' OR predecessor.proparallel<>'u' OR predecessor.procost<>100
      OR pg_catalog.pg_get_userbyid(predecessor.proowner)<>'postgres'
      OR predecessor.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
      OR predecessor.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
      OR actual_hash NOT IN (item.source_hash,item.target_hash)
      OR NOT pg_catalog.has_function_privilege('service_role',function_oid,'EXECUTE')
      OR pg_catalog.has_function_privilege('anon',function_oid,'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated',function_oid,'EXECUTE')
      OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(predecessor.proacl,pg_catalog.acldefault('f',predecessor.proowner)))
        WHERE grantee=0 AND privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'ssx_cooldown_predecessor_changed' USING ERRCODE='55000';
    END IF;
    IF actual_hash=item.target_hash THEN CONTINUE; END IF;
    definition:=pg_catalog.pg_get_functiondef(function_oid);
    IF (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,item.source_fragment,'')))
      / pg_catalog.length(item.source_fragment) <> 1 THEN
      RAISE EXCEPTION 'ssx_cooldown_duration_guard_changed' USING ERRCODE='55000';
    END IF;
    EXECUTE pg_catalog.replace(definition,item.source_fragment,item.target_fragment);
    SELECT * INTO successor FROM pg_catalog.pg_proc WHERE oid=function_oid;
    IF pg_catalog.md5(pg_catalog.replace(successor.prosrc,E'\r\n',E'\n'))<>item.target_hash
      OR successor.proacl IS DISTINCT FROM predecessor.proacl
      OR successor.proowner<>predecessor.proowner OR successor.prosecdef<>predecessor.prosecdef
      OR successor.proconfig IS DISTINCT FROM predecessor.proconfig
      OR successor.proargnames IS DISTINCT FROM predecessor.proargnames THEN
      RAISE EXCEPTION 'ssx_cooldown_poststate_changed' USING ERRCODE='55000';
    END IF;
  END LOOP;
END;
$ssx_cooldown_contract$;
