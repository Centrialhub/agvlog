-- Forward candidate: audited adjustment add/remove, no payment or fiscal action.
set local lock_timeout='3s';set local statement_timeout='30s';
do $preflight$ begin
 if to_regnamespace('expense_creation_private') is null or to_regclass('public.driver_settlement_adjustments') is not null then
  raise exception 'Adjustment release requires the MFA expense contract and an unapplied migration';end if;
end;$preflight$;
do $dependencies$ declare c record;begin
 for c in select * from(values ('public._build_driver_settlement(uuid,uuid)','0732d29f716ed074b9b215aff7569d03'),
('public._log_settlement_event(uuid,text,text,text,text,jsonb)','66b50396ce538929df80295c80446070'),
('public.is_tenant_operator_or_admin(uuid)','1345468a366a7b0b9ae62d3ec4825232'),
('public._delivery_allocation_document(uuid)','344801e75094a3f40f58e8fdbf7e97cc'),
('public._delivery_trip_financial_documents(uuid,uuid)','02296239569087e967b277309579dc8a'),
('public._preserve_closing_creation()','7400244049ef090f7c38dbd0856d78f8'),
('public._build_manual_driver_settlement(uuid)','2281ee623376f032433e7761b20c4ca3'),
('public.add_driver_settlement_adjustment(uuid,text,numeric,text,text)','bce03457eeb9512e253b391c21c55b37'),
('public.remove_driver_settlement_adjustment(uuid,uuid,text)','81a8a845ee473e44ba1da16819e00b56')) expected(signature,hash) loop
  if md5(replace(pg_get_functiondef(to_regprocedure(c.signature)),E'\r\n',E'\n')) is distinct from c.hash then
   raise exception 'Settlement adjustment dependency changed: %',c.signature;end if;
 end loop;
end;$dependencies$;
create schema settlement_adjustment_private;
revoke all on schema settlement_adjustment_private from public,anon,authenticated,service_role;
grant usage on schema settlement_adjustment_private to authenticated;
create table public.driver_settlement_adjustments(
 id uuid primary key,tenant_id uuid not null,actor_id uuid not null,request_id uuid not null,settlement_id uuid not null,item_id uuid not null,
 action text not null check(action in('add','remove')),reason text not null,payload_hash text not null,
 before_snapshot jsonb not null,after_snapshot jsonb not null,response jsonb not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,actor_id,request_id),foreign key(tenant_id,settlement_id) references public.driver_settlements(tenant_id,id) on delete restrict
);
alter table public.driver_settlement_adjustments enable row level security;
revoke all on public.driver_settlement_adjustments from public,anon,authenticated,service_role;
grant select on public.driver_settlement_adjustments to authenticated;
create policy settlement_adjustment_internal_read on public.driver_settlement_adjustments for select to authenticated
 using(public.is_tenant_operator_or_admin(tenant_id));
create index settlement_adjustment_history_idx on public.driver_settlement_adjustments(tenant_id,settlement_id,created_at desc,id desc);
create trigger settlement_adjustment_append_only before update or delete on public.driver_settlement_adjustments
 for each row execute function public._preserve_closing_creation();

create function settlement_adjustment_private.authorize(_tenant uuid) returns void
language plpgsql stable security invoker set search_path='' as $fn$
declare v_role text;
begin
 if auth.uid() is null then raise exception 'settlement_adjustment_not_authorized' using errcode='42501';end if;
 select role::text into v_role from public.tenant_memberships where tenant_id=_tenant and user_id=auth.uid() and active;
 if v_role is null or v_role not in('owner','admin','operator') then raise exception 'settlement_adjustment_not_authorized' using errcode='42501';end if;
 if v_role in('owner','admin') and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception 'settlement_adjustment_mfa_required' using errcode='42501';end if;
end;$fn$;
revoke all on function settlement_adjustment_private.authorize(uuid) from public,anon,authenticated,service_role;

create function settlement_adjustment_private.cents(_amount numeric) returns bigint
language sql immutable security invoker set search_path='' as $fn$
 select case when _amount::text not in('NaN','Infinity','-Infinity') and abs(_amount)<=999999999999.99 and _amount=round(_amount,2) then (_amount*100)::bigint end;
$fn$;
revoke all on function settlement_adjustment_private.cents(numeric) from public,anon,authenticated,service_role;

