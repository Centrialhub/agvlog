-- Captured from the restored local baseline on 2026-09-28, before corrective forwards.
-- Source record: ordinality-source-targets.json; SHA256 06f042b223e92c1337e692baaf03795fb3655f9d9fd7a3c0a3efc1e9159ae59e
-- Reviewed function definition only; no credentials or customer rows.
CREATE OR REPLACE FUNCTION public.get_finance_account_period_evidence_page(_tenant_id uuid, _account_id uuid, _closure_id uuid, _movement_offset integer DEFAULT 0, _dependency_offset integer DEFAULT 0, _limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 c public.finance_account_period_closures%rowtype;
 r public.finance_account_period_reopenings%rowtype;
 deps jsonb;
 movements jsonb;
 movement_total integer;
 dependency_total integer;
 expected_dependency_total integer;
 dependencies_match boolean := false;
 page_limit integer;
 paged_snapshot jsonb;
begin
 if not finance_private.can_access(_tenant_id) then
  raise exception 'finance_access_denied' using errcode='42501';
 end if;
 if _movement_offset < 0 or _dependency_offset < 0 then
  raise exception 'finance_evidence_invalid_offset' using errcode='22023';
 end if;
 page_limit:=least(greatest(_limit,1),100);
 select * into c
 from public.finance_account_period_closures
 where tenant_id=_tenant_id and account_id=_account_id and id=_closure_id;
 if not found then
  raise exception 'finance_period_closure_not_found' using errcode='22023';
 end if;
 select * into r
 from public.finance_account_period_reopenings
 where tenant_id=_tenant_id and closure_id=_closure_id;

 movement_total:=case when jsonb_typeof(c.snapshot#>'{facts,movements}')='array'
  then jsonb_array_length(c.snapshot#>'{facts,movements}') else 0 end;
 select coalesce(jsonb_agg(item order by ordinal),'[]'::jsonb) into movements
 from (
  select value item,ordinal
  from jsonb_array_elements(case when jsonb_typeof(c.snapshot#>'{facts,movements}')='array' then c.snapshot#>'{facts,movements}' else '[]'::jsonb end) with ordinality
  where ordinal > _movement_offset
  order by ordinal
  limit page_limit
 ) page;
 -- The full dependency array is deliberately removed from the paged snapshot.
 -- Its bounded page is returned in the top-level dependencies field below.
 paged_snapshot:=jsonb_set(c.snapshot,'{facts,movements}',movements,true)-'dependencies';

 select count(*)::integer into dependency_total
 from public.finance_account_period_dependencies
 where tenant_id=_tenant_id and closure_id=_closure_id;
 select coalesce(jsonb_agg(item order by item->>'source_kind',item->>'source_id'),'[]'::jsonb) into deps
 from (
  select to_jsonb(d)-'tenant_id'-'closure_id' item
  from public.finance_account_period_dependencies d
  where tenant_id=_tenant_id and closure_id=_closure_id
  order by source_kind,source_id
  offset _dependency_offset limit page_limit
 ) page;

 if jsonb_typeof(c.snapshot->'dependencies')='array' then
  select count(*)::integer into expected_dependency_total
  from jsonb_array_elements(c.snapshot->'dependencies');

  dependencies_match := expected_dependency_total=dependency_total
   and not exists(
    select 1
    from jsonb_array_elements(c.snapshot->'dependencies') expected(item)
    where not exists(
     select 1 from public.finance_account_period_dependencies d
     where d.tenant_id=_tenant_id and d.closure_id=_closure_id
       and to_jsonb(d)-'tenant_id'-'closure_id'=expected.item
    )
   )
   and not exists(
    select 1
    from public.finance_account_period_dependencies d
    where d.tenant_id=_tenant_id and d.closure_id=_closure_id
      and not exists(
       select 1 from jsonb_array_elements(c.snapshot->'dependencies') expected(item)
       where expected.item=to_jsonb(d)-'tenant_id'-'closure_id'
      )
   );
 end if;

 return jsonb_build_object(
  'version',1,'tenant_id',_tenant_id,'account_id',_account_id,'closure_id',_closure_id,
  'closure',jsonb_build_object('from',c.period_start,'to',c.period_end,'revision',c.snapshot_revision,'actor_id',c.actor_id,'actor_name',c.actor_name,'reason',c.reason,'created_at',c.created_at),
  'snapshot',paged_snapshot,'dependencies',deps,
  'movement_page',jsonb_build_object('offset',_movement_offset,'limit',page_limit,'total',movement_total),
  'dependency_page',jsonb_build_object('offset',_dependency_offset,'limit',page_limit,'total',dependency_total),
  'integrity',jsonb_build_object(
   'snapshot_matches_revision',coalesce(c.snapshot->>'revision'=c.snapshot_revision and md5((c.snapshot-'revision')::text)=c.snapshot_revision,false),
   'dependencies_match',dependencies_match
  ),
  'reopening',case when r.id is null then null else jsonb_build_object('id',r.id,'actor_id',r.actor_id,'actor_name',r.actor_name,'reason',r.reason,'created_at',r.created_at) end
 );
end$function$
;
