-- Private implementation first. Application execution is a separate release gate.
-- This corrects recorded money only; it does not execute a bank transaction.
create table finance_private.movement_void_write_tickets(
 transaction_id bigint not null,tenant_id uuid not null,movement_id uuid not null,
 request_id uuid not null,actor_id uuid not null,revision text not null,
 primary key(transaction_id,tenant_id,movement_id,request_id)
);
revoke all on finance_private.movement_void_write_tickets from public,anon,authenticated,service_role;

create function finance_private.guard_manual_movement_void() returns trigger
language plpgsql security definer set search_path='' as $$
declare context jsonb;begin
 if not finance_private.can_access(new.tenant_id) or new.actor_id is distinct from auth.uid() then raise exception 'finance_access_denied' using errcode='42501';end if;
 if not pg_try_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0)) then raise exception 'finance_movement_correction_busy' using errcode='40001';end if;
 if not finance_private.can_access(new.tenant_id) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if new.kind<>'void' or new.duplicate_of_movement_id is not null or new.replacement_movement_id is not null then raise exception 'finance_movement_correction_kind_not_supported' using errcode='23514';end if;
 delete from finance_private.movement_void_write_tickets where transaction_id=txid_current() and tenant_id=new.tenant_id and movement_id=new.movement_id and request_id=new.request_id and actor_id=new.actor_id and revision=new.revision;
 if not found then raise exception 'finance_movement_correction_command_required' using errcode='42501';end if;
 context:=finance_private.movement_correction_context(new.tenant_id,new.movement_id);
 if context->>'revision' is distinct from new.revision or context is distinct from new.source_snapshot then raise exception 'finance_movement_correction_changed' using errcode='40001';end if;
 if context->'eligible' is distinct from 'true'::jsonb or context#>>'{origin,original_request_id}' is distinct from new.original_request_id::text then raise exception 'finance_movement_correction_blocked' using errcode='23514';end if;
 return new;
end$$;
revoke all on function finance_private.guard_manual_movement_void() from public,anon,authenticated,service_role;
create trigger finance_manual_movement_void_command before insert on public.finance_movement_voids
 for each row execute function finance_private.guard_manual_movement_void();

-- Prevent new direct polymorphic references to a movement after invalidation.
-- Existing allocation/payment/link guards continue covering their own domains.
create function finance_private.guard_voided_movement_source() returns trigger
language plpgsql security definer set search_path='' as $$
declare row_data jsonb;states jsonb:=jsonb_build_array(to_jsonb(new));t uuid;movement uuid;field_name text;fields text[];begin
 if tg_op='UPDATE' then states:=jsonb_build_array(to_jsonb(old))||states;end if;
 for row_data in select value from jsonb_array_elements(states) loop
  if tg_table_name='finance_internal_transfers' then fields:=array['outgoing_id','incoming_id'];
  elsif tg_table_name='finance_transfer_departures' then fields:=array['outgoing_id'];
  elsif row_data->>'source_table'='finance_movements' then fields:=array['source_id'];
  else continue;end if;
  t:=(row_data->>'tenant_id')::uuid;
  perform finance_private.lock_active_movement_use(t);
  foreach field_name in array fields loop
   movement:=(row_data->>field_name)::uuid;
   if movement is null then raise exception 'finance_movement_reference_invalid' using errcode='23514';end if;
   perform finance_private.assert_active_movement_reference(t,movement);
  end loop;
 end loop;
 return new;
end$$;
revoke all on function finance_private.guard_voided_movement_source() from public,anon,authenticated,service_role;
do $$declare table_name text;begin
 foreach table_name in array array['payables','financial_obligations','payroll_entry_items','driver_settlement_items','finance_internal_transfers','finance_transfer_departures'] loop
 execute format('create trigger finance_active_movement_source before insert or update on public.%I for each row execute function finance_private.guard_voided_movement_source()',table_name);
 end loop;
end$$;

