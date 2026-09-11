-- Private core. Public promotion follows integration of every effective-cost consumer.
create table finance_private.expense_cost_amendments(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,expense_id uuid not null,charge_id uuid not null,payable_id uuid not null,
 ordinal integer not null check(ordinal>0),previous_id uuid,request_id uuid not null,revision_before text not null,
 before_cents bigint not null check(before_cents>0),after_cents bigint not null check(after_cents between 1 and 99999999999999),
 before_payable jsonb not null,after_payable jsonb not null,actor_id uuid not null,actor_name text,reason text not null check(length(btrim(reason)) between 10 and 2000),created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,expense_id,ordinal),unique(tenant_id,request_id),unique(tenant_id,expense_id,id),
 foreign key(tenant_id,expense_id) references public.finance_expense_items(tenant_id,id),foreign key(tenant_id,expense_id,previous_id) references finance_private.expense_cost_amendments(tenant_id,expense_id,id),check((ordinal=1)=(previous_id is null)),check(before_cents<>after_cents)
);
alter table finance_private.expense_cost_amendments enable row level security;
revoke all on finance_private.expense_cost_amendments from public,anon,authenticated,service_role;
create trigger preserve_expense_cost_amendments before update or delete on finance_private.expense_cost_amendments for each row execute function finance_private.preserve_event();
create function finance_private.expense_cost_effective(_tenant uuid,_expense uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e public.finance_expense_items%rowtype;x finance_private.expense_cost_amendments%rowtype;amount bigint;rev text;previous uuid;ordinal integer:=0;valid boolean:=true;history jsonb:='[]';item jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into e from public.finance_expense_items where tenant_id=_tenant and id=_expense;
 if not found then raise exception 'finance_expense_not_found' using errcode='22023';end if;
 amount:=e.amount_cents;rev:=md5(to_jsonb(e)::text);
 for x in select * from finance_private.expense_cost_amendments where tenant_id=_tenant and expense_id=_expense order by ordinal loop
  if ordinal=0 and (select count(*) from public.finance_commands c cross join lateral jsonb_array_elements(case when jsonb_typeof(c.payload->'items')='array' then c.payload->'items' else '[]'::jsonb end) i where c.tenant_id=_tenant and c.action='record_expense_batch' and c.result->>'batch_id'=e.batch_id::text and i->>'id'=e.id::text and i->>'amount_cents'=e.amount_cents::text)<>1 then valid:=false;end if;
  if x.ordinal<>ordinal+1 or x.previous_id is distinct from previous or x.revision_before<>rev or x.before_cents<>amount or x.charge_id is distinct from e.unloading_id or x.payable_id is distinct from e.payable_id
   or (x.before_payable-array['amount','status','updated_at']) is distinct from (x.after_payable-array['amount','status','updated_at']) or coalesce(x.before_payable->>'status','') not in('pending','approved')
   or x.after_payable->>'id' is distinct from e.payable_id::text or x.after_payable->>'tenant_id' is distinct from _tenant::text or x.after_payable->>'source_table' is distinct from 'finance_expense_items' or x.after_payable->>'source_id' is distinct from e.id::text
   or finance_private.unloading_repair_cents(x.before_payable->'amount') is distinct from x.before_cents::text or finance_private.unloading_repair_cents(x.after_payable->'amount') is distinct from x.after_cents::text or x.after_payable->>'status' is distinct from 'pending'
   or not exists(select 1 from public.finance_commands c where c.tenant_id=_tenant and c.request_id=x.request_id and c.actor_id=x.actor_id and c.action='correct_unloading_cost' and c.result->>'amendment_id'=x.id::text and c.payload->>'expense_id'=e.id::text and c.payload->>'amount_cents'=x.after_cents::text and c.payload->>'charge_id'=x.charge_id::text and c.payload->>'payable_id'=x.payable_id::text and c.result->>'request_id'=x.request_id::text and c.result->>'cost_before_cents'=x.before_cents::text and c.result->>'cost_after_cents'=x.after_cents::text and c.result->>'obligation_after_cents'=x.after_cents::text)
   or not exists(select 1 from public.finance_events a where a.tenant_id=_tenant and a.entity_id=e.id and a.action='unloading_cost_corrected' and a.actor_id=x.actor_id and a.after_data->>'amendment_id'=x.id::text and a.after_data->>'cost_after_cents'=x.after_cents::text)
  then valid:=false;end if;
  rev:=md5(jsonb_build_object('previous',rev,'event',to_jsonb(x))::text);amount:=x.after_cents;ordinal:=x.ordinal;previous:=x.id;
  item:=jsonb_build_object('id',x.id,'ordinal',x.ordinal,'previous_id',x.previous_id,'request_id',x.request_id,'before_amount_cents',x.before_cents::text,'after_amount_cents',x.after_cents::text,'approval_reset',x.before_payable->>'status'='approved','actor_id',x.actor_id,'actor_name',x.actor_name,'reason',x.reason,'created_at',x.created_at,'revision_after',rev);history:=history||jsonb_build_array(item);
 end loop;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'expense_id',e.id,'charge_id',e.unloading_id,'payable_id',e.payable_id,'verified',valid,'issue',case when valid then null else 'finance_expense_cost_chain_invalid' end,'original_amount_cents',e.amount_cents::text,'effective_amount_cents',case when valid then amount::text end,'revision',rev,'history',history);
