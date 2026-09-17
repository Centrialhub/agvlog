create or replace function public.get_finance_account_period_evidence_page(
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
end$$;

drop function public.get_finance_account_period_history(uuid,uuid,integer,integer);
drop function finance_private.account_period_history(uuid,uuid,integer,integer);

create function finance_private.account_period_history(
 _tenant uuid,
 _account uuid,
 _offset integer,
 _limit integer,
 _snapshot_at timestamptz
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;capable boolean;effective_snapshot timestamptz:=coalesce(_snapshot_at,statement_timestamp());
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _offset is null or _offset<0 or _limit is null or _limit<1 or _limit>100 or effective_snapshot>statement_timestamp()+interval '5 minutes' then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 if not exists(select 1 from public.bank_accounts where tenant_id=_tenant and id=_account) then raise exception 'finance_account_not_found' using errcode='22023';end if;
 capable:=finance_private.can_close_account_period(_tenant);
 with recursive all_closures as (
  select c.*,r.id reopening_id,r.actor_id reopening_actor_id,r.actor_name reopening_actor_name,r.reason reopening_reason,r.created_at reopened_at
  from public.finance_account_period_closures c
  left join public.finance_account_period_reopenings r
   on r.tenant_id=c.tenant_id and r.closure_id=c.id and r.created_at<=effective_snapshot
  where c.tenant_id=_tenant and c.account_id=_account and c.created_at<=effective_snapshot
 ), descendants(root_id,id) as (
  select predecessor_id,id from all_closures where predecessor_id is not null
  union
  select d.root_id,c.id from descendants d join all_closures c on c.predecessor_id=d.id
 ), page as (
  select * from all_closures order by period_end desc,created_at desc,id desc offset _offset limit _limit
 ), entries as (
  select c.*,coalesce((select jsonb_agg(d.id order by d.id) from descendants d join all_closures child on child.id=d.id where d.root_id=c.id and child.reopening_id is null),'[]'::jsonb) children
  from page c
 )
 select jsonb_build_object('version',1,'tenant_id',_tenant,'account_id',_account,'snapshot_at',effective_snapshot,'offset',_offset,'limit',_limit,'total_count',(select count(*) from all_closures),'can_execute',capable,
 'items',coalesce(jsonb_agg(jsonb_build_object('id',id,'from',period_start,'to',period_end,'revision',snapshot_revision,'actor_id',actor_id,'actor_name',actor_name,'reason',reason,'created_at',created_at,
 'active',reopening_id is null,'can_reopen',capable and reopening_id is null and children='[]'::jsonb,'active_descendant_ids',children,
 'opening_cents',snapshot#>>'{balances,opening_cents}','closing_cents',snapshot#>>'{balances,closing_cents}',
 'reopening',case when reopening_id is null then null else jsonb_build_object('id',reopening_id,'actor_id',reopening_actor_id,'actor_name',reopening_actor_name,'reason',reopening_reason,'created_at',reopened_at) end)
 order by period_end desc,created_at desc,id desc),'[]'::jsonb)) into result from entries;
 return result;
end$$;
revoke all on function finance_private.account_period_history(uuid,uuid,integer,integer,timestamptz) from public,anon,authenticated,service_role;
grant execute on function finance_private.account_period_history(uuid,uuid,integer,integer,timestamptz) to authenticated;

create function public.get_finance_account_period_history(
 _tenant_id uuid,
 _account_id uuid,
 _offset integer default 0,
 _limit integer default 30,
 _snapshot_at timestamptz default null
)
returns jsonb language sql stable security invoker set search_path='' as $$
 select finance_private.account_period_history(_tenant_id,_account_id,_offset,_limit,_snapshot_at)
$$;
revoke all on function public.get_finance_account_period_history(uuid,uuid,integer,integer,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_account_period_history(uuid,uuid,integer,integer,timestamptz) to authenticated;
