create function finance_private.stock_consumption_context(_tenant uuid,_part uuid,_movement uuid,_page integer,_search text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare part public.maintenance_parts%rowtype;movement public.stock_movements%rowtype;os public.maintenance_orders%rowtype;catalog public.stock_items%rowtype;result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page not between 1 and 1000000 or _search is null or length(_search)>200 then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 select * into part from public.maintenance_parts where tenant_id=_tenant and id=_part;
 if not found then raise exception 'finance_maintenance_part_not_found' using errcode='22023';end if;
 select * into movement from public.stock_movements where tenant_id=_tenant and id=_movement;
 if not found or part.stock_movement_id is distinct from _movement then raise exception 'finance_stock_consumption_source_mismatch' using errcode='22023';end if;
 select * into os from public.maintenance_orders where tenant_id=_tenant and id=part.maintenance_order_id;
 select * into catalog from public.stock_items where tenant_id=_tenant and id=movement.stock_item_id;
 with acquisitions as materialized(
  select a.*,s.moved_at acquired_at,c.company_name supplier_name,i.document_number,
   a.quantity-coalesce((select sum(d.quantity) from public.finance_stock_acquisition_dependencies d where d.tenant_id=a.tenant_id and d.acquisition_link_id=a.id),0) available_quantity,
   a.amount_cents-coalesce((select sum(d.amount_cents) from public.finance_stock_acquisition_dependencies d where d.tenant_id=a.tenant_id and d.acquisition_link_id=a.id),0) available_cents
  from public.finance_stock_acquisition_links a
  left join public.stock_movements s on s.tenant_id=a.tenant_id and s.id=a.inbound_movement_id
  left join public.clients c on c.tenant_id=a.tenant_id and c.id=a.supplier_id
  left join public.finance_expense_items i on i.tenant_id=a.tenant_id and i.id=a.cost_id
  where a.tenant_id=_tenant and a.stock_item_id=movement.stock_item_id
   and not exists(select 1 from public.finance_stock_acquisition_reversals r where r.tenant_id=a.tenant_id and r.link_id=a.id)
   and strpos(lower(concat_ws(' ',a.id::text,a.inbound_movement_id::text,a.cost_id::text,c.company_name,i.document_number)),lower(_search))>0
 ), candidates as(select * from acquisitions order by acquired_at desc nulls first,id limit 30 offset (_page-1)*30),
 attributions as materialized(select a.id,a.policy,a.actor_id,a.actor_name,a.reason,a.created_at,
  finance_private.stock_consumption_reversal_revision(_tenant,a.id) revision,
  (select coalesce(sum(l.quantity),0)::text from public.finance_stock_consumption_lines l where l.tenant_id=a.tenant_id and l.attribution_id=a.id) quantity,
  (select coalesce(sum(l.amount_cents),0)::text from public.finance_stock_consumption_lines l where l.tenant_id=a.tenant_id and l.attribution_id=a.id) attributed_cents,
  (select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'acquisition_link_id',l.acquisition_link_id,'quantity',l.quantity::text,'amount_cents',l.amount_cents::text,'balance_snapshot',l.balance_snapshot) order by l.acquisition_link_id,l.id),'[]')
   from public.finance_stock_consumption_lines l where l.tenant_id=a.tenant_id and l.attribution_id=a.id) lines,
  (select jsonb_build_object('id',r.id,'actor_id',r.actor_id,'actor_name',r.actor_name,'reason',r.reason,'created_at',r.created_at)
   from public.finance_stock_consumption_reversals r where r.tenant_id=a.tenant_id and r.attribution_id=a.id) reversal
  from public.finance_stock_consumption_attributions a where a.tenant_id=_tenant and a.part_id=_part and a.consumption_movement_id=_movement),
 history_rows as(select * from attributions order by created_at desc,id limit 30 offset (_page-1)*30)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'part_id',_part,'movement_id',_movement,'page',_page,'page_size',30,'search',_search,'total',(select count(*) from acquisitions),
 'source',jsonb_build_object('part_id',_part,'movement_id',_movement,'order_id',part.maintenance_order_id,'order_number',os.order_number,'order_status',os.status,
  'stock_item_id',movement.stock_item_id,'item_name',catalog.name,'unit',catalog.unit,
  'part_quantity',case when part.quantity>0 and part.quantity::text not in('NaN','Infinity','-Infinity') then part.quantity::text end,
  'movement_quantity',case when movement.quantity>0 and movement.quantity::text not in('NaN','Infinity','-Infinity') then movement.quantity::text end,
  'movement_date',case when isfinite(movement.moved_at) then (movement.moved_at at time zone 'America/Sao_Paulo')::date::text end,
  'declared_part_cents',finance_private.maintenance_declared_cents(part.total_cost),'declared_movement_cents',finance_private.maintenance_declared_cents(movement.total_cost)),
 'active_attribution',(select to_jsonb(a)-'reversal' from attributions a where reversal is null),
 'history',jsonb_build_object('total',(select count(*) from attributions),'rows',coalesce((select jsonb_agg(to_jsonb(h) order by created_at desc,id) from history_rows h),'[]')),
 'candidates',coalesce((select jsonb_agg(jsonb_build_object('acquisition_link_id',a.id,'inbound_movement_id',a.inbound_movement_id,'cost_id',a.cost_id,'supplier_id',a.supplier_id,
  'supplier_name',a.supplier_name,'document_number',a.document_number,'acquired_on',case when isfinite(a.acquired_at) then (a.acquired_at at time zone 'America/Sao_Paulo')::date::text end,
  'quantity',a.quantity::text,'amount_cents',a.amount_cents::text,'available_quantity',a.available_quantity::text,'available_cents',a.available_cents::text,
  'availability_issue',case when a.available_quantity<0 or a.available_cents<0 then 'finance_stock_consumption_capacity_invalid' when a.acquired_at is null or not isfinite(a.acquired_at) then 'finance_stock_consumption_acquisition_date_invalid' when a.available_quantity=0 then 'finance_stock_consumption_acquisition_exhausted' else null end)
  order by a.acquired_at desc nulls first,a.id) from candidates a),'[]')) into result;
 return result;
