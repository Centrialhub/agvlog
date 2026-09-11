-- History remains readable even when a fresh preview cannot close the account.
create function finance_private.account_period_history(_tenant uuid,_account uuid,_offset integer,_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;capable boolean;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _offset is null or _offset<0 or _limit is null or _limit<1 or _limit>100 then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 if not exists(select 1 from public.bank_accounts where tenant_id=_tenant and id=_account) then raise exception 'finance_account_not_found' using errcode='22023';end if;
 capable:=finance_private.can_close_account_period(_tenant);
 with recursive all_closures as (
  select c.*,r.id reopening_id,r.actor_id reopening_actor_id,r.actor_name reopening_actor_name,r.reason reopening_reason,r.created_at reopened_at
  from public.finance_account_period_closures c left join public.finance_account_period_reopenings r on r.tenant_id=c.tenant_id and r.closure_id=c.id
  where c.tenant_id=_tenant and c.account_id=_account
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
 select jsonb_build_object('version',1,'tenant_id',_tenant,'account_id',_account,'offset',_offset,'limit',_limit,'total_count',(select count(*) from all_closures),'can_execute',capable,
 'items',coalesce(jsonb_agg(jsonb_build_object('id',id,'from',period_start,'to',period_end,'revision',snapshot_revision,'actor_id',actor_id,'actor_name',actor_name,'reason',reason,'created_at',created_at,
 'active',reopening_id is null,'can_reopen',capable and reopening_id is null and children='[]'::jsonb,'active_descendant_ids',children,
 'opening_cents',snapshot#>>'{balances,opening_cents}','closing_cents',snapshot#>>'{balances,closing_cents}',
 'reopening',case when reopening_id is null then null else jsonb_build_object('id',reopening_id,'actor_id',reopening_actor_id,'actor_name',reopening_actor_name,'reason',reopening_reason,'created_at',reopened_at) end)
 order by period_end desc,created_at desc,id desc),'[]'::jsonb)) into result from entries;
 return result;
end$$;
revoke all on function finance_private.account_period_history(uuid,uuid,integer,integer) from public,anon,service_role;
grant execute on function finance_private.account_period_history(uuid,uuid,integer,integer) to authenticated;
create function public.get_finance_account_period_history(_tenant_id uuid,_account_id uuid,_offset integer default 0,_limit integer default 30)
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.account_period_history(_tenant_id,_account_id,_offset,_limit)$$;
revoke all on function public.get_finance_account_period_history(uuid,uuid,integer,integer) from public,anon,service_role;
grant execute on function public.get_finance_account_period_history(uuid,uuid,integer,integer) to authenticated;
