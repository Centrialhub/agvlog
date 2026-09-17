-- Extend the already-published v2 artifact bridge with an inert workbook
-- derivative. The original XLS/XLSX stays private and immutable.
set lock_timeout = '3s';
set statement_timeout = '30s';

do $preflight$
declare
  v_proc record;
begin
  select q.* into v_proc
  from pg_proc q
  where q.oid = to_regprocedure('secure_upload_private.finalize(jsonb)');
  if v_proc.oid is null
    or md5(v_proc.prosrc) <> '1ab94b41832df7708ace3ea3824d25f9'
    or not v_proc.prosecdef
    or v_proc.provolatile <> 'v'
    or v_proc.proconfig is distinct from array['search_path=""']::text[]
    or has_function_privilege('anon', v_proc.oid, 'execute')
    or has_function_privilege('authenticated', v_proc.oid, 'execute')
    or not has_function_privilege('service_role', v_proc.oid, 'execute')
    or exists(
      select 1 from aclexplode(coalesce(v_proc.proacl, acldefault('f', v_proc.proowner))) a
      where a.privilege_type = 'EXECUTE'
        and a.grantee not in (v_proc.proowner, (select oid from pg_roles where rolname = 'service_role'))
    )
  then
    raise exception 'finance_workbook_finalize_predecessor_changed' using errcode = '55000';
  end if;

  select q.* into v_proc
  from pg_proc q
  where q.oid = to_regprocedure('secure_upload_private.statement_source(uuid,uuid,uuid,text,text)');
  if v_proc.oid is null
    or md5(v_proc.prosrc) <> '3bfad50cf14ca921083d02a8f609f6ab'
    or not v_proc.prosecdef
    or v_proc.provolatile <> 's'
    or v_proc.proconfig is distinct from array['search_path=""']::text[]
    or has_function_privilege('anon', v_proc.oid, 'execute')
    or has_function_privilege('authenticated', v_proc.oid, 'execute')
    or has_function_privilege('service_role', v_proc.oid, 'execute')
    or exists(
      select 1 from aclexplode(coalesce(v_proc.proacl, acldefault('f', v_proc.proowner))) a
      where a.privilege_type = 'EXECUTE' and a.grantee <> v_proc.proowner
    )
  then
    raise exception 'finance_workbook_source_predecessor_changed' using errcode = '55000';
  end if;

  select q.* into v_proc
  from pg_proc q
  where q.oid = to_regprocedure('finance_private.intake_statement_artifact(jsonb)');
  if v_proc.oid is null
    or md5(v_proc.prosrc) <> '5d355998e92d4f4db8b3db1072a7f417'
    or not v_proc.prosecdef
    or v_proc.provolatile <> 'v'
    or v_proc.proconfig is distinct from array['search_path=""']::text[]
    or has_function_privilege('anon', v_proc.oid, 'execute')
    or not has_function_privilege('authenticated', v_proc.oid, 'execute')
    or has_function_privilege('service_role', v_proc.oid, 'execute')
    or exists(
      select 1 from aclexplode(coalesce(v_proc.proacl, acldefault('f', v_proc.proowner))) a
      where a.privilege_type = 'EXECUTE'
        and a.grantee not in (v_proc.proowner, (select oid from pg_roles where rolname = 'authenticated'))
    )
  then
    raise exception 'finance_workbook_intake_predecessor_changed' using errcode = '55000';
  end if;
end
$preflight$;

do $upgrade$
declare
  v_proc record;
  body text;
  updated text;
