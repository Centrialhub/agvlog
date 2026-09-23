create index if not exists finance_unloading_charges_receivable_lookup on public.finance_unloading_charges(tenant_id,receivable_id);
create index if not exists finance_fiscal_receivable_origins_receivable_lookup on public.finance_fiscal_receivable_origins(tenant_id,receivable_id);
create index if not exists receivables_tenant_created_keyset on public.receivables(tenant_id,created_at desc,id desc);

create function finance_private.receivables_page_v3(_tenant uuid,_search text,_status text,_client uuid,_from date,_to date,_cursor jsonb,_origin text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;today date:=(statement_timestamp() at time zone 'America/Sao_Paulo')::date;
 cursor_created timestamptz:=nullif(_cursor->>'created_at','')::timestamptz;cursor_id uuid:=nullif(_cursor->>'id','')::uuid;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _origin is null or _origin not in('all','unloading','fiscal','other')or _search is null or length(_search)>200
  or _status is null or _status not in('all','pending','invoiced','partial','received','cancelled','overdue')
  or(_from is not null and not isfinite(_from))or(_to is not null and not isfinite(_to))or _from>_to
  or(_cursor is not null and(jsonb_typeof(_cursor)is distinct from'object'or cursor_created is null or cursor_id is null or exists(select 1 from jsonb_object_keys(_cursor)k where k not in('created_at','id'))))
 then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 if _client is not null and not exists(select 1 from public.clients where tenant_id=_tenant and id=_client)then raise exception 'finance_client_not_found' using errcode='22023';end if;
 with base as materialized(
  select r.id,r.created_at from public.receivables r left join public.clients c on c.tenant_id=r.tenant_id and c.id=r.client_id
  where r.tenant_id=_tenant and(_client is null or r.client_id=_client)
   and(_status='all'or r.status=_status or(_status='overdue'and r.status in('pending','invoiced','partial')and isfinite(r.due_date)and r.due_date<today))
   and(_from is null or r.due_date>=_from)and(_to is null or r.due_date<=_to)
   and(_search=''or strpos(lower(concat_ws(' ',r.description,r.invoice_number,c.company_name)),lower(_search))>0)
 ),filtered_keys as materialized(
  select b.* from base b join public.receivables r on r.tenant_id=_tenant and r.id=b.id
  where _origin='all'
   or(_origin='unloading'and exists(select 1 from public.finance_unloading_charges u where u.tenant_id=_tenant and u.receivable_id=r.id))
   or(_origin='fiscal'and not exists(select 1 from public.finance_unloading_charges u where u.tenant_id=_tenant and u.receivable_id=r.id)and(r.cte_document_id is not null or exists(select 1 from public.finance_fiscal_receivable_origins f where f.tenant_id=_tenant and f.receivable_id=r.id)))
   or(_origin='other'and not exists(select 1 from public.finance_unloading_charges u where u.tenant_id=_tenant and u.receivable_id=r.id)and r.cte_document_id is null and not exists(select 1 from public.finance_fiscal_receivable_origins f where f.tenant_id=_tenant and f.receivable_id=r.id))
 ),page_keys as materialized(
  select * from filtered_keys k where _cursor is null or k.created_at<cursor_created or(k.created_at=cursor_created and k.id<cursor_id)
  order by created_at desc,id desc limit 51
 ),rows as(
  select r.*,case when u.receivable_id is not null then'unloading'when r.cte_document_id is not null or f.receivable_id is not null then'fiscal'else'other'end origin_kind,
   case when c.id is not null then jsonb_build_object('company_name',c.company_name)end clients
  from(select * from page_keys order by created_at desc,id desc limit 50)k join public.receivables r on r.tenant_id=_tenant and r.id=k.id
  left join public.clients c on c.tenant_id=r.tenant_id and c.id=r.client_id
  left join lateral(select u.receivable_id from public.finance_unloading_charges u where u.tenant_id=_tenant and u.receivable_id=r.id limit 1)u on true
  left join lateral(select f.receivable_id from public.finance_fiscal_receivable_origins f where f.tenant_id=_tenant and f.receivable_id=r.id limit 1)f on true
 )
 select jsonb_build_object('version',3,'origin_filter',_origin,'tenant_id',_tenant,'page_size',50,'cursor',_cursor,
  'next_cursor',case when(select count(*)>50 from page_keys)then(select jsonb_build_object('created_at',created_at,'id',id)from page_keys order by created_at desc,id desc offset 49 limit 1)end,
  'has_more',(select count(*)>50 from page_keys),'total',(select count(*)from filtered_keys),'total_unfiltered',(select count(*)from public.receivables where tenant_id=_tenant),
  'rows',coalesce((select jsonb_agg(to_jsonb(p)order by p.created_at desc,p.id desc)from rows p),'[]'))into result;
 return result;
end$$;
revoke all on function finance_private.receivables_page_v3(uuid,text,text,uuid,date,date,jsonb,text)from public,anon,authenticated,service_role;
grant execute on function finance_private.receivables_page_v3(uuid,text,text,uuid,date,date,jsonb,text)to authenticated;
create function public.get_finance_receivables_page_v3(_tenant_id uuid,_search text default'',_status text default'all',_client_id uuid default null,_from date default null,_to date default null,_cursor jsonb default null,_origin text default'all')
returns jsonb language sql stable security invoker set search_path=''as $$select finance_private.receivables_page_v3(_tenant_id,_search,_status,_client_id,_from,_to,_cursor,_origin)$$;
revoke all on function public.get_finance_receivables_page_v3(uuid,text,text,uuid,date,date,jsonb,text)from public,anon,authenticated,service_role;
grant execute on function public.get_finance_receivables_page_v3(uuid,text,text,uuid,date,date,jsonb,text)to authenticated;
