create function finance_private.expense_options(_tenant uuid,_kind text,_search text default '',_trip uuid default null,_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; total bigint; driver uuid;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _kind not in('trips','movements','suppliers','centers','deliveries') or _kind is null
   or _page is null or _page not between 1 and 1000000 or length(coalesce(_search,''))>200 then
   raise exception 'finance_invalid_options' using errcode='22023';end if;
 if _trip is not null then
   select driver_id into driver from public.dispatch_trips where id=_trip and tenant_id=_tenant and status='completed';
   if not found then raise exception 'finance_trip_not_completed' using errcode='22023';end if;
 end if;
 with options as materialized (
   select t.id,coalesce(d.name,'Sem motorista')||' · '||coalesce(to_jsonb(t)->>'actual_end_at',to_jsonb(t)->>'planned_start_at',left(t.id::text,8)) label,
     jsonb_build_object('driver_id',t.driver_id) extra
   from public.dispatch_trips t left join public.drivers d on d.id=t.driver_id and d.tenant_id=t.tenant_id
   where _kind='trips' and t.tenant_id=_tenant and t.status='completed'
   union all
   select m.id,m.beneficiary_name||' · '||m.occurred_on::text||' · '||coalesce(m.bank_reference,m.description),
     jsonb_build_object('amount_cents',m.amount_cents,'remaining_cents',m.amount_cents-coalesce(a.used,0),'driver_id',m.driver_id)
   from public.finance_movements m left join lateral (
     select sum(a.amount_cents) used from public.finance_expense_allocations a where a.tenant_id=_tenant and a.movement_id=m.id
   ) a on true where _kind='movements' and m.tenant_id=_tenant and m.direction='out' and m.nature<>'transfer'
     and (m.driver_id is null or m.driver_id=driver) and m.amount_cents>coalesce(a.used,0)
   union all
   select c.id,c.company_name,'{}'::jsonb from public.clients c where _kind='suppliers' and c.tenant_id=_tenant and c.active
   union all
   select c.id,c.name,'{}'::jsonb from public.cost_centers c where _kind='centers' and c.tenant_id=_tenant and c.active
   union all
   select s.id,s.destination,jsonb_build_object('delivery',finance_private.delivery_context(_tenant,s.id))
   from public.dispatch_stops s where _kind='deliveries' and s.tenant_id=_tenant and s.dispatch_trip_id=_trip
 ), filtered as materialized (
   select * from options where position(lower(coalesce(_search,'')) in lower(coalesce(label,'')||' '||id::text))>0
 ), paged as (
   select * from filtered order by label,id limit 30 offset (_page-1)*30
 ) select (select count(*) from filtered),coalesce(jsonb_agg(jsonb_build_object('id',id,'label',coalesce(label,''))||extra order by label,id),'[]')
 into total,rows from paged;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'kind',_kind,'trip_id',_trip,'page',_page,'total',total,'rows',rows);
end;$$;
revoke all on function finance_private.expense_options(uuid,text,text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function finance_private.expense_options(uuid,text,text,uuid,integer) to authenticated;
create function public.get_finance_expense_options(_tenant_id uuid,_kind text,_search text default '',_trip_id uuid default null,_page integer default 1)
returns jsonb language sql security invoker set search_path='' as $$
 select finance_private.expense_options(_tenant_id,_kind,_search,_trip_id,_page);
$$;
revoke all on function public.get_finance_expense_options(uuid,text,text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_expense_options(uuid,text,text,uuid,integer) to authenticated;
