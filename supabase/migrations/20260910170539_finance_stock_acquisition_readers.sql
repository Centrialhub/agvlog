create index finance_stock_inbound_inventory on public.stock_movements(tenant_id,moved_at desc,id) where movement_type='inbound';
create function finance_private.stock_acquisition_context(_tenant uuid,_inbound uuid,_page integer,_search text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source public.stock_movements%rowtype;item_name text;result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page not between 1 and 1000000 or _search is null or length(_search)>200 then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 select * into source from public.stock_movements where tenant_id=_tenant and id=_inbound;
 if not found then raise exception 'finance_stock_movement_not_found' using errcode='22023';end if;
 select name into item_name from public.stock_items where tenant_id=_tenant and id=source.stock_item_id;
 with candidates as materialized(
  select i.*,b.context,c.company_name registered_supplier_name from public.finance_expense_items i
  join public.finance_expense_batches b on b.tenant_id=i.tenant_id and b.id=i.batch_id
  left join public.clients c on c.tenant_id=i.tenant_id and c.id=i.supplier_id
  where i.tenant_id=_tenant and strpos(lower(concat_ws(' ',i.id::text,i.description,i.document_number,c.company_name,i.batch_id::text)),lower(_search))>0
 ), page_rows as(select * from candidates order by occurred_on desc,id limit 30 offset (_page-1)*30),
 links as materialized(select l.id,l.cost_id,l.supplier_id,l.quantity::text quantity,l.amount_cents::text amount_cents,l.actor_id,l.actor_name,l.reason,l.created_at,
  finance_private.stock_acquisition_revision(_tenant,_inbound,l.cost_id) revision,
  finance_private.stock_acquisition_dependencies(_tenant,l.id) dependencies,
  (select jsonb_build_object('id',r.id,'actor_id',r.actor_id,'actor_name',r.actor_name,'reason',r.reason,'created_at',r.created_at)
   from public.finance_stock_acquisition_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id) reversal
  from public.finance_stock_acquisition_links l where l.tenant_id=_tenant and l.inbound_movement_id=_inbound),
 history_rows as(select * from links order by created_at desc,id limit 30 offset (_page-1)*30)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'inbound_movement_id',_inbound,'page',_page,'page_size',30,'search',_search,
 'source',jsonb_build_object('id',source.id,'stock_item_id',source.stock_item_id,'item_name',item_name,'movement_type',source.movement_type,'reason',source.reason,
  'movement_date',case when isfinite(source.moved_at) then (source.moved_at at time zone 'America/Sao_Paulo')::date::text end,
  'quantity',case when source.quantity>0 and source.quantity::text not in('NaN','Infinity','-Infinity') then source.quantity::text end,
  'unit_cost_cents',finance_private.maintenance_declared_cents(source.unit_cost),'total_cost_cents',finance_private.maintenance_declared_cents(source.total_cost)),
 'active_link',(select to_jsonb(l)-'reversal' from links l where reversal is null),
 'history',jsonb_build_object('total',(select count(*) from links),'rows',coalesce((select jsonb_agg(to_jsonb(h) order by created_at desc,id) from history_rows h),'[]')),
 'total',(select count(*) from candidates),'candidates',coalesce((select jsonb_agg(jsonb_build_object('cost_id',p.id,'batch_id',p.batch_id,'description',p.description,'context',p.context,'category',p.category,
  'amount_cents',p.amount_cents::text,'occurred_on',case when isfinite(p.occurred_on) then p.occurred_on::text end,'supplier_id',p.supplier_id,'supplier_name',p.registered_supplier_name,'document_number',p.document_number,
  'issue',finance_private.stock_acquisition_issue(_tenant,_inbound,p.id),'revision',finance_private.stock_acquisition_revision(_tenant,_inbound,p.id)) order by p.occurred_on desc,p.id) from page_rows p),'[]')) into result;
 return result;
end$$;
revoke all on function finance_private.stock_acquisition_context(uuid,uuid,integer,text) from public,anon,service_role;
grant execute on function finance_private.stock_acquisition_context(uuid,uuid,integer,text) to authenticated;
create function public.get_finance_stock_acquisition_context(_tenant_id uuid,_inbound_movement_id uuid,_page integer default 1,_search text default '')
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.stock_acquisition_context(_tenant_id,_inbound_movement_id,_page,_search)$$;
revoke all on function public.get_finance_stock_acquisition_context(uuid,uuid,integer,text) from public,anon,service_role;
grant execute on function public.get_finance_stock_acquisition_context(uuid,uuid,integer,text) to authenticated;

create function finance_private.stock_acquisition_inventory(_tenant uuid,_page integer,_search text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page not between 1 and 1000000 or _search is null or length(_search)>200 then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 with sources as materialized(select m.*,s.name item_name,
  (select l.id from public.finance_stock_acquisition_links l where l.tenant_id=m.tenant_id and l.inbound_movement_id=m.id
   and not exists(select 1 from public.finance_stock_acquisition_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id)) active_link_id
  from public.stock_movements m left join public.stock_items s on s.tenant_id=m.tenant_id and s.id=m.stock_item_id
  where m.tenant_id=_tenant and m.movement_type='inbound' and strpos(lower(concat_ws(' ',m.id::text,m.stock_item_id::text,s.name,m.reason,m.justification)),lower(_search))>0),
 page_rows as(select * from sources order by moved_at desc,id limit 30 offset (_page-1)*30)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'page',_page,'page_size',30,'search',_search,'total',(select count(*) from sources),
 'associated_count',(select count(*) from sources where active_link_id is not null),'unassociated_count',(select count(*) from sources where active_link_id is null),
 'rows',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'stock_item_id',p.stock_item_id,'item_name',p.item_name,'reason',p.reason,
 'movement_date',case when isfinite(p.moved_at) then (p.moved_at at time zone 'America/Sao_Paulo')::date::text end,
 'quantity',case when p.quantity>0 and p.quantity::text not in('NaN','Infinity','-Infinity') then p.quantity::text end,
 'total_cost_cents',finance_private.maintenance_declared_cents(p.total_cost),'active_link_id',p.active_link_id) order by p.moved_at desc,p.id) from page_rows p),'[]')) into result;
 return result;
end$$;
revoke all on function finance_private.stock_acquisition_inventory(uuid,integer,text) from public,anon,service_role;
grant execute on function finance_private.stock_acquisition_inventory(uuid,integer,text) to authenticated;
create function public.get_finance_stock_acquisition_inventory(_tenant_id uuid,_page integer default 1,_search text default '')
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.stock_acquisition_inventory(_tenant_id,_page,_search)$$;
revoke all on function public.get_finance_stock_acquisition_inventory(uuid,integer,text) from public,anon,service_role;
grant execute on function public.get_finance_stock_acquisition_inventory(uuid,integer,text) to authenticated;

do $$declare body text;needle text;begin
 select pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure) into body;
 needle:='''identity_reviewed_manually'',''identity_review_reversed''';
 if position(needle in body)=0 then raise exception 'finance_stock_acquisition_audit_contract_changed';end if;
 execute replace(body,needle,'''stock_acquisition_associated'',''stock_acquisition_association_reversed'','||needle);
end$$;
