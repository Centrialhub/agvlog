set local lock_timeout='3s';
set local statement_timeout='30s';
-- Existing recorded money only; private linking command, no new cash movement.
do $guard$declare x record;p record;begin
 for x in select * from(values
('finance_private.expense_cost_effective(uuid,uuid)','e0328bd06900f17657a6bbc985f491fa'),
('finance_private.receipt_movement_used_cents(uuid,uuid)','05196cc18b7993460be1b4aa705eb291'),
('finance_private.expense_cost_coverage(uuid,uuid)','e03ebbe00144dbac0874cdb2c6e1a8e9')
 ) expected(signature,hash) loop
 select * into p from pg_proc where oid=to_regprocedure(x.signature);
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from x.hash or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee<>p.proowner) then raise exception 'finance_cost_return_predecessor_changed: %',x.signature using errcode='55000';end if;
 end loop;
 execute replace(pg_get_functiondef('finance_private.expense_cost_effective(uuid,uuid)'::regprocedure),'finance_private.expense_cost_effective(', 'finance_private.expense_cost_before_returns(');
 execute replace(pg_get_functiondef('finance_private.expense_cost_coverage(uuid,uuid)'::regprocedure),'finance_private.expense_cost_coverage(', 'finance_private.expense_cost_coverage_before_returns(');
 execute replace(pg_get_functiondef('finance_private.receipt_movement_used_cents(uuid,uuid)'::regprocedure),'finance_private.receipt_movement_used_cents(', 'finance_private.receipt_movement_used_before_cost_returns(');
end$guard$;
revoke all on function finance_private.expense_cost_before_returns(uuid,uuid),finance_private.expense_cost_coverage_before_returns(uuid,uuid),finance_private.receipt_movement_used_before_cost_returns(uuid,uuid) from public,anon,authenticated,service_role;
create table finance_private.cost_disposition_returns(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,expense_id uuid not null,regularization_id uuid not null,disposition_id uuid not null references finance_private.expense_cost_dispositions(id),incoming_movement_id uuid not null,
 request_id uuid not null,amount_cents bigint not null check(amount_cents between 1 and 99999999999999),actor_id uuid not null,actor_name text,reason text not null check(length(btrim(reason)) between 10 and 2000),created_at timestamptz not null default clock_timestamp(),occurred_on date not null,
 source_snapshot jsonb not null,unique(tenant_id,request_id),foreign key(tenant_id,expense_id,regularization_id) references finance_private.expense_cost_regularizations(tenant_id,expense_id,id),foreign key(tenant_id,incoming_movement_id) references public.finance_movements(tenant_id,id)
);
alter table finance_private.cost_disposition_returns enable row level security;revoke all on finance_private.cost_disposition_returns from public,anon,authenticated,service_role;
create index cost_disposition_returns_source on finance_private.cost_disposition_returns(tenant_id,disposition_id);
create index cost_disposition_returns_movement on finance_private.cost_disposition_returns(tenant_id,incoming_movement_id);
create trigger preserve_cost_disposition_return before update or delete on finance_private.cost_disposition_returns for each row execute function finance_private.preserve_event();
create or replace function finance_private.receipt_movement_used_cents(_tenant uuid,_movement uuid) returns numeric language sql stable security definer set search_path='' as $$
 select finance_private.receipt_movement_used_before_cost_returns(_tenant,_movement)+coalesce((select sum(amount_cents) from finance_private.cost_disposition_returns where tenant_id=_tenant and incoming_movement_id=_movement),0);
