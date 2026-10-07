-- Executable counterexamples for specific context/record lint findings.
-- No filter or tenant guard is removed. All fixtures roll back.
begin;
set local search_path=public,extensions;
set local lock_timeout='3s';
set local statement_timeout='30s';
select no_plan();

select lives_ok($$select extensions.postgis_full_version()$$,
  'PostGIS full version executes without the optional raster function');
create temporary table qa_lint_geometry(geom extensions.geometry(Point,4326));
insert into qa_lint_geometry values(extensions.st_setsrid(extensions.st_makepoint(0,0),4326)),
  (extensions.st_setsrid(extensions.st_makepoint(1,1),4326));
select is(extensions.st_findextent('qa_lint_geometry','geom')::text,'BOX(0 0,1 1)',
  'two-argument extent assigns its dynamic record on a nonempty geometry fixture');
select is(extensions.st_findextent('pg_temp','qa_lint_geometry','geom')::text,'BOX(0 0,1 1)',
  'three-argument extent assigns its dynamic record on a nonempty geometry fixture');

select set_config('request.headers','{}',true);
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',true);
set local role authenticated;
select throws_ok($$select public.resolve_ssx_mapping_conflict_v1(
  '90000000-0000-4000-8000-000000000001',null,'Synthetic review')$$,
  '42501','tenant_context_claim_required','SSX v1 refuses an authenticated request without a signed tenant claim');
select throws_ok($$select public.resolve_ssx_mapping_conflict_v2(
  '90000000-0000-4000-8000-000000000001',null,'Synthetic review',
  '90000000-0000-4000-8000-000000000002')$$,
  '42501','tenant_context_claim_required','SSX v2 refuses an authenticated request without a signed tenant claim');

select set_config('request.headers','{"x-agvlog-tenant-id":"20000000-0000-4000-8000-000000000001"}',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1","active_tenant_id":"20000000-0000-4000-8000-000000000001"}',true);
select throws_ok($$select public.resolve_ssx_mapping_conflict_v1(
  '90000000-0000-4000-8000-000000000001',null,'Synthetic review')$$,
  'P0002','mapping_conflict_not_found','SSX v1 with valid context reaches its domain contract');
select throws_ok($$select public.resolve_ssx_mapping_conflict_v2(
  '90000000-0000-4000-8000-000000000001',null,'Synthetic review',
  '90000000-0000-4000-8000-000000000002')$$,
  'P0002','mapping_conflict_not_found','SSX v2 with valid context reaches its domain contract');
reset role;

select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal1","active_tenant_id":"20000000-0000-4000-8000-000000000001"}',true);
select lives_ok($$select finance_private.legacy_integrity_inventory_revision(
  '20000000-0000-4000-8000-000000000001')$$,
  'legacy integrity FOREACH executes every table name separately');
select throws_ok($$select finance_private.unloading_projection_repair_context(
  '20000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000003')$$,
  '22023','finance_unloading_not_found','unloading repair still requires an existing audited charge');
-- Extract the exact array and SELECT from the installed function, exercising
-- the specific dynamic-record lint finding without inventing financial origin.
-- This scoped proof does not approve the complete repair command.
create function pg_temp.probe_unloading_dependency_loop() returns void language plpgsql as $probe$
declare source text; names text[]; query text; tab text; rows jsonb;
begin
  select prosrc into source from pg_proc where oid=
    'finance_private.unloading_projection_repair_context(uuid,uuid)'::regprocedure;
  names:=(regexp_match(source,'foreach tab in array array\[([^]]+)\] loop'));
  if names is null then raise exception 'unloading_loop_source_changed'; end if;
  execute 'select array['||names[1]||']::text[]' into names;
  if cardinality(names)<>14 then raise exception 'unloading_dependency_inventory_changed'; end if;
  query:=(regexp_match(source,'execute format\(\$q\$(.*?)\$q\$,tab\)','s'))[1];
  if query is null or ltrim(query) not like 'select %' then raise exception 'unloading_query_source_changed'; end if;
  foreach tab in array names loop
    if to_regclass('public.'||tab) is null then raise exception 'unloading_dependency_missing'; end if;
    execute format(query,tab) into rows using
      '20000000-0000-4000-8000-000000000001'::uuid,
      '90000000-0000-4000-8000-000000000004',
      '90000000-0000-4000-8000-000000000003',tab;
    if rows<>'[]'::jsonb then raise exception 'unexpected_synthetic_dependency'; end if;
  end loop;
end;
$probe$;
select lives_ok($$select pg_temp.probe_unloading_dependency_loop()$$,
  'the exact unloading FOREACH and SELECT execute across all fourteen dependencies');
select * from finish();
rollback;
