-- Manual costs remain identified by their original command and payable, never a new expense item.
create table public.finance_manual_expense_cancellations(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,payable_id uuid not null references public.payables(id),original_request_id uuid not null,
 revision text not null,source_snapshot jsonb not null,actor_id uuid not null,actor_name text not null,reason text not null check(length(btrim(reason)) between 10 and 2000),request_id uuid not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,payable_id),unique(tenant_id,original_request_id),unique(tenant_id,request_id),foreign key(tenant_id,original_request_id) references public.finance_commands(tenant_id,request_id)
);
alter table public.finance_manual_expense_cancellations enable row level security;
revoke all on public.finance_manual_expense_cancellations from public,anon,authenticated,service_role;
grant select on public.finance_manual_expense_cancellations to authenticated;
create policy finance_manual_cancel_read on public.finance_manual_expense_cancellations for select to authenticated using(finance_private.can_access(tenant_id));
create trigger finance_manual_cancel_immutable before update or delete on public.finance_manual_expense_cancellations for each row execute function finance_private.preserve_event();
create function finance_private.manual_expense_is_cancelled(_tenant uuid,_payable uuid) returns boolean language sql stable set search_path='' as $$select exists(select 1 from public.finance_manual_expense_cancellations where tenant_id=_tenant and payable_id=_payable)$$;
create function finance_private.manual_expense_cancellation_context(_tenant uuid,_payable uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.payables%rowtype;cmd public.finance_commands%rowtype;cancel public.finance_manual_expense_cancellations%rowtype;snapshot jsonb;issue text;cents numeric;begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into p from public.payables where tenant_id=_tenant and id=_payable;
 select * into cmd from public.finance_commands where tenant_id=_tenant and action='record_manual_expense' and result->>'payable_id'=_payable::text order by request_id limit 1;
 select * into cancel from public.finance_manual_expense_cancellations where tenant_id=_tenant and payable_id=_payable;
 snapshot:=jsonb_build_object('payable',to_jsonb(p),'command',to_jsonb(cmd),'supplier',(select to_jsonb(s) from public.clients s where s.tenant_id=_tenant and s.id=p.supplier_id),
 'commands',(select coalesce(jsonb_agg(to_jsonb(c) order by c.request_id),'[]') from public.finance_commands c where c.tenant_id=_tenant and c.action='record_manual_expense' and c.result->>'payable_id'=_payable::text),
 'payments',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.payables_payments x where x.tenant_id=_tenant and x.payable_id=_payable),
 'links',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.finance_payable_movement_links x where x.tenant_id=_tenant and x.payable_id=_payable),
 'evidence',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.finance_manual_expense_evidence x where x.tenant_id=_tenant and x.payable_id=_payable),
 'expense_items',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.finance_expense_items x where x.tenant_id=_tenant and x.payable_id=_payable),
 'advances',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.employee_advances x where x.tenant_id=_tenant and x.payable_id=_payable),
 'payroll_items',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.payroll_entry_items x where x.tenant_id=_tenant and x.source_table in('payables','manual_expense','finance_commands') and x.source_id in(_payable,cmd.request_id)),
 'settlement_items',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.driver_settlement_items x where x.tenant_id=_tenant and x.source_table in('payables','manual_expense','finance_commands') and x.source_id in(_payable,cmd.request_id)),
 'obligations',(select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') from public.financial_obligations x where x.tenant_id=_tenant and x.source_table in('payables','manual_expense','finance_commands') and x.source_id in(_payable,cmd.request_id)),
 'closure_dependencies',(select coalesce(jsonb_agg(to_jsonb(x) order by x.closure_id,x.source_kind,x.source_id),'[]') from public.finance_account_period_dependencies x where x.tenant_id=_tenant and (x.source_kind='payables' and x.source_id=_payable or x.source_kind in('manual_expense','finance_commands') and x.source_id=cmd.request_id)),
 'cancellation',case when cancel.id is not null then to_jsonb(cancel)-'source_snapshot' end);
 if coalesce(cmd.payload->>'amount_cents','') ~ '^[0-9]{1,14}$' then cents:=(cmd.payload->>'amount_cents')::numeric;end if;
 if p.id is null or cmd.request_id is null then issue:='finance_manual_expense_not_found';
 elsif cancel.id is not null then issue:='finance_manual_expense_already_cancelled';
 elsif jsonb_array_length(snapshot->'commands')<>1 or cents is null or cents<=0 or cents>99999999999999
  or cmd.payload->>'request_id' is distinct from cmd.request_id::text or cmd.result->>'request_id' is distinct from cmd.request_id::text or cmd.payload->'version' is distinct from '1'::jsonb or cmd.result->'confirmed' is distinct from 'true'::jsonb or cmd.payload->>'tenant_id' is distinct from _tenant::text or cmd.result->>'tenant_id' is distinct from _tenant::text
  or p.amount*100 is distinct from cents or p.status not in('pending','approved') or p.paid_amount is distinct from 0::numeric or p.paid_at is not null
  or p.source is distinct from 'manual' or p.source_table is not null or p.source_id is not null or p.driver_id is not null or p.dispatch_trip_id is not null or p.load_id is not null or p.vehicle_id is not null
  or p.supplier_id::text is distinct from nullif(cmd.payload->>'supplier_id','') or p.supplier_name is distinct from btrim(cmd.payload->>'supplier_name')
  or (p.competence_date is not null and not isfinite(p.competence_date)) or (p.due_date is not null and not isfinite(p.due_date)) or p.category is distinct from cmd.payload->>'category' or p.competence_date::text is distinct from nullif(cmd.payload->>'competence_date','') or p.due_date::text is distinct from nullif(cmd.payload->>'due_date','') then issue:='finance_manual_expense_source_inconsistent';
 elsif p.category='unloading' then issue:='finance_manual_expense_unloading_requires_resolution';
 elsif jsonb_array_length(snapshot->'payments')+jsonb_array_length(snapshot->'links')>0 or nullif(cmd.payload->>'movement_id','') is not null or nullif(cmd.result->>'movement_id','') is not null or cmd.result->'allocation' is distinct from 'null'::jsonb then issue:='finance_manual_expense_money_dependency';
 elsif jsonb_array_length(snapshot->'expense_items')+jsonb_array_length(snapshot->'advances')+jsonb_array_length(snapshot->'payroll_items')+jsonb_array_length(snapshot->'settlement_items')+jsonb_array_length(snapshot->'obligations')>0 then issue:='finance_manual_expense_materialization_dependency';
 end if;
 if issue is null then begin perform finance_private.assert_closed_source_mutable(_tenant,'payables',to_jsonb(p));exception when sqlstate '55000' then issue:='finance_manual_expense_closed_period_dependency';end;end if;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'payable_id',_payable,'original_request_id',cmd.request_id,'revision',md5(snapshot::text),'eligible',issue is null,'issue',issue,'snapshot',snapshot,'cancellation',case when cancel.id is not null then to_jsonb(cancel)-'source_snapshot' end,'effects',jsonb_build_object('cost_removed_cents',cents::text,'obligation_cancelled_cents',cents::text,'cash_changed',false));