$$;
revoke all on function finance_private.receipt_movement_used_cents(uuid,uuid) from public,anon,authenticated,service_role;
create or replace function finance_private.expense_cost_effective(t uuid,expense uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb;reg jsonb;d jsonb;ds jsonb:='[]';r finance_private.cost_disposition_returns%rowtype;m public.finance_movements%rowtype;rows jsonb;returned bigint;total_returned bigint:=0;driver_open bigint:=0;recovery_open bigint:=0;open_amount bigint;ok boolean;fingerprint text:='';
begin
 base:=finance_private.expense_cost_before_returns(t,expense);reg:=nullif(base->'regularization','null'::jsonb);if reg is null then return base;end if;ok:=base->>'verified'='true';
 for d in select value from jsonb_array_elements(reg->'dispositions') loop
  returned:=0;rows:='[]';
  for r in select * from finance_private.cost_disposition_returns x where x.tenant_id=t and x.disposition_id=(d->>'id')::uuid order by x.created_at,x.id loop
   select * into m from public.finance_movements where tenant_id=t and id=r.incoming_movement_id;
   if r.expense_id<>expense or r.regularization_id::text is distinct from reg->>'id' or r.source_snapshot->'movement' is distinct from to_jsonb(m) or r.source_snapshot->'disposition' is distinct from d or not exists(select 1 from finance_private.active_movements a where a.tenant_id=t and a.id=m.id) or finance_private.receipt_movement_used_cents(t,m.id)>m.amount_cents
    or not exists(select 1 from public.finance_commands c where c.tenant_id=t and c.request_id=r.request_id and c.actor_id=r.actor_id and c.action='record_cost_disposition_return' and c.payload->>'disposition_id'=r.disposition_id::text and c.payload->>'incoming_movement_id'=m.id::text and c.payload->>'amount_cents'=r.amount_cents::text and c.result->>'return_id'=r.id::text)
    or not exists(select 1 from public.finance_events e where e.tenant_id=t and e.entity_id=expense and e.actor_id=r.actor_id and e.action='cost_disposition_return_recorded' and e.after_data->>'return_id'=r.id::text)
   then ok:=false;end if;
   returned:=returned+r.amount_cents;fingerprint:=fingerprint||md5(to_jsonb(r)::text);
   rows:=rows||jsonb_build_array(jsonb_build_object('id',r.id,'request_id',r.request_id,'incoming_movement_id',r.incoming_movement_id,'amount_cents',r.amount_cents::text,'occurred_on',r.occurred_on,'actor_id',r.actor_id,'actor_name',r.actor_name,'reason',r.reason,'created_at',r.created_at));
  end loop;
  open_amount:=(d->>'residual_cents')::bigint-returned;if open_amount<0 then ok:=false;end if;total_returned:=total_returned+returned;
  if d->>'disposition_type'='driver_custody' then driver_open:=driver_open+open_amount;else recovery_open:=recovery_open+open_amount;end if;
  ds:=ds||jsonb_build_array(d||jsonb_build_object('returned_cents',returned::text,'open_cents',open_amount::text,'resolution_status',case when open_amount=0 then 'resolved' when returned>0 then 'partial' else 'pending' end,'returns',rows));
 end loop;
 if exists(select 1 from finance_private.cost_disposition_returns prior_return where prior_return.tenant_id=t and prior_return.expense_id=expense and prior_return.regularization_id::text<>reg->>'id') then ok:=false;end if;
 return base||jsonb_build_object('verified',ok,'issue',case when ok then null else 'finance_cost_return_chain_invalid' end,'effective_amount_cents',case when ok then base->>'effective_amount_cents' end,'revision',case when fingerprint='' then base->>'revision' else md5((base->>'revision')||fingerprint) end,'regularization',reg||jsonb_build_object('dispositions',ds,'returned_cents',total_returned::text,'open_cents',((reg->>'residual_cents')::bigint-total_returned)::text,'driver_custody_open_cents',driver_open::text,'payment_recovery_open_cents',recovery_open::text));
end$$;
revoke all on function finance_private.expense_cost_effective(uuid,uuid) from public,anon,authenticated,service_role;
create or replace function finance_private.expense_cost_coverage(t uuid,expense uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;cost jsonb;r jsonb;begin
 v:=finance_private.expense_cost_coverage_before_returns(t,expense);cost:=finance_private.expense_cost_effective(t,expense);r:=nullif(cost->'regularization','null'::jsonb);
 return v||jsonb_build_object('returned_cents',case when v->>'verified'='true' then coalesce(r->>'returned_cents','0') end,'open_cents',case when v->>'verified'='true' then coalesce(r->>'open_cents',v->>'residual_cents') end,'driver_custody_open_cents',case when v->>'verified'='true' then coalesce(r->>'driver_custody_open_cents',v->>'driver_custody_cents') end,'payment_recovery_open_cents',case when v->>'verified'='true' then coalesce(r->>'payment_recovery_open_cents',v->>'payment_recovery_cents') end);
end$$;
revoke all on function finance_private.expense_cost_coverage(uuid,uuid) from public,anon,authenticated,service_role;
create function finance_private.cost_disposition_return_context(t uuid,disposition uuid,incoming uuid,amount_text text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d finance_private.expense_cost_dispositions%rowtype;r finance_private.expense_cost_regularizations%rowtype;m public.finance_movements%rowtype;original jsonb;current_cost jsonb;current_d jsonb;result jsonb;blockers jsonb:='[]';used numeric;open_amount bigint;n bigint;recording jsonb;
begin
 perform finance_private.require_access(t);if coalesce(amount_text,'')!~'^[1-9][0-9]{0,13}$' then raise exception 'finance_invalid_amount' using errcode='22023';end if;n:=amount_text::bigint;
 select * into d from finance_private.expense_cost_dispositions where tenant_id=t and id=disposition;select * into r from finance_private.expense_cost_regularizations where tenant_id=t and id=d.regularization_id;select * into m from public.finance_movements where tenant_id=t and id=incoming;
 if d.id is null or m.id is null then raise exception 'finance_cost_return_source_not_found' using errcode='22023';end if;
 current_cost:=finance_private.expense_cost_effective(t,d.expense_id);select value into current_d from jsonb_array_elements(current_cost#>'{regularization,dispositions}') where value->>'id'=d.id::text;
 select value into original from jsonb_array_elements(finance_private.expense_cost_before_returns(t,d.expense_id)#>'{regularization,dispositions}') where value->>'id'=d.id::text;
 if current_d is null or current_cost->>'verified' is distinct from 'true' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_cost_return_disposition_not_current','source_table','expense_cost_dispositions','source_ids',jsonb_build_array(d.id)));end if;
 open_amount:=(current_d->>'open_cents')::bigint;used:=finance_private.receipt_movement_used_cents(t,incoming);
 if open_amount is null or n>open_amount or used<0 or used<>trunc(used) or used+n>m.amount_cents then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_cost_return_capacity_exceeded','source_table','finance_movements','source_ids',jsonb_build_array(incoming)));end if;
 if not isfinite(m.occurred_on) or not isfinite(m.occurred_on) or m.direction<>'in' or m.nature not in('refund','receipt','other') or not exists(select 1 from finance_private.active_movements a where a.tenant_id=t and a.id=m.id) or m.id=d.movement_id or m.occurred_on<(select occurred_on from public.finance_movements where tenant_id=t and id=d.movement_id)
  or (d.disposition_type='driver_custody' and m.driver_id is distinct from d.responsible_id)
  or (d.disposition_type='payment_recovery' and (m.driver_id is not null or nullif(btrim(m.beneficiary_name),'') is distinct from nullif(btrim(d.responsible_name),'')))
 then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_cost_return_movement_incompatible','source_table','finance_movements','source_ids',jsonb_build_array(incoming)));end if;
 recording:=finance_private.movement_recording_origin(t,m.id);
 if recording->>'verified' is distinct from 'true' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_cost_return_recording_unverified','source_table','finance_movements','source_ids',jsonb_build_array(incoming)));end if;
 begin perform finance_private.assert_closed_source_mutable(t,'finance_movements',to_jsonb(m));exception when sqlstate '55000' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_cost_return_closed_period','source_table','finance_movements','source_ids',jsonb_build_array(incoming)));end;
 result:=jsonb_build_object('version',1,'tenant_id',t,'actor_id',auth.uid(),'expense_id',d.expense_id,'charge_id',r.charge_id,'payable_id',r.payable_id,'regularization_id',r.id,'disposition_id',d.id,'disposition',current_d,'incoming',jsonb_build_object('movement_id',m.id,'bank_account_id',m.bank_account_id,'occurred_on',m.occurred_on,'amount_cents',m.amount_cents::text,'used_cents',trunc(used)::text,'available_cents',trunc(m.amount_cents-used)::text,'recorded_counterparty',m.beneficiary_name),'blockers',blockers,'eligible',jsonb_array_length(blockers)=0,'can_record',finance_private.can_repair_unloading(t),'can_execute',false,
 'effects',jsonb_build_object('amount_cents',amount_text,'open_before_cents',open_amount::text,'open_after_cents',(open_amount-n)::text,'cash_changed',false,'original_reservation_changed',false,'incoming_capacity_consumed_cents',amount_text),
 '_evidence',jsonb_build_object('movement',to_jsonb(m),'disposition',original,'recording',recording,'cost_revision',current_cost->>'revision'));
 return result||jsonb_build_object('revision',md5(result::text));
end$$;
revoke all on function finance_private.cost_disposition_return_context(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
create function finance_private.record_cost_disposition_return(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;actor uuid:=auth.uid();request uuid;disposition uuid;incoming uuid;d finance_private.expense_cost_dispositions%rowtype;existing public.finance_commands%rowtype;ctx jsonb;result jsonb;new_id uuid;actor_name text;
begin
 t:=(payload->>'tenant_id')::uuid;request:=(payload->>'request_id')::uuid;disposition:=(payload->>'disposition_id')::uuid;incoming:=(payload->>'incoming_movement_id')::uuid;
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if payload->'version' is distinct from '1'::jsonb or request is null or disposition is null or incoming is null or coalesce(payload->>'revision','')!~'^[a-f0-9]{32}$' or coalesce(payload->>'amount_cents','')!~'^[1-9][0-9]{0,13}$' or length(btrim(coalesce(payload->>'reason',''))) not between 10 and 2000 or exists(select 1 from jsonb_object_keys(payload)k where k<>all(array['version','tenant_id','request_id','disposition_id','incoming_movement_id','amount_cents','revision','reason'])) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor order by role::text for share nowait;perform 1 from public.drivers where tenant_id=t and user_id=actor order by id for share nowait;
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into existing from public.finance_commands where tenant_id=t and request_id=request;
 if found then if existing.actor_id<>actor or existing.action<>'record_cost_disposition_return' or existing.payload<>payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return existing.result;end if;
 select * into d from finance_private.expense_cost_dispositions where tenant_id=t and id=disposition for update nowait;
 perform 1 from public.finance_expense_items where tenant_id=t and id=d.expense_id for update nowait;
 perform 1 from public.finance_movements where tenant_id=t and id=incoming for update nowait;
 perform 1 from public.bank_accounts where tenant_id=t and id=(select bank_account_id from public.finance_movements where tenant_id=t and id=incoming) for share nowait;
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 ctx:=finance_private.cost_disposition_return_context(t,disposition,incoming,payload->>'amount_cents');
 if ctx->>'revision' is distinct from payload->>'revision' then raise exception 'finance_cost_return_changed' using errcode='40001';end if;
 if ctx->>'eligible' is distinct from 'true' then raise exception 'finance_cost_return_blocked' using errcode='55000';end if;
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into actor_name from auth.users where auth.users.id=actor;
 insert into finance_private.cost_disposition_returns(tenant_id,expense_id,regularization_id,disposition_id,incoming_movement_id,request_id,amount_cents,actor_id,actor_name,reason,occurred_on,source_snapshot)
 values(t,d.expense_id,d.regularization_id,d.id,incoming,request,(payload->>'amount_cents')::bigint,actor,actor_name,btrim(payload->>'reason'),(ctx#>>'{incoming,occurred_on}')::date,ctx->'_evidence') returning id into new_id;
 result:=jsonb_build_object('version',1,'tenant_id',t,'actor_id',actor,'request_id',request,'return_id',new_id,'expense_id',d.expense_id,'charge_id',ctx->'charge_id','payable_id',ctx->'payable_id','regularization_id',d.regularization_id,'disposition_id',d.id,'incoming_movement_id',incoming,'confirmed',true,'effects',ctx->'effects');
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(t,'expense_item',d.expense_id,'cost_disposition_return_recorded',actor,actor_name,btrim(payload->>'reason'),ctx-'_evidence',result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'record_cost_disposition_return',payload,result);
 if finance_private.expense_cost_effective(t,d.expense_id)->>'verified' is distinct from 'true' then raise exception 'finance_cost_return_chain_invalid' using errcode='23514';end if;return result;
exception when lock_not_available then raise exception 'finance_cost_return_busy' using errcode='40001';end$$;
revoke all on function finance_private.record_cost_disposition_return(jsonb) from public,anon,authenticated,service_role;
create function finance_private.guard_cost_disposition_return() returns trigger language plpgsql security definer set search_path='' as $$
declare m public.finance_movements%rowtype;d finance_private.expense_cost_dispositions%rowtype;current_id uuid;
begin
 if not pg_try_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0)) then raise exception 'finance_dependency_busy' using errcode='40001';end if;
 if tg_table_name='finance_movement_voids' then
  if exists(select 1 from finance_private.cost_disposition_returns where tenant_id=new.tenant_id and incoming_movement_id=new.movement_id) then raise exception 'finance_cost_return_source_protected' using errcode='55000';end if;return new;
 elsif tg_table_name='expense_cost_regularizations' then
  if exists(select 1 from finance_private.cost_disposition_returns where tenant_id=new.tenant_id and expense_id=new.expense_id) then raise exception 'finance_cost_return_carryforward_requires_plan' using errcode='55000';end if;return new;
 end if;
 select * into d from finance_private.expense_cost_dispositions where tenant_id=new.tenant_id and id=new.disposition_id;select * into m from public.finance_movements where tenant_id=new.tenant_id and id=new.incoming_movement_id for update nowait;
 select id into current_id from finance_private.expense_cost_regularizations where tenant_id=new.tenant_id and expense_id=new.expense_id order by ordinal desc limit 1;
 if d.id is null or d.regularization_id is distinct from current_id or d.expense_id is distinct from new.expense_id or d.regularization_id is distinct from new.regularization_id or not isfinite(m.occurred_on) or m.direction<>'in' or m.nature not in('refund','receipt','other') or not exists(select 1 from finance_private.active_movements a where a.tenant_id=new.tenant_id and a.id=m.id) then raise exception 'finance_cost_return_source_invalid' using errcode='23514';end if;
 if finance_private.receipt_movement_used_cents(new.tenant_id,m.id)+new.amount_cents>m.amount_cents or coalesce((select sum(amount_cents) from finance_private.cost_disposition_returns where tenant_id=new.tenant_id and disposition_id=d.id),0)+new.amount_cents>d.residual_cents then raise exception 'finance_cost_return_capacity_exceeded' using errcode='23514';end if;
 perform finance_private.assert_closed_source_mutable(new.tenant_id,'finance_movements',to_jsonb(m));return new;
exception when lock_not_available then raise exception 'finance_cost_return_busy' using errcode='40001';end$$;
revoke all on function finance_private.guard_cost_disposition_return() from public,anon,authenticated,service_role;
create trigger cost_return_capacity before insert on finance_private.cost_disposition_returns for each row execute function finance_private.guard_cost_disposition_return();
create trigger a_cost_return_guard before insert on public.finance_movement_voids for each row execute function finance_private.guard_cost_disposition_return();
create trigger a_cost_return_guard before insert on finance_private.expense_cost_regularizations for each row execute function finance_private.guard_cost_disposition_return();
create function finance_private.check_cost_disposition_return() returns trigger language plpgsql security definer set search_path='' as $$begin if finance_private.expense_cost_effective(new.tenant_id,new.expense_id)->>'verified' is distinct from 'true' then raise exception 'finance_cost_return_chain_invalid' using errcode='23514';end if;return null;end$$;
revoke all on function finance_private.check_cost_disposition_return() from public,anon,authenticated,service_role;
create constraint trigger cost_return_chain after insert on finance_private.cost_disposition_returns deferrable initially deferred for each row execute function finance_private.check_cost_disposition_return();

do $guard$declare p record;begin select * into p from pg_proc where oid='finance_private.cost_dispositions(uuid,integer,text)'::regprocedure;
 if md5(replace(p.prosrc,E'\r\n',E'\n'))<>'7ac7097f7cd269161cdfce861747ffa5' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or not has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE') or exists(select 1 from aclexplode(p.proacl)a where a.grantee not in(p.proowner,'authenticated'::regrole::oid)) then raise exception 'finance_cost_return_portfolio_changed' using errcode='55000';end if;
 execute replace(pg_get_functiondef(p.oid),'finance_private.cost_dispositions(', 'finance_private.cost_dispositions_before_returns(');
end$guard$;
revoke all on function finance_private.cost_dispositions_before_returns(uuid,integer,text) from public,anon,authenticated,service_role;
create or replace function finance_private.cost_dispositions(t uuid,_page integer default 1,_expected_revision text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;sums jsonb;begin
 v:=finance_private.cost_dispositions_before_returns(t,_page,_expected_revision);
 with sources as materialized(select finance_private.expense_cost_coverage(t,expense_id) c from (select distinct expense_id from finance_private.expense_cost_regularizations where tenant_id=t)e)
 select jsonb_build_object('returned_cents',case when bool_and(c->>'verified'='true') is not false then trunc(coalesce(sum((c->>'returned_cents')::numeric),0))::text end,'open_cents',case when bool_and(c->>'verified'='true') is not false then trunc(coalesce(sum((c->>'open_cents')::numeric),0))::text end,'driver_custody_open_cents',case when bool_and(c->>'verified'='true') is not false then trunc(coalesce(sum((c->>'driver_custody_open_cents')::numeric),0))::text end,'payment_recovery_open_cents',case when bool_and(c->>'verified'='true') is not false then trunc(coalesce(sum((c->>'payment_recovery_open_cents')::numeric),0))::text end) into sums from sources;
 return v||sums;
end$$;
revoke all on function finance_private.cost_dispositions(uuid,integer,text) from public,anon,authenticated,service_role;grant execute on function finance_private.cost_dispositions(uuid,integer,text) to authenticated;

do $guard$declare p record;begin select * into p from pg_proc where oid='finance_private.unloading_cost_regularization_context(uuid,uuid,jsonb)'::regprocedure;
 if md5(replace(p.prosrc,E'\r\n',E'\n'))<>'c3abcbc6593d94094cd4bcd3a51a10ea' or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(p.proacl)a where a.grantee<>p.proowner) then raise exception 'finance_cost_return_context_changed' using errcode='55000';end if;
 execute replace(pg_get_functiondef(p.oid),'finance_private.unloading_cost_regularization_context(', 'finance_private.unloading_cost_regularization_before_returns(');
end$guard$;
revoke all on function finance_private.unloading_cost_regularization_before_returns(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create or replace function finance_private.unloading_cost_regularization_context(t uuid,charge uuid,proposal jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;ids jsonb;begin
 v:=finance_private.unloading_cost_regularization_before_returns(t,charge,proposal);
 select jsonb_agg(r.id order by r.id) into ids from finance_private.cost_disposition_returns r where r.tenant_id=t and r.expense_id::text=v->>'expense_id';
 if ids is not null then v:=(v-'revision')||jsonb_build_object('eligible',false,'can_execute',false,'blockers',(v->'blockers')||jsonb_build_array(jsonb_build_object('code','finance_cost_return_carryforward_requires_plan','source_table','cost_disposition_returns','source_ids',ids)));v:=v||jsonb_build_object('revision',md5(v::text));end if;return v;
end$$;
revoke all on function finance_private.unloading_cost_regularization_context(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function finance_private.cost_return_movement_options(t uuid,disposition uuid,_query text default '',_page integer default 1,_expected_revision text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d finance_private.expense_cost_dispositions%rowtype;cost jsonb;result jsonb;
begin
 perform finance_private.require_access(t);
 if _page is null or _page not between 1 and 1000000 or length(coalesce(_query,''))>100 or _expected_revision is not null and _expected_revision!~'^[a-f0-9]{32}$' then raise exception 'finance_invalid_page' using errcode='22023';end if;
 if _page>1 and _expected_revision is null then raise exception 'finance_cost_return_options_revision_required' using errcode='22023';end if;
 select * into d from finance_private.expense_cost_dispositions where tenant_id=t and id=disposition;if not found then raise exception 'finance_cost_return_source_not_found' using errcode='22023';end if;
 cost:=finance_private.expense_cost_effective(t,d.expense_id);
 if cost->>'verified' is distinct from 'true' or not exists(select 1 from jsonb_array_elements(cost#>'{regularization,dispositions}')v where v->>'id'=disposition::text and (v->>'open_cents')::bigint>0) then raise exception 'finance_cost_return_disposition_not_current' using errcode='55000';end if;
 with candidates as materialized(
 select m.id,m.bank_account_id,b.name bank_account_name,m.occurred_on,m.beneficiary_name,m.description,m.amount_cents,finance_private.receipt_movement_used_cents(t,m.id) used
 from finance_private.active_movements m join public.bank_accounts b on b.tenant_id=m.tenant_id and b.id=m.bank_account_id
 where m.tenant_id=t and m.direction='in' and m.nature in('refund','receipt','other') and isfinite(m.occurred_on) and m.occurred_on>=(select occurred_on from public.finance_movements where tenant_id=t and id=d.movement_id)
 and (d.disposition_type='driver_custody' and m.driver_id=d.responsible_id or d.disposition_type='payment_recovery' and m.driver_id is null and nullif(btrim(m.beneficiary_name),'')=nullif(btrim(d.responsible_name),''))
 and (coalesce(btrim(_query),'')='' or strpos(lower(coalesce(m.description,'')||' '||coalesce(m.beneficiary_name,'')||' '||coalesce(b.name,'')),lower(btrim(_query)))>0)
 ),available as materialized(select id,bank_account_id,bank_account_name,occurred_on,coalesce(beneficiary_name,description,id::text) label,amount_cents::text amount_cents,trunc(used)::text used_cents,trunc(amount_cents-used)::text available_cents from candidates where used>=0 and used=trunc(used) and used<amount_cents),
 totals as(select count(*) total,md5(t::text||disposition::text||coalesce(_query,'')||(cost->>'revision')||coalesce(string_agg(md5(to_jsonb(a)::text),'' order by occurred_on desc,id),'')) revision from available a),
 paged as(select * from available order by occurred_on desc,id limit 30 offset (_page-1)*30)
 select jsonb_build_object('version',1,'tenant_id',t,'actor_id',auth.uid(),'disposition_id',disposition,'query',coalesce(_query,''),'page',_page,'page_size',30,'total',total,'revision',revision,'rows',coalesce((select jsonb_agg(to_jsonb(p) order by occurred_on desc,id) from paged p),'[]')) into result from totals;
 if _expected_revision is not null and _expected_revision is distinct from result->>'revision' then raise exception 'finance_cost_return_options_changed' using errcode='40001';end if;return result;
end$$;
revoke all on function finance_private.cost_return_movement_options(uuid,uuid,text,integer,text) from public,anon,authenticated,service_role;
