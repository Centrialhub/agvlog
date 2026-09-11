create function finance_private.maintenance_labor_context(_tenant uuid,_order uuid,_page integer,_search text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source public.maintenance_orders%rowtype;result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page not between 1 and 1000000 or _search is null or length(_search)>200 then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 select * into source from public.maintenance_orders where tenant_id=_tenant and id=_order;
 if not found then raise exception 'finance_maintenance_order_not_found' using errcode='22023';end if;
 with candidates as materialized(
  select i.*,c.company_name registered_supplier_name from public.finance_expense_items i
  join public.finance_expense_batches b on b.tenant_id=i.tenant_id and b.id=i.batch_id
  left join public.clients c on c.tenant_id=i.tenant_id and c.id=i.supplier_id
  where i.tenant_id=_tenant and b.context='maintenance' and i.category in('maintenance','service')
   and strpos(lower(concat_ws(' ',i.description,c.company_name,i.document_number,i.id::text,i.batch_id::text)),lower(_search))>0
 ), page_rows as(select * from candidates order by occurred_on desc,id limit 30 offset (_page-1)*30),
 links as materialized(select l.id,l.cost_id,l.amount_cents::text amount_cents,l.supplier_id,l.actor_id,l.actor_name,l.reason,l.created_at,
  (select jsonb_build_object('id',r.id,'actor_id',r.actor_id,'actor_name',r.actor_name,'reason',r.reason,'created_at',r.created_at)
   from public.finance_maintenance_labor_reversals r where r.tenant_id=l.tenant_id and r.link_id=l.id) reversal
  from public.finance_maintenance_labor_links l where l.tenant_id=_tenant and l.order_id=_order),
 history_rows as(select * from links order by created_at desc,id limit 30 offset (_page-1)*30)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'order_id',_order,'page',_page,'page_size',30,'search',_search,
  'source',jsonb_build_object('id',source.id,'order_number',source.order_number,'status',source.status,'labor_cents',finance_private.maintenance_declared_cents(source.labor_cost),
   'supplier_name',source.supplier_vendor,'opened_on',case when isfinite(source.opened_at) then (source.opened_at at time zone 'America/Sao_Paulo')::date::text end),
  'active_link',(select to_jsonb(l)-'reversal' from links l where reversal is null),
  'history',jsonb_build_object('total',(select count(*) from links),'rows',coalesce((select jsonb_agg(to_jsonb(h) order by created_at desc,id) from history_rows h),'[]')),
  'total',(select count(*) from candidates),
  'candidates',coalesce((select jsonb_agg(jsonb_build_object('cost_id',p.id,'batch_id',p.batch_id,'description',p.description,'category',p.category,
   'amount_cents',p.amount_cents::text,'occurred_on',case when isfinite(p.occurred_on) then p.occurred_on::text end,
   'supplier_id',p.supplier_id,'supplier_name',p.registered_supplier_name,
   'issue',finance_private.maintenance_labor_issue(_tenant,_order,p.id),'revision',finance_private.maintenance_labor_revision(_tenant,_order,p.id))
   order by p.occurred_on desc,p.id) from page_rows p),'[]')) into result;
 return result;
end$$;
revoke all on function finance_private.maintenance_labor_context(uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.maintenance_labor_context(uuid,uuid,integer,text) to authenticated;
create function public.get_finance_maintenance_labor_context(_tenant_id uuid,_order_id uuid,_page integer default 1,_search text default '')
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.maintenance_labor_context(_tenant_id,_order_id,_page,_search)$$;
revoke all on function public.get_finance_maintenance_labor_context(uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_maintenance_labor_context(uuid,uuid,integer,text) to authenticated;
do $$declare body text;needle text;begin
 select pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure) into body;
 needle:='''identity_reviewed_manually'',''identity_review_reversed''';
 if position(needle in body)=0 then raise exception 'finance_maintenance_labor_audit_contract_changed';end if;
 execute replace(body,needle,'''maintenance_labor_associated'',''maintenance_labor_association_reversed'','||needle);
end$$;
