set local lock_timeout='3s';
set local statement_timeout='30s';
do $dependencies$declare x record;p record;begin
 for x in select * from (values ('finance_private.expense_cost_coverage(uuid,uuid)','8c9ee6819131d28a86b015d234dfe4ef','s'),('finance_private.guard_effective_unloading_cost()','fd0ba9ed44140afda72e537254a2ec8a','v'),('finance_private.unloading_cost_cancellation_context(uuid,uuid)','b13dc12e8c106cfc97a8fad79dc6e366','s')) v(signature,hash,volatility) loop
  select * into p from pg_proc where oid=to_regprocedure(x.signature);
  if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from x.hash or not p.prosecdef or p.provolatile::text is distinct from x.volatility or p.proconfig is distinct from array['search_path=""']::text[] or p.proacl is null or exists(select 1 from aclexplode(p.proacl)a where a.grantee<>p.proowner) then raise exception 'finance_open_complement_dependency_changed:%',x.signature using errcode='55000';end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='public.payables'::regclass and tgname='finance_effective_unloading_payable' and tgfoid='finance_private.guard_effective_unloading_cost()'::regprocedure and tgtype=23 and tgenabled='O' and tgqual is null and tgnargs=0) then raise exception 'finance_open_complement_ticket_guard_changed' using errcode='55000';end if;
end$dependencies$;
-- Private positive-complement correction; paid/materialized and excess funding remain distinct plans.
do $guard$declare p record;begin select * into p from pg_proc where oid='finance_private.expense_cost_effective(uuid,uuid)'::regprocedure;
 if md5(replace(p.prosrc,E'\r\n',E'\n'))<>'de49565ea3e3325d16c4141e007a5311' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(p.proacl)a where a.grantee<>p.proowner) then raise exception 'finance_open_complement_predecessor_changed' using errcode='55000';end if;
 execute replace(pg_get_functiondef(p.oid),'finance_private.expense_cost_effective(', 'finance_private.expense_cost_before_open_complement(');
