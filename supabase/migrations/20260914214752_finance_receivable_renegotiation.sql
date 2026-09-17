-- PRIVATE CANDIDATE. Installment schedules never create another receivable or cash entry.
set lock_timeout='3s';
set statement_timeout='30s';

create table finance_private.receivable_agreement_events(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,receivable_id uuid not null,
 agreement_id uuid not null,previous_id uuid,action text not null check(action in('create','revise','revoke')),
 request_id uuid not null,actor_id uuid not null,actor_name text not null,reason text not null check(length(btrim(reason)) between 5 and 2000),
 source_revision text not null check(source_revision~'^[a-f0-9]{32}$'),source_snapshot jsonb not null,payload_hash text not null,result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),unique(tenant_id,id),unique(tenant_id,request_id),
 foreign key(tenant_id,receivable_id) references public.receivables(tenant_id,id),
 foreign key(tenant_id,previous_id) references finance_private.receivable_agreement_events(tenant_id,id),
 check((action='create' and previous_id is null and agreement_id=id)or(action='revise' and previous_id is not null and agreement_id=id)or(action='revoke' and previous_id is not null and agreement_id=previous_id))
);
create index receivable_agreement_target on finance_private.receivable_agreement_events(tenant_id,receivable_id,created_at,id);
create table finance_private.receivable_agreement_installments(
 tenant_id uuid not null,receivable_id uuid not null,agreement_id uuid not null,id uuid not null,ordinal integer not null check(ordinal between 1 and 100),
 amount_cents bigint not null check(amount_cents between 1 and 99999999999999),due_on date not null check(isfinite(due_on)),
 primary key(tenant_id,id),unique(tenant_id,agreement_id,ordinal),
 foreign key(tenant_id,receivable_id) references public.receivables(tenant_id,id),
 foreign key(tenant_id,agreement_id) references finance_private.receivable_agreement_events(tenant_id,id)
);
create table finance_private.receivable_installment_allocations(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,receivable_id uuid not null,agreement_id uuid not null,installment_id uuid not null,
 action text not null check(action in('allocate','reverse')),kind text not null check(kind in('cash','credit','discount','loss')),
 allocation_id uuid not null,source_event_id uuid not null,amount_cents bigint not null check(amount_cents between 1 and 99999999999999),created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id),unique(tenant_id,kind,source_event_id,installment_id,action),
 foreign key(tenant_id,receivable_id) references public.receivables(tenant_id,id),
 foreign key(tenant_id,installment_id) references finance_private.receivable_agreement_installments(tenant_id,id),
 foreign key(tenant_id,allocation_id) references finance_private.receivable_installment_allocations(tenant_id,id),
 check((action='allocate' and allocation_id=id)or(action='reverse' and allocation_id<>id))
);
create index receivable_installment_allocation_target on finance_private.receivable_installment_allocations(tenant_id,receivable_id,installment_id);
alter table finance_private.receivable_agreement_events enable row level security;
alter table finance_private.receivable_agreement_installments enable row level security;
alter table finance_private.receivable_installment_allocations enable row level security;
revoke all on finance_private.receivable_agreement_events,finance_private.receivable_agreement_installments,finance_private.receivable_installment_allocations from public,anon,authenticated,service_role;
create trigger preserve_receivable_agreement_event before update or delete on finance_private.receivable_agreement_events for each row execute function finance_private.preserve_event();
create trigger preserve_receivable_agreement_installment before update or delete on finance_private.receivable_agreement_installments for each row execute function finance_private.preserve_event();
create trigger preserve_receivable_installment_allocation before update or delete on finance_private.receivable_installment_allocations for each row execute function finance_private.preserve_event();

create function finance_private.receivable_agreement_current(_tenant uuid,_receivable uuid) returns setof finance_private.receivable_agreement_events
language sql stable security invoker set search_path='' rows 1 as $$
 select e.* from finance_private.receivable_agreement_events e where e.tenant_id=_tenant and e.receivable_id=_receivable order by e.created_at desc,e.id desc limit 1;