end$$;
create function finance_private.cancel_manual_expense(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;payable uuid;actor uuid:=auth.uid();actor_name text;context jsonb;prior public.finance_commands%rowtype;p public.payables%rowtype;cancel uuid;result jsonb;begin
 if jsonb_typeof(_payload) is distinct from 'object' or _payload->'version' is distinct from '1'::jsonb or jsonb_typeof(_payload->'reason') is distinct from 'string' or length(btrim(_payload->>'reason')) not between 10 and 2000 or coalesce(_payload->>'revision','') !~ '^[0-9a-f]{32}$' or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','payable_id','revision','reason')) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;payable:=(_payload->>'payable_id')::uuid;if t is null or request is null or payable is null then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;if found then if prior.actor_id<>actor or prior.action<>'cancel_manual_expense' or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return prior.result;end if;
 perform 1 from public.payroll_periods where tenant_id=t order by id for update;perform 1 from public.payroll_entries where tenant_id=t order by payroll_period_id,id for update;
 select * into p from public.payables where tenant_id=t and id=payable;perform 1 from public.clients where tenant_id=t and id=p.supplier_id for update;select * into p from public.payables where tenant_id=t and id=payable for update;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 context:=finance_private.manual_expense_cancellation_context(t,payable);if context->>'revision' is distinct from _payload->>'revision' then raise exception 'finance_manual_expense_cancellation_changed' using errcode='40001';end if;
 if context->'eligible' is distinct from 'true'::jsonb then raise exception '%',context->>'issue' using errcode='23514';end if;
 perform finance_private.assert_closed_source_mutable(t,'payables',to_jsonb(p));perform finance_private.assert_closed_source_mutable(t,'payables',to_jsonb(p)||jsonb_build_object('status','cancelled'));
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into actor_name from auth.users where id=actor;actor_name:=coalesce(actor_name,actor::text);
 insert into public.finance_manual_expense_cancellations(tenant_id,payable_id,original_request_id,revision,source_snapshot,actor_id,actor_name,reason,request_id) values(t,payable,(context->>'original_request_id')::uuid,context->>'revision',context->'snapshot',actor,actor_name,btrim(_payload->>'reason'),request) returning id into cancel;
 update public.payables set status='cancelled',updated_at=clock_timestamp() where tenant_id=t and id=payable;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'payable_id',payable,'original_request_id',context->>'original_request_id','cancellation_id',cancel,'amount_cents',context#>>'{effects,cost_removed_cents}','confirmed',true,'cash_changed',false);
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(t,'payable',payable,'manual_expense_cancelled',actor,actor_name,btrim(_payload->>'reason'),context->'snapshot',result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'cancel_manual_expense',_payload,result);return result;
end$$;
create function public.cancel_finance_manual_expense(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.cancel_manual_expense(_payload)$$;
revoke all on function finance_private.manual_expense_is_cancelled(uuid,uuid),finance_private.manual_expense_cancellation_context(uuid,uuid),finance_private.cancel_manual_expense(jsonb),public.cancel_finance_manual_expense(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.cancel_manual_expense(jsonb),public.cancel_finance_manual_expense(jsonb) to authenticated;
create function finance_private.guard_cancelled_manual_expense_dependency() returns trigger language plpgsql security definer set search_path='' as $$
declare data jsonb;t uuid;payable uuid;source uuid;begin
 if tg_op='DELETE' then data:=to_jsonb(old);else data:=to_jsonb(new);end if;t:=(data->>'tenant_id')::uuid;
 if not pg_try_advisory_xact_lock(hashtextextended(t::text||':finance',0)) then raise exception 'finance_dependency_busy' using errcode='40001';end if;
 if tg_table_name='payables' then
  if tg_op in('UPDATE','DELETE') and finance_private.manual_expense_is_cancelled(old.tenant_id,old.id) then
   if tg_op='DELETE' then raise exception 'finance_manual_expense_already_cancelled' using errcode='55000';end if;
   if new.status is distinct from 'cancelled' or (to_jsonb(new)-'status'-'updated_at') is distinct from (to_jsonb(old)-'status'-'updated_at') then raise exception 'finance_manual_expense_already_cancelled' using errcode='55000';end if;return new;
  end if;
  payable:=(data->>'id')::uuid;
 elsif tg_table_name in('payables_payments','finance_payable_movement_links','employee_advances','finance_expense_items') then payable:=(data->>'payable_id')::uuid;
 elsif data->>'source_table' in('payables','manual_expense','finance_commands') then
  source:=(data->>'source_id')::uuid;select c.payable_id into payable from public.finance_manual_expense_cancellations c where c.tenant_id=t and source in(c.payable_id,c.original_request_id) limit 1;
 end if;
 if payable is not null and finance_private.manual_expense_is_cancelled(t,payable) then raise exception 'finance_manual_expense_already_cancelled' using errcode='55000';end if;
 if tg_op='DELETE' then return old;end if;return new;
end$$;
revoke all on function finance_private.guard_cancelled_manual_expense_dependency() from public,anon,authenticated,service_role;
create trigger finance_cancelled_manual_payable before update or delete on public.payables for each row execute function finance_private.guard_cancelled_manual_expense_dependency();
do $$declare name text;begin foreach name in array array['payables_payments','finance_payable_movement_links','employee_advances','finance_expense_items','payroll_entry_items','driver_settlement_items','financial_obligations'] loop
 execute format('create trigger finance_cancelled_manual_dependency before insert or update on public.%I for each row execute function finance_private.guard_cancelled_manual_expense_dependency()',name);
end loop;end$$;
-- The immutable cancellation event is authoritative; an unaudited status change is a diagnostic.
do $$declare signature text;definition text;patched text;begin
 definition:=pg_get_functiondef('finance_private.recorded_costs(uuid,jsonb)'::regprocedure);
 patched:=replace(definition,'p.status=''cancelled'',p.amount*100<>(cmd.payload->>''amount_cents'')::numeric','finance_private.manual_expense_is_cancelled(cmd.tenant_id,p.id),(p.status=''cancelled'') is distinct from finance_private.manual_expense_is_cancelled(cmd.tenant_id,p.id) or p.amount*100<>(cmd.payload->>''amount_cents'')::numeric');
 if patched=definition then raise exception 'manual_cancel_recorded_costs_patch_missing';end if;execute patched;
 definition:=pg_get_functiondef('finance_private.recorded_cost_summary(uuid,date,date,text,text)'::regprocedure);
 patched:=replace(definition,'coalesce(p.status=''cancelled'',false),p.id is null or p.amount*100 is distinct from(cmd.payload->>''amount_cents'')::numeric','finance_private.manual_expense_is_cancelled(cmd.tenant_id,p.id),coalesce(p.status=''cancelled'',false) is distinct from finance_private.manual_expense_is_cancelled(cmd.tenant_id,p.id) or p.id is null or p.amount*100 is distinct from(cmd.payload->>''amount_cents'')::numeric');
 if patched=definition then raise exception 'manual_cancel_summary_patch_missing';end if;execute patched;
end$$;

-- Legacy row writers must not wait on finance while already holding a row lock.
do $$declare definition text;patched text;begin
 definition:=pg_get_functiondef('finance_private.guard_cancelled_expense_dependency()'::regprocedure);
 patched:=replace(definition,'perform pg_advisory_xact_lock(hashtextextended(t::text||'':finance'',0));','if not pg_try_advisory_xact_lock(hashtextextended(t::text||'':finance'',0)) then raise exception ''finance_dependency_busy'' using errcode=''40001'';end if;');
 if patched=definition then raise exception 'manual_cancel_dependency_lock_patch_missing';end if;execute patched;
end$$;
