-- Coordinated cancellation keeps the original charge/cost identities and uses the existing cancellation projection.
do $$declare sig text;p record;begin
 foreach sig in array array['finance_private.expense_cancellation_context(uuid,uuid)','finance_private.cancel_expense(jsonb)'] loop
  select * into p from pg_proc where oid=sig::regprocedure;
  if not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or has_function_privilege('anon',sig,'execute') or has_function_privilege('service_role',sig,'execute')
  or has_function_privilege('authenticated',sig,'execute') is distinct from (sig='finance_private.cancel_expense(jsonb)')
  or exists(select 1 from aclexplode(p.proacl) a where a.grantee not in(p.proowner,'authenticated'::regrole::oid)) then raise exception 'unloading_cost_predecessor_acl_changed' using errcode='55000';end if;
 end loop;
end$$;
do $$begin if (select md5(prosrc) from pg_proc where oid='finance_private.expense_cancellation_context(uuid,uuid)'::regprocedure) is distinct from '0ec4fdd6a7ca677e10e0bc71f742548b' then raise exception 'unloading_cost_predecessor_changed:expense_cancellation_context' using errcode='55000';end if;end$$;
do $$begin if (select md5(prosrc) from pg_proc where oid='finance_private.cancel_expense(jsonb)'::regprocedure) is distinct from '13b094e27d4987b3ab9cebcf459d51bf' then raise exception 'unloading_cost_predecessor_changed:cancel_expense' using errcode='55000';end if;end$$;
create table finance_private.unloading_cost_cancellation_tickets(transaction_id bigint not null,tenant_id uuid not null,actor_id uuid not null,request_id uuid not null,charge_id uuid not null,expense_id uuid not null,payload jsonb not null,primary key(transaction_id,tenant_id,request_id));
alter table finance_private.unloading_cost_cancellation_tickets enable row level security;
revoke all on finance_private.unloading_cost_cancellation_tickets from public,anon,authenticated,service_role;
create function finance_private.consume_unloading_cost_cancellation_ticket(_payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare ticket finance_private.unloading_cost_cancellation_tickets%rowtype;
begin
 if not finance_private.can_repair_unloading((_payload->>'tenant_id')::uuid) then raise exception 'finance_access_denied' using errcode='42501';end if;
 delete from finance_private.unloading_cost_cancellation_tickets where transaction_id=txid_current() and tenant_id=(_payload->>'tenant_id')::uuid and actor_id=auth.uid() and request_id=(_payload->>'request_id')::uuid and expense_id=(_payload->>'expense_id')::uuid and unloading_cost_cancellation_tickets.payload=consume_unloading_cost_cancellation_ticket._payload returning * into ticket;
 if not found or not exists(select 1 from public.finance_expense_items e where e.tenant_id=ticket.tenant_id and e.id=ticket.expense_id and e.unloading_id=ticket.charge_id) then raise exception 'unloading_cost_ticket_required' using errcode='55000';end if;
end$$;
revoke all on function finance_private.consume_unloading_cost_cancellation_ticket(jsonb) from public,anon,authenticated,service_role;
create function finance_private.unloading_cost_cancellation_context(_tenant uuid,_expense uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
 elsif e.unloading_id is null or e.category<>'unloading' then issue:='finance_unloading_cost_required';
 elsif jsonb_array_length(snapshot->'payments')>0 or jsonb_array_length(snapshot->'allocations')>0 or jsonb_array_length(snapshot->'payable_links')>0 then issue:='finance_expense_money_dependency';
 elsif jsonb_array_length(snapshot->'source_payables')<>1 or e.payable_id is null or p.id is null or p.source_table is distinct from 'finance_expense_items' or p.source_id is distinct from e.id or p.amount*100 is distinct from e.amount_cents::numeric or p.status not in('pending','approved') or p.driver_id is distinct from b.driver_id or jsonb_array_length(snapshot->'origin_items')<>1 or (case snapshot#>>'{origin_items,0,item,payee_type}' when 'supplier' then p.supplier_id is distinct from e.supplier_id or (e.supplier_id is null and p.supplier_name is distinct from e.supplier_name) when 'driver' then b.driver_id is null or p.supplier_id is not null or p.supplier_name is distinct from snapshot#>>'{driver,name}' else true end) then issue:='finance_expense_payable_inconsistent';
 elsif jsonb_array_length(snapshot->'legacy_links')+jsonb_array_length(snapshot->'maintenance_claims')+jsonb_array_length(snapshot->'labor_history')+jsonb_array_length(snapshot->'part_history')+jsonb_array_length(snapshot->'stock_history')>0 then issue:='finance_expense_source_association_dependency';
 elsif jsonb_array_length(snapshot->'advances')>0 or jsonb_array_length(snapshot->'payroll_items')>0 or exists(select 1 from public.driver_settlements x where x.tenant_id=_tenant and x.dispatch_trip_id=b.trip_id and x.status not in('pending_review','in_review','reopened')) then issue:='finance_expense_protected_composition';
 elsif jsonb_array_length(snapshot->'obligations')>0 then issue:='finance_expense_obligation_dependency';
 elsif exists(select 1 from public.finance_account_period_dependencies d join public.finance_account_period_closures c on c.tenant_id=d.tenant_id and c.id=d.closure_id where d.tenant_id=_tenant and ((d.source_kind='finance_expense_items' and d.source_id=e.id) or(d.source_kind='payables' and d.source_id=e.payable_id)) and not exists(select 1 from public.finance_account_period_reopenings r where r.tenant_id=_tenant and r.closure_id=c.id)) then issue:='finance_expense_closed_period_dependency';end if;
 if issue is null then begin perform finance_private.assert_closed_source_mutable(_tenant,'finance_expense_items',to_jsonb(e));perform finance_private.assert_closed_source_mutable(_tenant,'payables',to_jsonb(p));exception when sqlstate '55000' then issue:='finance_expense_closed_period_dependency';end;end if;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'expense_id',_expense,'revision',md5(snapshot::text),'eligible',issue is null,'issue',issue,'snapshot',snapshot,'cancellation',case when cancel.id is null then null else to_jsonb(cancel)-'source_snapshot' end,'effects',jsonb_build_object('cost_removed_cents',case when e.id is not null then e.amount_cents::text end,'obligation_cancelled_cents',case when p.id is not null then trunc(p.amount*100)::text end,'cash_changed',false));
end$$;
create function finance_private.cancel_unloading_cost(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;expense uuid;actor uuid:=auth.uid();actor_name text;context jsonb;prior public.finance_commands%rowtype;e public.finance_expense_items%rowtype;b public.finance_expense_batches%rowtype;p public.payables%rowtype;cancel uuid;result jsonb;begin
 perform finance_private.consume_unloading_cost_cancellation_ticket(_payload);
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
 context:=finance_private.unloading_cost_cancellation_context(t,expense);if context->>'revision' is distinct from _payload->>'revision' then raise exception 'finance_expense_cancellation_changed' using errcode='40001';end if;
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
revoke all on function finance_private.unloading_cost_cancellation_context(uuid,uuid),finance_private.cancel_unloading_cost(jsonb) from public,anon,authenticated,service_role;

create function finance_private.coordinated_unloading_cancellation_context(t uuid,charge uuid,effective_day date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare origin jsonb;right_context jsonb;cost_context jsonb;e public.finance_expense_items%rowtype;blockers jsonb:='[]';materializations jsonb;history jsonb;result jsonb;count_cost integer;
begin
 perform finance_private.require_access(t);
 origin:=finance_private.unloading_effective_origin(t,charge);
 right_context:=finance_private.unloading_origin_correction_context(t,charge,jsonb_build_object('operation','cancel_origin','effective_on',effective_day,'collection_right_only',true));
 blockers:=right_context->'blockers';
 select count(*) into count_cost from public.finance_expense_items where tenant_id=t and unloading_id=charge;
 select * into e from public.finance_expense_items where tenant_id=t and unloading_id=charge;
 if count_cost<>1 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_unique_cost_required','source_table','finance_expense_items','source_ids','[]'::jsonb));
 else
  cost_context:=finance_private.unloading_cost_cancellation_context(t,e.id);
  if cost_context->>'eligible' is distinct from 'true' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code',cost_context->>'issue','source_table','finance_expense_items','source_ids',jsonb_build_array(e.id)));end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into materializations from public.driver_settlement_items x where x.tenant_id=t and ((x.source_table='finance_expense_items' and x.source_id=e.id) or (x.source_table='payables' and x.source_id=e.payable_id));
 if jsonb_array_length(materializations)>0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_cost_materialized','source_table','driver_settlement_items','source_ids',(select jsonb_agg(x->'id') from jsonb_array_elements(materializations)x)));end if;
 select coalesce(jsonb_agg(jsonb_build_object('request_id',x.after_data->'request_id','actor_id',x.actor_id,'actor_name',x.actor_name,'reason',x.reason,'created_at',x.created_at,'expense_cancellation_id',x.after_data->'expense_cancellation_id','origin_amendment_id',x.after_data->'origin_amendment_id') order by x.created_at,x.id),'[]') into history from public.finance_events x where x.tenant_id=t and x.entity_id=charge and x.action='unloading_cancelled_coordinated';
 result:=jsonb_build_object('version',1,'tenant_id',t,'actor_id',auth.uid(),'charge_id',charge,'expense_id',e.id,'payable_id',e.payable_id,'effective_on',effective_day,'origin',origin,
 'cost',case when e.id is not null then jsonb_build_object('amount_cents',e.amount_cents::text,'payable_cents',cost_context#>'{effects,obligation_cancelled_cents}','beneficiary_id',cost_context#>'{snapshot,payable,supplier_id}','beneficiary_name',cost_context#>'{snapshot,payable,supplier_name}','payee_type',cost_context#>'{snapshot,origin_items,0,item,payee_type}') end,
 'blockers',blockers,'eligible',jsonb_array_length(blockers)=0,'can_cancel',finance_private.can_repair_unloading(t),'can_execute',false,'history',history,
 'effects',jsonb_build_object('computation','prospective_coordinated_cancellation','cash_changed',false,'cost_removed_cents',e.amount_cents::text,'obligation_cancelled_cents',cost_context#>'{effects,obligation_cancelled_cents}','collection_cancelled_cents',origin#>'{effective,amount_cents}'),
 '_evidence',jsonb_build_object('right',right_context,'cost',cost_context,'materializations',materializations));
 return result||jsonb_build_object('revision',md5(result::text));
end$$;
revoke all on function finance_private.coordinated_unloading_cancellation_context(uuid,uuid,date) from public,anon,authenticated,service_role;
create function finance_private.cancel_unloading_coordinated(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;charge uuid;req uuid;actor uuid:=auth.uid();context jsonb;existing public.finance_commands%rowtype;right_result jsonb;cost_result jsonb;child_payload jsonb;result jsonb;actor_name text;day date;
begin
 t:=(payload->>'tenant_id')::uuid;charge:=(payload->>'charge_id')::uuid;req:=(payload->>'request_id')::uuid;day:=(payload->>'effective_on')::date;
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if jsonb_typeof(payload) is distinct from 'object' or payload->'version' is distinct from '1'::jsonb or req is null or charge is null or day is null or coalesce(payload->>'revision','')!~'^[a-f0-9]{32}$' or length(btrim(coalesce(payload->>'reason',''))) not between 10 and 2000 or exists(select 1 from jsonb_object_keys(payload) k where k<>all(array['version','tenant_id','request_id','charge_id','effective_on','revision','reason'])) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor order by role::text for share nowait;perform 1 from public.drivers where tenant_id=t and user_id=actor order by id for share nowait;
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into existing from public.finance_commands where tenant_id=t and request_id=req;
 if found then if existing.actor_id<>actor or existing.action<>'cancel_unloading_coordinated' or existing.payload<>payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return existing.result;end if;
 perform 1 from public.finance_unloading_charges where tenant_id=t and id=charge for update nowait;
 perform public._lock_receivable_financial_graph(t,(select receivable_id from public.finance_unloading_charges where tenant_id=t and id=charge));
 perform 1 from public.payroll_periods where tenant_id=t order by id for update nowait;
 perform 1 from public.dispatch_trips where tenant_id=t and id in(select b.trip_id from public.finance_expense_items e join public.finance_expense_batches b on b.tenant_id=e.tenant_id and b.id=e.batch_id where e.tenant_id=t and e.unloading_id=charge) order by id for update nowait;
 perform 1 from public.driver_settlements where tenant_id=t order by id for update nowait;
 perform 1 from public.payroll_entries where tenant_id=t order by payroll_period_id,id for update nowait;
 perform 1 from public.finance_expense_items where tenant_id=t and unloading_id=charge order by id for update nowait;
 perform 1 from public.payables p where p.tenant_id=t and exists(select 1 from public.finance_expense_items e where e.tenant_id=t and e.unloading_id=charge and (e.payable_id=p.id or p.source_table='finance_expense_items' and p.source_id=e.id)) order by p.id for update nowait;
 context:=finance_private.coordinated_unloading_cancellation_context(t,charge,day);
 if context->>'revision' is distinct from payload->>'revision' then raise exception 'unloading_cancellation_changed' using errcode='40001';end if;
 if context->>'eligible' is distinct from 'true' then raise exception 'unloading_cancellation_blocked' using errcode='55000';end if;
 right_result:=finance_private.correct_unloading_origin(jsonb_build_object('version',1,'tenant_id',t,'request_id',md5(req::text||':origin')::uuid,'charge_id',charge,'revision',context#>'{_evidence,right,revision}','proposal',context#>'{_evidence,right,proposal}','reason',payload->>'reason'));
 child_payload:=jsonb_build_object('version',1,'tenant_id',t,'request_id',md5(req::text||':cost')::uuid,'expense_id',context->'expense_id','revision',context#>'{_evidence,cost,revision}','reason',payload->>'reason');
 insert into finance_private.unloading_cost_cancellation_tickets values(txid_current(),t,actor,(child_payload->>'request_id')::uuid,charge,(context->>'expense_id')::uuid,child_payload);
 cost_result:=finance_private.cancel_unloading_cost(child_payload);
 if exists(select 1 from finance_private.unloading_cost_cancellation_tickets where transaction_id=txid_current() and tenant_id=t and request_id=(child_payload->>'request_id')::uuid) then raise exception 'unloading_cost_ticket_unconsumed';end if;
 result:=jsonb_build_object('version',1,'tenant_id',t,'actor_id',actor,'request_id',req,'charge_id',charge,'receivable_id',right_result->'receivable_id','expense_id',context->'expense_id','payable_id',context->'payable_id','expense_cancellation_id',cost_result->'cancellation_id','origin_amendment_id',right_result->'amendment_id','confirmed',true,'cash_changed',false,'cost_removed_cents',context#>'{effects,cost_removed_cents}','obligation_cancelled_cents',context#>'{effects,obligation_cancelled_cents}','collection_cancelled_cents',context#>'{effects,collection_cancelled_cents}');
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into actor_name from auth.users where id=actor;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(t,'unloading',charge,'unloading_cancelled_coordinated',actor,actor_name,btrim(payload->>'reason'),context,result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,req,actor,'cancel_unloading_coordinated',payload,result);
 return result;
exception when lock_not_available then raise exception 'unloading_cancellation_busy' using errcode='40001';
end$$;
revoke all on function finance_private.cancel_unloading_coordinated(jsonb) from public,anon,authenticated,service_role;

create function finance_private.preview_unloading_cancellation(_tenant_id uuid,_charge_id uuid,_effective_on date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare value jsonb;begin
 perform finance_private.require_access(_tenant_id);value:=finance_private.coordinated_unloading_cancellation_context(_tenant_id,_charge_id,_effective_on);
 if value->>'tenant_id' is distinct from _tenant_id::text or value->>'actor_id' is distinct from auth.uid()::text or value->>'charge_id' is distinct from _charge_id::text then raise exception 'unloading_cancellation_identity_invalid' using errcode='55000';end if;
 return (value-'_evidence')||jsonb_build_object('can_execute',value->>'eligible'='true' and value->>'can_cancel'='true'
 and has_function_privilege('authenticated','public.cancel_finance_unloading(jsonb)','execute') and has_function_privilege('authenticated','finance_private.dispatch_unloading_cancellation(jsonb)','execute'));
end$$;
create function finance_private.dispatch_unloading_cancellation(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$begin perform finance_private.require_access((_payload->>'tenant_id')::uuid);return finance_private.cancel_unloading_coordinated(_payload);end$$;
create function public.preview_finance_unloading_cancellation(_tenant_id uuid,_charge_id uuid,_effective_on date) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.preview_unloading_cancellation(_tenant_id,_charge_id,_effective_on)$$;
create function public.cancel_finance_unloading(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.dispatch_unloading_cancellation(_payload)$$;
revoke all on function finance_private.preview_unloading_cancellation(uuid,uuid,date),finance_private.dispatch_unloading_cancellation(jsonb),public.preview_finance_unloading_cancellation(uuid,uuid,date),public.cancel_finance_unloading(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.preview_unloading_cancellation(uuid,uuid,date),finance_private.dispatch_unloading_cancellation(jsonb),public.preview_finance_unloading_cancellation(uuid,uuid,date),public.cancel_finance_unloading(jsonb) to authenticated;
do $audit$declare body text;begin
 select pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure) into body;
 if position('''unloading_origin_corrected'',' in body)=0 then raise exception 'unloading_coordinated_audit_predecessor_changed';end if;
 execute replace(body,'''unloading_origin_corrected'',','''unloading_cancelled_coordinated'',''unloading_origin_corrected'',');
end $audit$;
