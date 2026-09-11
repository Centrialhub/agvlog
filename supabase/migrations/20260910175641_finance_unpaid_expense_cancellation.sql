create table public.finance_expense_cancellations(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,expense_id uuid not null,revision text not null,source_snapshot jsonb not null,
 actor_id uuid not null,actor_name text not null,reason text not null check(length(btrim(reason)) between 10 and 2000),request_id uuid not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,expense_id),unique(tenant_id,request_id),foreign key(tenant_id,expense_id) references public.finance_expense_items(tenant_id,id)
);
alter table public.finance_expense_cancellations enable row level security;
revoke all on public.finance_expense_cancellations from public,anon,authenticated,service_role;
grant select on public.finance_expense_cancellations to authenticated;
create policy finance_expense_cancel_read on public.finance_expense_cancellations for select to authenticated using(finance_private.can_access(tenant_id));
create trigger preserve_expense_cancellation before update or delete on public.finance_expense_cancellations for each row execute function finance_private.preserve_event();
create function finance_private.expense_is_cancelled(_tenant uuid,_expense uuid) returns boolean language sql stable set search_path='' as $$select exists(select 1 from public.finance_expense_cancellations where tenant_id=_tenant and expense_id=_expense)$$;
create view finance_private.active_expense_items with(security_invoker=true) as select e.* from public.finance_expense_items e where not finance_private.expense_is_cancelled(e.tenant_id,e.id);
revoke all on finance_private.active_expense_items from public,anon,authenticated,service_role;
create function finance_private.expense_cancellation_context(_tenant uuid,_expense uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e public.finance_expense_items%rowtype;b public.finance_expense_batches%rowtype;p public.payables%rowtype;cancel public.finance_expense_cancellations%rowtype;snapshot jsonb;issue text;begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into e from public.finance_expense_items where tenant_id=_tenant and id=_expense;select * into b from public.finance_expense_batches where tenant_id=_tenant and id=e.batch_id;select * into p from public.payables where tenant_id=_tenant and id=e.payable_id;
 select * into cancel from public.finance_expense_cancellations where tenant_id=_tenant and expense_id=_expense;
 snapshot:=jsonb_build_object('expense',to_jsonb(e),'batch',to_jsonb(b),'payable',to_jsonb(p),'supplier',(select to_jsonb(s) from public.clients s where s.tenant_id=_tenant and s.id=e.supplier_id),'cancellation',case when cancel.id is null then null else to_jsonb(cancel)-'source_snapshot' end,
 'origin_items',(select coalesce(jsonb_agg(jsonb_build_object('request_id',c.request_id,'item',item) order by c.request_id),'[]') from public.finance_commands c cross join lateral jsonb_array_elements(c.payload->'items') item where c.tenant_id=_tenant and c.action='record_expense_batch' and c.result->>'batch_id'=b.id::text and item->>'id'=e.id::text),
 'driver',(select to_jsonb(d) from public.drivers d where d.tenant_id=_tenant and d.id=b.driver_id),
 'source_payables',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.payables x where x.tenant_id=_tenant and x.source_table='finance_expense_items' and x.source_id=e.id),
 'payments',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.payables_payments x where x.tenant_id=_tenant and x.payable_id=e.payable_id),
 'allocations',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.finance_expense_allocations x where x.tenant_id=_tenant and x.expense_id=e.id),
 'payable_links',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.finance_payable_movement_links x where x.tenant_id=_tenant and x.payable_id=e.payable_id),
 'legacy_links',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.finance_legacy_expense_cost_links x where x.tenant_id=_tenant and x.cost_id=e.id),
 'maintenance_claims',(select coalesce(jsonb_agg(to_jsonb(x) order by x.cost_id),'[]') from public.finance_maintenance_cost_claims x where x.tenant_id=_tenant and x.cost_id=e.id),
 'labor_history',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.finance_maintenance_labor_links x where x.tenant_id=_tenant and x.cost_id=e.id),
 'part_history',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.finance_maintenance_direct_part_links x where x.tenant_id=_tenant and x.cost_id=e.id),
 'stock_history',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.finance_stock_acquisition_links x where x.tenant_id=_tenant and x.cost_id=e.id),
 'settlements',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.driver_settlements x where x.tenant_id=_tenant and x.dispatch_trip_id=b.trip_id),
 'advances',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.employee_advances x where x.tenant_id=_tenant and x.payable_id=e.payable_id),
 'payroll_items',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.payroll_entry_items x where x.tenant_id=_tenant and (x.source_table='finance_expense_items' and x.source_id=e.id or x.source_table='payables' and x.source_id=e.payable_id)),
 'obligations',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.financial_obligations x where x.tenant_id=_tenant and x.source_table='finance_expense_items' and x.source_id=e.id),
 'closure_dependencies',(select coalesce(jsonb_agg(to_jsonb(x) order by x.closure_id,x.source_kind,x.source_id),'[]') from public.finance_account_period_dependencies x where x.tenant_id=_tenant and ((x.source_kind='finance_expense_items' and x.source_id=e.id) or(x.source_kind='payables' and x.source_id=e.payable_id))));
 if e.id is null or b.id is null then issue:='finance_expense_not_found';
 elsif cancel.id is not null then issue:='finance_expense_already_cancelled';
 elsif e.unloading_id is not null or e.category='unloading' then issue:='finance_expense_unloading_requires_resolution';
 elsif jsonb_array_length(snapshot->'payments')>0 or jsonb_array_length(snapshot->'allocations')>0 or jsonb_array_length(snapshot->'payable_links')>0 then issue:='finance_expense_money_dependency';
 elsif jsonb_array_length(snapshot->'source_payables')<>1 or e.payable_id is null or p.id is null or p.source_table is distinct from 'finance_expense_items' or p.source_id is distinct from e.id or p.amount*100 is distinct from e.amount_cents::numeric or p.status not in('pending','approved') or p.driver_id is distinct from b.driver_id or jsonb_array_length(snapshot->'origin_items')<>1 or (case snapshot#>>'{origin_items,0,item,payee_type}' when 'supplier' then p.supplier_id is distinct from e.supplier_id or (e.supplier_id is null and p.supplier_name is distinct from e.supplier_name) when 'driver' then b.driver_id is null or p.supplier_id is not null or p.supplier_name is distinct from snapshot#>>'{driver,name}' else true end) then issue:='finance_expense_payable_inconsistent';
 elsif jsonb_array_length(snapshot->'legacy_links')+jsonb_array_length(snapshot->'maintenance_claims')+jsonb_array_length(snapshot->'labor_history')+jsonb_array_length(snapshot->'part_history')+jsonb_array_length(snapshot->'stock_history')>0 then issue:='finance_expense_source_association_dependency';
 elsif jsonb_array_length(snapshot->'advances')>0 or jsonb_array_length(snapshot->'payroll_items')>0 or exists(select 1 from public.driver_settlements x where x.tenant_id=_tenant and x.dispatch_trip_id=b.trip_id and x.status not in('pending_review','in_review','reopened')) then issue:='finance_expense_protected_composition';
 elsif jsonb_array_length(snapshot->'obligations')>0 then issue:='finance_expense_obligation_dependency';
 elsif exists(select 1 from public.finance_account_period_dependencies d join public.finance_account_period_closures c on c.tenant_id=d.tenant_id and c.id=d.closure_id where d.tenant_id=_tenant and ((d.source_kind='finance_expense_items' and d.source_id=e.id) or(d.source_kind='payables' and d.source_id=e.payable_id)) and not exists(select 1 from public.finance_account_period_reopenings r where r.tenant_id=_tenant and r.closure_id=c.id)) then issue:='finance_expense_closed_period_dependency';end if;
 if issue is null then begin perform finance_private.assert_closed_source_mutable(_tenant,'finance_expense_items',to_jsonb(e));perform finance_private.assert_closed_source_mutable(_tenant,'payables',to_jsonb(p));exception when sqlstate '55000' then issue:='finance_expense_closed_period_dependency';end;end if;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'expense_id',_expense,'revision',md5(snapshot::text),'eligible',issue is null,'issue',issue,'snapshot',snapshot,'cancellation',case when cancel.id is null then null else to_jsonb(cancel)-'source_snapshot' end,'effects',jsonb_build_object('cost_removed_cents',case when e.id is not null then e.amount_cents::text end,'obligation_cancelled_cents',case when p.id is not null then trunc(p.amount*100)::text end,'cash_changed',false));