end$$;
revoke all on function finance_private.expense_cost_effective(uuid,uuid) from public,anon,authenticated,service_role;
create function finance_private.check_expense_cost_chain() returns trigger language plpgsql security definer set search_path='' as $$begin if finance_private.expense_cost_effective(new.tenant_id,new.expense_id)->>'verified' is distinct from 'true' then raise exception 'finance_expense_cost_chain_invalid' using errcode='23514';end if;return null;end$$;
revoke all on function finance_private.check_expense_cost_chain() from public,anon,authenticated,service_role;
create constraint trigger expense_cost_chain_valid after insert on finance_private.expense_cost_amendments deferrable initially deferred for each row execute function finance_private.check_expense_cost_chain();
create table finance_private.expense_cost_tickets(transaction_id bigint not null,tenant_id uuid not null,payable_id uuid not null,actor_id uuid not null,request_id uuid not null,before_data jsonb not null,after_data jsonb not null,primary key(transaction_id,tenant_id,payable_id));
alter table finance_private.expense_cost_tickets enable row level security;revoke all on finance_private.expense_cost_tickets from public,anon,authenticated,service_role;
create function finance_private.guard_effective_unloading_cost() returns trigger language plpgsql security definer set search_path='' as $$
declare e public.finance_expense_items%rowtype;p public.payables%rowtype;t uuid;version jsonb;ticket finance_private.expense_cost_tickets%rowtype;changed boolean;
begin
 t:=new.tenant_id;
 if tg_table_name='finance_expense_allocations' and tg_op='UPDATE' then
  if (old.tenant_id,old.expense_id) is distinct from (new.tenant_id,new.expense_id) and exists(select 1 from finance_private.expense_cost_amendments a where a.tenant_id=old.tenant_id and a.expense_id=old.expense_id) then raise exception 'finance_unloading_cost_allocation_identity_immutable' using errcode='55000';end if;
 end if;
 if tg_table_name='payables' then
  if tg_op='UPDATE' then select * into e from public.finance_expense_items where tenant_id=old.tenant_id and payable_id=old.id and unloading_id is not null;else select * into e from public.finance_expense_items where tenant_id=t and payable_id=new.id and unloading_id is not null;end if;
  if e.id is null then return new;end if;
 else
  if tg_table_name='payables_payments' then select * into p from public.payables where tenant_id=t and id=new.payable_id;select * into e from public.finance_expense_items where tenant_id=t and id=p.source_id and p.source_table='finance_expense_items' and unloading_id is not null;
  else select * into e from public.finance_expense_items where tenant_id=t and id=new.expense_id and unloading_id is not null;end if;
  if e.id is null then return new;end if;
 end if;
 if not pg_try_advisory_xact_lock(hashtextextended(e.tenant_id::text||':finance',0)) then raise exception 'finance_dependency_busy' using errcode='40001';end if;
 if tg_table_name='payables' and tg_op='UPDATE' then
  changed:=new.tenant_id is distinct from old.tenant_id or new.id is distinct from old.id or new.amount is distinct from old.amount or new.source_id is distinct from old.source_id or new.source_table is distinct from old.source_table or new.supplier_id is distinct from old.supplier_id or new.supplier_name is distinct from old.supplier_name or new.driver_id is distinct from old.driver_id;
  if changed then
   delete from finance_private.expense_cost_tickets where transaction_id=txid_current() and tenant_id=old.tenant_id and payable_id=old.id and actor_id=auth.uid() and before_data=to_jsonb(old) and after_data=to_jsonb(new) returning * into ticket;
   if not found or not finance_private.can_repair_unloading(old.tenant_id) or (ticket.before_data-array['amount','status','updated_at']) is distinct from (ticket.after_data-array['amount','status','updated_at']) or new.status<>'pending' then raise exception 'finance_unloading_cost_ticket_required' using errcode='55000';end if;return new;
  end if;
 end if;
 -- Unamended costs retain the original allocation/complement contract. A
 -- payable may represent only the unallocated remainder of the expense.
 if not exists(select 1 from finance_private.expense_cost_amendments a where a.tenant_id=e.tenant_id and a.expense_id=e.id) then return new;end if;
 version:=finance_private.expense_cost_effective(e.tenant_id,e.id);
 if version->>'verified' is distinct from 'true' then raise exception 'finance_expense_cost_unverified' using errcode='55000';end if;
 if tg_table_name='payables' then
  if finance_private.unloading_repair_cents(to_jsonb(new)->'amount') is distinct from version->>'effective_amount_cents' then raise exception 'finance_unloading_cost_payable_mismatch' using errcode='55000';end if;
 elsif tg_table_name='payables_payments' then
  select * into p from public.payables where tenant_id=t and id=new.payable_id;
  if finance_private.unloading_repair_cents(to_jsonb(p)->'amount') is distinct from version->>'effective_amount_cents' then raise exception 'finance_unloading_cost_payable_mismatch' using errcode='55000';end if;
 else
  -- A corrected cost already has one full nominal payable. A later direct
  -- allocation would duplicate its obligation and needs a coordinated writer.
  raise exception 'finance_unloading_cost_allocation_requires_command' using errcode='55000';
 end if;return new;
