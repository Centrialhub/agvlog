-- Cancellation decisions need existence proofs, not every historical row. Keep
-- the command revision authoritative while bounding evidence returned/stored.
create function finance_private.expense_cancellation_context_bounded(_tenant uuid,_expense uuid,_unloading boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e public.finance_expense_items%rowtype;b public.finance_expense_batches%rowtype;p public.payables%rowtype;cancel public.finance_expense_cancellations%rowtype;
 snapshot jsonb;issue text;cost_version jsonb;origin_items jsonb;source_payables jsonb;blocked_settlement boolean;truncated boolean;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into e from public.finance_expense_items where tenant_id=_tenant and id=_expense;
 select * into b from public.finance_expense_batches where tenant_id=_tenant and id=e.batch_id;
 select * into p from public.payables where tenant_id=_tenant and id=e.payable_id;
 select * into cancel from public.finance_expense_cancellations where tenant_id=_tenant and expense_id=_expense;
 if _unloading and e.id is not null then cost_version:=finance_private.expense_cost_effective(_tenant,e.id);end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.request_id),'[]') into origin_items from(
  select c.request_id,item from public.finance_commands c cross join lateral jsonb_array_elements(c.payload->'items') item
  where c.tenant_id=_tenant and c.action='record_expense_batch' and c.result->>'batch_id'=b.id::text and item->>'id'=e.id::text order by c.request_id limit 2)q;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') into source_payables from(
  select x.* from public.payables x where x.tenant_id=_tenant and x.source_table='finance_expense_items' and x.source_id=e.id order by x.id limit 2)q;
 blocked_settlement:=exists(select 1 from public.driver_settlements x where x.tenant_id=_tenant and x.dispatch_trip_id=b.trip_id and x.status not in('pending_review','in_review','reopened'));
 truncated:=exists(select 1 from public.payables_payments x where x.tenant_id=_tenant and x.payable_id=e.payable_id offset 5)
  or exists(select 1 from public.finance_expense_allocations x where x.tenant_id=_tenant and x.expense_id=e.id offset 5)
  or exists(select 1 from public.finance_payable_movement_links x where x.tenant_id=_tenant and x.payable_id=e.payable_id offset 5)
  or exists(select 1 from public.driver_settlements x where x.tenant_id=_tenant and x.dispatch_trip_id=b.trip_id offset 5);
 snapshot:=jsonb_build_object(
  'cost_version',case when cost_version is null then null else jsonb_build_object('revision',cost_version->'revision','verified',cost_version->'verified','effective_amount_cents',cost_version->'effective_amount_cents') end,
  'expense',to_jsonb(e),'batch',to_jsonb(b),'payable',to_jsonb(p),'supplier',(select to_jsonb(s) from public.clients s where s.tenant_id=_tenant and s.id=e.supplier_id),
  'cancellation',case when cancel.id is null then null else to_jsonb(cancel)-'source_snapshot' end,'origin_items',origin_items,'source_payables',source_payables,
  'driver',(select to_jsonb(d) from public.drivers d where d.tenant_id=_tenant and d.id=b.driver_id),
  'payments',(select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') from(select id from public.payables_payments where tenant_id=_tenant and payable_id=e.payable_id order by id limit 5)q),
  'allocations',(select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') from(select id,movement_id from public.finance_expense_allocations where tenant_id=_tenant and expense_id=e.id order by id limit 5)q),
  'payable_links',(select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') from(select id,movement_id from public.finance_payable_movement_links where tenant_id=_tenant and payable_id=e.payable_id order by id limit 5)q),
  'legacy_links',(select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') from(select id from public.finance_legacy_expense_cost_links where tenant_id=_tenant and cost_id=e.id order by id limit 5)q),
  'maintenance_claims',(select coalesce(jsonb_agg(to_jsonb(q) order by q.cost_id),'[]') from(select cost_id,source_kind,source_id,link_id from public.finance_maintenance_cost_claims where tenant_id=_tenant and cost_id=e.id order by cost_id limit 5)q),
  'labor_history',(select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') from(select id from public.finance_maintenance_labor_links where tenant_id=_tenant and cost_id=e.id order by id limit 5)q),
  'part_history',(select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') from(select id from public.finance_maintenance_direct_part_links where tenant_id=_tenant and cost_id=e.id order by id limit 5)q),
  'stock_history',(select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') from(select id from public.finance_stock_acquisition_links where tenant_id=_tenant and cost_id=e.id order by id limit 5)q),
  'settlements',(select coalesce(jsonb_agg(to_jsonb(q) order by q.blocked desc,q.id),'[]') from(select id,status,status not in('pending_review','in_review','reopened') blocked from public.driver_settlements where tenant_id=_tenant and dispatch_trip_id=b.trip_id order by status not in('pending_review','in_review','reopened') desc,id limit 5)q),
  'advances',(select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') from(select id from public.employee_advances where tenant_id=_tenant and payable_id=e.payable_id order by id limit 5)q),
  'payroll_items',(select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') from(select id from public.payroll_entry_items where tenant_id=_tenant and(source_table='finance_expense_items' and source_id=e.id or source_table='payables' and source_id=e.payable_id) order by id limit 5)q),
  'obligations',(select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') from(select id from public.financial_obligations where tenant_id=_tenant and source_table='finance_expense_items' and source_id=e.id order by id limit 5)q),
  'closure_dependencies',(select coalesce(jsonb_agg(to_jsonb(q) order by q.closure_id,q.source_kind,q.source_id),'[]') from(select closure_id,source_kind,source_id from public.finance_account_period_dependencies where tenant_id=_tenant and((source_kind='finance_expense_items' and source_id=e.id)or(source_kind='payables' and source_id=e.payable_id)) order by closure_id,source_kind,source_id limit 5)q),
  'references_truncated',truncated);
 if e.id is null or b.id is null then issue:='finance_expense_not_found';
 elsif _unloading and cost_version->>'verified' is distinct from 'true' then issue:='finance_expense_cost_unverified';
 elsif cancel.id is not null then issue:='finance_expense_already_cancelled';
 elsif _unloading and(e.unloading_id is null or e.category<>'unloading') then issue:='finance_unloading_cost_required';
 elsif not _unloading and(e.unloading_id is not null or e.category='unloading') then issue:='finance_expense_unloading_requires_resolution';
 elsif exists(select 1 from public.payables_payments x where x.tenant_id=_tenant and x.payable_id=e.payable_id) or exists(select 1 from public.finance_expense_allocations x where x.tenant_id=_tenant and x.expense_id=e.id) or exists(select 1 from public.finance_payable_movement_links x where x.tenant_id=_tenant and x.payable_id=e.payable_id) then issue:='finance_expense_money_dependency';
 elsif jsonb_array_length(source_payables)<>1 or e.payable_id is null or p.id is null or p.source_table is distinct from 'finance_expense_items' or p.source_id is distinct from e.id or p.amount*100 is distinct from(case when _unloading then(cost_version->>'effective_amount_cents')::numeric else e.amount_cents::numeric end) or p.status not in('pending','approved') or p.driver_id is distinct from b.driver_id or jsonb_array_length(origin_items)<>1 or(case origin_items#>>'{0,item,payee_type}' when 'supplier' then p.supplier_id is distinct from e.supplier_id or(e.supplier_id is null and p.supplier_name is distinct from e.supplier_name) when 'driver' then b.driver_id is null or p.supplier_id is not null or p.supplier_name is distinct from snapshot#>>'{driver,name}' else true end) then issue:='finance_expense_payable_inconsistent';
 elsif exists(select 1 from public.finance_legacy_expense_cost_links x where x.tenant_id=_tenant and x.cost_id=e.id) or exists(select 1 from public.finance_maintenance_cost_claims x where x.tenant_id=_tenant and x.cost_id=e.id) or exists(select 1 from public.finance_maintenance_labor_links x where x.tenant_id=_tenant and x.cost_id=e.id) or exists(select 1 from public.finance_maintenance_direct_part_links x where x.tenant_id=_tenant and x.cost_id=e.id) or exists(select 1 from public.finance_stock_acquisition_links x where x.tenant_id=_tenant and x.cost_id=e.id) then issue:='finance_expense_source_association_dependency';
 elsif exists(select 1 from public.employee_advances x where x.tenant_id=_tenant and x.payable_id=e.payable_id) or exists(select 1 from public.payroll_entry_items x where x.tenant_id=_tenant and(source_table='finance_expense_items' and source_id=e.id or source_table='payables' and source_id=e.payable_id)) or blocked_settlement then issue:='finance_expense_protected_composition';
 elsif exists(select 1 from public.financial_obligations x where x.tenant_id=_tenant and x.source_table='finance_expense_items' and x.source_id=e.id) then issue:='finance_expense_obligation_dependency';
 elsif exists(select 1 from public.finance_account_period_dependencies d join public.finance_account_period_closures c on c.tenant_id=d.tenant_id and c.id=d.closure_id where d.tenant_id=_tenant and((d.source_kind='finance_expense_items' and d.source_id=e.id)or(d.source_kind='payables' and d.source_id=e.payable_id))and not exists(select 1 from public.finance_account_period_reopenings r where r.tenant_id=_tenant and r.closure_id=c.id)) then issue:='finance_expense_closed_period_dependency';end if;
 if issue is null then begin perform finance_private.assert_closed_source_mutable(_tenant,'finance_expense_items',to_jsonb(e));perform finance_private.assert_closed_source_mutable(_tenant,'payables',to_jsonb(p));exception when sqlstate '55000' then issue:='finance_expense_closed_period_dependency';end;end if;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'expense_id',_expense,'revision',md5(snapshot::text),'eligible',issue is null,'issue',issue,'snapshot',snapshot,'cancellation',case when cancel.id is null then null else to_jsonb(cancel)-'source_snapshot' end,'effects',jsonb_build_object('cost_removed_cents',case when _unloading then cost_version->>'effective_amount_cents' when e.id is not null then e.amount_cents::text end,'obligation_cancelled_cents',case when p.id is not null then trunc(p.amount*100)::text end,'cash_changed',false));
end$$;
revoke all on function finance_private.expense_cancellation_context_bounded(uuid,uuid,boolean) from public,anon,authenticated,service_role;

create or replace function finance_private.expense_cancellation_context(_tenant uuid,_expense uuid) returns jsonb language sql stable security definer set search_path='' as $$select finance_private.expense_cancellation_context_bounded(_tenant,_expense,false)$$;
create or replace function finance_private.unloading_cost_cancellation_context(_tenant uuid,_expense uuid) returns jsonb language sql stable security definer set search_path='' as $$select finance_private.expense_cancellation_context_bounded(_tenant,_expense,true)$$;
revoke all on function finance_private.expense_cancellation_context(uuid,uuid),finance_private.unloading_cost_cancellation_context(uuid,uuid) from public,anon,authenticated,service_role;
