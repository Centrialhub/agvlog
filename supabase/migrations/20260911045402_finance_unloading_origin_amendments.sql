-- Exact predecessor implementations; no unreviewed bypass or ACL is accepted.
do $preflight$
declare item record;p record;
begin
 for item in select * from (values
 ('finance_private.guard_unloading_receivable_source()','bdf896097eb666ff99c9d1f88dcd3aa4',true),
 ('finance_private.unloading_projection_repair_context(uuid,uuid)','fe0b133442bab6f51ec6a0065b68629b',true),
 ('finance_private.unloading_receivable_source_context(uuid,uuid)','329fcc118795c2c5a31c4dbc32edf7bc',false)) v(signature,body_hash,definer) loop
  select * into p from pg_proc where oid=to_regprocedure(item.signature);
  if p.oid is null or md5(p.prosrc)<>item.body_hash or p.prosecdef<>item.definer or p.proconfig is distinct from array['search_path=""']::text[]
   or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE')
   or exists(select 1 from aclexplode(p.proacl) a where a.grantee<>p.proowner)
  then raise exception 'unloading_amendment_predecessor_changed' using errcode='55000';end if;
 end loop;
end $preflight$;
-- Private first: original charge identity, cost and payments remain preserved.
create table finance_private.unloading_origin_amendments(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,charge_id uuid not null,receivable_id uuid not null,
 ordinal integer not null check(ordinal>0),previous_id uuid,request_id uuid not null,
 operation text not null check(operation in('amend_origin','cancel_origin')),revision_before text not null,
 before_state jsonb not null,after_state jsonb not null,effective_on date not null,actor_id uuid not null,actor_name text not null,
 reason text not null check(length(btrim(reason)) between 10 and 2000),evidence jsonb not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,request_id),unique(tenant_id,charge_id,ordinal),unique(tenant_id,charge_id,id),
 foreign key(charge_id) references public.finance_unloading_charges(id),
 foreign key(tenant_id,charge_id,previous_id) references finance_private.unloading_origin_amendments(tenant_id,charge_id,id),
 check((ordinal=1)=(previous_id is null))
);
alter table finance_private.unloading_origin_amendments enable row level security;
revoke all on finance_private.unloading_origin_amendments from public,anon,authenticated,service_role;
create trigger unloading_origin_amendment_immutable before update or delete on finance_private.unloading_origin_amendments for each row execute function finance_private.preserve_event();