$$;
revoke all on function finance_private.receivable_agreement_current(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.receivable_installment_position(_tenant uuid,_receivable uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r public.receivables%rowtype;e finance_private.receivable_agreement_events%rowtype;s jsonb;rows jsonb:='[]';agreement uuid;status text:='none';scheduled numeric:=0;unallocated numeric;open_value numeric;valid boolean:=true;requires boolean:=false;history_count bigint;rev text;
begin
 perform finance_private.require_access(_tenant);select * into r from public.receivables where tenant_id=_tenant and id=_receivable;
 if not found then raise exception 'finance_agreement_receivable_missing' using errcode='22023';end if;
 s:=public._receivable_financial_snapshot(_tenant,_receivable);open_value:=(s->>'open_cents')::numeric;
 select count(*) into history_count from finance_private.receivable_agreement_events where tenant_id=_tenant and receivable_id=_receivable;
 select * into e from finance_private.receivable_agreement_current(_tenant,_receivable);
 if found then
  if e.action='revoke' then status:='revoked';
  else agreement:=e.agreement_id;status:=case when r.status='cancelled' then 'source_blocked' else 'active' end;
   with values_by_installment as(
    select i.*,coalesce(sum(case when a.action='allocate' then a.amount_cents else -a.amount_cents end)filter(where a.kind='cash'),0) cash,
     coalesce(sum(case when a.action='allocate' then a.amount_cents else -a.amount_cents end)filter(where a.kind='credit'),0) credit,
     coalesce(sum(case when a.action='allocate' then a.amount_cents else -a.amount_cents end)filter(where a.kind='discount'),0) discount,
     coalesce(sum(case when a.action='allocate' then a.amount_cents else -a.amount_cents end)filter(where a.kind='loss'),0) loss
    from finance_private.receivable_agreement_installments i left join finance_private.receivable_installment_allocations a on a.tenant_id=i.tenant_id and a.installment_id=i.id
    where i.tenant_id=_tenant and i.receivable_id=_receivable and i.agreement_id=agreement group by i.tenant_id,i.receivable_id,i.agreement_id,i.id,i.ordinal,i.amount_cents,i.due_on
   ),checked as(select *,amount_cents-cash-credit-discount-loss open_cents from values_by_installment)
   select coalesce(jsonb_agg(jsonb_build_object('id',id,'agreement_id',agreement_id,'ordinal',ordinal,'due_on',due_on,'amount_cents',amount_cents::text,'cash_cents',cash::text,'credit_cents',credit::text,'discount_cents',discount::text,'loss_cents',loss::text,'open_cents',case when open_cents>=0 then open_cents::text end,'status',case when open_cents=0 then 'settled' when due_on<(statement_timestamp() at time zone 'America/Sao_Paulo')::date then 'overdue' else 'open' end)order by ordinal),'[]'),coalesce(sum(open_cents),0),coalesce(bool_and(open_cents>=0),true)
   into rows,scheduled,valid from checked;
  end if;
 end if;
 unallocated:=open_value-scheduled;if unallocated<0 then valid:=false;end if;requires:=status='active' and unallocated>0;
 rev:=md5(jsonb_build_object('tenant',_tenant,'receivable',_receivable,'snapshot_revision',s->>'revision','event',to_jsonb(e),'installments',rows,'history_count',history_count)::text);
 return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'verified',valid and s->'requires_reconciliation'='false'::jsonb,'issue',case when not valid then 'finance_agreement_inconsistent' when s->'requires_reconciliation'<>'false'::jsonb then 'finance_receivable_unverified' when requires then 'finance_agreement_requires_reallocation' end,
  'receivable_id',_receivable,'agreement_id',agreement,'revision',rev,'status',status,'open_cents',case when valid then open_value::bigint::text end,'scheduled_open_cents',case when valid then scheduled::bigint::text end,'unallocated_open_cents',case when valid then unallocated::bigint::text end,'requires_reallocation',requires,'installments',rows,'history_count',history_count);
end$$;
revoke all on function finance_private.receivable_installment_position(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.receivable_agreement_context(_tenant uuid,_receivable uuid,_proposal jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p jsonb;pos jsonb;s jsonb;action text;items jsonb;total numeric:=0;blockers jsonb:='[]';manager boolean;result jsonb;
begin
 perform finance_private.require_access(_tenant);manager:=coalesce(public.is_tenant_admin(_tenant),false);
 if jsonb_typeof(_proposal) is distinct from 'object' or exists(select 1 from jsonb_object_keys(_proposal)as keys(key) where key not in('action','installments')) then raise exception 'finance_agreement_invalid' using errcode='22023';end if;
 action:=_proposal->>'action';items:=_proposal->'installments';if action not in('create','revise','revoke') or jsonb_typeof(items) is distinct from 'array' then raise exception 'finance_agreement_invalid' using errcode='22023';end if;
 if(action='revoke' and jsonb_array_length(items)<>0)or(action<>'revoke' and jsonb_array_length(items)not between 1 and 100) then raise exception 'finance_agreement_invalid' using errcode='22023';end if;
 if action<>'revoke' then
  if exists(select 1 from jsonb_array_elements(items)as elements(value) where jsonb_typeof(value)<>'object' or exists(select 1 from jsonb_object_keys(value)as keys(key) where key not in('id','amount_cents','due_on')) or coalesce(value->>'id','')!~'^[0-9a-fA-F-]{36}$' or coalesce(value->>'amount_cents','')!~'^[1-9][0-9]{0,13}$' or coalesce(value->>'due_on','')!~'^\d{4}-\d{2}-\d{2}$') then raise exception 'finance_agreement_invalid_installment' using errcode='22023';end if;
  if(select count(*)<>count(distinct value->>'id') from jsonb_array_elements(items)as elements(value))then raise exception 'finance_agreement_duplicate_installment' using errcode='22023';end if;
  select sum((value->>'amount_cents')::numeric) into total from jsonb_array_elements(items)as elements(value);
 end if;
 pos:=finance_private.receivable_installment_position(_tenant,_receivable);s:=public._receivable_financial_snapshot(_tenant,_receivable);
 if pos->'verified' is distinct from 'true'::jsonb then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_agreement_source_unverified','source_ids',jsonb_build_array(_receivable)));end if;
 if not manager then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_agreement_manager_required','source_ids',jsonb_build_array(auth.uid())));end if;
 if action='create' and pos->>'status'<>'none' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_agreement_already_exists','source_ids',jsonb_build_array(_receivable)));end if;
 if action in('revise','revoke') and pos->>'status'<>'active' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_agreement_not_active','source_ids',jsonb_build_array(_receivable)));end if;
 if action<>'revoke' and total<>coalesce((pos->>'open_cents')::numeric,-1) then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_agreement_sum_mismatch','source_ids',jsonb_build_array(_receivable)));end if;
 result:=jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'receivable_id',_receivable,'revision',md5(jsonb_build_object('position',pos,'proposal',_proposal)::text),'eligible',blockers='[]'::jsonb,'can_manage',manager,'can_execute',false,'blockers',blockers,
  'target',jsonb_build_object('reference',s->>'reference','status',s->>'status','amount_cents',s->>'amount_cents','cash_received_cents',s->>'cash_received_cents','credit_applied_cents',s->>'credit_applied_cents','discount_cents',s->>'discount_cents','loss_cents',s->>'loss_cents','settled_cents',s->>'settled_cents','open_cents',s->>'open_cents','revision',s->>'revision'),
  'agreement',pos,'effects',jsonb_build_object('cash_changed',false,'nominal_changed',false,'open_before_cents',pos->>'open_cents','open_after_cents',pos->>'open_cents','scheduled_before_cents',pos->>'scheduled_open_cents','scheduled_after_cents',case when action='revoke' then '0' else total::bigint::text end,'unallocated_before_cents',pos->>'unallocated_open_cents','unallocated_after_cents',case when action='revoke' then pos->>'open_cents' else '0' end));
 return result;
end$$;
revoke all on function finance_private.receivable_agreement_context(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function finance_private.record_receivable_agreement(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;actor uuid:=auth.uid();req uuid;target uuid;action text;proposal jsonb;ctx jsonb;prior finance_private.receivable_agreement_events%rowtype;current_event finance_private.receivable_agreement_events%rowtype;event_id uuid:=gen_random_uuid();agreement uuid;name text;result jsonb;ordinal integer:=0;x jsonb;expected_status text;
begin
 if jsonb_typeof(_payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(_payload)as keys(key) where key not in('version','tenant_id','request_id','receivable_id','action','expected_revision','reason','installments')) then raise exception 'finance_agreement_invalid' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;req:=(_payload->>'request_id')::uuid;target:=(_payload->>'receivable_id')::uuid;action:=_payload->>'action';
 perform finance_private.require_access(t);if actor is null or not coalesce(public.is_tenant_admin(t),false) then raise exception 'finance_agreement_manager_required' using errcode='42501';end if;
 if _payload->'version' is distinct from '1'::jsonb or req is null or target is null or action not in('create','revise','revoke') or coalesce(_payload->>'expected_revision','')!~'^[a-f0-9]{32}$' or coalesce(length(btrim(_payload->>'reason')),0)not between 5 and 2000 then raise exception 'finance_agreement_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 select * into prior from finance_private.receivable_agreement_events where tenant_id=t and request_id=req;
 if found then if prior.actor_id is distinct from actor or prior.payload_hash is distinct from md5(_payload::text) then raise exception 'finance_agreement_request_conflict' using errcode='23514';end if;return prior.result;end if;
 perform public._lock_receivable_financial_graph(t,target);select * into current_event from finance_private.receivable_agreement_current(t,target);
 proposal:=jsonb_build_object('action',action,'installments',coalesce(_payload->'installments','[]'::jsonb));ctx:=finance_private.receivable_agreement_context(t,target,proposal);
 if ctx->>'revision' is distinct from _payload->>'expected_revision' then raise exception 'finance_agreement_changed' using errcode='40001';end if;
 if ctx->'eligible' is distinct from 'true'::jsonb then raise exception 'finance_agreement_unavailable' using errcode='23514';end if;
 agreement:=case when action='revoke' then current_event.agreement_id else event_id end;
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into name from auth.users where id=actor;name:=coalesce(name,actor::text);
 result:=jsonb_build_object('version',1,'confirmed',true,'tenant_id',t,'actor_id',actor,'request_id',req,'event_id',event_id,'agreement_id',agreement,'receivable_id',target,'action',action,'cash_changed',false,'effects',ctx->'effects');
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(t,'receivable_agreement',event_id,'receivable_agreement_'||action,actor,name,btrim(_payload->>'reason'),ctx,result);
 insert into finance_private.receivable_agreement_events(id,tenant_id,receivable_id,agreement_id,previous_id,action,request_id,actor_id,actor_name,reason,source_revision,source_snapshot,payload_hash,result)
 values(event_id,t,target,agreement,current_event.id,action,req,actor,name,btrim(_payload->>'reason'),ctx->>'revision',ctx,md5(_payload::text),result);
 if action<>'revoke' then for x in select value from jsonb_array_elements(_payload->'installments') loop ordinal:=ordinal+1;insert into finance_private.receivable_agreement_installments(tenant_id,receivable_id,agreement_id,id,ordinal,amount_cents,due_on)values(t,target,event_id,(x->>'id')::uuid,ordinal,(x->>'amount_cents')::bigint,(x->>'due_on')::date);end loop;end if;
 expected_status:=case when action='revoke' then 'revoked' else 'active' end;
 if(finance_private.receivable_installment_position(t,target)->>'status')is distinct from expected_status then raise exception 'finance_agreement_projection_failed' using errcode='55000';end if;
 return result;
exception when lock_not_available then raise exception 'finance_agreement_busy' using errcode='40001';
end$$;
revoke all on function finance_private.record_receivable_agreement(jsonb) from public,anon,authenticated,service_role;

create function finance_private.receivable_agreement_history(_tenant uuid,_receivable uuid,_offset integer default 0,_limit integer default 30,_expected_revision text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare pos jsonb;total integer;rows jsonb;begin
 perform finance_private.require_access(_tenant);if _offset<0 or _limit not between 1 and 100 or(_expected_revision is not null and _expected_revision!~'^[a-f0-9]{32}$')then raise exception 'finance_agreement_history_invalid' using errcode='22023';end if;
 pos:=finance_private.receivable_installment_position(_tenant,_receivable);if _expected_revision is not null and _expected_revision is distinct from pos->>'revision' then raise exception 'finance_agreement_history_changed' using errcode='40001';end if;
 select count(*) into total from finance_private.receivable_agreement_events where tenant_id=_tenant and receivable_id=_receivable;
 select coalesce(jsonb_agg(to_jsonb(e)order by e.created_at desc,e.id desc),'[]') into rows from(select * from finance_private.receivable_agreement_events where tenant_id=_tenant and receivable_id=_receivable order by created_at desc,id desc limit _limit offset _offset)e;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'receivable_id',_receivable,'revision',pos->>'revision','offset',_offset,'limit',_limit,'total',total,'next_offset',case when _offset+jsonb_array_length(rows)<total then _offset+jsonb_array_length(rows) end,'rows',rows);
end$$;
revoke all on function finance_private.receivable_agreement_history(uuid,uuid,integer,integer,text) from public,anon,authenticated,service_role;

create function finance_private.receivable_payment_installment_history(_tenant uuid,_receivable uuid,_payment uuid,_offset integer default 0,_limit integer default 30,_expected_revision text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare pos jsonb;total integer;rows jsonb;begin
 perform finance_private.require_access(_tenant);
 if _offset<0 or _limit not between 1 and 100 then raise exception 'finance_agreement_payment_history_invalid' using errcode='22023';end if;
 if not exists(select 1 from public.receivables_payments where tenant_id=_tenant and receivable_id=_receivable and id=_payment)then raise exception 'finance_agreement_payment_missing' using errcode='22023';end if;
 pos:=finance_private.receivable_installment_position(_tenant,_receivable);if _expected_revision is not null and _expected_revision is distinct from pos->>'revision' then raise exception 'finance_agreement_history_changed' using errcode='40001';end if;
 with relevant as(select a.* from finance_private.receivable_installment_allocations a where a.tenant_id=_tenant and a.receivable_id=_receivable and a.kind='cash' and(a.source_event_id=_payment or exists(select 1 from finance_private.receivable_installment_allocations original where original.tenant_id=a.tenant_id and original.id=a.allocation_id and original.source_event_id=_payment)))select count(*) into total from relevant;
 with relevant as(select a.*,i.ordinal,i.due_on from finance_private.receivable_installment_allocations a join finance_private.receivable_agreement_installments i on i.tenant_id=a.tenant_id and i.id=a.installment_id where a.tenant_id=_tenant and a.receivable_id=_receivable and a.kind='cash' and(a.source_event_id=_payment or exists(select 1 from finance_private.receivable_installment_allocations original where original.tenant_id=a.tenant_id and original.id=a.allocation_id and original.source_event_id=_payment)) order by a.created_at,a.id limit _limit offset _offset)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'allocation_id',allocation_id,'source_event_id',source_event_id,'agreement_id',agreement_id,'installment_id',installment_id,'ordinal',ordinal,'due_on',due_on,'action',action,'amount_cents',amount_cents::text,'created_at',created_at)order by created_at,id),'[]')into rows from relevant;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'receivable_id',_receivable,'payment_id',_payment,'revision',pos->>'revision','offset',_offset,'limit',_limit,'total',total,'next_offset',case when _offset+jsonb_array_length(rows)<total then _offset+jsonb_array_length(rows)end,'rows',rows);
end$$;
revoke all on function finance_private.receivable_payment_installment_history(uuid,uuid,uuid,integer,integer,text) from public,anon,authenticated,service_role;

create function public.get_finance_receivable_agreement_context(_tenant_id uuid,_receivable_id uuid,_proposal jsonb) returns jsonb language sql stable security definer set search_path='' as $$select finance_private.receivable_agreement_context(_tenant_id,_receivable_id,_proposal)$$;
create function public.record_finance_receivable_agreement(_payload jsonb) returns jsonb language sql volatile security definer set search_path='' as $$select finance_private.record_receivable_agreement(_payload)$$;
create function public.get_finance_receivable_installment_position(_tenant_id uuid,_receivable_id uuid) returns jsonb language sql stable security definer set search_path='' as $$select finance_private.receivable_installment_position(_tenant_id,_receivable_id)$$;
create function public.get_finance_receivable_agreement_history(_tenant_id uuid,_receivable_id uuid,_offset integer default 0,_limit integer default 30,_expected_revision text default null) returns jsonb language sql stable security definer set search_path='' as $$select finance_private.receivable_agreement_history(_tenant_id,_receivable_id,_offset,_limit,_expected_revision)$$;
create function public.get_finance_receivable_payment_installments(_tenant_id uuid,_receivable_id uuid,_payment_id uuid,_offset integer default 0,_limit integer default 30,_expected_revision text default null) returns jsonb language sql stable security definer set search_path='' as $$select finance_private.receivable_payment_installment_history(_tenant_id,_receivable_id,_payment_id,_offset,_limit,_expected_revision)$$;
revoke all on function public.get_finance_receivable_agreement_context(uuid,uuid,jsonb),public.record_finance_receivable_agreement(jsonb),public.get_finance_receivable_installment_position(uuid,uuid),public.get_finance_receivable_agreement_history(uuid,uuid,integer,integer,text),public.get_finance_receivable_payment_installments(uuid,uuid,uuid,integer,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_receivable_agreement_context(uuid,uuid,jsonb),public.record_finance_receivable_agreement(jsonb),public.get_finance_receivable_installment_position(uuid,uuid),public.get_finance_receivable_agreement_history(uuid,uuid,integer,integer,text),public.get_finance_receivable_payment_installments(uuid,uuid,uuid,integer,integer,text) to authenticated;

create function finance_private.closing_receivable_agreement_position(_tenant uuid,_report uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare target uuid;begin perform finance_private.require_access(_tenant);
 select coalesce(c.receivable_id,r.id) into target from public.closing_reports c left join public.receivables r on r.tenant_id=c.tenant_id and(r.closing_report_id=c.id or exists(select 1 from public.client_invoices i where i.tenant_id=c.tenant_id and i.id=c.client_invoice_id and(r.client_invoice_id=i.id or i.receivable_id=r.id))) where c.tenant_id=_tenant and c.id=_report order by case when c.receivable_id=r.id then 0 else 1 end limit 1;
 if target is null then return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'report_id',_report,'receivable_id',null,'agreement',null);end if;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'report_id',_report,'receivable_id',target,'agreement',finance_private.receivable_installment_position(_tenant,target));
end$$;
create function public.get_finance_closing_receivable_agreement(_tenant_id uuid,_report_id uuid) returns jsonb language sql stable security definer set search_path='' as $$select finance_private.closing_receivable_agreement_position(_tenant_id,_report_id)$$;
revoke all on function finance_private.closing_receivable_agreement_position(uuid,uuid),public.get_finance_closing_receivable_agreement(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_closing_receivable_agreement(uuid,uuid) to authenticated;

create function finance_private.prepare_receivable_installment_distribution(_tenant uuid,_receivable uuid,_payload jsonb,_kind text) returns void
language plpgsql security definer set search_path='' as $$
declare pos jsonb;items jsonb;x jsonb;sum_value numeric:=0;agreement uuid;available numeric;
begin
 perform set_config('finance.receivable_installment_distribution','',true);
 if _kind not in('cash','credit','discount','loss') then raise exception 'finance_agreement_distribution_invalid' using errcode='22023';end if;
 pos:=finance_private.receivable_installment_position(_tenant,_receivable);
 if pos->>'status'='source_blocked' then raise exception 'finance_agreement_source_blocked' using errcode='55000';end if;
 if pos->>'status'<>'active' then
  if _payload ? 'installment_allocations' or _payload ? 'expected_agreement_revision' then raise exception 'finance_agreement_not_active' using errcode='23514';end if;return;
 end if;
 if pos->'verified' is distinct from 'true'::jsonb or pos->'requires_reallocation' is distinct from 'false'::jsonb then raise exception 'finance_agreement_requires_reallocation' using errcode='55000';end if;
 if _payload->>'expected_agreement_revision' is distinct from pos->>'revision' then raise exception 'finance_agreement_changed' using errcode='40001';end if;
 items:=_payload->'installment_allocations';if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)not between 1 and 100 then raise exception 'finance_agreement_distribution_required' using errcode='23514';end if;
 if exists(select 1 from jsonb_array_elements(items)as elements(value) where jsonb_typeof(value)<>'object' or exists(select 1 from jsonb_object_keys(value)as keys(key) where key not in('installment_id','amount_cents')) or coalesce(value->>'installment_id','')!~'^[0-9a-fA-F-]{36}$' or coalesce(value->>'amount_cents','')!~'^[1-9][0-9]{0,13}$')
  or(select count(*)<>count(distinct value->>'installment_id') from jsonb_array_elements(items)as elements(value)) then raise exception 'finance_agreement_distribution_invalid' using errcode='22023';end if;
 agreement:=(pos->>'agreement_id')::uuid;
 for x in select value from jsonb_array_elements(items) loop
  select (value->>'open_cents')::numeric into available from jsonb_array_elements(pos->'installments')as elements(value) where value->>'id'=x->>'installment_id';
  if available is null or (x->>'amount_cents')::numeric>available then raise exception 'finance_agreement_installment_capacity' using errcode='23514';end if;sum_value:=sum_value+(x->>'amount_cents')::numeric;
 end loop;
 if sum_value<>coalesce((_payload->>'amount_cents')::numeric,-1) then raise exception 'finance_agreement_distribution_sum' using errcode='23514';end if;
 perform set_config('finance.receivable_installment_distribution',jsonb_build_object('tenant_id',_tenant,'receivable_id',_receivable,'agreement_id',agreement,'revision',pos->>'revision','kind',_kind,'items',items)::text,true);
end$$;
revoke all on function finance_private.prepare_receivable_installment_distribution(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;

create function finance_private.consume_receivable_installment_distribution(_tenant uuid,_receivable uuid,_kind text,_source uuid,_amount numeric) returns void
language plpgsql security definer set search_path='' as $$
declare raw text;proof jsonb;x jsonb;event_id uuid;
begin
 if not exists(select 1 from finance_private.receivable_agreement_events e where e.tenant_id=_tenant and e.receivable_id=_receivable and e.action in('create','revise') and not exists(select 1 from finance_private.receivable_agreement_events later where later.tenant_id=e.tenant_id and later.receivable_id=e.receivable_id and(later.created_at,later.id)>(e.created_at,e.id))) then return;end if;
 raw:=current_setting('finance.receivable_installment_distribution',true);
 if coalesce(raw,'')='' then raise exception 'finance_agreement_distribution_required' using errcode='23514';end if;proof:=raw::jsonb;
 if proof->>'tenant_id' is distinct from _tenant::text or proof->>'receivable_id' is distinct from _receivable::text or proof->>'kind' is distinct from _kind
  or(select sum((value->>'amount_cents')::numeric)from jsonb_array_elements(proof->'items')as elements(value))<>_amount*100 then raise exception 'finance_agreement_distribution_mismatch' using errcode='23514';end if;
 for x in select value from jsonb_array_elements(proof->'items') loop
  event_id:=gen_random_uuid();insert into finance_private.receivable_installment_allocations(id,tenant_id,receivable_id,agreement_id,installment_id,action,kind,allocation_id,source_event_id,amount_cents)
  values(event_id,_tenant,_receivable,(proof->>'agreement_id')::uuid,(x->>'installment_id')::uuid,'allocate',_kind,event_id,_source,(x->>'amount_cents')::bigint);
 end loop;
 perform set_config('finance.receivable_installment_distribution','',true);
end$$;
revoke all on function finance_private.consume_receivable_installment_distribution(uuid,uuid,text,uuid,numeric) from public,anon,authenticated,service_role;

create function finance_private.reverse_receivable_installment_distribution(_tenant uuid,_receivable uuid,_kind text,_original uuid,_source uuid,_amount numeric) returns void
language plpgsql security definer set search_path='' as $$
declare a record;remaining numeric:=_amount*100;available numeric;take numeric;event_id uuid;
begin
 for a in select allocation.*,i.ordinal from finance_private.receivable_installment_allocations allocation join finance_private.receivable_agreement_installments i on i.tenant_id=allocation.tenant_id and i.id=allocation.installment_id
  where allocation.tenant_id=_tenant and allocation.receivable_id=_receivable and allocation.kind=_kind and allocation.source_event_id=_original and allocation.action='allocate' order by i.ordinal,allocation.id loop
  select a.amount_cents-coalesce(sum(r.amount_cents),0) into available from finance_private.receivable_installment_allocations r where r.tenant_id=_tenant and r.action='reverse' and r.allocation_id=a.id;
  take:=least(remaining,available);if take>0 then event_id:=gen_random_uuid();insert into finance_private.receivable_installment_allocations(id,tenant_id,receivable_id,agreement_id,installment_id,action,kind,allocation_id,source_event_id,amount_cents)
   values(event_id,_tenant,_receivable,a.agreement_id,a.installment_id,'reverse',_kind,a.id,_source,take::bigint);remaining:=remaining-take;end if;exit when remaining=0;
 end loop;
 if remaining<>0 and exists(select 1 from finance_private.receivable_installment_allocations where tenant_id=_tenant and receivable_id=_receivable and kind=_kind and source_event_id=_original and action='allocate') then raise exception 'finance_agreement_reversal_mismatch' using errcode='23514';end if;
end$$;
revoke all on function finance_private.reverse_receivable_installment_distribution(uuid,uuid,text,uuid,uuid,numeric) from public,anon,authenticated,service_role;

create function finance_private.allocate_receivable_cash() returns trigger language plpgsql security definer set search_path='' as $$begin perform finance_private.consume_receivable_installment_distribution(new.tenant_id,new.receivable_id,'cash',new.id,new.amount);return new;end$$;
create function finance_private.reverse_receivable_cash_allocation() returns trigger language plpgsql security definer set search_path='' as $$begin perform finance_private.reverse_receivable_installment_distribution(new.tenant_id,new.receivable_id,'cash',new.payment_id,new.id,new.amount);return new;end$$;
create function finance_private.allocate_receivable_credit() returns trigger language plpgsql security definer set search_path='' as $$begin if new.action='apply' then perform finance_private.consume_receivable_installment_distribution(new.tenant_id,new.receivable_id,'credit',new.id,new.amount_cents::numeric/100);else perform finance_private.reverse_receivable_installment_distribution(new.tenant_id,new.receivable_id,'credit',new.application_id,new.id,new.amount_cents::numeric/100);end if;return new;end$$;
create function finance_private.allocate_receivable_adjustment() returns trigger language plpgsql security definer set search_path='' as $$begin if new.action='apply' then perform finance_private.consume_receivable_installment_distribution(new.tenant_id,new.receivable_id,new.kind,new.id,new.amount_cents::numeric/100);else perform finance_private.reverse_receivable_installment_distribution(new.tenant_id,new.receivable_id,new.kind,new.adjustment_id,new.id,new.amount_cents::numeric/100);end if;return new;end$$;
revoke all on function finance_private.allocate_receivable_cash(),finance_private.reverse_receivable_cash_allocation(),finance_private.allocate_receivable_credit(),finance_private.allocate_receivable_adjustment() from public,anon,authenticated,service_role;
create trigger aa_allocate_receivable_cash after insert on public.receivables_payments for each row execute function finance_private.allocate_receivable_cash();
create trigger aa_reverse_receivable_cash_allocation after insert on public.receivable_payment_reversals for each row execute function finance_private.reverse_receivable_cash_allocation();
create trigger aa_allocate_receivable_credit after insert on finance_private.customer_credit_application_events for each row execute function finance_private.allocate_receivable_credit();
create trigger aa_allocate_receivable_adjustment after insert on finance_private.receivable_balance_adjustment_events for each row execute function finance_private.allocate_receivable_adjustment();

create function finance_private.verify_receivable_installment_chain() returns trigger language plpgsql security definer set search_path='' as $$
declare pos jsonb;begin pos:=finance_private.receivable_installment_position(new.tenant_id,new.receivable_id);if pos->'verified' is distinct from 'true'::jsonb then raise exception 'finance_agreement_chain_invalid' using errcode='23514';end if;return null;end$$;
revoke all on function finance_private.verify_receivable_installment_chain() from public,anon,authenticated,service_role;
create constraint trigger verify_receivable_agreement_chain after insert on finance_private.receivable_agreement_events deferrable initially deferred for each row execute function finance_private.verify_receivable_installment_chain();
create constraint trigger verify_receivable_allocation_chain after insert on finance_private.receivable_installment_allocations deferrable initially deferred for each row execute function finance_private.verify_receivable_installment_chain();

do $cash$declare body text;needle text;begin
 select pg_get_functiondef('public.apply_receivable_financial_command(jsonb)'::regprocedure) into body;
 needle:='''refund_kind'',''movement_id'')) then';if position(needle in body)=0 then raise exception 'finance_agreement_cash_payload_changed' using errcode='55000';end if;
 body:=replace(body,needle,'''refund_kind'',''movement_id'',''installment_allocations'',''expected_agreement_revision'')) then');
 needle:=' v_hash:=encode(sha256(convert_to(_payload::text,''UTF8'')),''hex'');';if position(needle in body)=0 then raise exception 'finance_agreement_cash_hash_changed' using errcode='55000';end if;
 body:=replace(body,needle,' if v_action<>''receive'' and(_payload ? ''installment_allocations'' or _payload ? ''expected_agreement_revision'')then raise exception ''finance_agreement_distribution_invalid'' using errcode=''22023'';end if;'||needle);
 needle:='if v_amount*100>(v_before->>''open_cents'')::numeric then';
 if position(needle in body)=0 then raise exception 'finance_agreement_cash_writer_changed' using errcode='55000';end if;
 body:=replace(body,needle,'perform finance_private.prepare_receivable_installment_distribution(v_tenant,v_id,_payload,''cash''); '||needle);execute body;