end$guard$;
revoke all on function finance_private.expense_cost_before_open_complement(uuid,uuid) from public,anon,authenticated,service_role;
create table finance_private.expense_open_complement_amendments(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,expense_id uuid not null,charge_id uuid not null,payable_id uuid not null,
 ordinal integer not null check(ordinal>0),previous_id uuid,request_id uuid not null,actor_id uuid not null,actor_name text,reason text not null check(length(btrim(reason)) between 10 and 2000),created_at timestamptz not null default clock_timestamp(),
 base_revision text not null,revision_before text not null,before_cost_cents bigint not null check(before_cost_cents>0),after_cost_cents bigint not null check(after_cost_cents between 1 and 99999999999999),allocated_cents bigint not null check(allocated_cents>0),before_payable jsonb not null,after_payable jsonb not null,source_snapshot jsonb not null,
 unique(tenant_id,request_id),unique(tenant_id,expense_id,ordinal),unique(tenant_id,expense_id,id),foreign key(tenant_id,expense_id) references public.finance_expense_items(tenant_id,id),foreign key(tenant_id,expense_id,previous_id) references finance_private.expense_open_complement_amendments(tenant_id,expense_id,id),check((ordinal=1)=(previous_id is null)),check(after_cost_cents>allocated_cents),check(before_cost_cents<>after_cost_cents)
);
alter table finance_private.expense_open_complement_amendments enable row level security;revoke all on finance_private.expense_open_complement_amendments from public,anon,authenticated,service_role;
create trigger preserve_open_complement before update or delete on finance_private.expense_open_complement_amendments for each row execute function finance_private.preserve_event();
create function finance_private.open_complement_source(t uuid,expense uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e public.finance_expense_items%rowtype;b public.finance_expense_batches%rowtype;a public.finance_expense_allocations%rowtype;m public.finance_movements%rowtype;command public.finance_commands%rowtype;item jsonb;allocations jsonb:='[]';movements jsonb:='[]';total numeric:=0;ok boolean:=true;
begin
 perform finance_private.require_access(t);select * into e from public.finance_expense_items where tenant_id=t and id=expense;select * into b from public.finance_expense_batches where tenant_id=t and id=e.batch_id;
 if e.id is null or e.unloading_id is null then raise exception 'finance_unloading_cost_source_unavailable' using errcode='22023';end if;
 select c.* into command from public.finance_commands c where c.tenant_id=t and c.action='record_expense_batch' and c.result->>'batch_id'=b.id::text;
 if (select count(*) from public.finance_commands c where c.tenant_id=t and c.action='record_expense_batch' and c.result->>'batch_id'=b.id::text)<>1 then ok:=false;end if;
 select value into item from jsonb_array_elements(case when jsonb_typeof(command.payload->'items')='array' then command.payload->'items' else '[]'::jsonb end) where value->>'id'=e.id::text;
 if item->>'amount_cents' is distinct from e.amount_cents::text or item->>'supplier_id' is distinct from e.supplier_id::text or jsonb_typeof(item->'allocations') is distinct from 'array' then ok:=false;end if;
 for a in select * from public.finance_expense_allocations x where x.tenant_id=t and x.expense_id=e.id order by x.id loop
  select * into m from public.finance_movements where tenant_id=t and id=a.movement_id;
  if m.id is null or m.direction<>'out' or m.nature='transfer' or not exists(select 1 from finance_private.active_movements x where x.tenant_id=t and x.id=m.id) or finance_private.movement_used_cents(t,m.id)>m.amount_cents or finance_private.movement_used_cents(t,m.id)<a.amount_cents then ok:=false;end if;
  if (select count(*) from jsonb_array_elements(case when jsonb_typeof(item->'allocations')='array' then item->'allocations' else '[]'::jsonb end)x where x->>'movement_id'=a.movement_id::text and x->>'amount_cents'=a.amount_cents::text)<>1 then ok:=false;end if;
  total:=total+a.amount_cents;allocations:=allocations||jsonb_build_array(to_jsonb(a));movements:=movements||jsonb_build_array(to_jsonb(m));
 end loop;
 if total<=0 or total>e.amount_cents or jsonb_array_length(allocations)<>jsonb_array_length(case when jsonb_typeof(item->'allocations')='array' then item->'allocations' else '[]'::jsonb end) then ok:=false;end if;
 return jsonb_build_object('verified',ok,'allocated_cents',trunc(total)::text,'expense',to_jsonb(e),'batch',to_jsonb(b),'allocations',allocations,'movements',movements,'command',to_jsonb(command),'item',item);
end$$;
revoke all on function finance_private.open_complement_source(uuid,uuid) from public,anon,authenticated,service_role;
create or replace function finance_private.expense_cost_effective(t uuid,expense uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb;source jsonb;p public.payables%rowtype;x finance_private.expense_open_complement_amendments%rowtype;rev text;amount bigint;previous uuid;ordinal integer:=0;ok boolean;history jsonb:='[]';latest jsonb;
begin
 base:=finance_private.expense_cost_before_open_complement(t,expense);rev:=base->>'revision';amount:=(base->>'effective_amount_cents')::bigint;ok:=coalesce(base->>'verified'='true',false);
 if not exists(select 1 from finance_private.expense_open_complement_amendments a where a.tenant_id=t and a.expense_id=expense) then return base||jsonb_build_object('open_complement',null);end if;
 source:=finance_private.open_complement_source(t,expense);select * into p from public.payables where tenant_id=t and id=(base->>'payable_id')::uuid;
 for x in select * from finance_private.expense_open_complement_amendments a where a.tenant_id=t and a.expense_id=expense order by a.ordinal loop
  if x.ordinal<>ordinal+1 or x.previous_id is distinct from previous or x.revision_before is distinct from rev or x.base_revision is distinct from base->>'revision' or x.before_cost_cents is distinct from amount or x.source_snapshot is distinct from source or source->>'verified' is distinct from 'true' or x.allocated_cents::text is distinct from source->>'allocated_cents' or x.charge_id::text is distinct from base->>'charge_id' or x.payable_id::text is distinct from base->>'payable_id'
   or (x.before_payable-array['amount','status','updated_at']) is distinct from (x.after_payable-array['amount','status','updated_at']) or coalesce(x.before_payable->>'status','') not in('pending','approved') or x.after_payable->>'id' is distinct from x.payable_id::text or x.after_payable->>'tenant_id' is distinct from t::text or x.after_payable->>'source_id' is distinct from expense::text or x.after_payable->>'source_table' is distinct from 'finance_expense_items' or x.after_payable->>'status' is distinct from 'pending' or finance_private.unloading_repair_cents(x.before_payable->'amount') is distinct from (x.before_cost_cents-x.allocated_cents)::text or finance_private.unloading_repair_cents(x.after_payable->'amount') is distinct from (x.after_cost_cents-x.allocated_cents)::text
   or not exists(select 1 from public.finance_commands c where c.tenant_id=t and c.request_id=x.request_id and c.actor_id=x.actor_id and c.action='correct_open_unloading_complement' and c.result->>'amendment_id'=x.id::text and c.payload->>'expense_id'=expense::text and c.payload->>'amount_cents'=x.after_cost_cents::text and c.payload->>'charge_id'=x.charge_id::text and c.payload->>'payable_id'=x.payable_id::text and c.result->>'request_id'=x.request_id::text and c.result#>>'{effects,cost_before_cents}'=x.before_cost_cents::text and c.result#>>'{effects,cost_after_cents}'=x.after_cost_cents::text and c.result#>>'{effects,complement_after_cents}'=(x.after_cost_cents-x.allocated_cents)::text)
   or not exists(select 1 from public.finance_events a where a.tenant_id=t and a.entity_id=expense and a.actor_id=x.actor_id and a.action='unloading_open_complement_corrected' and a.after_data->>'amendment_id'=x.id::text and a.after_data#>>'{effects,cost_after_cents}'=x.after_cost_cents::text and a.before_data#>'{_evidence,source}'=x.source_snapshot)
  then ok:=false;end if;
  rev:=md5(jsonb_build_object('previous',rev,'event',to_jsonb(x))::text);amount:=x.after_cost_cents;previous:=x.id;ordinal:=x.ordinal;
  latest:=jsonb_build_object('id',x.id,'ordinal',x.ordinal,'previous_id',x.previous_id,'request_id',x.request_id,'actor_id',x.actor_id,'actor_name',x.actor_name,'reason',x.reason,'created_at',x.created_at,'cost_before_cents',x.before_cost_cents::text,'cost_after_cents',x.after_cost_cents::text,'complement_before_cents',(x.before_cost_cents-x.allocated_cents)::text,'complement_after_cents',(x.after_cost_cents-x.allocated_cents)::text,'allocated_reserved_cents',x.allocated_cents::text,'approval_reset',x.before_payable->>'status'='approved','revision_after',rev);history:=history||jsonb_build_array(latest);
 end loop;
 if p.id is null or finance_private.unloading_repair_cents(to_jsonb(p)->'amount') is distinct from (amount-(source->>'allocated_cents')::bigint)::text or p.source_table is distinct from 'finance_expense_items' or p.source_id is distinct from expense or (to_jsonb(p)-array['amount','status','updated_at','paid_amount','paid_at','bank_account_id','approved_at','approved_by']) is distinct from (x.after_payable-array['amount','status','updated_at','paid_amount','paid_at','bank_account_id','approved_at','approved_by']) then ok:=false;end if;
 return base||jsonb_build_object('verified',ok,'issue',case when ok then null else 'finance_open_complement_chain_invalid' end,'effective_amount_cents',case when ok then amount::text end,'revision',rev,'open_complement',latest||jsonb_build_object('history',history));
end$$;
revoke all on function finance_private.expense_cost_effective(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.unloading_open_complement_context(t uuid,charge uuid,amount_text text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e public.finance_expense_items%rowtype;p public.payables%rowtype;cost jsonb;source jsonb;deps jsonb;materialized jsonb;blockers jsonb:='[]';result jsonb;k text;allocated bigint;before_cents text;m jsonb;
begin
 perform finance_private.require_access(t);
 if coalesce(amount_text,'')!~'^[1-9][0-9]{0,13}$' then raise exception 'finance_invalid_amount' using errcode='22023';end if;
 select * into e from public.finance_expense_items where tenant_id=t and unloading_id=charge;
 select * into p from public.payables where tenant_id=t and id=e.payable_id;
 if e.id is null or p.id is null then raise exception 'finance_unloading_cost_source_unavailable' using errcode='55000';end if;
 cost:=finance_private.expense_cost_effective(t,e.id);source:=finance_private.open_complement_source(t,e.id);deps:=finance_private.unloading_cost_cancellation_context(t,e.id)->'snapshot';allocated:=(source->>'allocated_cents')::bigint;before_cents:=finance_private.unloading_repair_cents(to_jsonb(p)->'amount');
 if cost->>'verified' is distinct from 'true' or source->>'verified' is distinct from 'true' or e.category<>'unloading' or deps->'cancellation'<>'null'::jsonb then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_open_complement_source_unverified','source_table','finance_expense_items','source_ids',jsonb_build_array(e.id)));end if;
 if cost->'regularization' is not null and cost->'regularization'<>'null'::jsonb then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_open_complement_covered_plan_required','source_table','finance_expense_items','source_ids',jsonb_build_array(e.id)));end if;
 if amount_text::bigint<=allocated then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_open_complement_requires_disposition_plan','source_table','finance_expense_allocations','source_ids',(select jsonb_agg(x->'id') from jsonb_array_elements(source->'allocations')x)));end if;
 if amount_text=cost->>'effective_amount_cents' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_unloading_cost_unchanged','source_table','finance_expense_items','source_ids',jsonb_build_array(e.id)));end if;
 if p.status not in('pending','approved') or coalesce(p.paid_amount,0)<>0 or before_cents is distinct from ((cost->>'effective_amount_cents')::bigint-allocated)::text or jsonb_array_length(deps->'source_payables')<>1 or p.source_table is distinct from 'finance_expense_items' or p.source_id is distinct from e.id or p.driver_id::text is distinct from source#>>'{batch,driver_id}' or (case source#>>'{item,payee_type}' when 'supplier' then p.supplier_id is distinct from e.supplier_id or p.supplier_name is distinct from e.supplier_name when 'driver' then p.driver_id is null or p.supplier_id is not null else true end) then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_open_complement_obligation_inconsistent','source_table','payables','source_ids',jsonb_build_array(p.id)));end if;
 foreach k in array array['payments','payable_links','legacy_links','maintenance_claims','labor_history','part_history','stock_history','advances','payroll_items','obligations'] loop
  if jsonb_array_length(deps->k)>0 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_open_complement_dependency_requires_plan','source_table',k,'source_ids',(select coalesce(jsonb_agg(coalesce(x->'id',x->'cost_id')),'[]') from jsonb_array_elements(deps->k)x)));end if;
 end loop;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into materialized from public.driver_settlement_items x where x.tenant_id=t and ((x.source_table='finance_expense_items' and x.source_id=e.id) or(x.source_table='payables' and x.source_id=p.id));
 if jsonb_array_length(materialized)>0 or exists(select 1 from jsonb_array_elements(deps->'settlements')x where x->>'status' not in('pending_review','in_review','reopened')) then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_open_complement_materialization_requires_plan','source_table','driver_settlement_items','source_ids',(select coalesce(jsonb_agg(x->'id'),'[]') from jsonb_array_elements(materialized)x)));end if;
 begin
  perform finance_private.assert_closed_source_mutable(t,'finance_expense_items',to_jsonb(e));perform finance_private.assert_closed_source_mutable(t,'payables',to_jsonb(p));
  if amount_text::bigint>allocated then perform finance_private.assert_closed_source_mutable(t,'payables',to_jsonb(p)||jsonb_build_object('amount',(amount_text::numeric-allocated)/100,'status','pending'));end if;
  for m in select value from jsonb_array_elements(source->'movements') loop perform finance_private.assert_closed_source_mutable(t,'finance_movements',m);end loop;
 exception when sqlstate '55000' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_expense_closed_period_dependency','source_table','finance_expense_items','source_ids',jsonb_build_array(e.id)));end;
 result:=jsonb_build_object('version',1,'tenant_id',t,'actor_id',auth.uid(),'charge_id',charge,'expense_id',e.id,'payable_id',p.id,'cost_origin',cost,'allocated_reserved_cents',allocated::text,'payable',jsonb_build_object('amount_cents',before_cents,'status',p.status,'beneficiary_id',p.supplier_id,'beneficiary_name',p.supplier_name),'target',jsonb_build_object('cost_cents',amount_text,'complement_cents',case when amount_text::bigint>allocated then (amount_text::bigint-allocated)::text end,'status','pending'),'approval_reset',p.status='approved','blockers',blockers,'eligible',jsonb_array_length(blockers)=0,'can_correct',finance_private.can_repair_unloading(t),'can_execute',false,'effects',jsonb_build_object('cost_before_cents',cost->>'effective_amount_cents','cost_after_cents',amount_text,'complement_before_cents',before_cents,'complement_after_cents',case when amount_text::bigint>allocated then (amount_text::bigint-allocated)::text end,'cash_changed',false,'capacity_released_cents','0','approval_reset',p.status='approved'),'_evidence',jsonb_build_object('source',source,'payable',to_jsonb(p),'dependencies',deps,'materialized',materialized));
 return result||jsonb_build_object('revision',md5(result::text));
end$$;
revoke all on function finance_private.unloading_open_complement_context(uuid,uuid,text) from public,anon,authenticated,service_role;
create function finance_private.correct_unloading_open_complement(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;charge uuid;expense uuid;payable uuid;req uuid;actor uuid:=auth.uid();ctx jsonb;existing public.finance_commands%rowtype;p public.payables%rowtype;after_row jsonb;prior finance_private.expense_open_complement_amendments%rowtype;new_amendment uuid;result jsonb;actor_name text;
begin
 t:=(payload->>'tenant_id')::uuid;charge:=(payload->>'charge_id')::uuid;expense:=(payload->>'expense_id')::uuid;payable:=(payload->>'payable_id')::uuid;req:=(payload->>'request_id')::uuid;
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if payload->'version' is distinct from '1'::jsonb or req is null or charge is null or expense is null or payable is null or coalesce(payload->>'revision','')!~'^[a-f0-9]{32}$' or coalesce(payload->>'amount_cents','')!~'^[1-9][0-9]{0,13}$' or length(btrim(coalesce(payload->>'reason',''))) not between 10 and 2000 or exists(select 1 from jsonb_object_keys(payload) k where k<>all(array['version','tenant_id','request_id','charge_id','expense_id','payable_id','amount_cents','revision','reason'])) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor order by role::text for share nowait;perform 1 from public.drivers where tenant_id=t and user_id=actor order by id for share nowait;
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into existing from public.finance_commands where tenant_id=t and request_id=req;if found then if existing.actor_id<>actor or existing.action<>'correct_open_unloading_complement' or existing.payload<>payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return existing.result;end if;
 perform 1 from public.finance_unloading_charges where tenant_id=t and id=charge for update nowait;
 perform public._lock_receivable_financial_graph(t,(select receivable_id from public.finance_unloading_charges where tenant_id=t and id=charge));
 perform 1 from public.payroll_periods where tenant_id=t order by id for update nowait;perform 1 from public.dispatch_trips where tenant_id=t and id in(select trip_id from public.finance_expense_batches where tenant_id=t and id=(select batch_id from public.finance_expense_items where tenant_id=t and id=expense)) for update nowait;
 perform 1 from public.driver_settlements where tenant_id=t order by id for update nowait;perform 1 from public.payroll_entries where tenant_id=t order by payroll_period_id,id for update nowait;
 perform 1 from public.finance_expense_items where tenant_id=t and id=expense for update nowait;select * into p from public.payables where tenant_id=t and id=payable for update nowait;
 perform 1 from public.payables where tenant_id=t and source_table='finance_expense_items' and source_id=expense order by id for update nowait;
 perform 1 from public.clients where tenant_id=t and id=p.supplier_id for share nowait;
 perform 1 from public.drivers where tenant_id=t and id=p.driver_id for share nowait;
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 perform 1 from public.finance_expense_allocations where tenant_id=t and expense_id=expense order by id for update nowait;perform 1 from public.finance_movements where tenant_id=t and id in(select movement_id from public.finance_expense_allocations where tenant_id=t and expense_id=expense) order by id for update nowait;
 ctx:=finance_private.unloading_open_complement_context(t,charge,payload->>'amount_cents');
 if ctx->>'expense_id' is distinct from expense::text or ctx->>'payable_id' is distinct from payable::text or ctx->>'revision' is distinct from payload->>'revision' then raise exception 'finance_unloading_cost_changed' using errcode='40001';end if;
 if ctx->>'eligible' is distinct from 'true' then raise exception 'finance_unloading_cost_blocked' using errcode='55000';end if;
 after_row:=to_jsonb(p)||jsonb_build_object('amount',(ctx#>>'{target,complement_cents}')::numeric/100,'status','pending','updated_at',clock_timestamp());
 perform finance_private.assert_closed_source_mutable(t,'payables',to_jsonb(p));perform finance_private.assert_closed_source_mutable(t,'payables',after_row);
 insert into finance_private.expense_cost_tickets values(txid_current(),t,payable,actor,req,to_jsonb(p),after_row);
 update public.payables set amount=(ctx#>>'{target,complement_cents}')::numeric/100,status='pending',updated_at=(after_row->>'updated_at')::timestamptz where tenant_id=t and id=payable;
 if exists(select 1 from finance_private.expense_cost_tickets where transaction_id=txid_current() and tenant_id=t and payable_id=payable) then raise exception 'finance_unloading_cost_ticket_unconsumed' using errcode='55000';end if;
 select * into prior from finance_private.expense_open_complement_amendments where tenant_id=t and expense_id=expense order by ordinal desc limit 1;
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into actor_name from auth.users where auth.users.id=actor;
 insert into finance_private.expense_open_complement_amendments(tenant_id,expense_id,charge_id,payable_id,ordinal,previous_id,request_id,base_revision,revision_before,before_cost_cents,after_cost_cents,allocated_cents,before_payable,after_payable,source_snapshot,actor_id,actor_name,reason) values(t,expense,charge,payable,coalesce(prior.ordinal,0)+1,prior.id,req,finance_private.expense_cost_before_open_complement(t,expense)->>'revision',ctx#>>'{cost_origin,revision}',(ctx#>>'{cost_origin,effective_amount_cents}')::bigint,(payload->>'amount_cents')::bigint,(ctx->>'allocated_reserved_cents')::bigint,to_jsonb(p),after_row,ctx#>'{_evidence,source}',actor,actor_name,btrim(payload->>'reason')) returning expense_open_complement_amendments.id into new_amendment;
 result:=jsonb_build_object('version',1,'tenant_id',t,'actor_id',actor,'request_id',req,'charge_id',charge,'expense_id',expense,'payable_id',payable,'amendment_id',new_amendment,'confirmed',true,'effects',ctx->'effects','payable_status','pending');
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(t,'expense_item',expense,'unloading_open_complement_corrected',actor,actor_name,btrim(payload->>'reason'),ctx,result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,req,actor,'correct_open_unloading_complement',payload,result);
 if finance_private.expense_cost_effective(t,expense)->>'verified' is distinct from 'true' then raise exception 'finance_expense_cost_chain_invalid' using errcode='23514';end if;return result;
exception when lock_not_available then raise exception 'finance_unloading_cost_busy' using errcode='40001';
end$$;
revoke all on function finance_private.correct_unloading_open_complement(jsonb) from public,anon,authenticated,service_role;

create function finance_private.guard_open_complement_source() returns trigger language plpgsql security definer set search_path='' as $$
declare row_data jsonb;t uuid;expense uuid;a finance_private.expense_open_complement_amendments%rowtype;v jsonb;
begin
 for row_data in select x from jsonb_array_elements(case when tg_op='INSERT' then jsonb_build_array(to_jsonb(new)) when tg_op='DELETE' then jsonb_build_array(to_jsonb(old)) else jsonb_build_array(to_jsonb(old),to_jsonb(new)) end)x loop
  t:=(row_data->>'tenant_id')::uuid;expense:=null;
  if tg_table_name='payables' then select e.id into expense from public.finance_expense_items e where e.tenant_id=t and e.payable_id=(row_data->>'id')::uuid;
  elsif tg_table_name='finance_movement_voids' then select a.expense_id into expense from public.finance_expense_allocations a join finance_private.expense_open_complement_amendments j on j.tenant_id=a.tenant_id and j.expense_id=a.expense_id where a.tenant_id=t and a.movement_id=(row_data->>'movement_id')::uuid limit 1;
  else expense:=(row_data->>'expense_id')::uuid;end if;
  select * into a from finance_private.expense_open_complement_amendments x where x.tenant_id=t and x.expense_id=expense order by x.ordinal desc limit 1;
  if a.id is null then continue;end if;
  if not pg_try_advisory_xact_lock(hashtextextended(t::text||':finance',0)) then raise exception 'finance_open_complement_busy' using errcode='40001';end if;
  if tg_table_name='payables' and tg_op='UPDATE' then
   if exists(select 1 from finance_private.expense_cost_tickets k where k.transaction_id=txid_current() and k.tenant_id=t and k.payable_id=old.id and k.actor_id=auth.uid() and k.before_data=to_jsonb(old) and k.after_data=to_jsonb(new)) then continue;end if;
   if (to_jsonb(old)-array['status','updated_at','paid_amount','paid_at','bank_account_id','approved_at','approved_by']) is distinct from (to_jsonb(new)-array['status','updated_at','paid_amount','paid_at','bank_account_id','approved_at','approved_by']) or new.status not in('pending','approved','paid','partial') then raise exception 'finance_open_complement_source_protected' using errcode='55000';end if;
   v:=finance_private.expense_cost_effective(t,expense);
   if v->>'verified' is distinct from 'true' then raise exception 'finance_open_complement_chain_invalid' using errcode='55000';end if;
  else raise exception 'finance_open_complement_source_protected' using errcode='55000';end if;
 end loop;
 if tg_op='DELETE' then return old;end if;return new;
end$$;
revoke all on function finance_private.guard_open_complement_source() from public,anon,authenticated,service_role;
create trigger a_open_complement_payable before update or delete on public.payables for each row execute function finance_private.guard_open_complement_source();
create trigger a_open_complement_allocation before insert or update or delete on public.finance_expense_allocations for each row execute function finance_private.guard_open_complement_source();
create trigger a_open_complement_cancellation before insert on public.finance_expense_cancellations for each row execute function finance_private.guard_open_complement_source();
create trigger a_open_complement_void before insert on public.finance_movement_voids for each row execute function finance_private.guard_open_complement_source();
create trigger a_open_complement_old_cost before insert on finance_private.expense_cost_amendments for each row execute function finance_private.guard_open_complement_source();
create trigger a_open_complement_covered_cost before insert on finance_private.expense_cost_regularizations for each row execute function finance_private.guard_open_complement_source();
create function finance_private.check_open_complement_chain() returns trigger language plpgsql security definer set search_path='' as $$
begin if finance_private.expense_cost_effective(new.tenant_id,new.expense_id)->>'verified' is distinct from 'true' then raise exception 'finance_open_complement_chain_invalid' using errcode='23514';end if;return new;end$$;
revoke all on function finance_private.check_open_complement_chain() from public,anon,authenticated,service_role;
create constraint trigger check_open_complement_chain after insert on finance_private.expense_open_complement_amendments deferrable initially deferred for each row execute function finance_private.check_open_complement_chain();