create function settlement_adjustment_private.snapshot(_tenant uuid,_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $fn$
declare s public.driver_settlements%rowtype;v_evidence jsonb;v_items jsonb;v_bad boolean;v_result jsonb;
begin
 select * into s from public.driver_settlements where tenant_id=_tenant and id=_id;
 if not found then raise exception 'settlement_adjustment_not_found' using errcode='23514';end if;
 if not exists(select 1 from public.drivers where tenant_id=_tenant and id=s.driver_id) or
  (s.is_manual and s.dispatch_trip_id is not null) or (not s.is_manual and not exists(
   select 1 from public.dispatch_trips where tenant_id=_tenant and id=s.dispatch_trip_id and driver_id=s.driver_id)) or
  exists(select 1 from public.driver_settlement_items where settlement_id=_id and tenant_id<>_tenant) or
  exists(select 1 from public.driver_settlement_loads sl left join public.loads l on l.id=sl.load_id where sl.settlement_id=_id and (sl.tenant_id<>_tenant or l.tenant_id is distinct from _tenant)) then
   raise exception 'settlement_adjustment_source_scope' using errcode='23514';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'nature',x.nature,'amount_cents',settlement_adjustment_private.cents(x.amount),
  'description',x.description,'reason',x.metadata->>'reason','created_at',x.created_at) order by x.created_at,x.id),'[]'),
  coalesce(bool_or(x.nature is null or x.nature not in('credit','debit') or settlement_adjustment_private.cents(x.amount) is null or x.amount<=0),false)
 into v_items,v_bad from public.driver_settlement_items x where tenant_id=_tenant and settlement_id=_id and item_type='adjustment';
 v_evidence:=jsonb_build_object('settlement',to_jsonb(s),
  'items',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.driver_settlement_items x where tenant_id=_tenant and settlement_id=_id),'[]'),
  'payments',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.driver_settlement_payments x where tenant_id=_tenant and settlement_id=_id),'[]'),
  'expenses',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.driver_expenses x where tenant_id=_tenant and (dispatch_trip_id=s.dispatch_trip_id or manual_settlement_id=_id)),'[]'),
  'links',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.driver_settlement_loads x where settlement_id=_id),'[]'),
  'trip',(select to_jsonb(t) from public.dispatch_trips t where tenant_id=_tenant and id=s.dispatch_trip_id),
  'stops',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.dispatch_stops x where dispatch_trip_id=s.dispatch_trip_id),'[]'),
  'routes',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.trip_routes x where trip_id=s.dispatch_trip_id),'[]'),
  'loads',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.loads l where tenant_id=_tenant and (id in(select load_id from public.driver_settlement_loads where settlement_id=_id)
    or id in(select load_id from public.dispatch_trip_loads where dispatch_trip_id=s.dispatch_trip_id) or id=(select load_id from public.dispatch_trips where id=s.dispatch_trip_id))),'[]'),
  'documents',case when s.is_manual then coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from public.fiscal_documents d where tenant_id=_tenant and load_id in(select load_id from public.driver_settlement_loads where settlement_id=_id)),'[]')
   else coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from public._delivery_trip_financial_documents(_tenant,s.dispatch_trip_id) d),'[]') end);
 v_result:=jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'settlement_id',_id,'status',s.status,'is_manual',s.is_manual,
  'can_add',s.status in('pending_review','in_review','reopened') and not v_bad,
  'can_remove',s.status in('pending_review','in_review','reopened'),'requires_reconciliation',v_bad,'items',v_items,
  'totals',jsonb_build_object('credits_cents',settlement_adjustment_private.cents(s.driver_credits_total),'debits_cents',settlement_adjustment_private.cents(s.driver_debits_total),
    'payable_cents',settlement_adjustment_private.cents(s.driver_payable_amount),'paid_cents',settlement_adjustment_private.cents(s.total_paid_amount),'balance_cents',settlement_adjustment_private.cents(s.payment_balance)),
  'evidence',v_evidence);
 return v_result||jsonb_build_object('revision',md5(v_evidence::text));
end;$fn$;
revoke all on function settlement_adjustment_private.snapshot(uuid,uuid) from public,anon,authenticated,service_role;

create function settlement_adjustment_private.release_guard() returns void language plpgsql security invoker set search_path='' as $fn$
begin
 if not pg_try_advisory_xact_lock_shared(hashtext('settlement-adjustment-release'),1) then raise exception 'settlement_adjustment_release_busy' using errcode='40001';end if;
 if not has_function_privilege('authenticated','public.apply_driver_settlement_adjustment(jsonb)','execute') then
  raise exception 'settlement_adjustment_suspended' using errcode='55000';end if;
end;$fn$;
revoke all on function settlement_adjustment_private.release_guard() from public,anon,authenticated,service_role;

