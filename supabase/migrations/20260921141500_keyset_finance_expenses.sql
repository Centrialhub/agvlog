create function finance_private.list_expense_page_v2(_tenant uuid,_filters jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare size integer:=coalesce((_filters->>'page_size')::integer,30);from_date date:=nullif(_filters->>'from','')::date;to_date date:=nullif(_filters->>'to','')::date;
 search text:=lower(coalesce(_filters->>'search',''));cursor_day date:=nullif(_filters->'cursor'->>'occurred_on','')::date;
 cursor_created timestamptz:=nullif(_filters->'cursor'->>'created_at','')::timestamptz;cursor_id uuid:=nullif(_filters->'cursor'->>'id','')::uuid;result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if jsonb_typeof(_filters) is distinct from 'object' or size not between 1 and 100 or length(search)>200 or from_date>to_date
  or exists(select 1 from jsonb_object_keys(_filters) k where k not in('page_size','from','to','search','category','context','trip_id','missing_receipt','cost_center','cursor'))
  or ((_filters->'cursor') is not null and(cursor_day is null or cursor_created is null or cursor_id is null)) then
  raise exception 'finance_invalid_expense_filters' using errcode='22023';end if;
 with base as materialized(
  select e.*,x.id is not null cancelled,to_jsonb(x)-'source_snapshot' cancellation,b.context,b.trip_id,b.driver_id,b.description batch_description,c.name cost_center_name
  from public.finance_expense_items e
  left join public.finance_expense_cancellations x on x.tenant_id=e.tenant_id and x.expense_id=e.id
  join public.finance_expense_batches b on b.tenant_id=e.tenant_id and b.id=e.batch_id
  left join public.cost_centers c on c.id=e.cost_center_id and c.tenant_id=e.tenant_id
  where e.tenant_id=_tenant and(from_date is null or e.occurred_on>=from_date)and(to_date is null or e.occurred_on<=to_date)
   and(nullif(_filters->>'cost_center','')is null or((_filters->>'cost_center'='unassigned'and e.cost_center_id is null)or e.cost_center_id=nullif(nullif(_filters->>'cost_center',''),'unassigned')::uuid))
   and(nullif(_filters->>'category','')is null or e.category=_filters->>'category')and(nullif(_filters->>'context','')is null or b.context=_filters->>'context')
   and(nullif(_filters->>'trip_id','')is null or b.trip_id=(_filters->>'trip_id')::uuid)
   and(not coalesce((_filters->>'missing_receipt')::boolean,false)or(e.receipt_path is null and secure_upload_private.expense_receipt_count(e.tenant_id,e.id)=0))
   and position(search in lower(e.description||' '||e.supplier_name||' '||b.description||' '||coalesce(e.document_number,'')))>0
 ),candidates as materialized(
  select * from base e where cursor_day is null or e.occurred_on<cursor_day or(e.occurred_on=cursor_day and(e.created_at<cursor_created or(e.created_at=cursor_created and e.id<cursor_id)))
  order by occurred_on desc,created_at desc,id desc limit size+1
 ),scope as materialized(
  select * from candidates
 ),metrics as materialized(
  select s.*,finance_private.expense_cost_coverage(s.tenant_id,s.id) coverage,finance_private.expense_cost_effective(s.tenant_id,s.id) cost_origin,
   finance_private.effective_cost_amount(s.tenant_id,s.id) effective_amount_cents,secure_upload_private.expense_receipt_count(s.tenant_id,s.id) receipt_artifact_count,
   coalesce((select sum(a.amount_cents)from public.finance_expense_allocations a where a.tenant_id=s.tenant_id and a.expense_id=s.id),0)::bigint allocated_cents
  from scope s
 ),enriched as materialized(
  select m.*,(m.coverage->>'complement_cents')complement_cents,p.status payable_status,u.receivable_id,u.supplier_id reimbursement_supplier_id,
   u.source_snapshot->>'supplier_name'reimbursement_supplier_name,r.status receivable_status
  from metrics m left join public.payables p on p.id=m.payable_id and p.tenant_id=m.tenant_id
  left join public.finance_unloading_charges u on u.id=m.unloading_id and u.tenant_id=m.tenant_id
  left join public.receivables r on r.id=u.receivable_id and r.tenant_id=m.tenant_id
 ),page_source as materialized(
  select e.* from enriched e join(select id from candidates order by occurred_on desc,created_at desc,id desc limit size)c using(id)
 ),rows as materialized(
  select p.*,case when p.unloading_id is null then null else finance_private.unloading_effective_origin(p.tenant_id,p.unloading_id)end unloading_origin,
   coalesce((select jsonb_agg(jsonb_build_object('movement_id',m.id,'amount_cents',a.amount_cents,'movement_amount_cents',m.amount_cents,'beneficiary_name',m.beneficiary_name,'occurred_on',m.occurred_on,'bank_reference',m.bank_reference)order by m.occurred_on,m.id)
    from public.finance_expense_allocations a join public.finance_movements m on m.id=a.movement_id and m.tenant_id=a.tenant_id where a.expense_id=p.id and a.tenant_id=_tenant),'[]')allocations,
   coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'actor_id',v.actor_id,'actor_name',v.actor_name,'action',v.action,'reason',v.reason,'created_at',v.created_at)order by v.created_at,v.id)
    from public.finance_events v where v.tenant_id=_tenant and((v.entity_type='expense_batch'and v.entity_id=p.batch_id)or(v.entity_type='expense_item'and v.entity_id=p.id))),'[]')history
  from page_source p
 )
 select jsonb_build_object('version',2,'tenant_id',_tenant,'page_size',size,'cursor',_filters->'cursor','has_more',(select count(*)>size from candidates),
  'next_cursor',case when(select count(*)>size from candidates)then(select jsonb_build_object('occurred_on',occurred_on,'created_at',created_at,'id',id)from candidates order by occurred_on desc,created_at desc,id desc offset size-1 limit 1)end,
  'summary',null,
  'rows',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('effective_amount_cents',r.effective_amount_cents::text)order by occurred_on desc,created_at desc,id desc)from rows r),'[]'))into result;
 return result;
end$$;
revoke all on function finance_private.list_expense_page_v2(uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function finance_private.list_expense_page_v2(uuid,jsonb)to authenticated;
create function public.list_finance_expense_page_v2(_tenant_id uuid,_filters jsonb default '{}')returns jsonb language sql stable security invoker set search_path=''as $$select finance_private.list_expense_page_v2(_tenant_id,_filters)$$;
revoke all on function public.list_finance_expense_page_v2(uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.list_finance_expense_page_v2(uuid,jsonb)to authenticated;
