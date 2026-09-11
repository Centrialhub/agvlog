create function finance_private.cash_period_count_history(_tenant uuid,_account uuid,_end date,_page integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;active_account boolean;capable boolean;closed boolean;active_id uuid;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page<1 or _end is null or not isfinite(_end) then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 select active into active_account from public.bank_accounts where tenant_id=_tenant and id=_account and account_type='cash';
 if not found then raise exception 'finance_cash_account_required' using errcode='22023';end if;
 capable:=finance_private.can_close_account_period(_tenant);
 closed:=finance_private.closed_interval_exists(_tenant,_account,_end,_end);
 select c.id into active_id from public.finance_cash_period_counts c where c.tenant_id=_tenant and c.account_id=_account and c.period_end=_end
 and not exists(select 1 from public.finance_cash_period_count_reversals r where r.tenant_id=c.tenant_id and r.count_id=c.id);
 with entries as (
  select c.*,to_jsonb(r) reversal from public.finance_cash_period_counts c
  left join public.finance_cash_period_count_reversals r on r.tenant_id=c.tenant_id and r.count_id=c.id
  where c.tenant_id=_tenant and c.account_id=_account and c.period_end=_end
 ), page_rows as (
  select * from entries order by created_at desc,id desc limit 30 offset ((_page::bigint-1)*30)
 )
 select jsonb_build_object('version',1,'tenant_id',_tenant,'account_id',_account,'period_end',_end,'page',_page,'page_size',30,
  'total',(select count(*) from entries),'active_count_id',active_id,
  'can_record',coalesce(active_account,false) and not closed and active_id is null and _end<(statement_timestamp() at time zone 'America/Sao_Paulo')::date,
  'can_reverse',capable and not closed,
  'rows',coalesce(jsonb_agg((to_jsonb(c)-'reversal')||jsonb_build_object('total_cents',c.total_cents::text,'reversal',c.reversal,
   'can_reverse',capable and not closed and c.reversal is null and not exists(
    select 1 from public.finance_account_period_dependencies d join public.finance_account_period_closures cl on cl.tenant_id=d.tenant_id and cl.id=d.closure_id
    where d.tenant_id=_tenant and d.source_kind='finance_cash_period_counts' and d.source_id=c.id
    and not exists(select 1 from public.finance_account_period_reopenings r where r.tenant_id=cl.tenant_id and r.closure_id=cl.id)
   )) order by c.created_at desc,c.id desc),'[]'::jsonb)) into result from page_rows c;
 return result;
end$$;
revoke all on function finance_private.cash_period_count_history(uuid,uuid,date,integer) from public,anon,service_role;
grant execute on function finance_private.cash_period_count_history(uuid,uuid,date,integer) to authenticated;
create function public.get_finance_cash_period_counts(_tenant_id uuid,_account_id uuid,_period_end date,_page integer default 1)
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.cash_period_count_history(_tenant_id,_account_id,_period_end,_page)$$;
revoke all on function public.get_finance_cash_period_counts(uuid,uuid,date,integer) from public,anon,service_role;
grant execute on function public.get_finance_cash_period_counts(uuid,uuid,date,integer) to authenticated;
