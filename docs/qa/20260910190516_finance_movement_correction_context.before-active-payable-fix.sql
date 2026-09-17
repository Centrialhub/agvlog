create function finance_private.json_references_movement(_value jsonb,_movement uuid) returns boolean language sql immutable security invoker set search_path='' as $$select exists(select 1 from jsonb_path_query(_value,'$.** ? (@.type() == "string")') x where finance_private.movement_origin_uuid(x#>>'{}')=_movement)$$;
revoke all on function finance_private.json_references_movement(jsonb,uuid) from public,anon,authenticated,service_role;
-- Readiness and graph only: no correction writer or application grant.
create function finance_private.movement_correction_graph(_tenant uuid,_movement uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare graph jsonb;missing text[]:='{}';e record;ids uuid[];rows jsonb;merged jsonb;before_graph jsonb;iteration integer;source record;begin
 select jsonb_build_object('finance_movements',jsonb_build_array(to_jsonb(m))) into graph from public.finance_movements m where tenant_id=_tenant and id=_movement;
 select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') into rows from public.receivable_financial_commands c where c.tenant_id=_tenant and finance_private.json_references_movement(to_jsonb(c),_movement);
 graph:=graph||jsonb_build_object('receivable_financial_commands',rows);
 for iteration in 1..32 loop
 before_graph:=graph;
 for e in select * from(values
('finance_expense_allocations','movement_id','finance_movements','id',false),
('finance_payable_movement_links','movement_id','finance_movements','id',false),
('finance_settlement_movement_links','movement_id','finance_movements','id',false),
('finance_receivable_movement_links','movement_id','finance_movements','id',false),
('finance_legacy_receipt_movement_links','movement_id','finance_movements','id',false),
('finance_reconciliation_groups','movement_ids','finance_movements','id',true),
('finance_internal_transfers','outgoing_id','finance_movements','id',false),
('finance_internal_transfers','incoming_id','finance_movements','id',false),
('finance_transfer_departures','outgoing_id','finance_movements','id',false),
('finance_movement_voids','movement_id','finance_movements','id',false),
('finance_movement_voids','duplicate_of_movement_id','finance_movements','id',false),
('finance_movement_voids','replacement_movement_id','finance_movements','id',false),
('finance_payable_movement_links','payment_id','payables_payments','id',false),
('payables_payments','id','finance_payable_movement_links','payment_id',false),
('finance_settlement_movement_links','payment_id','driver_settlement_payments','id',false),
('driver_settlement_payments','id','finance_settlement_movement_links','payment_id',false),
('finance_receivable_movement_links','payment_id','receivables_payments','id',false),
('receivables_payments','id','finance_receivable_movement_links','payment_id',false),
('finance_legacy_receipt_movement_links','payment_id','receivables_payments','id',false),
('receivables_payments','id','finance_legacy_receipt_movement_links','payment_id',false),
('finance_payable_link_reversals','link_id','finance_payable_movement_links','id',false),
('finance_settlement_link_reversals','link_id','finance_settlement_movement_links','id',false),
('finance_legacy_receipt_link_reversals','link_id','finance_legacy_receipt_movement_links','id',false),
('finance_expense_allocations','expense_id','finance_expense_items','id',false),
('finance_expense_items','id','finance_expense_allocations','expense_id',false),
('finance_expense_items','batch_id','finance_expense_batches','id',false),
('finance_expense_batches','id','finance_expense_items','batch_id',false),
('finance_expense_items','payable_id','payables','id',false),
('payables','id','finance_expense_items','payable_id',false),
('payables_payments','payable_id','payables','id',false),
('payables','id','payables_payments','payable_id',false),
('driver_settlement_payments','settlement_id','driver_settlements','id',false),
('driver_settlements','id','driver_settlement_payments','settlement_id',false),
('receivables_payments','receivable_id','receivables','id',false),
('receivables','id','receivables_payments','receivable_id',false),
('finance_receivable_movement_links','command_id','receivable_financial_commands','id',false),
('receivable_financial_commands','id','finance_receivable_movement_links','command_id',false),
('payables_payments','bank_transaction_id','bank_transactions','id',false),
('bank_transactions','id','payables_payments','bank_transaction_id',false),
('receivables_payments','bank_transaction_id','bank_transactions','id',false),
('bank_transactions','id','receivables_payments','bank_transaction_id',false),
('finance_receivable_movement_links','bank_transaction_id','bank_transactions','id',false),
('bank_transactions','id','finance_receivable_movement_links','bank_transaction_id',false),
('receivable_payment_reversals','bank_transaction_id','bank_transactions','id',false),
('bank_transactions','id','receivable_payment_reversals','bank_transaction_id',false),
('receivable_payment_reversals','payment_id','receivables_payments','id',false),
('finance_receipt_allocation_corrections','payment_id','receivables_payments','id',false),
('load_payments','receivable_payment_id','receivables_payments','id',false),
('closing_report_payments','canonical_receivable_payment_id','receivables_payments','id',false),
('employee_advances','payable_id','payables','id',false),
('finance_fiscal_receivable_origins','receivable_id','receivables','id',false),
('finance_reconciliation_reversals','group_id','finance_reconciliation_groups','id',false),
('receivables','id','receivable_financial_commands','receivable_id',false),
('driver_settlement_items','settlement_id','driver_settlements','id',false),
('payroll_entries','id','payroll_entry_items','payroll_entry_id',false),
('payroll_periods','id','payroll_entries','payroll_period_id',false),
('finance_unloading_charges','id','finance_expense_items','unloading_id',false),
('finance_unloading_charges','receivable_id','receivables','id',false),
('receivables','id','finance_unloading_charges','receivable_id',false),
('finance_fiscal_observations','id','finance_fiscal_receivable_origins','observation_id',false),
('finance_fiscal_projection_events','origin_id','finance_fiscal_receivable_origins','id',false)
 ) edges(table_name,field,parent,parent_field,is_array) loop
 if to_regclass('public.'||e.table_name) is null then missing:=array_append(missing,'table:'||e.table_name);continue;end if;
 select array_agg(distinct (value->>e.parent_field)::uuid) into ids from jsonb_array_elements(coalesce(graph->e.parent,'[]')) where value->>e.parent_field is not null;
 if ids is null then continue;end if;
 execute format('select coalesce(jsonb_agg(to_jsonb(s)),''[]'') from public.%I s where s.tenant_id=$1 and %s',e.table_name,case when e.is_array then format('s.%I && $2',e.field) else format('s.%I=any($2)',e.field) end) into rows using _tenant,ids;
 select coalesce(jsonb_agg(x order by x::text),'[]') into merged from(select distinct value x from jsonb_array_elements(coalesce(graph->e.table_name,'[]')||rows)) q;
 graph:=jsonb_set(graph,array[e.table_name],merged,true);
 end loop;
 -- Polymorphic origins are paired by both source table and ID.
 for source in select key,value from jsonb_each(graph) loop
 select array_agg((value->>'id')::uuid) into ids from jsonb_array_elements(source.value) where value->>'id' is not null;
 if ids is null then continue;end if;
 for e in select unnest(array['payroll_entry_items','driver_settlement_items','payables','financial_obligations']) table_name loop
 if to_regclass('public.'||e.table_name) is null then missing:=array_append(missing,'table:'||e.table_name);continue;end if;
 execute format('select coalesce(jsonb_agg(to_jsonb(s)),''[]'') from public.%I s where s.tenant_id=$1 and s.source_table=$2 and s.source_id=any($3)',e.table_name) into rows using _tenant,source.key,ids;
 select coalesce(jsonb_agg(x order by x::text),'[]') into merged from(select distinct value x from jsonb_array_elements(coalesce(graph->e.table_name,'[]')||rows)) q;graph:=jsonb_set(graph,array[e.table_name],merged,true);
 end loop;
 end loop;
 exit when graph=before_graph;
 end loop;
 if graph<>before_graph then missing:=array_append(missing,'graph:depth_limit');end if;
 select coalesce(array_agg(distinct x order by x),'{}') into missing from unnest(missing) x;
 return jsonb_build_object('rows',graph,'missing',to_jsonb(missing));
end$$;
revoke all on function finance_private.movement_correction_graph(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.movement_correction_readiness() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare missing text[]:='{}';required record;found boolean;facts jsonb:='[]';p record;begin
 for required in select * from(values
 ('finance_expense_allocations','a_finance_active_movement_reference','finance_private.guard_active_financial_movement_reference()',23,false),
 ('finance_payable_movement_links','a_finance_active_movement_reference','finance_private.guard_active_financial_movement_reference()',23,false),
 ('finance_settlement_movement_links','a_finance_active_movement_reference','finance_private.guard_active_financial_movement_reference()',23,false),
 ('finance_receivable_movement_links','a_finance_active_movement_reference','finance_private.guard_active_financial_movement_reference()',23,false),
 ('finance_legacy_receipt_movement_links','a_finance_active_movement_reference','finance_private.guard_active_financial_movement_reference()',23,false),
 ('payables_payments','a_finance_active_payment_reference','finance_private.guard_payment_active_movement_references()',23,false),
 ('driver_settlement_payments','a_finance_active_payment_reference','finance_private.guard_payment_active_movement_references()',23,false),
 ('receivables_payments','a_finance_active_payment_reference','finance_private.guard_payment_active_movement_references()',23,false),
 ('payables_payments','finance_active_payment_reference_final','finance_private.guard_payment_active_movement_references()',21,true),
 ('driver_settlement_payments','finance_active_payment_reference_final','finance_private.guard_payment_active_movement_references()',21,true),
 ('receivables_payments','finance_active_payment_reference_final','finance_private.guard_payment_active_movement_references()',21,true),
 ('finance_reconciliation_groups','finance_reconciliation_active_movements','finance_private.guard_reconciliation_active_movements()',7,false)
 ) r(table_name,trigger_name,fn,trigger_type,deferred) loop
 select exists(select 1 from pg_catalog.pg_trigger t where t.tgrelid=to_regclass('public.'||required.table_name) and t.tgname=required.trigger_name and t.tgfoid=to_regprocedure(required.fn) and t.tgenabled in('O','A') and t.tgnargs=0 and t.tgqual is null and t.tgtype=required.trigger_type and t.tgdeferrable=required.deferred and t.tginitdeferred=required.deferred) into found;
 if not found then missing:=array_append(missing,'trigger:'||required.table_name||'.'||required.trigger_name);end if;
 end loop;
 for required in select * from(values
 ('finance_private.expense_options(uuid,text,text,uuid,integer)','finance_private.active_movements'),
('finance_private.manual_expense_movements(uuid,text,integer)','finance_private.active_movements'),
('finance_private.payable_movement_options(uuid,uuid,text,integer)','finance_private.active_movements'),
('finance_private.receipt_movement_options(uuid,uuid,date,text,integer)','finance_private.active_movements'),
('finance_private.legacy_payable_association(uuid,uuid,integer)','finance_private.active_movements'),
('finance_private.legacy_receivable_association(uuid,uuid,integer)','finance_private.active_movements'),
('finance_private.get_settlement_payment_movements(uuid,uuid,integer)','finance_private.active_movements'),
('finance_private.new_settlement_payment_candidates(uuid,uuid,bigint,integer)','finance_private.active_movements'),
('finance_private.reconciliation_options(uuid,uuid,text,text,integer)','finance_private.active_movements'),
('finance_private.reconciliation_snapshot_internal(uuid,uuid[],uuid[])','finance_private.active_movements'),
('finance_private.reconciliation_evidence_issue(uuid,uuid)','finance_private.active_movements'),
('finance_private.available_movement_cents(uuid,uuid,text)','movement_is_active'),
('finance_private.check_movement_use()','movement_used_cents'),
('finance_private.check_payable_payment_insert()','payables_payments'),
('finance_private.check_settlement_movement_link()','movement_used_cents'),
('finance_private.check_receipt_movement_capacity()','receipt_movement_used_cents'),
 ('finance_private.movement_is_active(uuid,uuid)','finance_movement_voids'),
 ('finance_private.record_movement(jsonb)','finance_private.active_movements'),
 ('finance_private.account_opening(uuid,uuid,date,date)','finance_private.active_movements'),
 ('finance_private.account_period_review(uuid,uuid,date,date)','finance_private.active_movements'),
 ('finance_private.account_period_close_snapshot(uuid,uuid,date,date)','movement_correction_facts'),
 ('finance_private.cash_period_close_snapshot(uuid,uuid,date,date,uuid)','movement_correction_facts'),
 ('finance_private.reconciliation_context(uuid,uuid[],uuid[])','finance_private.active_movements'),
 ('finance_private.process_automatic_reconciliation(uuid)','finance_private.active_movements'),
 ('finance_private.paid_projection_chain(uuid,text,uuid)','source_movement_void_evidence'),
 ('finance_private.payable_portfolio_evidence(uuid,uuid)','payment_movement_voided'),
 ('finance_private.legacy_cut_manifest(uuid,uuid,date,date)','finance_movement_voids'),
 ('finance_private.legacy_integrity_rows(uuid)','source_movement_voided'),
 ('finance_private.legacy_cut_settlement_evidence(uuid,uuid)','settlement_movement_voided')
 ) r(signature,token) loop
 select q.oid,q.prosecdef,q.proconfig,q.proacl,pg_get_functiondef(q.oid) definition into p from pg_catalog.pg_proc q where q.oid=to_regprocedure(required.signature);
 if p.oid is null or position(required.token in p.definition)=0 then missing:=array_append(missing,'definition:'||required.signature);end if;
 facts:=facts||jsonb_build_array(jsonb_build_object('signature',required.signature,'definition_hash',md5(p.definition),'security_definer',p.prosecdef,'config',to_jsonb(p.proconfig),'acl',to_jsonb(p.proacl)));
 end loop;
 if not coalesce(finance_private.account_period_guards_ready(),false) then missing:=array_append(missing,'period_guards');end if;
 return jsonb_build_object('ready',cardinality(missing)=0,'missing',to_jsonb(missing),'definitions',facts);
end$$;
revoke all on function finance_private.movement_correction_readiness() from public,anon,authenticated,service_role;

create function finance_private.movement_correction_context(_tenant uuid,_movement uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m public.finance_movements%rowtype;origin jsonb;graph jsonb;dep jsonb;readiness jsonb;blockers jsonb:='[]';void jsonb;effects jsonb;revision text;rows jsonb;ids uuid[];source record;closed_issue text;begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into m from public.finance_movements where tenant_id=_tenant and id=_movement;
 if not found then raise exception 'finance_movement_not_found' using errcode='22023';end if;
 select jsonb_build_array(to_jsonb(a)) into rows from public.bank_accounts a where tenant_id=_tenant and id=m.bank_account_id;
 if rows is null then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','movement_account_unresolved','source_table','bank_accounts','source_ids',jsonb_build_array(m.bank_account_id)));end if;
 origin:=finance_private.movement_recording_origin(_tenant,_movement);graph:=finance_private.movement_correction_graph(_tenant,_movement);dep:=(graph->'rows')||jsonb_build_object('bank_accounts',coalesce(rows,'[]'));readiness:=finance_private.movement_correction_readiness();
 readiness:=jsonb_set(readiness,'{missing}',(readiness->'missing')||(graph->'missing'));readiness:=jsonb_set(readiness,'{ready}',to_jsonb(jsonb_array_length(readiness->'missing')=0));
 select to_jsonb(v) into void from public.finance_movement_voids v where tenant_id=_tenant and movement_id=_movement;
 if not coalesce((origin->>'verified')::boolean,false) then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','manual_origin_unverified','source_table','finance_commands','source_ids','[]'::jsonb));end if;
 if void is not null then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','movement_already_voided','source_table','finance_movement_voids','source_ids',jsonb_build_array(void->>'id')));end if;
 if m.nature='transfer' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','transfer_requires_specific_correction','source_table','finance_movements','source_ids',jsonb_build_array(m.id)));end if;
 for source in select * from(values
 ('receivable_financial_commands','receivable_command_history'),('payables','payable_obligation_history'),('financial_obligations','financial_obligation_history'),('finance_expense_allocations','expense_allocation_history'),('finance_payable_movement_links','payable_payment_history'),('finance_settlement_movement_links','settlement_payment_history'),('finance_receivable_movement_links','receivable_payment_history'),('finance_legacy_receipt_movement_links','legacy_receipt_history'),('finance_reconciliation_groups','reconciliation_history'),('finance_internal_transfers','transfer_history'),('finance_transfer_departures','transfer_history'),('employee_advances','advance_projection_history'),('payroll_entry_items','payroll_projection_history'),('driver_settlement_items','settlement_composition_history'),('finance_fiscal_receivable_origins','fiscal_origin_history'),('finance_unloading_charges','unloading_reimbursement_history')
 ) r(table_name,code) loop
 rows:=coalesce(dep->source.table_name,'[]');if jsonb_array_length(rows)>0 then
 select coalesce(jsonb_agg(coalesce(value->'id',value->'command_id') order by coalesce(value->>'id',value->>'command_id')),'[]') into rows from jsonb_array_elements(rows);
 blockers:=blockers||jsonb_build_array(jsonb_build_object('code',source.code,'source_table',source.table_name,'source_ids',rows));end if;
 end loop;
 select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]') into rows from public.finance_movement_voids v where tenant_id=_tenant and (duplicate_of_movement_id=_movement or replacement_movement_id=_movement);
 dep:=dep||jsonb_build_object('correction_backlinks',rows);
 if jsonb_array_length(rows)>0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','correction_target_dependency','source_table','finance_movement_voids','source_ids',(select jsonb_agg(value->'id') from jsonb_array_elements(rows))));end if;
 -- Commands/events are exact JSON UUID references, never textual substring matching.
 select coalesce(jsonb_agg(to_jsonb(c) order by c.request_id),'[]') into rows from public.finance_commands c where tenant_id=_tenant and (finance_private.json_references_movement(c.payload,_movement) or finance_private.json_references_movement(c.result,_movement));
 dep:=dep||jsonb_build_object('finance_commands',rows);
 if exists(select 1 from jsonb_array_elements(rows) x where x->>'request_id' is distinct from origin->>'original_request_id') then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','other_command_reference','source_table','finance_commands','source_ids',(select jsonb_agg(x->'request_id') from jsonb_array_elements(rows) x where x->>'request_id' is distinct from origin->>'original_request_id')));end if;
 select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') into rows from public.finance_events e where tenant_id=_tenant and (entity_id=_movement or finance_private.json_references_movement(to_jsonb(e),_movement));dep:=dep||jsonb_build_object('finance_events',rows);
 if exists(select 1 from jsonb_array_elements(rows) x where not exists(select 1 from jsonb_array_elements(coalesce(origin#>'{snapshot,recording_events}','[]')) o where o->>'id'=x->>'id')) then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','other_event_reference','source_table','finance_events','source_ids',(select jsonb_agg(x->'id') from jsonb_array_elements(rows) x where not exists(select 1 from jsonb_array_elements(coalesce(origin#>'{snapshot,recording_events}','[]')) o where o->>'id'=x->>'id'))));end if;

 -- Keep historical closures but block only live monetary dependencies/cuts.
 select coalesce(jsonb_agg(to_jsonb(d) order by d.closure_id,d.source_kind,d.source_id),'[]') into rows from public.finance_account_period_dependencies d where d.tenant_id=_tenant and exists(select 1 from jsonb_each(dep) g,jsonb_array_elements(g.value) x where g.key=d.source_kind and x->>'id'=d.source_id::text);dep:=dep||jsonb_build_object('finance_account_period_dependencies',rows);
 select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') into rows from public.finance_account_period_closures c where c.tenant_id=_tenant and ((c.account_id=m.bank_account_id and m.occurred_on between c.period_start and c.period_end) or exists(select 1 from jsonb_array_elements(dep->'finance_account_period_dependencies') d where d->>'closure_id'=c.id::text));dep:=dep||jsonb_build_object('finance_account_period_closures',rows);
 select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') into rows from public.finance_account_period_reopenings r where r.tenant_id=_tenant and exists(select 1 from jsonb_array_elements(dep->'finance_account_period_closures') c where c->>'id'=r.closure_id::text);dep:=dep||jsonb_build_object('finance_account_period_reopenings',rows);
 begin perform finance_private.assert_closed_source_mutable(_tenant,'finance_movements',to_jsonb(m));exception when sqlstate '55000' then get stacked diagnostics closed_issue=message_text;end;
 if closed_issue is not null then blockers:=blockers||jsonb_build_array(jsonb_build_object('code',closed_issue,'source_table','finance_account_period_closures','source_ids',(select coalesce(jsonb_agg(c->'id'),'[]') from jsonb_array_elements(dep->'finance_account_period_closures') c where not exists(select 1 from jsonb_array_elements(dep->'finance_account_period_reopenings') r where r->>'closure_id'=c->>'id'))));end if;
 if not (readiness->>'ready')::boolean then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','movement_correction_runtime_not_ready','source_table',null,'source_ids','[]'::jsonb));end if;
 if void is null then effects:=jsonb_build_object('computation','prospective_invalidation','bank_money_transacted',false,'recorded_balance_changed',true,'account_id',m.bank_account_id,'occurred_on',m.occurred_on,'inflow_delta_cents',case when m.direction='in' then (-m.amount_cents)::text else '0' end,'outflow_delta_cents',case when m.direction='out' then (-m.amount_cents)::text else '0' end,'balance_delta_cents',case when m.direction='in' then (-m.amount_cents)::text else m.amount_cents::text end);end if;
 revision:=md5(jsonb_build_object('movement',to_jsonb(m),'origin',origin,'dependencies',dep,'readiness',readiness,'blockers',blockers,'void',void)::text);
 return jsonb_build_object('version',1,'operation','void','tenant_id',_tenant,'movement_id',_movement,'revision',revision,'eligible',jsonb_array_length(blockers)=0,'origin',origin,'void',void,'dependencies',dep,'readiness',readiness,'blockers',blockers,'effects',effects);
end$$;
revoke all on function finance_private.movement_correction_context(uuid,uuid) from public,anon,authenticated,service_role;

-- This baseline detects post-installation drift. Initial implementation approval
-- remains the release's reviewed/tested effective catalog, not a self-attestation.
create function finance_private.movement_correction_runtime_state() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('functions',(select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'body',pg_get_functiondef(p.oid),'acl',to_jsonb(p.proacl),'config',to_jsonb(p.proconfig),'definer',p.prosecdef) order by p.oid::regprocedure::text),'[]') from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='finance_private' and p.proname in('expense_options','manual_expense_movements','payable_movement_options','receipt_movement_options','legacy_payable_association','legacy_receivable_association','get_settlement_payment_movements','new_settlement_payment_candidates','reconciliation_options','reconciliation_snapshot_internal','reconciliation_evidence_issue','available_movement_cents','check_movement_use','check_payable_payment_insert','check_settlement_movement_link','check_receipt_movement_capacity','movement_correction_graph','json_references_movement','movement_correction_context','movement_is_active','lock_active_movement_use','assert_active_movement_reference','guard_active_financial_movement_reference','guard_payment_active_movement_references','guard_reconciliation_active_movements','assert_closed_source_mutable','account_period_guards_ready','record_movement','account_opening','account_period_review','account_period_close_snapshot','cash_period_close_snapshot','reconciliation_context','process_automatic_reconciliation','paid_projection_chain','payable_portfolio_evidence','legacy_cut_manifest','legacy_integrity_rows','legacy_cut_settlement_evidence','movement_recording_origin','source_movement_void_evidence')),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) order by t.tgrelid::regclass::text,t.tgname),'[]') from pg_catalog.pg_trigger t where t.tgname in('a_finance_active_movement_reference','a_finance_active_payment_reference','finance_active_payment_reference_final','finance_reconciliation_active_movements')),
 'active_view',pg_get_viewdef('finance_private.active_movements'::regclass,true),'view_options',(select to_jsonb(reloptions) from pg_catalog.pg_class where oid='finance_private.active_movements'::regclass),'view_acl',(select to_jsonb(relacl) from pg_catalog.pg_class where oid='finance_private.active_movements'::regclass))
$$;
revoke all on function finance_private.movement_correction_runtime_state() from public,anon,authenticated,service_role;
create table finance_private.movement_correction_runtime_baseline(singleton boolean primary key default true check(singleton),snapshot jsonb not null);
revoke all on finance_private.movement_correction_runtime_baseline from public,anon,authenticated,service_role;
do $$begin
 if not (finance_private.movement_correction_readiness()->>'ready')::boolean then raise exception 'finance_movement_correction_installation_incomplete';end if;
 insert into finance_private.movement_correction_runtime_baseline(snapshot) values(finance_private.movement_correction_runtime_state());
end$$;
create trigger preserve_movement_correction_runtime_baseline before update or delete on finance_private.movement_correction_runtime_baseline for each row execute function finance_private.preserve_event();
do $$declare body text;needle text;begin
 body:=pg_get_functiondef('finance_private.movement_correction_readiness()'::regprocedure);needle:=' return jsonb_build_object(''ready'',cardinality(missing)=0';
 if position(needle in body)=0 then raise exception 'finance_movement_readiness_contract_changed';end if;
 body:=replace(body,needle,$patch$ if not exists(select 1 from finance_private.movement_correction_runtime_baseline where snapshot=finance_private.movement_correction_runtime_state()) then missing:=array_append(missing,'runtime_baseline_drift');end if;
 return jsonb_build_object('baseline_basis','migration_checked_not_release_attested','ready',cardinality(missing)=0$patch$);execute body;
end$$;
