-- Private recorded refund: links existing outgoing money; no bank transaction is created.
set local lock_timeout='3s';set local statement_timeout='30s';
do $preflight$declare x record;p record;body text;needle text;begin
 for x in select * from(values
 ('finance_private.customer_credit_position(uuid,uuid)','9c7f511f9f20852086366abba5b2b56b','customer_credit_position_before_refunds'),
 ('finance_private.movement_used_cents(uuid,uuid)','cc216802448c49d665d2b5d2e2335415','movement_used_before_customer_refunds'),
 ('finance_private.movement_recording_origin(uuid,uuid)','fa6f51930c05baed7362e3a6fa40a99f','customer_refund_movement_origin'))s(signature,hash,alias) loop
  select * into p from pg_proc where oid=to_regprocedure(x.signature);
  if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from x.hash or not p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee<>p.proowner) then raise exception 'finance_credit_refund_predecessor_changed: %',x.signature using errcode='55000';end if;
  body:=pg_get_functiondef(p.oid);body:=replace(body,'FUNCTION finance_private.'||p.proname||'(','FUNCTION finance_private.'||x.alias||'(');
  if p.proname='movement_recording_origin' then
   needle:='if not finance_private.can_access(_tenant) then raise exception ''finance_access_denied'' using errcode=''42501'';end if;';
   if (length(body)-length(replace(body,needle,'')))/length(needle)<>1 then raise exception 'finance_credit_refund_proof_contract_changed';end if;body:=replace(body,needle,'');
  end if;execute body;
 end loop;
end$preflight$;
revoke all on function finance_private.customer_credit_position_before_refunds(uuid,uuid),finance_private.movement_used_before_customer_refunds(uuid,uuid),finance_private.customer_refund_movement_origin(uuid,uuid) from public,anon,authenticated,service_role;
create table finance_private.customer_credit_refunds(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),credit_id uuid not null references public.finance_customer_credits(id),payer_id uuid not null references public.clients(id),outgoing_movement_id uuid not null,
 amount_cents bigint not null check(amount_cents between 1 and 99999999999999),request_id uuid not null,actor_id uuid not null,actor_name text not null,reason text not null check(length(btrim(reason)) between 5 and 2000),source_snapshot jsonb not null,payload_hash text not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,request_id),foreign key(tenant_id,outgoing_movement_id) references public.finance_movements(tenant_id,id)
);
alter table finance_private.customer_credit_refunds enable row level security;revoke all on finance_private.customer_credit_refunds from public,anon,authenticated,service_role;
create index customer_credit_refunds_credit on finance_private.customer_credit_refunds(tenant_id,credit_id,id);
create index customer_credit_refunds_movement on finance_private.customer_credit_refunds(tenant_id,outgoing_movement_id,id);
create trigger preserve_customer_credit_refund before update or delete on finance_private.customer_credit_refunds for each row execute function finance_private.preserve_event();
create function finance_private.customer_refund_document(_document text) returns text language sql immutable strict security invoker set search_path='' as $$
 select case when _document~'^[0-9./ -]+$' and length(regexp_replace(_document,'[^0-9]','','g')) in(11,14) then regexp_replace(_document,'[^0-9]','','g') end;
$$;
revoke all on function finance_private.customer_refund_document(text) from public,anon,authenticated,service_role;
create or replace function finance_private.movement_used_cents(_tenant uuid,_movement uuid) returns numeric language sql stable security definer set search_path='' as $$
 select finance_private.movement_used_before_customer_refunds(_tenant,_movement)+coalesce((select sum(amount_cents) from finance_private.customer_credit_refunds where tenant_id=_tenant and outgoing_movement_id=_movement),0);
