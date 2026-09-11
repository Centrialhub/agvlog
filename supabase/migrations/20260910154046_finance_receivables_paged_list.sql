create function finance_private.receivables_page(_tenant uuid,_search text,_status text,_client uuid,_from date,_to date,_page integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;today date:=(statement_timestamp() at time zone 'America/Sao_Paulo')::date;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _search is null or length(_search)>200 or _page is null or _page not between 1 and 1000000 or _status is null or _status not in('all','pending','invoiced','partial','received','cancelled','overdue')
  or (_from is not null and not isfinite(_from)) or (_to is not null and not isfinite(_to)) or _from>_to then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 if _client is not null and not exists(select 1 from public.clients where tenant_id=_tenant and id=_client) then raise exception 'finance_client_not_found' using errcode='22023';end if;
 with candidates as materialized(
  select r.*,case when c.id is not null then jsonb_build_object('company_name',c.company_name) end clients
  from public.receivables r left join public.clients c on c.tenant_id=r.tenant_id and c.id=r.client_id
  where r.tenant_id=_tenant and (_client is null or r.client_id=_client)
   and (_status='all' or r.status=_status or (_status='overdue' and r.status in('pending','invoiced','partial') and isfinite(r.due_date) and r.due_date<today))
   and (_from is null or r.due_date>=_from) and (_to is null or r.due_date<=_to)
   and (_search='' or strpos(lower(concat_ws(' ',r.description,r.invoice_number,c.company_name)),lower(_search))>0)
 ), page_rows as(select * from candidates order by created_at desc nulls last,id desc limit 50 offset (_page-1)*50)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'page',_page,'page_size',50,'total',(select count(*) from candidates),
  'total_unfiltered',(select count(*) from public.receivables where tenant_id=_tenant),
  'rows',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc nulls last,p.id desc) from page_rows p),'[]')) into result;
 return result;
end$$;
revoke all on function finance_private.receivables_page(uuid,text,text,uuid,date,date,integer) from public,anon,authenticated,service_role;
grant execute on function finance_private.receivables_page(uuid,text,text,uuid,date,date,integer) to authenticated;
create function public.get_finance_receivables_page(_tenant_id uuid,_search text default '',_status text default 'all',_client_id uuid default null,_from date default null,_to date default null,_page integer default 1)
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.receivables_page(_tenant_id,_search,_status,_client_id,_from,_to,_page)$$;
revoke all on function public.get_finance_receivables_page(uuid,text,text,uuid,date,date,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_receivables_page(uuid,text,text,uuid,date,date,integer) to authenticated;