end$$;
revoke all on function finance_private.guard_effective_unloading_cost() from public,anon,authenticated,service_role;
create trigger finance_effective_unloading_payable before insert or update on public.payables for each row execute function finance_private.guard_effective_unloading_cost();
create trigger finance_effective_unloading_payment before insert on public.payables_payments for each row execute function finance_private.guard_effective_unloading_cost();
create trigger finance_effective_unloading_allocation before insert or update on public.finance_expense_allocations for each row execute function finance_private.guard_effective_unloading_cost();
create function finance_private.unloading_cost_correction_context(t uuid,charge uuid,amount_text text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e public.finance_expense_items%rowtype;p public.payables%rowtype;base jsonb;cost jsonb;collection jsonb;blockers jsonb:='[]';materialized jsonb;result jsonb;before_cents text;
begin
 perform finance_private.require_access(t);
 if coalesce(amount_text,'')!~'^[1-9][0-9]{0,13}$' then raise exception 'finance_invalid_amount' using errcode='22023';end if;
 select * into e from public.finance_expense_items where tenant_id=t and unloading_id=charge;select * into p from public.payables where tenant_id=t and id=e.payable_id;
 if e.id is null or p.id is null then raise exception 'finance_unloading_cost_source_unavailable' using errcode='55000';end if;
 cost:=finance_private.expense_cost_effective(t,e.id);collection:=finance_private.unloading_effective_origin(t,charge);base:=finance_private.unloading_cost_cancellation_context(t,e.id);before_cents:=finance_private.unloading_repair_cents(to_jsonb(p)->'amount');
 if base->>'eligible' is distinct from 'true' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code',base->>'issue','source_table','finance_expense_items','source_ids',jsonb_build_array(e.id)));end if;
 if cost->>'verified' is distinct from 'true' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_expense_cost_unverified','source_table','finance_expense_items','source_ids',jsonb_build_array(e.id)));end if;
 if collection->>'verified' is distinct from 'true' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_origin_unverified','source_table','finance_unloading_charges','source_ids',jsonb_build_array(charge)));end if;
 if cost->>'effective_amount_cents'=amount_text then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_unloading_cost_unchanged','source_table','finance_expense_items','source_ids',jsonb_build_array(e.id)));end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into materialized from public.driver_settlement_items x where x.tenant_id=t and ((x.source_table='finance_expense_items' and x.source_id=e.id) or (x.source_table='payables' and x.source_id=p.id));
 if jsonb_array_length(materialized)>0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_cost_materialized','source_table','driver_settlement_items','source_ids',(select jsonb_agg(x->'id') from jsonb_array_elements(materialized)x)));end if;
 begin perform finance_private.assert_closed_source_mutable(t,'finance_expense_items',to_jsonb(e));perform finance_private.assert_closed_source_mutable(t,'payables',to_jsonb(p));perform finance_private.assert_closed_source_mutable(t,'payables',to_jsonb(p)||jsonb_build_object('amount',amount_text::numeric/100,'status','pending'));exception when sqlstate '55000' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_expense_closed_period_dependency','source_table','payables','source_ids',jsonb_build_array(p.id)));end;
 result:=jsonb_build_object('version',1,'tenant_id',t,'actor_id',auth.uid(),'charge_id',charge,'expense_id',e.id,'payable_id',p.id,'cost',cost,'collection',collection,'payable',jsonb_build_object('original_amount_cents',case when cost->>'verified'='true' and jsonb_array_length(cost->'history')>0 then (select finance_private.unloading_repair_cents(a.before_payable->'amount') from finance_private.expense_cost_amendments a where a.tenant_id=t and a.expense_id=e.id order by ordinal limit 1) when base->>'eligible'='true' and before_cents=e.amount_cents::text then before_cents end,'amount_cents',before_cents,'status',p.status,'beneficiary_id',p.supplier_id,'beneficiary_name',p.supplier_name),
 'target',jsonb_build_object('amount_cents',amount_text,'payable_amount_cents',amount_text,'payable_status','pending'),'approval_reset',p.status='approved','blockers',blockers,'eligible',jsonb_array_length(blockers)=0,'can_correct',finance_private.can_repair_unloading(t),'can_execute',false,
 'effects',jsonb_build_object('computation','prospective_cost_correction','cost_before_cents',cost->>'effective_amount_cents','cost_after_cents',amount_text,'cost_delta_cents',case when cost->>'effective_amount_cents' is not null then (amount_text::bigint-(cost->>'effective_amount_cents')::bigint)::text end,'obligation_before_cents',before_cents,'obligation_after_cents',amount_text,'cash_changed',false,'collection_changed',false,'approval_reset',p.status='approved'),
 '_evidence',jsonb_build_object('base',base,'materializations',materialized,'payable',to_jsonb(p)));
 return result||jsonb_build_object('revision',md5(result::text));
end$$;
revoke all on function finance_private.unloading_cost_correction_context(uuid,uuid,text) from public,anon,authenticated,service_role;
create function finance_private.correct_unloading_cost(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;charge uuid;expense uuid;payable uuid;req uuid;actor uuid:=auth.uid();ctx jsonb;existing public.finance_commands%rowtype;p public.payables%rowtype;after_row jsonb;prior finance_private.expense_cost_amendments%rowtype;new_amendment uuid;result jsonb;actor_name text;
begin
 t:=(payload->>'tenant_id')::uuid;charge:=(payload->>'charge_id')::uuid;expense:=(payload->>'expense_id')::uuid;payable:=(payload->>'payable_id')::uuid;req:=(payload->>'request_id')::uuid;
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if payload->'version' is distinct from '1'::jsonb or req is null or charge is null or expense is null or payable is null or coalesce(payload->>'revision','')!~'^[a-f0-9]{32}$' or coalesce(payload->>'amount_cents','')!~'^[1-9][0-9]{0,13}$' or length(btrim(coalesce(payload->>'reason',''))) not between 10 and 2000 or exists(select 1 from jsonb_object_keys(payload) k where k<>all(array['version','tenant_id','request_id','charge_id','expense_id','payable_id','amount_cents','revision','reason'])) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor order by role::text for share nowait;perform 1 from public.drivers where tenant_id=t and user_id=actor order by id for share nowait;
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into existing from public.finance_commands where tenant_id=t and request_id=req;if found then if existing.actor_id<>actor or existing.action<>'correct_unloading_cost' or existing.payload<>payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return existing.result;end if;
 perform 1 from public.finance_unloading_charges where tenant_id=t and id=charge for update nowait;
 perform public._lock_receivable_financial_graph(t,(select receivable_id from public.finance_unloading_charges where tenant_id=t and id=charge));
 perform 1 from public.payroll_periods where tenant_id=t order by id for update nowait;perform 1 from public.dispatch_trips where tenant_id=t and id in(select trip_id from public.finance_expense_batches where tenant_id=t and id=(select batch_id from public.finance_expense_items where tenant_id=t and id=expense)) for update nowait;
 perform 1 from public.driver_settlements where tenant_id=t order by id for update nowait;perform 1 from public.payroll_entries where tenant_id=t order by payroll_period_id,id for update nowait;
 perform 1 from public.finance_expense_items where tenant_id=t and id=expense for update nowait;select * into p from public.payables where tenant_id=t and id=payable for update nowait;
 perform 1 from public.payables where tenant_id=t and source_table='finance_expense_items' and source_id=expense order by id for update nowait;
 perform 1 from public.clients where tenant_id=t and id=p.supplier_id for share nowait;
 perform 1 from public.drivers where tenant_id=t and id=p.driver_id for share nowait;
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 ctx:=finance_private.unloading_cost_correction_context(t,charge,payload->>'amount_cents');
 if ctx->>'expense_id' is distinct from expense::text or ctx->>'payable_id' is distinct from payable::text or ctx->>'revision' is distinct from payload->>'revision' then raise exception 'finance_unloading_cost_changed' using errcode='40001';end if;
 if ctx->>'eligible' is distinct from 'true' then raise exception 'finance_unloading_cost_blocked' using errcode='55000';end if;
 after_row:=to_jsonb(p)||jsonb_build_object('amount',(payload->>'amount_cents')::numeric/100,'status','pending','updated_at',clock_timestamp());
 perform finance_private.assert_closed_source_mutable(t,'payables',to_jsonb(p));perform finance_private.assert_closed_source_mutable(t,'payables',after_row);
 insert into finance_private.expense_cost_tickets values(txid_current(),t,payable,actor,req,to_jsonb(p),after_row);
 update public.payables set amount=(payload->>'amount_cents')::numeric/100,status='pending',updated_at=(after_row->>'updated_at')::timestamptz where tenant_id=t and id=payable;
 if exists(select 1 from finance_private.expense_cost_tickets where transaction_id=txid_current() and tenant_id=t and payable_id=payable) then raise exception 'finance_unloading_cost_ticket_unconsumed' using errcode='55000';end if;
 select * into prior from finance_private.expense_cost_amendments where tenant_id=t and expense_id=expense order by ordinal desc limit 1;
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into actor_name from auth.users where auth.users.id=actor;
 insert into finance_private.expense_cost_amendments(tenant_id,expense_id,charge_id,payable_id,ordinal,previous_id,request_id,revision_before,before_cents,after_cents,before_payable,after_payable,actor_id,actor_name,reason) values(t,expense,charge,payable,coalesce(prior.ordinal,0)+1,prior.id,req,ctx#>>'{cost,revision}',(ctx#>>'{cost,effective_amount_cents}')::bigint,(payload->>'amount_cents')::bigint,to_jsonb(p),after_row,actor,actor_name,btrim(payload->>'reason')) returning expense_cost_amendments.id into new_amendment;
 result:=jsonb_build_object('version',1,'tenant_id',t,'actor_id',actor,'request_id',req,'charge_id',charge,'expense_id',expense,'payable_id',payable,'amendment_id',new_amendment,'confirmed',true,'cost_before_cents',ctx#>'{effects,cost_before_cents}','cost_after_cents',payload->>'amount_cents','obligation_before_cents',ctx#>'{effects,obligation_before_cents}','obligation_after_cents',payload->>'amount_cents','approval_reset',ctx->'approval_reset','payable_status','pending','cash_changed',false,'collection_changed',false);
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(t,'expense_item',expense,'unloading_cost_corrected',actor,actor_name,btrim(payload->>'reason'),ctx,result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,req,actor,'correct_unloading_cost',payload,result);
 if finance_private.expense_cost_effective(t,expense)->>'verified' is distinct from 'true' then raise exception 'finance_expense_cost_chain_invalid' using errcode='23514';end if;return result;
exception when lock_not_available then raise exception 'finance_unloading_cost_busy' using errcode='40001';
end$$;
revoke all on function finance_private.correct_unloading_cost(jsonb) from public,anon,authenticated,service_role;

do $$declare p record;begin select * into p from pg_proc where oid='finance_private.unloading_cost_cancellation_context(uuid,uuid)'::regprocedure;if md5(p.prosrc) is distinct from '7e5d7713a5216917facf33b3e8d68f75' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(p.proacl)a where a.grantee<>p.proowner) then raise exception 'expense_cost_cancellation_predecessor_changed:unloading_cost_cancellation_context' using errcode='55000';end if;end$$;
create or replace function finance_private.unloading_cost_cancellation_context(_tenant uuid,_expense uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e public.finance_expense_items%rowtype;b public.finance_expense_batches%rowtype;p public.payables%rowtype;cancel public.finance_expense_cancellations%rowtype;snapshot jsonb;issue text;cost_version jsonb;begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into e from public.finance_expense_items where tenant_id=_tenant and id=_expense;select * into b from public.finance_expense_batches where tenant_id=_tenant and id=e.batch_id;select * into p from public.payables where tenant_id=_tenant and id=e.payable_id;
 select * into cancel from public.finance_expense_cancellations where tenant_id=_tenant and expense_id=_expense;
 cost_version:=case when e.id is not null then finance_private.expense_cost_effective(_tenant,e.id) end;
 snapshot:=jsonb_build_object('cost_version',cost_version,'expense',to_jsonb(e),'batch',to_jsonb(b),'payable',to_jsonb(p),'supplier',(select to_jsonb(s) from public.clients s where s.tenant_id=_tenant and s.id=e.supplier_id),'cancellation',case when cancel.id is null then null else to_jsonb(cancel)-'source_snapshot' end,
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
 elsif cost_version->>'verified' is distinct from 'true' then issue:='finance_expense_cost_unverified';
 elsif cancel.id is not null then issue:='finance_expense_already_cancelled';
 elsif e.unloading_id is null or e.category<>'unloading' then issue:='finance_unloading_cost_required';
 elsif jsonb_array_length(snapshot->'payments')>0 or jsonb_array_length(snapshot->'allocations')>0 or jsonb_array_length(snapshot->'payable_links')>0 then issue:='finance_expense_money_dependency';
 elsif jsonb_array_length(snapshot->'source_payables')<>1 or e.payable_id is null or p.id is null or p.source_table is distinct from 'finance_expense_items' or p.source_id is distinct from e.id or p.amount*100 is distinct from (cost_version->>'effective_amount_cents')::numeric or p.status not in('pending','approved') or p.driver_id is distinct from b.driver_id or jsonb_array_length(snapshot->'origin_items')<>1 or (case snapshot#>>'{origin_items,0,item,payee_type}' when 'supplier' then p.supplier_id is distinct from e.supplier_id or (e.supplier_id is null and p.supplier_name is distinct from e.supplier_name) when 'driver' then b.driver_id is null or p.supplier_id is not null or p.supplier_name is distinct from snapshot#>>'{driver,name}' else true end) then issue:='finance_expense_payable_inconsistent';
 elsif jsonb_array_length(snapshot->'legacy_links')+jsonb_array_length(snapshot->'maintenance_claims')+jsonb_array_length(snapshot->'labor_history')+jsonb_array_length(snapshot->'part_history')+jsonb_array_length(snapshot->'stock_history')>0 then issue:='finance_expense_source_association_dependency';
 elsif jsonb_array_length(snapshot->'advances')>0 or jsonb_array_length(snapshot->'payroll_items')>0 or exists(select 1 from public.driver_settlements x where x.tenant_id=_tenant and x.dispatch_trip_id=b.trip_id and x.status not in('pending_review','in_review','reopened')) then issue:='finance_expense_protected_composition';
 elsif jsonb_array_length(snapshot->'obligations')>0 then issue:='finance_expense_obligation_dependency';
 elsif exists(select 1 from public.finance_account_period_dependencies d join public.finance_account_period_closures c on c.tenant_id=d.tenant_id and c.id=d.closure_id where d.tenant_id=_tenant and ((d.source_kind='finance_expense_items' and d.source_id=e.id) or(d.source_kind='payables' and d.source_id=e.payable_id)) and not exists(select 1 from public.finance_account_period_reopenings r where r.tenant_id=_tenant and r.closure_id=c.id)) then issue:='finance_expense_closed_period_dependency';end if;
 if issue is null then begin perform finance_private.assert_closed_source_mutable(_tenant,'finance_expense_items',to_jsonb(e));perform finance_private.assert_closed_source_mutable(_tenant,'payables',to_jsonb(p));exception when sqlstate '55000' then issue:='finance_expense_closed_period_dependency';end;end if;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'expense_id',_expense,'revision',md5(snapshot::text),'eligible',issue is null,'issue',issue,'snapshot',snapshot,'cancellation',case when cancel.id is null then null else to_jsonb(cancel)-'source_snapshot' end,'effects',jsonb_build_object('cost_removed_cents',cost_version->>'effective_amount_cents','obligation_cancelled_cents',case when p.id is not null then trunc(p.amount*100)::text end,'cash_changed',false));
end$$;

do $$declare p record;begin select * into p from pg_proc where oid='finance_private.cancel_unloading_cost(jsonb)'::regprocedure;if md5(p.prosrc) is distinct from '3ab56297d95dfe8a24a3883c72962802' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(p.proacl)a where a.grantee<>p.proowner) then raise exception 'expense_cost_cancellation_predecessor_changed:cancel_unloading_cost' using errcode='55000';end if;end$$;
create or replace function finance_private.cancel_unloading_cost(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'expense_id',expense,'cancellation_id',cancel,'payable_id',p.id,'amount_cents',context#>'{effects,cost_removed_cents}','confirmed',true,'cash_changed',false);
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(t,'expense_item',expense,'expense_cancelled',actor,actor_name,btrim(_payload->>'reason'),context->'snapshot',result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'cancel_expense',_payload,result);return result;
end$$;

do $$declare p record;begin select * into p from pg_proc where oid='finance_private.coordinated_unloading_cancellation_context(uuid,uuid,date)'::regprocedure;if md5(p.prosrc) is distinct from 'a2771f898913ae62bbf793250bbfe070' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(p.proacl)a where a.grantee<>p.proowner) then raise exception 'expense_cost_cancellation_predecessor_changed:coordinated_unloading_cancellation_context' using errcode='55000';end if;end$$;
create or replace function finance_private.coordinated_unloading_cancellation_context(t uuid,charge uuid,effective_day date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare origin jsonb;right_context jsonb;cost_context jsonb;e public.finance_expense_items%rowtype;blockers jsonb:='[]';materializations jsonb;history jsonb;result jsonb;count_cost integer;prior_claim jsonb;
begin
 perform finance_private.require_access(t);
 origin:=finance_private.unloading_effective_origin(t,charge);
 right_context:=finance_private.unloading_origin_correction_context(t,charge,jsonb_build_object('operation','cancel_origin','effective_on',effective_day,'collection_right_only',true));
 blockers:=right_context->'blockers';
 if origin#>>'{effective,status}'='cancelled' then
  prior_claim:=finance_private.unloading_cancelled_claim_link(t,charge);
  if prior_claim->>'verified'='true' then
   -- Only the state/nominal checks made obsolete by the proven cancellation are removed.
   -- Financial history, fiscal links, date and closed-period blockers remain untouched.
   select coalesce(jsonb_agg(x),'[]') into blockers from jsonb_array_elements(blockers)x where x->>'code' not in('unloading_origin_not_active','unloading_projection_requires_repair','unloading_projection_state_requires_resolution');
  else blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_prior_cancellation_unverified','source_table','receivables','source_ids',jsonb_build_array(origin->'receivable_id')));end if;
 end if;
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
 'cost',case when e.id is not null then jsonb_build_object('amount_cents',cost_context#>>'{effects,cost_removed_cents}','payable_cents',cost_context#>'{effects,obligation_cancelled_cents}','beneficiary_id',cost_context#>'{snapshot,payable,supplier_id}','beneficiary_name',cost_context#>'{snapshot,payable,supplier_name}','payee_type',cost_context#>'{snapshot,origin_items,0,item,payee_type}') end,
 'blockers',blockers,'eligible',jsonb_array_length(blockers)=0,'can_cancel',finance_private.can_repair_unloading(t),'can_execute',false,'history',history,
 'effects',jsonb_build_object('computation','prospective_coordinated_cancellation','cash_changed',false,'cost_removed_cents',cost_context#>>'{effects,cost_removed_cents}','obligation_cancelled_cents',cost_context#>'{effects,obligation_cancelled_cents}','collection_cancelled_cents',origin#>'{effective,amount_cents}'),
 '_evidence',jsonb_build_object('prior_claim',prior_claim,'right',right_context,'cost',cost_context,'materializations',materializations));
 return result||jsonb_build_object('revision',md5(result::text));
end$$;

do $audit$declare body text;begin
 select pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure) into body;
 if position('''unloading_cancelled_coordinated'',' in body)=0 or position('''unloading_cost_corrected'',' in body)>0 then raise exception 'unloading_cost_audit_predecessor_changed';end if;
 execute replace(body,'''unloading_cancelled_coordinated'',','''unloading_cost_corrected'',''unloading_cancelled_coordinated'',');
end $audit$;