end$$;
create function finance_private.cancel_expense(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;expense uuid;actor uuid:=auth.uid();actor_name text;context jsonb;prior public.finance_commands%rowtype;e public.finance_expense_items%rowtype;b public.finance_expense_batches%rowtype;p public.payables%rowtype;cancel uuid;result jsonb;begin
 if jsonb_typeof(_payload) is distinct from 'object' or _payload->'version' is distinct from '1'::jsonb or jsonb_typeof(_payload->'reason') is distinct from 'string' or length(btrim(_payload->>'reason')) not between 10 and 2000 or coalesce(_payload->>'revision','') !~ '^[0-9a-f]{32}$' or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','expense_id','revision','reason')) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;expense:=(_payload->>'expense_id')::uuid;if t is null or request is null or expense is null then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;if found then if prior.actor_id<>actor or prior.action<>'cancel_expense' or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return prior.result;end if;
 select * into e from public.finance_expense_items where tenant_id=t and id=expense;select * into b from public.finance_expense_batches where tenant_id=t and id=e.batch_id;
 perform 1 from public.payroll_periods where tenant_id=t order by id for update;perform 1 from public.dispatch_trips where tenant_id=t and id=b.trip_id for update;
 perform 1 from public.driver_settlements where tenant_id=t and dispatch_trip_id=b.trip_id order by id for update;perform 1 from public.payroll_entries where tenant_id=t order by payroll_period_id,id for update;
 perform 1 from public.finance_expense_items where tenant_id=t and id=expense for update;
 perform 1 from public.drivers where tenant_id=t and id=b.driver_id for update;
 perform 1 from public.clients where tenant_id=t and id=e.supplier_id for update;
 perform 1 from public.payables where tenant_id=t and (id=e.payable_id or source_table='finance_expense_items' and source_id=e.id) order by id for update;select * into p from public.payables where tenant_id=t and id=e.payable_id;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 context:=finance_private.expense_cancellation_context(t,expense);if context->>'revision' is distinct from _payload->>'revision' then raise exception 'finance_expense_cancellation_changed' using errcode='40001';end if;
 if context->'eligible' is distinct from 'true'::jsonb then raise exception '%',context->>'issue' using errcode='23514';end if;
 perform finance_private.assert_closed_source_mutable(t,'finance_expense_items',to_jsonb(e));
 -- The same guard checks the before/after obligation, without updating money.
 perform finance_private.assert_closed_source_mutable(t,'payables',to_jsonb(p));
 perform finance_private.assert_closed_source_mutable(t,'payables',to_jsonb(p)||jsonb_build_object('status','cancelled'));
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into actor_name from auth.users where id=actor;actor_name:=coalesce(actor_name,actor::text);
 insert into public.finance_expense_cancellations(tenant_id,expense_id,revision,source_snapshot,actor_id,actor_name,reason,request_id) values(t,expense,context->>'revision',context->'snapshot',actor,actor_name,btrim(_payload->>'reason'),request) returning id into cancel;
 update public.payables set status='cancelled',updated_at=clock_timestamp() where tenant_id=t and id=p.id;
 update public.driver_settlements set needs_recalculation=true,recalculation_reason=concat_ws('; ',nullif(recalculation_reason,''),'canonical_cost_cancelled') where tenant_id=t and dispatch_trip_id=b.trip_id;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'expense_id',expense,'cancellation_id',cancel,'payable_id',p.id,'amount_cents',e.amount_cents::text,'confirmed',true,'cash_changed',false);
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(t,'expense_item',expense,'expense_cancelled',actor,actor_name,btrim(_payload->>'reason'),context->'snapshot',result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'cancel_expense',_payload,result);return result;
end$$;
create function public.cancel_finance_expense(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.cancel_expense(_payload)$$;
revoke all on function finance_private.expense_is_cancelled(uuid,uuid),finance_private.expense_cancellation_context(uuid,uuid),finance_private.cancel_expense(jsonb),public.cancel_finance_expense(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.cancel_expense(jsonb),public.cancel_finance_expense(jsonb) to authenticated;
-- Serialize future materialization with cancellation; never resurrect its obligation.
create function finance_private.guard_cancelled_expense_dependency() returns trigger language plpgsql security definer set search_path='' as $$
declare t uuid;cost uuid;data jsonb;begin
 data:=to_jsonb(new);t:=(data->>'tenant_id')::uuid;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if tg_table_name='payables' then
  if tg_op='UPDATE' and old.source_table='finance_expense_items' and finance_private.expense_is_cancelled(old.tenant_id,old.source_id) then
   if new.status is distinct from 'cancelled' or (to_jsonb(new)-'status'-'updated_at') is distinct from (to_jsonb(old)-'status'-'updated_at') then raise exception 'finance_expense_already_cancelled' using errcode='55000';end if;return new;
  end if;
  if new.source_table='finance_expense_items' then cost:=new.source_id;end if;
 elsif tg_table_name in('payables_payments','employee_advances') then select source_id into cost from public.payables where tenant_id=t and id=new.payable_id and source_table='finance_expense_items';
 elsif tg_table_name='finance_expense_allocations' then cost:=new.expense_id;
 elsif tg_table_name in('payroll_entry_items','driver_settlement_items','financial_obligations') then if data->>'source_table'='finance_expense_items' then cost:=(data->>'source_id')::uuid;end if;
 else cost:=(data->>'cost_id')::uuid;end if;
 if cost is not null and finance_private.expense_is_cancelled(t,cost) then raise exception 'finance_expense_already_cancelled' using errcode='55000';end if;return new;
end$$;
revoke all on function finance_private.guard_cancelled_expense_dependency() from public,anon,authenticated,service_role;
create trigger finance_cancelled_expense_payable before insert or update on public.payables for each row execute function finance_private.guard_cancelled_expense_dependency();
create trigger finance_cancelled_expense_payment before insert on public.payables_payments for each row execute function finance_private.guard_cancelled_expense_dependency();
create trigger finance_cancelled_expense_allocation before insert on public.finance_expense_allocations for each row execute function finance_private.guard_cancelled_expense_dependency();
create trigger finance_cancelled_expense_legacy before insert on public.finance_legacy_expense_cost_links for each row execute function finance_private.guard_cancelled_expense_dependency();
create trigger finance_cancelled_expense_claim before insert on public.finance_maintenance_cost_claims for each row execute function finance_private.guard_cancelled_expense_dependency();
-- Keep original rows and cancel flags in recorded-cost history, omit from future builders.
do $$declare signature text;definition text;patched text;begin
 foreach signature in array array['finance_private.recorded_costs(uuid,jsonb)','finance_private.recorded_cost_summary(uuid,date,date,text,text)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);patched:=replace(definition,'false cancelled,false needs_review','finance_private.expense_is_cancelled(e.tenant_id,e.id) cancelled,false needs_review');
  if patched=definition then raise exception 'expense_cancellation_cost_patch_missing: %',signature;end if;execute patched;
 end loop;
 foreach signature in array array['finance_private.canonical_trip_costs(uuid,uuid)','finance_private.settlement_expense_context(uuid,uuid,integer)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);patched:=replace(definition,'public.finance_expense_items','finance_private.active_expense_items');if patched=definition then raise exception 'expense_cancellation_builder_patch_missing: %',signature;end if;execute patched;
 end loop;
 foreach signature in array array['finance_private.legacy_expense_cost_issue(uuid,uuid,uuid)','finance_private.maintenance_labor_issue(uuid,uuid,uuid)','finance_private.maintenance_direct_part_issue(uuid,uuid,uuid)','finance_private.stock_acquisition_issue(uuid,uuid,uuid)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);patched:=regexp_replace(definition,'\mbegin\M','begin if finance_private.expense_is_cancelled(_tenant,_cost) then return ''finance_expense_already_cancelled'';end if;','i');if patched=definition then raise exception 'expense_cancellation_issue_patch_missing: %',signature;end if;execute patched;
 end loop;
end$$;
do $$declare signature text;definition text;patched text;begin
 foreach signature in array array['finance_private.legacy_expense_cost_snapshot(uuid,uuid,uuid)','finance_private.maintenance_labor_snapshot(uuid,uuid,uuid)','finance_private.maintenance_direct_part_snapshot(uuid,uuid,uuid)','finance_private.stock_acquisition_snapshot(uuid,uuid,uuid)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);patched:=regexp_replace(definition,'jsonb_build_object\(','jsonb_build_object(''cost_cancellation'',(select to_jsonb(cancel)-''source_snapshot'' from public.finance_expense_cancellations cancel where cancel.tenant_id=_tenant and cancel.expense_id=_cost),');if patched=definition then raise exception 'expense_cancellation_snapshot_patch_missing: %',signature;end if;execute patched;
 end loop;
end$$;

create trigger finance_cancelled_expense_payroll before insert or update on public.payroll_entry_items for each row execute function finance_private.guard_cancelled_expense_dependency();
create trigger finance_cancelled_expense_settlement before insert or update on public.driver_settlement_items for each row execute function finance_private.guard_cancelled_expense_dependency();
create trigger finance_cancelled_expense_obligation before insert or update on public.financial_obligations for each row execute function finance_private.guard_cancelled_expense_dependency();

create trigger finance_cancelled_expense_advance before insert or update on public.employee_advances for each row execute function finance_private.guard_cancelled_expense_dependency();