-- Origin resolution reads only immutable recording evidence, not the whole dependency graph.
create function finance_private.unloading_origin_base(_tenant uuid,_charge uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.finance_unloading_charges%rowtype;cmd public.finance_commands%rowtype;commands jsonb;events jsonb;proof boolean;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into c from public.finance_unloading_charges where tenant_id=_tenant and id=_charge;
 if not found then raise exception 'finance_unloading_not_found' using errcode='22023';end if;

 select coalesce(jsonb_agg(to_jsonb(x) order by request_id),'[]') into commands from public.finance_commands x where tenant_id=_tenant and action='record_unloading' and x.result->>'charge_id'=c.id::text;
 select x.* into cmd from public.finance_commands x where x.tenant_id=_tenant and x.action='record_unloading' and x.result->>'charge_id'=c.id::text order by x.request_id limit 1;
 select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') into events from public.finance_events x where tenant_id=_tenant and entity_type='unloading' and entity_id=c.id and action='recorded';
 proof:=jsonb_array_length(commands)=1 and jsonb_array_length(events)=1
  and cmd.payload->>'tenant_id'=c.tenant_id::text and cmd.result->>'tenant_id'=c.tenant_id::text
  and cmd.actor_id=c.created_by and cmd.result->>'receivable_id'=c.receivable_id::text and cmd.result->>'supplier_id'=c.supplier_id::text
  and cmd.payload->>'amount_cents'=c.amount_cents::text and cmd.payload->>'occurred_on'=c.occurred_on::text
  and cmd.payload->>'receipt_path'=c.receipt_path and cmd.payload->>'stop_id'=c.recorded_stop_id::text
  and cmd.payload->>'expected_revision'=c.source_snapshot->>'revision'
  and c.source_snapshot->>'supplier_id'=c.supplier_id::text and c.source_snapshot->>'delivery_stop_id'=c.delivery_stop_id::text
  and events#>'{0,after_data,context}'=c.source_snapshot
  and events#>>'{0,actor_id}'=c.created_by::text and events#>>'{0,after_data,receivable_id}'=c.receivable_id::text
  and events#>>'{0,after_data,amount_cents}'=c.amount_cents::text
  and exists(select 1 from public.clients where tenant_id=_tenant and id=c.supplier_id);

 return jsonb_build_object('origin_verified',coalesce(proof,false),'receivable_id',c.receivable_id,
 'original',jsonb_build_object('supplier_id',c.supplier_id,'supplier_name',c.source_snapshot->>'supplier_name','amount_cents',c.amount_cents::text),
 '_evidence',jsonb_build_object('charge',to_jsonb(c),'commands',commands,'events',events));
end$$;
revoke all on function finance_private.unloading_origin_base(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.unloading_effective_origin(t uuid,charge uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base jsonb;original jsonb;current_state jsonb;rev text;history jsonb:='[]';effects jsonb;item finance_private.unloading_origin_amendments%rowtype;
 previous uuid;position integer:=0;valid boolean;issue text;last_day date;result jsonb;
begin
 base:=finance_private.unloading_origin_base(t,charge);
 original:=jsonb_build_object('supplier_id',base#>'{original,supplier_id}','supplier_name',base#>'{original,supplier_name}','amount_cents',base#>'{original,amount_cents}','status','active');
 current_state:=original;valid:=base->>'origin_verified'='true';
 if valid is distinct from true then issue:='unloading_origin_unverified';end if;
 rev:=md5(jsonb_build_object('charge',base#>'{_evidence,charge}','commands',base#>'{_evidence,commands}','events',base#>'{_evidence,events}')::text);
 last_day:=(base#>>'{_evidence,charge,occurred_on}')::date;
 for item in select * from finance_private.unloading_origin_amendments where tenant_id=t and charge_id=charge order by ordinal loop
  position:=position+1;
  if item.ordinal<>position or item.previous_id is distinct from previous or item.revision_before<>rev or item.before_state<>current_state
   or item.receivable_id::text is distinct from base->>'receivable_id' or current_state->>'status'<>'active' or item.effective_on<last_day
   or not exists(select 1 from public.finance_commands c where c.tenant_id=t and c.request_id=item.request_id and c.actor_id=item.actor_id and c.action='correct_unloading_origin' and c.result->>'amendment_id'=item.id::text and c.payload->>'charge_id'=charge::text)
   or not exists(select 1 from public.finance_events e where e.tenant_id=t and e.entity_type='unloading' and e.entity_id=charge and e.actor_id=item.actor_id and e.action='unloading_origin_corrected' and e.after_data->>'amendment_id'=item.id::text and e.before_data=item.before_state and e.after_data->'effective'=item.after_state)
   or item.after_state->>'status' is distinct from (case when item.operation='cancel_origin' then 'cancelled' else 'active' end)
   or jsonb_typeof(item.after_state) is distinct from 'object' or not(item.after_state ?& array['supplier_id','supplier_name','amount_cents','status'])
   or exists(select 1 from jsonb_object_keys(item.after_state) k where k<>all(array['supplier_id','supplier_name','amount_cents','status']))
   or coalesce(item.after_state->>'supplier_id','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or (item.operation='amend_origin' and (coalesce(item.after_state->>'amount_cents','')!~'^[1-9][0-9]{0,13}$' or item.after_state=item.before_state))
   or (item.operation='cancel_origin' and (item.after_state->>'amount_cents' is distinct from '0' or item.after_state->'supplier_id' is distinct from item.before_state->'supplier_id'))
  then valid:=false;issue:='unloading_amendment_chain_invalid';end if;
  effects:=jsonb_build_array(jsonb_build_object('leg','release','supplier_id',item.before_state->'supplier_id','supplier_name',item.before_state->'supplier_name','amount_cents','-'||(item.before_state->>'amount_cents')));
  if item.operation='amend_origin' then effects:=effects||jsonb_build_array(jsonb_build_object('leg','recognize','supplier_id',item.after_state->'supplier_id','supplier_name',item.after_state->'supplier_name','amount_cents',item.after_state->>'amount_cents'));end if;
  rev:=md5(jsonb_build_object('previous',rev,'event',to_jsonb(item))::text);
  history:=history||jsonb_build_array(jsonb_build_object('revision_after',rev,'id',item.id,'previous_id',item.previous_id,'ordinal',item.ordinal,'operation',item.operation,'effective_on',item.effective_on,'created_at',item.created_at,'actor_id',item.actor_id,'actor_name',item.actor_name,'reason',item.reason,'before',item.before_state,'after',item.after_state,'economic_effects',effects));
  current_state:=item.after_state;previous:=item.id;last_day:=item.effective_on;
 end loop;
 result:=jsonb_build_object('version',1,'tenant_id',t,'charge_id',charge,'receivable_id',base->'receivable_id','verified',coalesce(valid,false),'issue',issue,'original',original,'effective',case when valid then current_state end,'revision',rev,'history',history,'last_effective_on',last_day);
 return result;
end$$;
revoke all on function finance_private.unloading_effective_origin(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.unloading_origin_correction_context(t uuid,charge uuid,proposal jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base jsonb;origin jsonb;target jsonb;blockers jsonb;result jsonb;client_name text;target_id uuid;amount text;day date;r jsonb;
begin
 base:=finance_private.unloading_projection_repair_context(t,charge);origin:=finance_private.unloading_effective_origin(t,charge);
 if jsonb_typeof(proposal) is distinct from 'object' or coalesce(proposal->>'operation','') not in('amend_origin','cancel_origin') or proposal->'collection_right_only' is distinct from 'true'::jsonb
  or coalesce(proposal->>'effective_on','')!~'^\d{4}-\d{2}-\d{2}$'
  or exists(select 1 from jsonb_object_keys(proposal) k where k<>all(array['operation','supplier_id','amount_cents','effective_on','collection_right_only'])) then raise exception 'finance_unloading_invalid_correction' using errcode='22023';end if;
 day:=(proposal->>'effective_on')::date;
 select coalesce(jsonb_agg(x),'[]') into blockers from jsonb_array_elements(base->'blockers') x where x->>'code' not in('unloading_projection_already_matches','unloading_origin_has_amendments');
 if origin->>'verified' is distinct from 'true' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_origin_unverified','source_table','finance_unloading_charges','source_ids',jsonb_build_array(charge)));end if;
 if origin#>>'{effective,status}' is distinct from 'active' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_origin_not_active','source_table','finance_unloading_charges','source_ids',jsonb_build_array(charge)));end if;
 r:=base#>'{_evidence,receivable}';
 if r->>'client_id' is distinct from origin#>>'{effective,supplier_id}' or finance_private.unloading_repair_cents(r->'amount') is distinct from origin#>>'{effective,amount_cents}' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_projection_requires_repair','source_table','receivables','source_ids',jsonb_build_array(base->'receivable_id')));end if;
 if day<(origin->>'last_effective_on')::date or day>(clock_timestamp() at time zone 'America/Sao_Paulo')::date then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_correction_date_invalid','source_table','finance_unloading_charges','source_ids',jsonb_build_array(charge)));end if;
 if proposal->>'operation'='amend_origin' then
  target_id:=nullif(proposal->>'supplier_id','')::uuid;amount:=proposal->>'amount_cents';
  if target_id is null or coalesce(amount,'')!~'^[1-9][0-9]{0,13}$' then raise exception 'finance_unloading_invalid_correction' using errcode='22023';end if;
  select company_name into client_name from public.clients where tenant_id=t and id=target_id and active;
  if not found then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_supplier_unavailable','source_table','clients','source_ids',jsonb_build_array(target_id)));end if;
  target:=jsonb_build_object('supplier_id',target_id,'supplier_name',client_name,'amount_cents',amount,'status','active');
  if target=origin->'effective' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_correction_no_change','source_table','finance_unloading_charges','source_ids',jsonb_build_array(charge)));end if;
 else
  if proposal ? 'supplier_id' or proposal ? 'amount_cents' then raise exception 'finance_unloading_invalid_correction' using errcode='22023';end if;
  target:=(origin->'effective')||jsonb_build_object('amount_cents','0','status','cancelled');
 end if;
 begin
  perform finance_private.assert_closed_source_mutable(t,'receivables',r,0);
  perform finance_private.assert_closed_source_mutable(t,'receivables',r||jsonb_build_object('client_id',target->'supplier_id','amount',case when proposal->>'operation'='cancel_origin' then (r->>'amount')::numeric else (target->>'amount_cents')::numeric/100 end,'status',case when proposal->>'operation'='cancel_origin' then 'cancelled' else 'pending' end),0);
 exception when sqlstate '55000' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','unloading_closed_dependency','source_table','receivables','source_ids',jsonb_build_array(base->'receivable_id')));end;
 result:=jsonb_build_object('version',1,'tenant_id',t,'actor_id',auth.uid(),'charge_id',charge,'receivable_id',base->'receivable_id','original',origin->'original','effective',origin->'effective','proposal',proposal,'target',target,'history',origin->'history','dependencies',base->'dependencies','blockers',blockers,'eligible',jsonb_array_length(blockers)=0,'can_correct',finance_private.can_repair_unloading(t),'can_execute',false,'effects',jsonb_build_object('computation','prospective_origin_correction','cash_changed',false,'cost_changed',false,'payable_changed',false,'receivable_changed',true),'origin_revision',origin->'revision','_evidence',base->'_evidence');
 return result||jsonb_build_object('revision',md5(result::text));
end$$;
revoke all on function finance_private.unloading_origin_correction_context(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create table finance_private.unloading_origin_tickets(
 transaction_id bigint not null,tenant_id uuid not null,charge_id uuid not null,receivable_id uuid not null,request_id uuid not null,actor_id uuid not null,
 revision text not null,proposal jsonb not null,before_data jsonb not null,after_data jsonb not null,
 primary key(transaction_id,tenant_id,receivable_id)
);
revoke all on finance_private.unloading_origin_tickets from public,anon,authenticated,service_role;
create function finance_private.consume_unloading_origin_ticket(before_row jsonb,after_row jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare ticket finance_private.unloading_origin_tickets%rowtype;context jsonb;
begin
 if not finance_private.can_repair_unloading((before_row->>'tenant_id')::uuid) then return false;end if;
 select * into ticket from finance_private.unloading_origin_tickets where transaction_id=txid_current() and tenant_id=(before_row->>'tenant_id')::uuid and receivable_id=(before_row->>'id')::uuid and actor_id=auth.uid() and before_data=before_row and after_data=after_row;
 if not found then return false;end if;
 context:=finance_private.unloading_origin_correction_context(ticket.tenant_id,ticket.charge_id,ticket.proposal);
 if context->>'revision' is distinct from ticket.revision or context->>'eligible' is distinct from 'true' then return false;end if;
 if (before_row-array['client_id','amount','status','updated_by','updated_at']) is distinct from (after_row-array['client_id','amount','status','updated_by','updated_at']) then return false;end if;
 delete from finance_private.unloading_origin_tickets where transaction_id=ticket.transaction_id and tenant_id=ticket.tenant_id and receivable_id=ticket.receivable_id;
 return true;
end$$;
revoke all on function finance_private.consume_unloading_origin_ticket(jsonb,jsonb) from public,anon,authenticated,service_role;

create function finance_private.correct_unloading_origin(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid:=(payload->>'tenant_id')::uuid;charge uuid:=(payload->>'charge_id')::uuid;req uuid:=(payload->>'request_id')::uuid;actor uuid:=auth.uid();
 proposal jsonb:=payload->'proposal';context jsonb;before_row jsonb;after_row jsonb;c public.finance_unloading_charges%rowtype;prior finance_private.unloading_origin_amendments%rowtype;
 existing public.finance_commands%rowtype;amendment uuid;result jsonb;actor_name text;next_amount numeric;next_status text;
begin
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if jsonb_typeof(payload) is distinct from 'object' or payload->'version' is distinct from '1'::jsonb or charge is null or req is null or nullif(payload->>'revision','') is null or length(btrim(coalesce(payload->>'reason',''))) not between 10 and 2000
 or exists(select 1 from jsonb_object_keys(payload) k where k<>all(array['version','tenant_id','charge_id','request_id','revision','proposal','reason'])) then raise exception 'finance_unloading_invalid_correction' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor order by role::text for share nowait;
 perform 1 from public.drivers where tenant_id=t and user_id=actor order by id for share nowait;
 if not finance_private.can_repair_unloading(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into existing from public.finance_commands where tenant_id=t and request_id=req;
 if found then if existing.actor_id<>actor or existing.action<>'correct_unloading_origin' or existing.payload<>payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return existing.result;end if;
 select * into c from public.finance_unloading_charges where tenant_id=t and id=charge for update;
 if not found then raise exception 'finance_unloading_not_found' using errcode='22023';end if;
 perform public._lock_receivable_financial_graph(t,c.receivable_id);
 perform 1 from public.clients where tenant_id=t and (id=c.supplier_id or id=nullif(proposal->>'supplier_id','')::uuid) order by id for share nowait;
 perform 1 from public.finance_expense_items where tenant_id=t and unloading_id=charge order by id for share nowait;
 perform 1 from public.payables p where tenant_id=t and exists(select 1 from public.finance_expense_items e where e.tenant_id=t and e.unloading_id=charge and e.payable_id=p.id) order by id for share nowait;
 context:=finance_private.unloading_origin_correction_context(t,charge,proposal);
 if context->>'revision' is distinct from payload->>'revision' then raise exception 'finance_unloading_correction_changed' using errcode='40001';end if;
 if context->>'eligible' is distinct from 'true' then raise exception 'finance_unloading_correction_blocked' using errcode='55000';end if;
 select to_jsonb(r) into before_row from public.receivables r where tenant_id=t and id=c.receivable_id;
 next_amount:=case when proposal->>'operation'='cancel_origin' then (before_row->>'amount')::numeric else (context#>>'{target,amount_cents}')::numeric/100 end;
 next_status:=case when proposal->>'operation'='cancel_origin' then 'cancelled' else 'pending' end;
 after_row:=to_jsonb(jsonb_populate_record(null::public.receivables,before_row||jsonb_build_object('client_id',context#>'{target,supplier_id}','amount',next_amount,'status',next_status,'updated_by',actor,'updated_at',clock_timestamp())));
 perform finance_private.assert_closed_source_mutable(t,'receivables',before_row,0);perform finance_private.assert_closed_source_mutable(t,'receivables',after_row,0);
 insert into finance_private.unloading_origin_tickets values(txid_current(),t,charge,c.receivable_id,req,actor,context->>'revision',proposal,before_row,after_row);
 update public.receivables set client_id=(context#>>'{target,supplier_id}')::uuid,amount=next_amount,status=next_status,updated_by=actor,updated_at=(after_row->>'updated_at')::timestamptz where tenant_id=t and id=c.receivable_id;
 if exists(select 1 from finance_private.unloading_origin_tickets where transaction_id=txid_current() and tenant_id=t and receivable_id=c.receivable_id) then raise exception 'finance_unloading_correction_ticket_unconsumed' using errcode='55000';end if;
 select * into prior from finance_private.unloading_origin_amendments where tenant_id=t and charge_id=charge order by ordinal desc limit 1;
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into actor_name from auth.users where id=actor;
 insert into finance_private.unloading_origin_amendments(tenant_id,charge_id,receivable_id,ordinal,previous_id,request_id,operation,revision_before,before_state,after_state,effective_on,actor_id,actor_name,reason,evidence)
 values(t,charge,c.receivable_id,coalesce(prior.ordinal,0)+1,prior.id,req,proposal->>'operation',context->>'origin_revision',context->'effective',context->'target',(proposal->>'effective_on')::date,actor,coalesce(actor_name,actor::text),btrim(payload->>'reason'),context) returning id into amendment;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(t,'unloading',charge,'unloading_origin_corrected',actor,coalesce(actor_name,actor::text),btrim(payload->>'reason'),context->'effective',jsonb_build_object('amendment_id',amendment,'effective',context->'target','cash_changed',false,'cost_changed',false,'payable_changed',false));
 result:=jsonb_build_object('version',1,'tenant_id',t,'actor_id',actor,'request_id',req,'charge_id',charge,'receivable_id',c.receivable_id,'amendment_id',amendment,'confirmed',true,'cash_changed',false,'cost_changed',false,'payable_changed',false);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,req,actor,'correct_unloading_origin',payload,result);
 if finance_private.unloading_effective_origin(t,charge)->>'verified' is distinct from 'true' then raise exception 'finance_unloading_chain_invalid' using errcode='55000';end if;
 return result;
exception when lock_not_available then raise exception 'finance_unloading_correction_busy' using errcode='40001';
end$$;
revoke all on function finance_private.correct_unloading_origin(jsonb) from public,anon,authenticated,service_role;
-- Existing direct-write guards remain; the ticket exempts only this exact authorized row transition.
do $guards$
declare body text;needle text;
begin
 body:=pg_get_functiondef('finance_private.guard_unloading_receivable_source()'::regprocedure);
 if position('finance_private.consume_unloading_repair_ticket(to_jsonb(old),to_jsonb(new))' in body)=0 or position('finance_private.consume_unloading_origin_ticket' in body)>0 then raise exception 'unloading_amendment_guard_contract_changed';end if;
 needle:='  if new.id is distinct from old.id';
 if position(needle in body)=0 then raise exception 'unloading_amendment_guard_contract_changed';end if;
 body:=replace(body,needle,'  if finance_private.consume_unloading_origin_ticket(to_jsonb(old),to_jsonb(new)) then return new;end if;'||E'\n'||needle);
 needle:=' if r.id is null or r.client_id is distinct from c.supplier_id';
 if position(needle in body)=0 then raise exception 'unloading_amendment_payment_contract_changed';end if;
 body:=replace(body,needle,$new$
 if tg_table_name='receivables_payments' then
  declare origin jsonb;begin
   origin:=finance_private.unloading_effective_origin(t,c.id);
   if origin->>'verified' is distinct from 'true' or origin#>>'{effective,status}' is distinct from 'active' then raise exception 'finance_unloading_source_mismatch' using errcode='55000';end if;
   c.supplier_id:=(origin#>>'{effective,supplier_id}')::uuid;c.amount_cents:=(origin#>>'{effective,amount_cents}')::bigint;
  end;
 end if;
$new$||needle);
 execute body;
 body:=pg_get_functiondef('finance_private.unloading_projection_repair_context(uuid,uuid)'::regprocedure);
 needle:=' return result||jsonb_build_object(''revision'',md5(result::text));';
 if position(needle in body)=0 then raise exception 'unloading_amendment_repair_contract_changed';end if;
 body:=replace(body,needle,$new$
 if exists(select 1 from finance_private.unloading_origin_amendments where tenant_id=_tenant and charge_id=_charge) then
  result:=result||jsonb_build_object('eligible',false,'blockers',(result->'blockers')||jsonb_build_array(jsonb_build_object('code','unloading_origin_has_amendments','source_table','finance_unloading_charges','source_ids',jsonb_build_array(_charge))));
 end if;
$new$||needle);
 execute body;
 body:=pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure);
 needle:='''unloading_projection_repaired'',';
 if position(needle in body)=0 then raise exception 'unloading_amendment_audit_contract_changed';end if;
 execute replace(body,needle,'''unloading_origin_corrected'','||needle);
end $guards$;

create or replace function finance_private.unloading_receivable_source_context(_tenant uuid,_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare c public.finance_unloading_charges%rowtype;r public.receivables%rowtype;origin jsonb;mismatch boolean;
begin
 select * into c from public.finance_unloading_charges where tenant_id=_tenant and receivable_id=_id;
 if not found then return jsonb_build_object('source_issue',null,'source_revision',null,'unloading_origin',null);end if;
 origin:=finance_private.unloading_effective_origin(_tenant,c.id);
 select * into r from public.receivables where tenant_id=_tenant and id=_id;
 mismatch:=origin->>'verified' is distinct from 'true' or r.id is null or r.client_id::text is distinct from origin#>>'{effective,supplier_id}' or finance_private.unloading_repair_cents(to_jsonb(r)->'amount') is distinct from origin#>>'{effective,amount_cents}'
  or r.client_invoice_id is not null or r.closing_report_id is not null or to_jsonb(r)->>'fiscal_document_id' is not null or to_jsonb(r)->>'cte_document_id' is not null or r.status in('cancelled','invoiced');
 return jsonb_build_object('source_issue',case when origin#>>'{effective,status}'='cancelled' then 'finance_unloading_origin_cancelled' when mismatch then 'finance_unloading_source_mismatch' end,
  'source_revision',md5(jsonb_build_object('origin',origin,'receivable',to_jsonb(r))::text),
  'unloading_origin',jsonb_build_object('version',1,'charge_id',c.id,'verified',origin->'verified','revision',origin->'revision','amendment_id',origin->'history'->-1->'id','effective',origin->'effective'));
end$$;
create function finance_private.guard_unloading_amendment_identity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.finance_unloading_charges c where c.id=new.charge_id and c.tenant_id=new.tenant_id and c.receivable_id=new.receivable_id) then raise exception 'unloading_amendment_identity_invalid' using errcode='23514';end if;
 return new;
end$$;
create trigger unloading_amendment_identity before insert on finance_private.unloading_origin_amendments for each row execute function finance_private.guard_unloading_amendment_identity();
create function finance_private.validate_unloading_amendment_chain() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if finance_private.unloading_effective_origin(new.tenant_id,new.charge_id)->>'verified' is distinct from 'true' then raise exception 'unloading_amendment_chain_invalid' using errcode='23514';end if;
 return null;
end$$;
create constraint trigger unloading_amendment_chain_valid after insert on finance_private.unloading_origin_amendments deferrable initially deferred for each row execute function finance_private.validate_unloading_amendment_chain();
revoke all on function finance_private.guard_unloading_amendment_identity(),finance_private.validate_unloading_amendment_chain() from public,anon,authenticated,service_role;