$$;
revoke all on function finance_private.movement_used_cents(uuid,uuid) from public,anon,authenticated,service_role;
create or replace function finance_private.customer_credit_position(_tenant uuid,_credit uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb;r finance_private.customer_credit_refunds%rowtype;m public.finance_movements%rowtype;proof jsonb;valid boolean;returned numeric:=0;history jsonb:='[]';begin
 base:=finance_private.customer_credit_position_before_refunds(_tenant,_credit);valid:=base->'valid'='true'::jsonb;
 for r in select * from finance_private.customer_credit_refunds where tenant_id=_tenant and credit_id=_credit order by created_at,id loop
  select * into m from public.finance_movements where tenant_id=_tenant and id=r.outgoing_movement_id;
  if m.id is null then valid:=false;else
   proof:=finance_private.customer_refund_movement_origin(_tenant,m.id);
   if proof->'verified' is distinct from 'true'::jsonb or proof->>'revision' is distinct from r.source_snapshot#>>'{movement_origin,revision}' or to_jsonb(m) is distinct from r.source_snapshot->'movement' or not exists(select 1 from finance_private.active_movements where tenant_id=_tenant and id=m.id) or finance_private.movement_used_cents(_tenant,m.id)>m.amount_cents then valid:=false;end if;
  end if;
  if r.payer_id::text is distinct from base->>'payer_id' or r.source_snapshot->>'binding_revision' is distinct from base->>'binding_revision' or not exists(select 1 from public.finance_events e where e.tenant_id=_tenant and e.entity_type='customer_credit' and e.entity_id=_credit and e.action='customer_credit_refunded' and e.actor_id=r.actor_id and e.after_data=r.result) then valid:=false;end if;
  returned:=returned+r.amount_cents;history:=history||jsonb_build_array(to_jsonb(r));
 end loop;
 if coalesce((base->>'available_cents')::numeric,-1)<returned then valid:=false;end if;
 return base||jsonb_build_object('valid',coalesce(valid,false),'applied_cents',case when valid then base->>'applied_cents' end,'returned_cents',case when valid then returned::text end,'available_cents',case when valid then ((base->>'available_cents')::numeric-returned)::text end,'refund_history',history,'revision',md5(jsonb_build_object('base',base->'revision','refunds',history)::text));
end$$;
revoke all on function finance_private.customer_credit_position(uuid,uuid) from public,anon,authenticated,service_role;
create function finance_private.customer_credit_refund_context(_tenant uuid,_credit uuid,_movement uuid,_amount text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare credit jsonb;m public.finance_movements%rowtype;p public.clients%rowtype;proof jsonb;doc text;fiscal_doc text;matches integer;used numeric;amount bigint;blockers jsonb:='[]';result jsonb;begin
 perform finance_private.require_access(_tenant);if _amount is null or _amount!~'^[1-9][0-9]{0,13}$' then raise exception 'finance_credit_refund_amount_invalid' using errcode='22023';end if;amount:=_amount::bigint;
 credit:=finance_private.customer_credit_position(_tenant,_credit);select * into m from public.finance_movements where tenant_id=_tenant and id=_movement;
 if not found then raise exception 'finance_credit_refund_movement_missing' using errcode='22023';end if;
 select * into p from public.clients where tenant_id=_tenant and id=(credit->>'payer_id')::uuid;if not found then raise exception 'finance_credit_refund_payer_missing' using errcode='22023';end if;
 select origin.basis->>'payer_document' into fiscal_doc from public.finance_customer_credits c join public.finance_fiscal_receivable_origins origin on origin.tenant_id=c.tenant_id and origin.id=c.origin_id where c.tenant_id=_tenant and c.id=_credit;doc:=finance_private.customer_refund_document(p.tax_id);select count(*) into matches from public.clients where tenant_id=_tenant and finance_private.customer_refund_document(tax_id)=doc;
 if doc is null or matches<>1 or finance_private.customer_refund_document(m.beneficiary_document) is distinct from doc or (fiscal_doc is not null and finance_private.customer_refund_document(fiscal_doc) is distinct from doc) then blockers:=blockers||jsonb_build_array('credit_refund_payer_unproven');end if;
 proof:=finance_private.customer_refund_movement_origin(_tenant,m.id);used:=finance_private.movement_used_cents(_tenant,m.id);
 if credit->'valid' is distinct from 'true'::jsonb then blockers:=blockers||jsonb_build_array('credit_source_unverified');end if;
 if m.direction<>'out' or m.nature not in('refund','payment','other') or m.driver_id is not null or not isfinite(m.occurred_on) or not exists(select 1 from finance_private.active_movements where tenant_id=_tenant and id=m.id) or proof->'verified' is distinct from 'true'::jsonb then blockers:=blockers||jsonb_build_array('credit_refund_movement_unproven');end if;
 if used<0 or used<>trunc(used) or used+amount>m.amount_cents then blockers:=blockers||jsonb_build_array('credit_refund_movement_capacity_exceeded');end if;
 if amount>coalesce((credit->>'available_cents')::numeric,-1) then blockers:=blockers||jsonb_build_array('credit_refund_capacity_exceeded');end if;
 begin perform finance_private.assert_closed_source_mutable(_tenant,'finance_movements',to_jsonb(m));exception when sqlstate '55000' then
 if sqlerrm='finance_account_period_closed' then blockers:=blockers||jsonb_build_array('credit_refund_period_closed');elsif sqlerrm in('finance_closed_source_resolution_required','finance_closed_anchor_conflict') then blockers:=blockers||jsonb_build_array('credit_refund_period_unverified');else raise;end if;
 end;
 result:=jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'credit_id',_credit,'payer_id',p.id,'payer',jsonb_build_object('id',p.id,'name',p.company_name,'document',doc),'identity',jsonb_build_object('verified',coalesce(doc is not null and matches=1 and finance_private.customer_refund_document(m.beneficiary_document)=doc and (fiscal_doc is null or finance_private.customer_refund_document(fiscal_doc)=doc),false)),'outgoing_movement_id',m.id,'amount_cents',_amount,'credit',credit-'history'-'refund_history','outgoing',jsonb_build_object('movement_id',m.id,'bank_account_id',m.bank_account_id,'occurred_on',case when isfinite(m.occurred_on) then m.occurred_on end,'amount_cents',m.amount_cents::text,'used_cents',used::text,'available_cents',(m.amount_cents-used)::text,'beneficiary_name',m.beneficiary_name,'beneficiary_document',finance_private.customer_refund_document(m.beneficiary_document)),'effects',jsonb_build_object('amount_cents',_amount,'credit_before_cents',credit->>'available_cents','credit_after_cents',case when blockers='[]'::jsonb then ((credit->>'available_cents')::numeric-amount)::text end,'movement_available_before_cents',(m.amount_cents-used)::text,'movement_available_after_cents',case when blockers='[]'::jsonb then (m.amount_cents-used-amount)::text end),'eligible',blockers='[]'::jsonb,'can_execute',false,'blockers',blockers,'_evidence',jsonb_build_object('movement',to_jsonb(m),'movement_origin',proof,'payer_id',p.id,'payer_document',doc,'binding_revision',credit->'binding_revision'));
 return result||jsonb_build_object('revision',md5(result::text));
end$$;
revoke all on function finance_private.customer_credit_refund_context(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;

create function finance_private.record_customer_credit_refund(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;actor uuid:=auth.uid();req uuid;credit uuid;movement uuid;ctx jsonb;result jsonb;event_id uuid:=gen_random_uuid();name text;old finance_private.customer_credit_refunds%rowtype;begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_credit_refund_invalid' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;req:=(_payload->>'request_id')::uuid;credit:=(_payload->>'credit_id')::uuid;movement:=(_payload->>'outgoing_movement_id')::uuid;perform finance_private.require_access(t);
 if req is null or credit is null or movement is null or _payload->>'version' is distinct from '1' or coalesce(_payload->>'amount_cents','')!~'^[1-9][0-9]{0,13}$' or coalesce(_payload->>'expected_revision','')!~'^[a-f0-9]{32}$' or coalesce(length(btrim(_payload->>'reason')),0) not between 5 and 2000 or exists(select 1 from jsonb_object_keys(_payload)k where k<>all(array['version','tenant_id','request_id','credit_id','outgoing_movement_id','amount_cents','expected_revision','reason'])) then raise exception 'finance_credit_refund_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor order by role::text for share nowait;perform 1 from public.drivers where tenant_id=t and user_id=actor order by id for share nowait;perform finance_private.require_access(t);
 select * into old from finance_private.customer_credit_refunds where tenant_id=t and request_id=req;
 if found then if old.actor_id is distinct from actor or old.payload_hash is distinct from md5(_payload::text) then raise exception 'finance_credit_refund_request_conflict' using errcode='23514';end if;return old.result;end if;
 perform 1 from public.finance_customer_credits where tenant_id=t and id=credit for share nowait;
 perform 1 from public.clients where tenant_id=t and id=(select payer_id from public.finance_customer_credits where tenant_id=t and id=credit) for share nowait;
 perform 1 from public.finance_movements where tenant_id=t and id=movement for update nowait;
 ctx:=finance_private.customer_credit_refund_context(t,credit,movement,_payload->>'amount_cents');
 if ctx->>'revision' is distinct from _payload->>'expected_revision' then raise exception 'finance_credit_refund_changed' using errcode='40001';end if;
 if ctx->'eligible' is distinct from 'true'::jsonb then raise exception 'finance_credit_refund_unavailable' using errcode='23514';end if;
 perform finance_private.assert_closed_source_mutable(t,'finance_movements',ctx#>'{_evidence,movement}');
 select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into name from auth.users where id=actor;name:=coalesce(name,actor::text);
 result:=jsonb_build_object('version',1,'tenant_id',t,'actor_id',actor,'request_id',req,'refund_id',event_id,'credit_id',credit,'payer_id',ctx->'payer_id','outgoing_movement_id',movement,'amount_cents',_payload->>'amount_cents','cash_movement_created',false,'effects',ctx->'effects');
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(t,'customer_credit',credit,'customer_credit_refunded',actor,name,btrim(_payload->>'reason'),ctx-'_evidence',result);
 insert into finance_private.customer_credit_refunds(id,tenant_id,credit_id,payer_id,outgoing_movement_id,amount_cents,request_id,actor_id,actor_name,reason,source_snapshot,payload_hash,result) values(event_id,t,credit,(ctx->>'payer_id')::uuid,movement,(_payload->>'amount_cents')::bigint,req,actor,name,btrim(_payload->>'reason'),ctx->'_evidence',md5(_payload::text),result);
 if finance_private.customer_credit_position(t,credit)->'valid' is distinct from 'true'::jsonb then raise exception 'finance_credit_refund_proof_failed' using errcode='23514';end if;
 perform finance_private.require_access(t);if auth.uid() is distinct from actor then raise exception 'finance_credit_refund_actor_changed' using errcode='42501';end if;return result;
exception when lock_not_available then raise exception 'finance_credit_refund_busy' using errcode='40001';
end$$;
revoke all on function finance_private.record_customer_credit_refund(jsonb) from public,anon,authenticated,service_role;
create function finance_private.guard_customer_credit_refund() returns trigger language plpgsql security definer set search_path='' as $$
declare ctx jsonb;begin
 if not pg_try_advisory_xact_lock(hashtextextended('fiscal:'||new.tenant_id::text,0)) or not pg_try_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0)) then raise exception 'finance_credit_refund_busy' using errcode='40001';end if;
 if tg_table_name='finance_movement_voids' then
  if exists(select 1 from finance_private.customer_credit_refunds where tenant_id=new.tenant_id and outgoing_movement_id=new.movement_id) then raise exception 'finance_credit_refund_movement_protected' using errcode='55000';end if;return new;
 end if;
 ctx:=finance_private.customer_credit_refund_context(new.tenant_id,new.credit_id,new.outgoing_movement_id,new.amount_cents::text);
 if ctx->'eligible' is distinct from 'true'::jsonb or ctx->'_evidence' is distinct from new.source_snapshot or new.payer_id::text is distinct from ctx->>'payer_id' or new.actor_id is distinct from auth.uid() or new.result @> jsonb_build_object('version',1,'tenant_id',new.tenant_id,'actor_id',new.actor_id,'request_id',new.request_id,'refund_id',new.id,'credit_id',new.credit_id,'payer_id',new.payer_id,'outgoing_movement_id',new.outgoing_movement_id,'amount_cents',new.amount_cents::text,'cash_movement_created',false) is distinct from true or new.result->>'refund_id' is distinct from new.id::text or new.result->>'amount_cents' is distinct from new.amount_cents::text or not exists(select 1 from public.finance_events e where e.tenant_id=new.tenant_id and e.entity_type='customer_credit' and e.entity_id=new.credit_id and e.action='customer_credit_refunded' and e.actor_id=new.actor_id and e.after_data=new.result) then raise exception 'finance_credit_refund_source_invalid' using errcode='23514';end if;
 perform finance_private.assert_closed_source_mutable(new.tenant_id,'finance_movements',ctx#>'{_evidence,movement}');return new;
end$$;
revoke all on function finance_private.guard_customer_credit_refund() from public,anon,authenticated,service_role;
create trigger guard_customer_credit_refund before insert on finance_private.customer_credit_refunds for each row execute function finance_private.guard_customer_credit_refund();
create trigger a_customer_credit_refund_void before insert on public.finance_movement_voids for each row execute function finance_private.guard_customer_credit_refund();
create function finance_private.verify_customer_credit_refund() returns trigger language plpgsql security definer set search_path='' as $$begin
 if finance_private.customer_credit_position(new.tenant_id,new.credit_id)->'valid' is distinct from 'true'::jsonb then raise exception 'finance_credit_refund_inconsistent' using errcode='23514';end if;return null;end$$;
revoke all on function finance_private.verify_customer_credit_refund() from public,anon,authenticated,service_role;
create constraint trigger verify_customer_credit_refund after insert on finance_private.customer_credit_refunds deferrable initially deferred for each row execute function finance_private.verify_customer_credit_refund();

do $audit$declare p record;body text;needle text:='''customer_credit_application_released'',';begin
 select * into p from pg_proc where oid=to_regprocedure('finance_private.audit_events(uuid,jsonb)');
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from '6c7960750c3acb7d3ceba891e924fecb' or not p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[] or not has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') then raise exception 'finance_credit_refund_audit_changed' using errcode='55000';end if;
 body:=pg_get_functiondef(p.oid);if (length(body)-length(replace(body,needle,'')))/length(needle)<>2 then raise exception 'finance_credit_refund_audit_contract_changed' using errcode='55000';end if;
 execute replace(body,needle,needle||'''customer_credit_refunded'',');
end$audit$;

-- Existing application APIs retain their safe DTO; never expose refund journal snapshots.
do $application$declare x record;p record;body text;begin
 for x in select * from(values
 ('finance_private.customer_credit_application_context(uuid,uuid,uuid,text,uuid)','896f7c6c668df92def2bf361330a8156','credit-''history''','credit-''history''-''refund_history'''),
 ('finance_private.record_customer_credit_application(jsonb)','6b04a6f7a7c514ec40976f3550988577','position-''history''','position-''history''-''refund_history'''))s(signature,hash,needle,replacement) loop
 select * into p from pg_proc where oid=to_regprocedure(x.signature);
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from x.hash or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[] or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee<>p.proowner) then raise exception 'finance_credit_refund_application_changed: %',x.signature using errcode='55000';end if;
 body:=pg_get_functiondef(p.oid);if (length(body)-length(replace(body,x.needle,'')))/length(x.needle)<>1 then raise exception 'finance_credit_refund_application_contract_changed' using errcode='55000';end if;execute replace(body,x.needle,x.replacement);
 end loop;
end$application$;
