create function finance_private.maintenance_declared_cents(_value numeric) returns text
language sql immutable set search_path='' as $$select case when _value>=0 and _value*100=trunc(_value*100) and _value*100<=99999999999999 then trunc(_value*100)::text end$$;
revoke all on function finance_private.maintenance_declared_cents(numeric) from public,anon,authenticated,service_role;

create function finance_private.maintenance_cost_context(_tenant uuid,_order uuid,_page integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m public.maintenance_orders%rowtype;result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page not between 1 and 1000000 then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 select * into m from public.maintenance_orders where tenant_id=_tenant and id=_order;
 if not found then raise exception 'finance_maintenance_order_not_found' using errcode='22023';end if;
 with parts as materialized(select * from public.maintenance_parts where tenant_id=_tenant and maintenance_order_id=_order),
 stocks as materialized(select s.* from public.stock_movements s where s.tenant_id=_tenant and (s.maintenance_order_id=_order or exists(select 1 from parts p where p.stock_movement_id=s.id))),
 part_page as(select * from parts order by id limit 30 offset (_page-1)*30),
 stock_page as(select * from stocks order by moved_at desc nulls first,id limit 30 offset (_page-1)*30)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'order_id',_order,'page',_page,'page_size',30,'coverage_complete',false,'recognized_cost_cents',null,
  'revision',md5(jsonb_build_object('header',to_jsonb(m),'parts',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from parts p),'stock',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from stocks s))::text),
  'header',jsonb_build_object('id',m.id,'order_number',m.order_number,'status',m.status,'opened_on',case when isfinite(m.opened_at) then (m.opened_at at time zone 'America/Sao_Paulo')::date::text end,
   'description',m.reported_problem,'supplier_name',m.supplier_vendor,'parts_cents',finance_private.maintenance_declared_cents(m.parts_cost),'labor_cents',finance_private.maintenance_declared_cents(m.labor_cost),'total_cents',finance_private.maintenance_declared_cents(m.total_cost),
   'issues',array_remove(array['maintenance_components_require_review',
    case when not coalesce(isfinite(m.opened_at),false) then 'invalid_date' end,
    case when finance_private.maintenance_declared_cents(m.parts_cost) is null or finance_private.maintenance_declared_cents(m.labor_cost) is null or finance_private.maintenance_declared_cents(m.total_cost) is null then 'invalid_declared_value' end,
    case when m.parts_cost+m.labor_cost is distinct from m.total_cost then 'header_total_mismatch' end,
    case when exists(select 1 from parts p where finance_private.maintenance_declared_cents(p.total_cost) is null) then 'parts_values_require_review' end,
    case when exists(select 1 from parts) and (select sum(total_cost) from parts) is distinct from m.parts_cost then 'header_parts_mismatch' end
   ],null)),
  'parts',jsonb_build_object('total',(select count(*) from parts),'rows',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'stock_item_id',p.stock_item_id,'stock_movement_id',p.stock_movement_id,'description',p.item_description,
   'quantity',case when p.quantity>0 and p.quantity::text not in('NaN','Infinity','-Infinity') then p.quantity::text end,
   'unit_cost_cents',finance_private.maintenance_declared_cents(p.unit_cost),'total_cost_cents',finance_private.maintenance_declared_cents(p.total_cost),
   'issues',array_remove(array[
    case when not coalesce(p.quantity>0 and p.quantity::text not in('NaN','Infinity','-Infinity'),false) then 'invalid_quantity' end,
    case when finance_private.maintenance_declared_cents(p.unit_cost) is null or finance_private.maintenance_declared_cents(p.total_cost) is null then 'invalid_declared_value' end,
    case when p.quantity*p.unit_cost is distinct from p.total_cost then 'component_total_mismatch' end,
    case when p.stock_item_id is not null and not exists(select 1 from public.stock_items i where i.tenant_id=_tenant and i.id=p.stock_item_id) then 'stock_item_missing' end,
    case when p.stock_movement_id is null then 'part_source_requires_classification' end,
    case when p.stock_movement_id is not null and not exists(select 1 from stocks s where s.id=p.stock_movement_id) then 'stock_movement_missing' end,
    case when exists(select 1 from stocks s where s.id=p.stock_movement_id and (s.maintenance_order_id is distinct from _order or s.stock_item_id is distinct from p.stock_item_id or s.quantity is distinct from p.quantity or s.unit_cost is distinct from p.unit_cost or s.total_cost is distinct from p.total_cost)) then 'part_stock_mismatch' end,
    case when (select count(*) from public.maintenance_parts other where other.tenant_id=_tenant and other.stock_movement_id=p.stock_movement_id)>1 then 'stock_movement_reused' end
   ],null)) order by p.id) from part_page p),'[]')),
  'stock',jsonb_build_object('total',(select count(*) from stocks),'rows',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'stock_item_id',s.stock_item_id,'maintenance_order_id',s.maintenance_order_id,'movement_type',s.movement_type,
   'quantity',case when s.quantity>0 and s.quantity::text not in('NaN','Infinity','-Infinity') then s.quantity::text end,
   'unit_cost_cents',finance_private.maintenance_declared_cents(s.unit_cost),'total_cost_cents',finance_private.maintenance_declared_cents(s.total_cost),
   'occurred_on',case when isfinite(s.moved_at) then (s.moved_at at time zone 'America/Sao_Paulo')::date::text end,
   'issues',array_remove(array['stock_movement_not_a_payment',
    case when not coalesce(isfinite(s.moved_at),false) then 'invalid_date' end,
    case when not coalesce(s.quantity>0 and s.quantity::text not in('NaN','Infinity','-Infinity'),false) then 'invalid_quantity' end,
    case when finance_private.maintenance_declared_cents(s.unit_cost) is null or finance_private.maintenance_declared_cents(s.total_cost) is null then 'invalid_declared_value' end,
    case when s.quantity*s.unit_cost is distinct from s.total_cost then 'component_total_mismatch' end,
    case when not exists(select 1 from public.stock_items i where i.tenant_id=_tenant and i.id=s.stock_item_id) then 'stock_item_missing' end,
    case when s.maintenance_order_id is distinct from _order then 'stock_order_mismatch' end,
    case when not exists(select 1 from parts p where p.stock_movement_id=s.id) then 'stock_without_part_link' end
   ],null)) order by s.moved_at desc nulls first,s.id) from stock_page s),'[]'))) into result;
 return result;
end$$;
revoke all on function finance_private.maintenance_cost_context(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function finance_private.maintenance_cost_context(uuid,uuid,integer) to authenticated;
create function public.get_finance_maintenance_cost_context(_tenant_id uuid,_order_id uuid,_page integer default 1)
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.maintenance_cost_context(_tenant_id,_order_id,_page)$$;
revoke all on function public.get_finance_maintenance_cost_context(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_maintenance_cost_context(uuid,uuid,integer) to authenticated;
