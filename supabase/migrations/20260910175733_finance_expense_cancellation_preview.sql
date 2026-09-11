create function finance_private.expense_cancellation_preview(_tenant uuid,_expense uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if not exists(select 1 from public.finance_expense_items where tenant_id=_tenant and id=_expense) then raise exception 'finance_expense_not_found' using errcode='22023';end if;
 result:=finance_private.expense_cancellation_context(_tenant,_expense);
 if result->>'tenant_id' is distinct from _tenant::text or result->>'expense_id' is distinct from _expense::text then raise exception 'finance_expense_preview_context_invalid' using errcode='22023';end if;
 return result||jsonb_build_object('can_execute',true);
end$$;
revoke all on function finance_private.expense_cancellation_preview(uuid,uuid) from public,anon,service_role;
grant execute on function finance_private.expense_cancellation_preview(uuid,uuid) to authenticated;
create function public.preview_finance_expense_cancellation(_tenant_id uuid,_expense_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.expense_cancellation_preview(_tenant_id,_expense_id)$$;
revoke all on function public.preview_finance_expense_cancellation(uuid,uuid) from public,anon,service_role;
grant execute on function public.preview_finance_expense_cancellation(uuid,uuid) to authenticated;

-- Keep cancelled rows and original values in history; current totals exclude them.
create or replace function finance_private.list_expenses(_tenant uuid,_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare page integer:=coalesce((_filters->>'page')::integer,1);size integer:=coalesce((_filters->>'page_size')::integer,30);
 from_date date:=nullif(_filters->>'from','')::date;to_date date:=nullif(_filters->>'to','')::date;
 search text:=lower(coalesce(_filters->>'search',''));result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if jsonb_typeof(_filters) is distinct from 'object' or page not between 1 and 1000000 or size not between 1 and 100
   or length(search)>200 or from_date>to_date
   or exists(select 1 from jsonb_object_keys(_filters) k where k not in('page','page_size','from','to','search','category','context','trip_id','missing_receipt','cost_center')) then
   raise exception 'finance_invalid_expense_filters' using errcode='22023';end if;
 with filtered as materialized (
   select e.*,x.id is not null cancelled,to_jsonb(x)-'source_snapshot' cancellation,b.context,b.trip_id,b.driver_id,b.description batch_description,c.name cost_center_name,
     coalesce(a.allocated,0)::bigint allocated_cents,p.status payable_status,
     u.receivable_id,u.supplier_id reimbursement_supplier_id,u.source_snapshot->>'supplier_name' reimbursement_supplier_name,
     r.status receivable_status
   from public.finance_expense_items e
   left join public.finance_expense_cancellations x on x.tenant_id=e.tenant_id and x.expense_id=e.id
   join public.finance_expense_batches b on b.tenant_id=e.tenant_id and b.id=e.batch_id
   left join public.cost_centers c on c.id=e.cost_center_id and c.tenant_id=e.tenant_id
   left join public.payables p on p.id=e.payable_id and p.tenant_id=e.tenant_id
   left join public.finance_unloading_charges u on u.id=e.unloading_id and u.tenant_id=e.tenant_id
   left join public.receivables r on r.id=u.receivable_id and r.tenant_id=e.tenant_id
   left join lateral(select sum(a.amount_cents) allocated from public.finance_expense_allocations a
     where a.tenant_id=e.tenant_id and a.expense_id=e.id) a on true
   where e.tenant_id=_tenant and (from_date is null or e.occurred_on>=from_date) and (to_date is null or e.occurred_on<=to_date)
     and (nullif(_filters->>'cost_center','') is null or ((_filters->>'cost_center'='unassigned' and e.cost_center_id is null) or e.cost_center_id=nullif(nullif(_filters->>'cost_center',''),'unassigned')::uuid))
     and (nullif(_filters->>'category','') is null or e.category=_filters->>'category')
     and (nullif(_filters->>'context','') is null or b.context=_filters->>'context')
     and (nullif(_filters->>'trip_id','') is null or b.trip_id=(_filters->>'trip_id')::uuid)
     and (not coalesce((_filters->>'missing_receipt')::boolean,false) or e.receipt_path is null)
     and position(search in lower(e.description||' '||e.supplier_name||' '||b.description||' '||coalesce(e.document_number,'')))>0
 ), paged as (
   select * from filtered order by occurred_on desc,created_at desc,id desc limit size offset (page-1)*size
 ), category_totals as (
   select category,sum(amount_cents)::text amount_cents,count(*) item_count from filtered where not cancelled group by category
 ), center_totals as (
   select cost_center_id,cost_center_name,sum(amount_cents)::text amount_cents,count(*) item_count from filtered where not cancelled group by cost_center_id,cost_center_name
 ), rows as (
   select p.*,coalesce((select jsonb_agg(jsonb_build_object('movement_id',m.id,'amount_cents',a.amount_cents,
     'movement_amount_cents',m.amount_cents,'beneficiary_name',m.beneficiary_name,'occurred_on',m.occurred_on,'bank_reference',m.bank_reference)
     order by m.occurred_on,m.id) from public.finance_expense_allocations a join public.finance_movements m on m.id=a.movement_id and m.tenant_id=a.tenant_id
     where a.expense_id=p.id and a.tenant_id=_tenant),'[]') allocations,
     coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'actor_id',v.actor_id,'actor_name',v.actor_name,'action',v.action,
       'reason',v.reason,'created_at',v.created_at) order by v.created_at,v.id) from public.finance_events v
       where v.tenant_id=_tenant and ((v.entity_type='expense_batch' and v.entity_id=p.batch_id) or (v.entity_type='expense_item' and v.entity_id=p.id))),'[]') history
   from paged p
 ) select jsonb_build_object('version',1,'tenant_id',_tenant,'page',page,'page_size',size,
   'total',(select count(*) from filtered),
   'active_count',(select count(*) from filtered where not cancelled),'cancelled_count',(select count(*) from filtered where cancelled),
   'historical_total_cents',(select coalesce(sum(amount_cents),0)::text from filtered),'cancelled_total_cents',(select coalesce(sum(amount_cents),0)::text from filtered where cancelled),
   'total_cents',(select coalesce(sum(amount_cents),0)::text from filtered where not cancelled),
   'allocated_cents',(select coalesce(sum(allocated_cents),0)::text from filtered where not cancelled),
   'complement_cents',(select coalesce(sum(amount_cents-allocated_cents),0)::text from filtered where not cancelled),
   'missing_receipt_count',(select count(*) from filtered where not cancelled and receipt_path is null),
   'cost_centers',coalesce((select jsonb_agg(to_jsonb(c) order by cost_center_name nulls last,cost_center_id) from center_totals c),'[]'),
   'categories',coalesce((select jsonb_agg(to_jsonb(c) order by category) from category_totals c),'[]'),
   'rows',coalesce((select jsonb_agg(to_jsonb(r) order by occurred_on desc,created_at desc,id desc) from rows r),'[]')) into result;
 return result;
end;$$;