begin
  select q.oid, q.prosrc into v_proc
  from pg_proc q
  where q.oid = 'secure_upload_private.finalize(jsonb)'::regprocedure;
  body := v_proc.prosrc;
  updated := replace(
    body,
    $old$if not((a.format='ofx' and method='native-ofx-v1') or (a.format='csv' and method='strict-csv-matrix-v1'))$old$,
    $new$if not((a.format='ofx' and method='native-ofx-v1') or (a.format='csv' and method='strict-csv-matrix-v1') or (a.format in('xls','xlsx') and method='strict-workbook-matrix-v1'))$new$
  );
  updated := replace(
    updated,
    $old$d->'financial_mapping_required' is distinct from to_jsonb(a.format='csv')$old$,
    $new$d->'financial_mapping_required' is distinct from to_jsonb(a.format in('csv','xls','xlsx'))$new$
  );
  if updated = body
    or position('strict-workbook-matrix-v1' in updated) = 0
    or position($old$to_jsonb(a.format='csv')$old$ in updated) <> 0
  then
    raise exception 'finance_workbook_finalize_contract_changed' using errcode = '55000';
  end if;
  execute replace(pg_get_functiondef(v_proc.oid), body, updated);

  select q.oid, q.prosrc into v_proc
  from pg_proc q
  where q.oid = 'secure_upload_private.statement_source(uuid,uuid,uuid,text,text)'::regprocedure;
  body := v_proc.prosrc;
  updated := replace(
    body,
    $old$a.format not in('ofx','csv')$old$,
    $new$a.format not in('ofx','csv','xls','xlsx')$new$
  );
  if updated = body
    or position($new$a.format not in('ofx','csv','xls','xlsx')$new$ in updated) = 0
  then
    raise exception 'finance_workbook_source_contract_changed' using errcode = '55000';
  end if;
  execute replace(pg_get_functiondef(v_proc.oid), body, updated);

  select q.oid, q.prosrc into v_proc
  from pg_proc q
  where q.oid = 'finance_private.intake_statement_artifact(jsonb)'::regprocedure;
  body := v_proc.prosrc;
  updated := replace(
    body,
    $old$if (source#>>'{artifact,original,format}'='ofx' and _payload->>'parser_version'<>'native-ofx-v1') or (source#>>'{artifact,original,format}'='csv' and _payload->>'parser_version'<>'mapped-csv-v1') then raise exception 'finance_artifact_parser_mismatch' using errcode='23514';end if;$old$,
    $new$if not (
   (source#>>'{artifact,original,format}'='ofx' and _payload->>'parser_version'='native-ofx-v1')
   or (source#>>'{artifact,original,format}'='csv' and _payload->>'parser_version'='mapped-csv-v1')
   or (source#>>'{artifact,original,format}' in('xls','xlsx') and _payload->>'parser_version'='mapped-workbook-v1')
  ) then raise exception 'finance_artifact_parser_mismatch' using errcode='23514';end if;$new$
  );
  if updated = body
    or position($new$source#>>'{artifact,original,format}' in('xls','xlsx')$new$ in updated) = 0
  then
    raise exception 'finance_workbook_intake_contract_changed' using errcode = '55000';
  end if;
  execute replace(pg_get_functiondef(v_proc.oid), body, updated);
end
$upgrade$;

-- CREATE OR REPLACE preserves ACLs, but repeat the intended boundary explicitly.
revoke all on function secure_upload_private.finalize(jsonb) from public, anon, authenticated, service_role;
grant execute on function secure_upload_private.finalize(jsonb) to service_role;
revoke all on function secure_upload_private.statement_source(uuid,uuid,uuid,text,text) from public, anon, authenticated, service_role;
revoke all on function finance_private.intake_statement_artifact(jsonb) from public, anon, authenticated, service_role;
grant execute on function finance_private.intake_statement_artifact(jsonb) to authenticated;

do $postflight$
declare
  v_proc record;
begin
  select q.* into v_proc from pg_proc q where q.oid = 'secure_upload_private.finalize(jsonb)'::regprocedure;
  if has_function_privilege('anon', v_proc.oid, 'execute')
    or has_function_privilege('authenticated', v_proc.oid, 'execute')
    or not has_function_privilege('service_role', v_proc.oid, 'execute')
    or exists(
      select 1 from aclexplode(coalesce(v_proc.proacl, acldefault('f', v_proc.proowner))) a
      where a.privilege_type = 'EXECUTE'
        and a.grantee not in (v_proc.proowner, (select oid from pg_roles where rolname = 'service_role'))
    )
  then
    raise exception 'finance_workbook_finalize_acl_postflight_failed' using errcode = '55000';
  end if;

  select q.* into v_proc from pg_proc q where q.oid = 'secure_upload_private.statement_source(uuid,uuid,uuid,text,text)'::regprocedure;
  if has_function_privilege('anon', v_proc.oid, 'execute')
    or has_function_privilege('authenticated', v_proc.oid, 'execute')
    or has_function_privilege('service_role', v_proc.oid, 'execute')
    or exists(
      select 1 from aclexplode(coalesce(v_proc.proacl, acldefault('f', v_proc.proowner))) a
      where a.privilege_type = 'EXECUTE' and a.grantee <> v_proc.proowner
    )
  then
    raise exception 'finance_workbook_source_acl_postflight_failed' using errcode = '55000';
  end if;

  select q.* into v_proc from pg_proc q where q.oid = 'finance_private.intake_statement_artifact(jsonb)'::regprocedure;
  if has_function_privilege('anon', v_proc.oid, 'execute')
    or not has_function_privilege('authenticated', v_proc.oid, 'execute')
    or has_function_privilege('service_role', v_proc.oid, 'execute')
    or exists(
      select 1 from aclexplode(coalesce(v_proc.proacl, acldefault('f', v_proc.proowner))) a
      where a.privilege_type = 'EXECUTE'
        and a.grantee not in (v_proc.proowner, (select oid from pg_roles where rolname = 'authenticated'))
    )
  then
    raise exception 'finance_workbook_intake_acl_postflight_failed' using errcode = '55000';
  end if;
end
$postflight$;
