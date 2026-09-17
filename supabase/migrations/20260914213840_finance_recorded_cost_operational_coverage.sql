-- Operational sources are evidence that an already recorded canonical expense
-- represents maintenance or another legacy cost. They never create a second cost.
create function finance_private.recorded_cost_operational_coverage(_tenant uuid,_from date,_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if (_from is not null and not isfinite(_from)) or (_to is not null and not isfinite(_to)) or _from>_to then raise exception 'finance_invalid_cost_filters' using errcode='22023';end if;
 with orders as materialized(
  select m.* from public.maintenance_orders m where m.tenant_id=_tenant and m.status='completed'
   and (not isfinite(m.opened_at) or ((_from is null or (m.opened_at at time zone 'America/Sao_Paulo')::date>=_from) and (_to is null or (m.opened_at at time zone 'America/Sao_Paulo')::date<=_to)))
 ), parts as materialized(
  select p.* from public.maintenance_parts p join orders m on m.tenant_id=p.tenant_id and m.id=p.maintenance_order_id
 ), acquisitions as materialized(
  select s.* from public.stock_movements s where s.tenant_id=_tenant and s.movement_type='inbound' and s.reason='purchase'
   and (not isfinite(s.moved_at) or ((_from is null or (s.moved_at at time zone 'America/Sao_Paulo')::date>=_from) and (_to is null or (s.moved_at at time zone 'America/Sao_Paulo')::date<=_to)))
 ), legacy as materialized(
  select d.* from public.driver_expenses d where d.tenant_id=_tenant
   and (not isfinite(d.expense_at) or ((_from is null or (d.expense_at at time zone 'America/Sao_Paulo')::date>=_from) and (_to is null or (d.expense_at at time zone 'America/Sao_Paulo')::date<=_to)))
 ), recognized_keys as materialized(
  select distinct q.cost_id from(
   select c.cost_id from public.finance_maintenance_cost_claims c join orders m on c.source_kind='labor' and c.source_id=m.id where c.tenant_id=_tenant
   union all select c.cost_id from public.finance_maintenance_cost_claims c join parts p on c.source_kind='direct_part' and c.source_id=p.id where c.tenant_id=_tenant
   union all select c.cost_id from public.finance_maintenance_cost_claims c join acquisitions s on c.source_kind='stock_acquisition' and c.source_id=s.id where c.tenant_id=_tenant
   union all select l.cost_id from public.finance_legacy_expense_cost_links l join legacy d on d.id=l.expense_id
    where l.tenant_id=_tenant and not exists(select 1 from public.finance_legacy_expense_cost_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id)
  ) q
 ), recognized as materialized(
  select k.cost_id,e.id is not null and not finance_private.expense_is_cancelled(_tenant,e.id) and finance_private.effective_cost_amount(_tenant,e.id) is not null valid,
   case when e.id is not null and not finance_private.expense_is_cancelled(_tenant,e.id) then finance_private.effective_cost_amount(_tenant,e.id) end amount_cents
  from recognized_keys k left join public.finance_expense_items e on e.tenant_id=_tenant and e.id=k.cost_id
 ), labor as(
  select count(*) filter(where covered) covered_count,count(*) filter(where not covered) pending_count from(
   select exists(select 1 from public.finance_maintenance_cost_claims c where c.tenant_id=_tenant and c.source_kind='labor' and c.source_id=m.id) covered
   from orders m where m.labor_cost>0
  ) x
 ), direct_parts as(
  select count(*) filter(where covered) covered_count,count(*) filter(where not covered) pending_count from(
   select exists(select 1 from public.finance_maintenance_cost_claims c where c.tenant_id=_tenant and c.source_kind='direct_part' and c.source_id=p.id) covered
   from parts p where p.stock_movement_id is null and p.total_cost is distinct from 0
  ) x
 ), stock_acquisitions as(
  select count(*) filter(where covered) covered_count,count(*) filter(where not covered) pending_count from(
   select exists(select 1 from public.finance_maintenance_cost_claims c where c.tenant_id=_tenant and c.source_kind='stock_acquisition' and c.source_id=s.id) covered
   from acquisitions s where s.total_cost is distinct from 0
  ) x
 ), stock_consumptions as(
  select count(*) filter(where covered) covered_count,count(*) filter(where not covered) pending_count from(
   select exists(select 1 from finance_private.stock_consumption_claims c where c.tenant_id=_tenant and c.part_id=p.id) covered
   from parts p where p.stock_movement_id is not null
  ) x
 ), legacy_costs as(
  select count(*) filter(where covered) covered_count,count(*) filter(where not covered) pending_count from(
   select exists(select 1 from public.finance_legacy_expense_cost_links l where l.tenant_id=_tenant and l.expense_id=d.id
    and not exists(select 1 from public.finance_legacy_expense_cost_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id)) covered from legacy d
  ) x
 ), ambiguity as(
  select count(*) pending_count from orders m where
   m.parts_cost is null or m.labor_cost is null or m.total_cost is null
   or m.parts_cost::text in('NaN','Infinity','-Infinity') or m.labor_cost::text in('NaN','Infinity','-Infinity') or m.total_cost::text in('NaN','Infinity','-Infinity')
   or m.parts_cost<0 or m.labor_cost<0 or m.total_cost<0 or m.parts_cost*100<>trunc(m.parts_cost*100) or m.labor_cost*100<>trunc(m.labor_cost*100) or m.total_cost*100<>trunc(m.total_cost*100)
   or m.parts_cost+m.labor_cost is distinct from m.total_cost
 ), consumed as(
  select count(distinct c.attribution_id) attribution_count,coalesce(sum(l.amount_cents),0) amount
  from finance_private.stock_consumption_claims c join parts p on p.id=c.part_id
  join public.finance_stock_consumption_lines l on l.tenant_id=c.tenant_id and l.attribution_id=c.attribution_id where c.tenant_id=_tenant
 ), totals as(
  select count(*) recognized_count,count(*) filter(where not valid) review_count,coalesce(sum(amount_cents) filter(where valid),0) amount from recognized
 )
 select jsonb_build_object('version',1,'tenant_id',_tenant,'from',_from,'to',_to,'filter_scope','period_only',
  'coverage_complete',false,'totals_additive',false,'double_counted_cents','0',
  'recognized_cost_count',t.recognized_count,'recognized_cost_needs_review_count',t.review_count,
  'recognized_cost_cents',case when t.review_count=0 then trunc(t.amount)::text end,
  'maintenance',jsonb_build_object(
   'labor',jsonb_build_object('covered_count',l.covered_count,'pending_count',l.pending_count),
   'direct_parts',jsonb_build_object('covered_count',d.covered_count,'pending_count',d.pending_count),
   'stock_acquisitions',jsonb_build_object('covered_count',a.covered_count,'pending_count',a.pending_count),
   'stock_consumptions',jsonb_build_object('covered_count',s.covered_count,'pending_count',s.pending_count,'attribution_count',c.attribution_count,'attributed_cents',trunc(c.amount)::text),
   'ambiguous_order_count',o.pending_count),
  'legacy_driver_expenses',jsonb_build_object('covered_count',g.covered_count,'pending_count',g.pending_count),
  'review_pending_count',l.pending_count+d.pending_count+a.pending_count+s.pending_count+o.pending_count+g.pending_count,
  'detail_readers',jsonb_build_array('get_finance_legacy_cost_inventory','get_finance_maintenance_cost_context','get_finance_maintenance_labor_context','get_finance_maintenance_direct_part_context','get_finance_stock_acquisition_inventory','get_finance_stock_consumption_context')) into result
 from totals t cross join labor l cross join direct_parts d cross join stock_acquisitions a cross join stock_consumptions s cross join ambiguity o cross join legacy_costs g cross join consumed c;
 return result;
end$$;
revoke all on function finance_private.recorded_cost_operational_coverage(uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function finance_private.recorded_cost_operational_coverage(uuid,date,date) to authenticated;
create function public.get_finance_recorded_cost_operational_coverage(_tenant_id uuid,_from date default null,_to date default null)
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.recorded_cost_operational_coverage(_tenant_id,_from,_to)$$;
revoke all on function public.get_finance_recorded_cost_operational_coverage(uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_recorded_cost_operational_coverage(uuid,date,date) to authenticated;