end$$;
revoke all on function finance_private.stock_consumption_context(uuid,uuid,uuid,integer,text) from public,anon,service_role;
grant execute on function finance_private.stock_consumption_context(uuid,uuid,uuid,integer,text) to authenticated;
create function public.get_finance_stock_consumption_context(_tenant_id uuid,_part_id uuid,_movement_id uuid,_page integer default 1,_search text default '')
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.stock_consumption_context(_tenant_id,_part_id,_movement_id,_page,_search)$$;
revoke all on function public.get_finance_stock_consumption_context(uuid,uuid,uuid,integer,text) from public,anon,service_role;
grant execute on function public.get_finance_stock_consumption_context(uuid,uuid,uuid,integer,text) to authenticated;

create function finance_private.preview_stock_consumption(_tenant uuid,_part uuid,_movement uuid,_lines jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 return finance_private.stock_consumption_preview(_tenant,_part,_movement,_lines)||jsonb_build_object('tenant_id',_tenant,'part_id',_part,'movement_id',_movement);
end$$;
revoke all on function finance_private.preview_stock_consumption(uuid,uuid,uuid,jsonb) from public,anon,service_role;
grant execute on function finance_private.preview_stock_consumption(uuid,uuid,uuid,jsonb) to authenticated;
create function public.preview_finance_stock_consumption(_tenant_id uuid,_part_id uuid,_movement_id uuid,_lines jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.preview_stock_consumption(_tenant_id,_part_id,_movement_id,_lines)$$;
revoke all on function public.preview_finance_stock_consumption(uuid,uuid,uuid,jsonb) from public,anon,service_role;
grant execute on function public.preview_finance_stock_consumption(uuid,uuid,uuid,jsonb) to authenticated;

-- Keep declared unit-price precision visible after the rounded line-total rule.
do $$declare body text;needle text;begin
 select pg_get_functiondef('finance_private.stock_acquisition_context(uuid,uuid,integer,text)'::regprocedure) into body;
 needle:='''unit_cost_cents'',finance_private.maintenance_declared_cents(source.unit_cost)';
 if position(needle in body)=0 then raise exception 'finance_stock_acquisition_unit_price_contract_changed';end if;
 execute replace(body,needle,needle||',''unit_cost_decimal'',case when source.unit_cost>=0 and source.unit_cost::text not in(''NaN'',''Infinity'',''-Infinity'') then source.unit_cost::text end,''unit_price_policy'',''rounded_extended_total_cents_v1''');
 select pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure) into body;
 needle:='''identity_reviewed_manually'',''identity_review_reversed''';
 if position(needle in body)=0 then raise exception 'finance_stock_consumption_audit_contract_changed';end if;
 execute replace(body,needle,'''stock_consumption_attributed'',''stock_consumption_attribution_reversed'','||needle);
end$$;