create function settlement_adjustment_private.context(_tenant_id uuid,_settlement_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $fn$
begin
 perform settlement_adjustment_private.authorize(_tenant_id);perform settlement_adjustment_private.release_guard();
 return settlement_adjustment_private.snapshot(_tenant_id,_settlement_id)-'evidence';
end;$fn$;
revoke all on function settlement_adjustment_private.context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function settlement_adjustment_private.context(uuid,uuid) to authenticated;
create function public.get_driver_settlement_adjustment_context(_tenant_id uuid,_settlement_id uuid) returns jsonb
language sql security invoker set search_path='' as $fn$select settlement_adjustment_private.context(_tenant_id,_settlement_id);$fn$;
revoke all on function public.get_driver_settlement_adjustment_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_driver_settlement_adjustment_context(uuid,uuid) to authenticated;
-- Lock only financial sources. Historical trips can retain loads/documents
-- from an earlier delivery attempt; operational replanning guards do not apply.
create function settlement_adjustment_private.lock_sources(_tenant uuid,_id uuid) returns void
language plpgsql security invoker set search_path='' as $fn$
declare s public.driver_settlements%rowtype;v_loads uuid[];v_docs uuid[];
begin
 select * into s from public.driver_settlements where tenant_id=_tenant and id=_id;
 if not found then raise exception 'settlement_adjustment_not_found' using errcode='23514';end if;
 perform 1 from public.dispatch_trips where id=s.dispatch_trip_id for update nowait;
 perform 1 from public.drivers where id=s.driver_id for share nowait;
 perform 1 from public.driver_settlements where id=_id for update nowait;
 if not exists(select 1 from public.driver_settlements x where x.id=_id and x.tenant_id=_tenant
  and x.dispatch_trip_id is not distinct from s.dispatch_trip_id and x.driver_id=s.driver_id and x.is_manual=s.is_manual) then
  raise exception 'settlement_adjustment_context_changed' using errcode='40001';end if;
 perform 1 from public.driver_settlement_loads where settlement_id=_id order by load_id,id for update nowait;
 perform 1 from public.dispatch_trip_loads where dispatch_trip_id=s.dispatch_trip_id order by load_id,id for update nowait;
 select coalesce(array_agg(distinct id),array[]::uuid[]) into v_loads from(
  select load_id id from public.driver_settlement_loads where settlement_id=_id
  union select load_id from public.dispatch_trip_loads where dispatch_trip_id=s.dispatch_trip_id
  union select load_id from public.dispatch_trips where id=s.dispatch_trip_id and load_id is not null) ids;
 perform 1 from public.loads where id=any(v_loads) order by id for update nowait;
 perform 1 from public.dispatch_stops where dispatch_trip_id=s.dispatch_trip_id order by id for update nowait;
 perform d.id from public.dispatch_stop_documents d join public.dispatch_stops t on t.id=d.dispatch_stop_id
  where t.dispatch_trip_id=s.dispatch_trip_id order by d.id for update of d nowait;
 select coalesce(array_agg(distinct id),array[]::uuid[]) into v_docs from(
  select id from public.fiscal_documents where load_id=any(v_loads)
  union select d.fiscal_document_id from public.dispatch_stop_documents d join public.dispatch_stops t on t.id=d.dispatch_stop_id where t.dispatch_trip_id=s.dispatch_trip_id) ids;
 perform 1 from public.fiscal_documents where id=any(v_docs) order by id for update nowait;
 perform 1 from public.delivery_attempts where fiscal_document_id=any(v_docs) order by id for share nowait;
 perform 1 from public.load_items where fiscal_document_id=any(v_docs) order by id for share nowait;
 perform 1 from public.trip_routes where trip_id=s.dispatch_trip_id order by id for share nowait;
 perform 1 from public.driver_expenses where dispatch_trip_id=s.dispatch_trip_id or manual_settlement_id=_id order by id for update nowait;
 perform 1 from public.driver_settlement_items where settlement_id=_id order by id for update nowait;
 perform 1 from public.driver_settlement_payments where settlement_id=_id order by id for update nowait;
 -- Every source used by either builder must belong to the same tenant.
 if exists(select 1 from public.loads where id=any(v_loads) and tenant_id<>_tenant)
  or exists(select 1 from public.fiscal_documents where id=any(v_docs) and tenant_id<>_tenant)
  or exists(select 1 from public.dispatch_trip_loads where dispatch_trip_id=s.dispatch_trip_id and tenant_id<>_tenant)
  or exists(select 1 from public.dispatch_stops where dispatch_trip_id=s.dispatch_trip_id and tenant_id<>_tenant)
  or exists(select 1 from public.dispatch_stop_documents d join public.dispatch_stops t on t.id=d.dispatch_stop_id where t.dispatch_trip_id=s.dispatch_trip_id and d.tenant_id<>_tenant)
  or exists(select 1 from public.driver_settlement_payments where settlement_id=_id and tenant_id<>_tenant)
  or exists(select 1 from public.driver_expenses where (dispatch_trip_id=s.dispatch_trip_id or manual_settlement_id=_id) and (tenant_id<>_tenant or driver_id is distinct from s.driver_id)) then
  raise exception 'settlement_adjustment_source_scope' using errcode='23514';end if;
end;$fn$;
revoke all on function settlement_adjustment_private.lock_sources(uuid,uuid) from public,anon,authenticated,service_role;

create function settlement_adjustment_private.apply(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='3s' as $fn$
declare v_tenant uuid;v_actor uuid:=auth.uid();v_request uuid;v_settlement uuid;v_item uuid;v_action text;v_amount numeric;
 v_hash text;v_before jsonb;v_after jsonb;v_response jsonb;v_id uuid:=gen_random_uuid();v_built uuid;s public.driver_settlements%rowtype;
 h public.driver_settlement_adjustments%rowtype;v_removed public.driver_settlement_items%rowtype;
begin
 if jsonb_typeof(_payload) is distinct from 'object' or octet_length(_payload::text)>15000
  or _payload->'version' is distinct from '1'::jsonb
  or not (_payload ?& array['tenant_id','actor_id','request_id','settlement_id','action','item_id','nature','amount_cents','description','reason','expected_revision'])
  or (_payload-array['version','tenant_id','actor_id','request_id','settlement_id','action','item_id','nature','amount_cents','description','reason','expected_revision'])<>'{}'::jsonb
  or exists(select 1 from jsonb_each(_payload) p where p.key in('tenant_id','actor_id','request_id','settlement_id','action','reason','expected_revision') and jsonb_typeof(p.value)<>'string') then
  raise exception 'settlement_adjustment_invalid_payload' using errcode='22023';end if;
 v_tenant:=(_payload->>'tenant_id')::uuid;v_request:=(_payload->>'request_id')::uuid;v_settlement:=(_payload->>'settlement_id')::uuid;
 perform settlement_adjustment_private.authorize(v_tenant);
 if v_actor is distinct from (_payload->>'actor_id')::uuid then raise exception 'settlement_adjustment_not_authorized' using errcode='42501';end if;
 v_action:=_payload->>'action';
 if v_action not in('add','remove') or length(btrim(_payload->>'reason')) not between 5 and 2000
  or (_payload->>'expected_revision')!~'^[a-f0-9]{32}$' then raise exception 'settlement_adjustment_invalid_payload' using errcode='22023';end if;
 if v_action='add' then
  if _payload->'item_id' is distinct from 'null'::jsonb or jsonb_typeof(_payload->'nature') is distinct from 'string' or (_payload->>'nature') not in('credit','debit')
   or jsonb_typeof(_payload->'description') is distinct from 'string' or length(btrim(_payload->>'description')) not between 1 and 500
   or jsonb_typeof(_payload->'amount_cents') is distinct from 'number' then raise exception 'settlement_adjustment_invalid_payload' using errcode='22023';end if;
  v_amount:=(_payload->>'amount_cents')::numeric;
  if v_amount<1 or v_amount>99999999999999 or trunc(v_amount)<>v_amount then raise exception 'settlement_adjustment_invalid_amount' using errcode='22023';end if;
 else
  if jsonb_typeof(_payload->'item_id') is distinct from 'string' or _payload->'nature' is distinct from 'null'::jsonb
   or _payload->'amount_cents' is distinct from 'null'::jsonb or _payload->'description' is distinct from 'null'::jsonb then raise exception 'settlement_adjustment_invalid_payload' using errcode='22023';end if;
  v_item:=(_payload->>'item_id')::uuid;
 end if;
 perform settlement_adjustment_private.release_guard();
 v_hash:=encode(sha256(convert_to(_payload::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext('driver-settlement-adjustment'),hashtext(v_tenant::text||':'||v_actor::text||':'||v_request::text));
 perform 1 from public.tenant_memberships where tenant_id=v_tenant and user_id=v_actor and active for share nowait;
 if not found then raise exception 'settlement_adjustment_not_authorized' using errcode='42501';end if;
 perform settlement_adjustment_private.authorize(v_tenant);
 select * into h from public.driver_settlement_adjustments where tenant_id=v_tenant and actor_id=v_actor and request_id=v_request;
 if found then
  if h.payload_hash<>v_hash then raise exception 'settlement_adjustment_key_mismatch' using errcode='22023';end if;
  return h.response;
 end if;
 perform settlement_adjustment_private.lock_sources(v_tenant,v_settlement);
 v_before:=settlement_adjustment_private.snapshot(v_tenant,v_settlement);
 if v_before->>'revision' is distinct from _payload->>'expected_revision' then raise exception 'settlement_adjustment_context_changed' using errcode='40001';end if;
 if (v_before->>'can_remove')::boolean is distinct from true then raise exception 'settlement_adjustment_locked' using errcode='23514';end if;
 if v_action='add' and (v_before->>'requires_reconciliation')::boolean then raise exception 'settlement_adjustment_requires_reconciliation' using errcode='23514';end if;
 select * into strict s from public.driver_settlements where tenant_id=v_tenant and id=v_settlement;
 if v_action='add' then
  v_item:=gen_random_uuid();
  insert into public.driver_settlement_items(id,tenant_id,settlement_id,item_type,nature,amount,description,metadata)
   values(v_item,v_tenant,v_settlement,'adjustment',_payload->>'nature',v_amount/100,btrim(_payload->>'description'),
    jsonb_build_object('reason',btrim(_payload->>'reason'),'command_id',v_id,'created_by',v_actor));
 else
  delete from public.driver_settlement_items where id=v_item and tenant_id=v_tenant and settlement_id=v_settlement and item_type='adjustment' returning * into v_removed;
  if not found then raise exception 'settlement_adjustment_item_not_found' using errcode='23514';end if;
 end if;
 -- Invalid historical values cannot be fed back into the financial builder.
 if exists(select 1 from public.driver_settlement_items x where settlement_id=v_settlement and item_type='adjustment'
  and (nature is null or nature not in('credit','debit') or settlement_adjustment_private.cents(amount) is null or amount<=0)) then
  raise exception 'settlement_adjustment_requires_reconciliation' using errcode='23514';end if;
 if s.is_manual then v_built:=public._build_manual_driver_settlement(v_settlement);
 else v_built:=public._build_driver_settlement(v_tenant,s.dispatch_trip_id);end if;
 if v_built is distinct from v_settlement then raise exception 'settlement_adjustment_source_scope' using errcode='23514';end if;
 v_after:=settlement_adjustment_private.snapshot(v_tenant,v_settlement);
 if exists(select 1 from jsonb_each(v_after->'totals') t where t.value='null'::jsonb) then
  raise exception 'settlement_adjustment_requires_reconciliation' using errcode='23514';end if;
 v_response:=jsonb_build_object('version',1,'tenant_id',v_tenant,'actor_id',v_actor,'request_id',v_request,'settlement_id',v_settlement,
  'command_id',v_id,'item_id',v_item,'action',v_action,'confirmed',true,'revision',v_after->>'revision');
 insert into public.driver_settlement_adjustments(id,tenant_id,actor_id,request_id,settlement_id,item_id,action,reason,payload_hash,before_snapshot,after_snapshot,response)
  values(v_id,v_tenant,v_actor,v_request,v_settlement,v_item,v_action,btrim(_payload->>'reason'),v_hash,v_before,v_after,v_response);
 perform public._log_settlement_event(v_settlement,case when v_action='add' then 'adjustment_added' else 'adjustment_removed' end,
  s.status,v_after->>'status',btrim(_payload->>'reason'),jsonb_build_object('command_id',v_id,'item_id',v_item,'removed_item',to_jsonb(v_removed),'totals',v_after->'totals'));
 return v_response;
end;$fn$;
revoke all on function settlement_adjustment_private.apply(jsonb) from public,anon,authenticated,service_role;
grant execute on function settlement_adjustment_private.apply(jsonb) to authenticated;
create function public.apply_driver_settlement_adjustment(_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $fn$select settlement_adjustment_private.apply(_payload);$fn$;
revoke all on function public.apply_driver_settlement_adjustment(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.apply_driver_settlement_adjustment(jsonb) to authenticated;
revoke all on function public.add_driver_settlement_adjustment(uuid,text,numeric,text,text),public.remove_driver_settlement_adjustment(uuid,uuid,text) from public,anon,authenticated,service_role;
-- Browser clients read statement items; writers go through checked RPCs.
revoke insert,update,delete,truncate,references,trigger on public.driver_settlement_items from public,anon,authenticated;