create function finance_private.void_manual_movement(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;movement uuid;actor uuid:=auth.uid();actor_name text;
 prior public.finance_commands%rowtype;m public.finance_movements%rowtype;
 context jsonb;result jsonb;correction public.finance_movement_voids%rowtype;begin
 if jsonb_typeof(_payload) is distinct from 'object' or _payload->'version' is distinct from '1'::jsonb
  or jsonb_typeof(_payload->'reason') is distinct from 'string' or length(btrim(_payload->>'reason')) not between 10 and 2000
  or coalesce(_payload->>'revision','') !~ '^[0-9a-f]{32}$'
  or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','movement_id','revision','reason'))
 then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=finance_private.movement_origin_uuid(_payload->>'tenant_id');request:=finance_private.movement_origin_uuid(_payload->>'request_id');movement:=finance_private.movement_origin_uuid(_payload->>'movement_id');
 if t is null or request is null or movement is null then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if prior.actor_id is distinct from actor or prior.action is distinct from 'void_manual_movement' or prior.payload is distinct from _payload then raise exception 'finance_request_conflict' using errcode='23505';end if;
  return prior.result;
 end if;
 -- Never wait while another legacy writer owns a dependency row.
 begin
  select * into m from public.finance_movements where tenant_id=t and id=movement for update nowait;
  if not found then raise exception 'finance_movement_not_found' using errcode='22023';end if;
  perform 1 from public.bank_accounts where tenant_id=t and id=m.bank_account_id for update nowait;
 exception when lock_not_available then raise exception 'finance_movement_correction_busy' using errcode='40001';end;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 -- Guard implementation and activation are mandatory even for the private command.
 if not exists(select 1 from finance_private.movement_void_command_baseline where snapshot=finance_private.movement_void_command_runtime_state()) then raise exception 'finance_movement_correction_runtime_not_ready' using errcode='23514';end if;
 if not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.finance_movement_voids'::regclass and tgname='finance_manual_movement_void_command' and tgfoid='finance_private.guard_manual_movement_void()'::regprocedure and tgenabled in('O','A') and tgtype=7 and tgqual is null and tgnargs=0)
 or exists(select 1 from unnest(array['payables','financial_obligations','payroll_entry_items','driver_settlement_items','finance_internal_transfers','finance_transfer_departures']) x where not exists(select 1 from pg_catalog.pg_trigger where tgrelid=to_regclass('public.'||x) and tgname='finance_active_movement_source' and tgfoid='finance_private.guard_voided_movement_source()'::regprocedure and tgenabled in('O','A') and tgtype=23 and tgqual is null and tgnargs=0))
 then raise exception 'finance_movement_correction_runtime_not_ready' using errcode='23514';end if;
 context:=finance_private.movement_correction_context(t,movement);
 if context->>'revision' is distinct from _payload->>'revision' then raise exception 'finance_movement_correction_changed' using errcode='40001';end if;
 if context->'eligible' is distinct from 'true'::jsonb then raise exception 'finance_movement_correction_blocked' using errcode='23514';end if;
 select coalesce(nullif(btrim(raw_user_meta_data->>'full_name'),''),email,actor::text) into actor_name from auth.users where id=actor;
 actor_name:=left(coalesce(actor_name,actor::text),300);
 insert into finance_private.movement_void_write_tickets values(txid_current(),t,movement,request,actor,context->>'revision');
 insert into public.finance_movement_voids(tenant_id,movement_id,original_request_id,request_id,kind,actor_id,actor_name,reason,revision,source_snapshot)
 values(t,movement,(context#>>'{origin,original_request_id}')::uuid,request,'void',actor,actor_name,btrim(_payload->>'reason'),context->>'revision',context) returning * into correction;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'movement_id',movement,'original_request_id',correction.original_request_id,'correction_id',correction.id,'kind','void','confirmed',true,'bank_money_transacted',false,'recorded_balance_changed',true,'effects',context->'effects','actor_id',actor,'actor_name',actor_name,'reason',correction.reason,'created_at',correction.created_at);
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(t,'movement',movement,'movement_voided',actor,actor_name,correction.reason,context,result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'void_manual_movement',_payload,result);
 return result;
end$$;
revoke all on function finance_private.void_manual_movement(jsonb) from public,anon,authenticated,service_role;

create function finance_private.movement_void_command_runtime_state() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,'body',pg_get_functiondef(p.oid),'acl',to_jsonb(p.proacl)) order by p.oid::regprocedure::text) from pg_catalog.pg_proc p where p.oid in('finance_private.guard_manual_movement_void()'::regprocedure,'finance_private.guard_voided_movement_source()'::regprocedure,'finance_private.void_manual_movement(jsonb)'::regprocedure,'finance_private.movement_void_command_runtime_state()'::regprocedure)),
 'triggers',(select jsonb_agg(jsonb_build_object('table',tgrelid::regclass::text,'definition',pg_get_triggerdef(oid),'enabled',tgenabled) order by tgrelid::regclass::text,tgname) from pg_catalog.pg_trigger where tgname in('finance_manual_movement_void_command','finance_active_movement_source')),
 'ticket_acl',(select to_jsonb(relacl) from pg_catalog.pg_class where oid='finance_private.movement_void_write_tickets'::regclass))
$$;
revoke all on function finance_private.movement_void_command_runtime_state() from public,anon,authenticated,service_role;
create table finance_private.movement_void_command_baseline(singleton boolean primary key default true check(singleton),snapshot jsonb not null);
revoke all on finance_private.movement_void_command_baseline from public,anon,authenticated,service_role;
insert into finance_private.movement_void_command_baseline(snapshot) values(finance_private.movement_void_command_runtime_state());
create trigger preserve_movement_void_command_baseline before update or delete on finance_private.movement_void_command_baseline for each row execute function finance_private.preserve_event();
-- Snapshot detects subsequent drift. Integrated release testing is still required.

-- Manual invalidation remains discoverable through the manual-only audit filter.
do $$declare definition text;needle text:='''identity_reviewed_manually'',''identity_review_reversed''';begin
 definition:=pg_get_functiondef('finance_private.audit_events(uuid,jsonb)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'finance_movement_void_audit_contract_changed';end if;
 execute replace(definition,needle,'''movement_voided'','||needle);
end$$;
