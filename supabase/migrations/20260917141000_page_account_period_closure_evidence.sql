create function public.get_finance_account_period_evidence_page(
 _tenant_id uuid,
 _account_id uuid,
 _closure_id uuid,
 _movement_offset integer default 0,
 _dependency_offset integer default 0,
 _limit integer default 30
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
 c public.finance_account_period_closures%rowtype;
 r public.finance_account_period_reopenings%rowtype;
 deps jsonb;
 expected jsonb;
 movements jsonb;
 movement_total integer;
 dependency_total integer;
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
 paged_snapshot:=jsonb_set(c.snapshot,'{facts,movements}',movements,true);

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
  select coalesce(jsonb_agg(value order by value->>'source_kind',value->>'source_id'),'[]'::jsonb) into expected
  from jsonb_array_elements(c.snapshot->'dependencies');
 end if;
 return jsonb_build_object(
  'version',1,'tenant_id',_tenant_id,'account_id',_account_id,'closure_id',_closure_id,
  'closure',jsonb_build_object('from',c.period_start,'to',c.period_end,'revision',c.snapshot_revision,'actor_id',c.actor_id,'actor_name',c.actor_name,'reason',c.reason,'created_at',c.created_at),
  'snapshot',paged_snapshot,'dependencies',deps,
  'movement_page',jsonb_build_object('offset',_movement_offset,'limit',page_limit,'total',movement_total),
  'dependency_page',jsonb_build_object('offset',_dependency_offset,'limit',page_limit,'total',dependency_total),
  'integrity',jsonb_build_object(
   'snapshot_matches_revision',coalesce(c.snapshot->>'revision'=c.snapshot_revision and md5((c.snapshot-'revision')::text)=c.snapshot_revision,false),
   'dependencies_match',coalesce(expected=(select coalesce(jsonb_agg(to_jsonb(d)-'tenant_id'-'closure_id' order by source_kind,source_id),'[]'::jsonb) from public.finance_account_period_dependencies d where tenant_id=_tenant_id and closure_id=_closure_id),false)
  ),
  'reopening',case when r.id is null then null else jsonb_build_object('id',r.id,'actor_id',r.actor_id,'actor_name',r.actor_name,'reason',r.reason,'created_at',r.created_at) end
 );
end$$;

revoke all on function public.get_finance_account_period_evidence_page(uuid,uuid,uuid,integer,integer,integer) from public,anon,service_role;
grant execute on function public.get_finance_account_period_evidence_page(uuid,uuid,uuid,integer,integer,integer) to authenticated;