end$cash$;

do $credit$declare body text;needle text;begin
 select pg_get_functiondef('finance_private.record_customer_credit_application(jsonb)'::regprocedure) into body;
 needle:='''expected_revision'',''reason'']))';if position(needle in body)=0 then raise exception 'finance_agreement_credit_payload_changed' using errcode='55000';end if;
 body:=replace(body,needle,'''expected_revision'',''reason'',''installment_allocations'',''expected_agreement_revision'']))');
 needle:=' position:=finance_private.customer_credit_position(t,credit);';if position(needle in body)=0 then raise exception 'finance_agreement_credit_writer_changed' using errcode='55000';end if;
 body:=replace(body,needle,' if action=''apply'' then perform finance_private.prepare_receivable_installment_distribution(t,target,_payload,''credit'');elsif _payload ? ''installment_allocations'' or _payload ? ''expected_agreement_revision'' then raise exception ''finance_agreement_distribution_invalid'' using errcode=''22023'';end if;'||needle);execute body;
end$credit$;

do $adjustment$declare body text;needle text;begin
 select pg_get_functiondef('finance_private.record_receivable_balance_adjustment(jsonb)'::regprocedure) into body;
 needle:='''expected_revision'',''reason'']))';if position(needle in body)=0 then raise exception 'finance_agreement_adjustment_payload_changed' using errcode='55000';end if;
 body:=replace(body,needle,'''expected_revision'',''reason'',''installment_allocations'',''expected_agreement_revision'']))');
 needle:=' select coalesce(nullif(raw_user_meta_data->>''full_name'',''''),email,actor::text) into name';if position(needle in body)=0 then raise exception 'finance_agreement_adjustment_writer_changed' using errcode='55000';end if;
 body:=replace(body,needle,' if action=''apply'' then perform finance_private.prepare_receivable_installment_distribution(t,target,_payload,kind);elsif _payload ? ''installment_allocations'' or _payload ? ''expected_agreement_revision'' then raise exception ''finance_agreement_distribution_invalid'' using errcode=''22023'';end if;'||needle);execute body;
end$adjustment$;

do $portfolio$declare body text;needle text;replacement text;begin
 select pg_get_functiondef('finance_private.receivable_portfolio_summary(uuid,date,date,uuid)'::regprocedure) into body;
 needle:='coalesce(sum(remaining) filter(where due_date<today),0) overdue';
 replacement:='coalesce(sum(case when finance_private.receivable_installment_position(_tenant,id)->>''status''=''active'' then coalesce((select sum((item->>''open_cents'')::numeric) from jsonb_array_elements(finance_private.receivable_installment_position(_tenant,id)->''installments'') item where (item->>''due_on'')::date<today),0) when due_date<today then remaining else 0 end),0) overdue';
 if(length(body)-length(replace(body,needle,'')))/length(needle)<>1 or position('case when valid then adjustment_cents end adjusted' in body)=0 then raise exception 'finance_agreement_portfolio_reader_changed' using errcode='55000';end if;
 execute replace(body,needle,replacement);
end$portfolio$;

do $forecast_copy$declare body text;begin
 select pg_get_functiondef('finance_private.cash_forecast_collect(uuid,date,date)'::regprocedure) into body;
 if position('FUNCTION finance_private.cash_forecast_collect(' in body)=0 then raise exception 'finance_agreement_forecast_reader_changed' using errcode='55000';end if;
 execute replace(body,'FUNCTION finance_private.cash_forecast_collect(','FUNCTION finance_private.cash_forecast_collect_without_agreements(');
end$forecast_copy$;
revoke all on function finance_private.cash_forecast_collect_without_agreements(uuid,date,date) from public,anon,authenticated,service_role;
create or replace function finance_private.cash_forecast_collect(_tenant uuid,_cutoff date,_period_end date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base jsonb;origins jsonb:='[]';issues jsonb;origin jsonb;pos jsonb;item jsonb;counts jsonb;begin
 base:=finance_private.cash_forecast_collect_without_agreements(_tenant,_cutoff,_period_end);issues:=base->'source_issues';
 for origin in select value from jsonb_array_elements(base->'origins') loop
  if origin->>'source_table'='receivables' then pos:=finance_private.receivable_installment_position(_tenant,(origin->>'source_id')::uuid);else pos:=null;end if;
  if pos->>'status'='active' then
   for item in select value from jsonb_array_elements(pos->'installments') loop
    if coalesce((item->>'open_cents')::numeric,0)>0 then origins:=origins||jsonb_build_array(jsonb_build_object('economic_key',(origin->>'economic_key')||':installment:'||(item->>'id'),'source_table','receivables','source_id',(item->>'id')::uuid,'source_revision',md5(jsonb_build_object('parent_revision',origin->>'source_revision','agreement_revision',pos->>'revision','installment',item)::text),'direction','in','scenario','confirmed','nominal_cents',item->>'open_cents','fulfilled_cents','0','reserved_credit_cents','0','expected_on',item->>'due_on','expected_date_source','due_date','valid',coalesce(pos->'verified'='true'::jsonb,false)));end if;
   end loop;
   if pos->'requires_reallocation'='true'::jsonb then issues:=issues||jsonb_build_array(jsonb_build_object('scope','confirmed','code','forecast_receivable_agreement_requires_reallocation','source_ids',jsonb_build_array(origin->'source_id')));end if;
  else origins:=origins||jsonb_build_array(origin);end if;
 end loop;
 counts:=jsonb_set(base->'counts','{origins}',to_jsonb(jsonb_array_length(origins)));base:=base-'revision'||jsonb_build_object('origins',origins,'source_issues',issues,'counts',counts);
 return base||jsonb_build_object('revision',md5(base::text));
end$$;
revoke all on function finance_private.cash_forecast_collect(uuid,date,date) from public,anon,authenticated,service_role;

-- Public endpoints stay SECURITY INVOKER; only tenant-checking dispatchers cross
-- into the private SECURITY DEFINER implementation.
create function finance_private.dispatch_receivable_agreement_context(_tenant_id uuid, _receivable_id uuid, _proposal jsonb)
returns jsonb language sql stable security definer set search_path='' as $$select finance_private.receivable_agreement_context(_tenant_id,_receivable_id,_proposal)$$;
create function finance_private.dispatch_receivable_agreement_record(_payload jsonb)
returns jsonb language sql volatile security definer set search_path='' as $$select finance_private.record_receivable_agreement(_payload)$$;
create function finance_private.dispatch_receivable_installment_position(_tenant_id uuid, _receivable_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$select finance_private.receivable_installment_position(_tenant_id,_receivable_id)$$;
create function finance_private.dispatch_receivable_agreement_history(_tenant_id uuid, _receivable_id uuid, _offset integer, _limit integer, _expected_revision text)
returns jsonb language sql stable security definer set search_path='' as $$select finance_private.receivable_agreement_history(_tenant_id,_receivable_id,_offset,_limit,_expected_revision)$$;
create function finance_private.dispatch_receivable_payment_installments(_tenant_id uuid, _receivable_id uuid, _payment_id uuid, _offset integer, _limit integer, _expected_revision text)
returns jsonb language sql stable security definer set search_path='' as $$select finance_private.receivable_payment_installment_history(_tenant_id,_receivable_id,_payment_id,_offset,_limit,_expected_revision)$$;
create function finance_private.dispatch_closing_receivable_agreement(_tenant_id uuid, _report_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$select finance_private.closing_receivable_agreement_position(_tenant_id,_report_id)$$;
revoke all on function finance_private.dispatch_receivable_agreement_context(uuid,uuid,jsonb),finance_private.dispatch_receivable_agreement_record(jsonb),finance_private.dispatch_receivable_installment_position(uuid,uuid),finance_private.dispatch_receivable_agreement_history(uuid,uuid,integer,integer,text),finance_private.dispatch_receivable_payment_installments(uuid,uuid,uuid,integer,integer,text),finance_private.dispatch_closing_receivable_agreement(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function finance_private.dispatch_receivable_agreement_context(uuid,uuid,jsonb),finance_private.dispatch_receivable_agreement_record(jsonb),finance_private.dispatch_receivable_installment_position(uuid,uuid),finance_private.dispatch_receivable_agreement_history(uuid,uuid,integer,integer,text),finance_private.dispatch_receivable_payment_installments(uuid,uuid,uuid,integer,integer,text),finance_private.dispatch_closing_receivable_agreement(uuid,uuid) to authenticated;

create or replace function public.get_finance_receivable_agreement_context(_tenant_id uuid,_receivable_id uuid,_proposal jsonb) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.dispatch_receivable_agreement_context(_tenant_id,_receivable_id,_proposal)$$;
create or replace function public.record_finance_receivable_agreement(_payload jsonb) returns jsonb language sql volatile security invoker set search_path='' as $$select finance_private.dispatch_receivable_agreement_record(_payload)$$;
create or replace function public.get_finance_receivable_installment_position(_tenant_id uuid,_receivable_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.dispatch_receivable_installment_position(_tenant_id,_receivable_id)$$;
create or replace function public.get_finance_receivable_agreement_history(_tenant_id uuid,_receivable_id uuid,_offset integer default 0,_limit integer default 30,_expected_revision text default null) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.dispatch_receivable_agreement_history(_tenant_id,_receivable_id,_offset,_limit,_expected_revision)$$;
create or replace function public.get_finance_receivable_payment_installments(_tenant_id uuid,_receivable_id uuid,_payment_id uuid,_offset integer default 0,_limit integer default 30,_expected_revision text default null) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.dispatch_receivable_payment_installments(_tenant_id,_receivable_id,_payment_id,_offset,_limit,_expected_revision)$$;
create or replace function public.get_finance_closing_receivable_agreement(_tenant_id uuid,_report_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.dispatch_closing_receivable_agreement(_tenant_id,_report_id)$$;
revoke all on function public.get_finance_receivable_agreement_context(uuid,uuid,jsonb),public.record_finance_receivable_agreement(jsonb),public.get_finance_receivable_installment_position(uuid,uuid),public.get_finance_receivable_agreement_history(uuid,uuid,integer,integer,text),public.get_finance_receivable_payment_installments(uuid,uuid,uuid,integer,integer,text),public.get_finance_closing_receivable_agreement(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_receivable_agreement_context(uuid,uuid,jsonb),public.record_finance_receivable_agreement(jsonb),public.get_finance_receivable_installment_position(uuid,uuid),public.get_finance_receivable_agreement_history(uuid,uuid,integer,integer,text),public.get_finance_receivable_payment_installments(uuid,uuid,uuid,integer,integer,text),public.get_finance_closing_receivable_agreement(uuid,uuid) to authenticated;
