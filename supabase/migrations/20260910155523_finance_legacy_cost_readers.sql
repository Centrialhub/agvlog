-- Read-only source discovery. Similarity is not proof of expense identity.
create function finance_private.legacy_expense_cost_context(_tenant uuid,_expense uuid,_page integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source public.driver_expenses%rowtype;result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page not between 1 and 1000000 then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 select * into source from public.driver_expenses where tenant_id=_tenant and id=_expense;
 if not found then raise exception 'finance_expense_not_found' using errcode='22023';end if;
 with candidates as materialized(
  select i.* from public.finance_expense_items i join public.finance_expense_batches b on b.tenant_id=i.tenant_id and b.id=i.batch_id
  where i.tenant_id=_tenant and b.trip_id=source.dispatch_trip_id and b.driver_id=source.driver_id
 ), page_rows as(select * from candidates order by occurred_on desc,id limit 30 offset (_page-1)*30),
 links as materialized(
  select l.id,l.cost_id,l.amount_cents::text amount_cents,l.actor_id,l.actor_name,l.reason,l.created_at,
   (select jsonb_build_object('id',r.id,'actor_id',r.actor_id,'actor_name',r.actor_name,'reason',r.reason,'created_at',r.created_at)
    from public.finance_legacy_expense_cost_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id) reversal
  from public.finance_legacy_expense_cost_links l where l.tenant_id=_tenant and l.expense_id=_expense
 ), history_rows as(select * from links order by created_at desc,id limit 30 offset (_page-1)*30)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'expense_id',_expense,'page',_page,'page_size',30,
  'source',jsonb_build_object('id',source.id,'trip_id',source.dispatch_trip_id,'driver_id',source.driver_id,'description',source.notes,'category',source.category,
   'amount_cents',case when source.amount>0 and source.amount*100=trunc(source.amount*100) and source.amount*100<=99999999999999 then trunc(source.amount*100)::text end,
   'occurred_on',case when isfinite(source.expense_at) then (source.expense_at at time zone 'America/Sao_Paulo')::date::text end,
   'approval_status',source.approval_status,'payment_source',source.payment_source,'reimbursable',source.reimbursable,
   'issue',finance_private.legacy_expense_source_issue(_tenant,_expense)),
  'active_link',(select to_jsonb(l)-'reversal' from links l where reversal is null),
  'history',jsonb_build_object('total',(select count(*) from links),'rows',coalesce((select jsonb_agg(to_jsonb(h) order by created_at desc,id) from history_rows h),'[]')),
  'total',(select count(*) from candidates),
  'candidates',coalesce((select jsonb_agg(jsonb_build_object('cost_id',p.id,'batch_id',p.batch_id,'description',p.description,'category',p.category,
   'amount_cents',p.amount_cents::text,'occurred_on',case when isfinite(p.occurred_on) then p.occurred_on::text end,
   'issue',finance_private.legacy_expense_cost_issue(_tenant,_expense,p.id),'revision',finance_private.legacy_expense_cost_revision(_tenant,_expense,p.id))
   order by p.occurred_on desc,p.id) from page_rows p),'[]')) into result;
 return result;
end$$;

create function finance_private.legacy_cost_inventory(_tenant uuid,_page integer,_source text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page not between 1 and 1000000 or _source is null or _source not in('all','driver_expenses','maintenance_orders') then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 with sources as materialized(
  select 'driver_expenses'::text source_table,d.id source_id,d.notes description,
   case when isfinite(d.expense_at) then (d.expense_at at time zone 'America/Sao_Paulo')::date::text end occurred_on,
   case when d.amount>0 and d.amount*100=trunc(d.amount*100) and d.amount*100<=99999999999999 then trunc(d.amount*100)::text end amount_cents,
   d.approval_status status from public.driver_expenses d where d.tenant_id=_tenant and _source in('all','driver_expenses')
  union all
  select 'maintenance_orders',m.id,m.order_number||' — '||coalesce(m.reported_problem,''),
   case when isfinite(m.opened_at) then (m.opened_at at time zone 'America/Sao_Paulo')::date::text end,
   case when m.total_cost>=0 and m.total_cost*100=trunc(m.total_cost*100) and m.total_cost*100<=99999999999999 then trunc(m.total_cost*100)::text end,
   m.status from public.maintenance_orders m where m.tenant_id=_tenant and _source in('all','maintenance_orders')
 ), page_rows as(select * from sources order by occurred_on desc nulls first,source_table,source_id limit 30 offset (_page-1)*30)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'page',_page,'page_size',30,'source_filter',_source,'total',(select count(*) from sources),
  'coverage_complete',false,'rows',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object(
   'issue',case when p.source_table='driver_expenses' then finance_private.legacy_expense_source_issue(_tenant,p.source_id) else 'maintenance_components_require_review' end,
   'active_link_id',case when p.source_table='driver_expenses' then (select l.id from public.finance_legacy_expense_cost_links l
    where l.tenant_id=_tenant and l.expense_id=p.source_id and not exists(select 1 from public.finance_legacy_expense_cost_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id)) end)
   order by p.occurred_on desc nulls first,p.source_table,p.source_id) from page_rows p),'[]')) into result;
 return result;
end$$;

revoke all on function finance_private.legacy_expense_cost_context(uuid,uuid,integer),finance_private.legacy_cost_inventory(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.legacy_expense_cost_context(uuid,uuid,integer),finance_private.legacy_cost_inventory(uuid,integer,text) to authenticated;
create function public.get_finance_legacy_expense_cost_context(_tenant_id uuid,_expense_id uuid,_page integer default 1)
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.legacy_expense_cost_context(_tenant_id,_expense_id,_page)$$;
create function public.get_finance_legacy_cost_inventory(_tenant_id uuid,_page integer default 1,_source text default 'all')
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.legacy_cost_inventory(_tenant_id,_page,_source)$$;
revoke all on function public.get_finance_legacy_expense_cost_context(uuid,uuid,integer),public.get_finance_legacy_cost_inventory(uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_legacy_expense_cost_context(uuid,uuid,integer),public.get_finance_legacy_cost_inventory(uuid,integer,text) to authenticated;
