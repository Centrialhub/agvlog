-- PRIVATE CANDIDATE: application/release of existing payer credit, no money creation.
set lock_timeout='3s';set statement_timeout='30s';
create table finance_private.customer_credit_application_events(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 credit_id uuid not null references public.finance_customer_credits(id),receivable_id uuid not null references public.receivables(id),
 action text not null check(action in('apply','release')),application_id uuid not null references finance_private.customer_credit_application_events(id),
 amount_cents bigint not null check(amount_cents>0 and amount_cents<=99999999999999),
 observation_id uuid references public.finance_fiscal_observations(id),request_id uuid not null,actor_id uuid,actor_name text not null,reason text not null check(length(btrim(reason)) between 5 and 2000),
 source_revision text not null,source_snapshot jsonb not null,payload_hash text not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,request_id),check((action='apply' and application_id=id) or(action='release' and application_id<>id))
);
create index customer_credit_application_source on finance_private.customer_credit_application_events(tenant_id,credit_id,id);
create index customer_credit_application_target on finance_private.customer_credit_application_events(tenant_id,receivable_id,id);
alter table finance_private.customer_credit_application_events enable row level security;
revoke all on finance_private.customer_credit_application_events from public,anon,authenticated,service_role;
create trigger preserve_customer_credit_application before update or delete on finance_private.customer_credit_application_events for each row execute function finance_private.preserve_event();
do $proof$declare body text;begin
 if not exists(select 1 from pg_proc where oid=to_regprocedure('finance_private.forecast_customer_credit_evidence(uuid,uuid)') and md5(replace(prosrc,E'\r\n',E'\n'))='0d52a40e865dba8396d54c1eaed99d90' and prosecdef and not has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute')) then raise exception 'finance_customer_credit_source_changed' using errcode='55000';end if;
 select pg_get_functiondef('finance_private.forecast_customer_credit_evidence(uuid,uuid)'::regprocedure) into body;
 execute replace(replace(body,'FUNCTION finance_private.forecast_customer_credit_evidence(','FUNCTION finance_private.customer_credit_source_evidence('),'perform finance_private.require_access(_tenant);','');
end$proof$;
revoke all on function finance_private.customer_credit_source_evidence(uuid,uuid) from public,anon,authenticated,service_role;
create function finance_private.customer_credit_position(_tenant uuid,_credit uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.finance_customer_credits%rowtype;proof jsonb;history jsonb;used numeric;released numeric;valid boolean;original numeric;
begin
 select * into c from public.finance_customer_credits where tenant_id=_tenant and id=_credit;
 if not found then raise exception 'finance_customer_credit_missing' using errcode='22023';end if;
 proof:=finance_private.customer_credit_source_evidence(_tenant,_credit);original:=c.amount_cents;
 select coalesce(sum(e.amount_cents) filter(where e.action='apply'),0),coalesce(sum(e.amount_cents) filter(where e.action='release'),0),coalesce(jsonb_agg(to_jsonb(e) order by e.created_at,e.id),'[]') into used,released,history from finance_private.customer_credit_application_events e where e.tenant_id=_tenant and e.credit_id=_credit;
 valid:=proof->'valid'='true'::jsonb and used-released between 0 and original;
 if exists(select 1 from finance_private.customer_credit_application_events e left join public.receivables r on r.tenant_id=e.tenant_id and r.id=e.receivable_id where e.tenant_id=_tenant and e.credit_id=_credit and(e.source_snapshot->>'binding_revision' is distinct from md5(to_jsonb(c)::text) or r.id is null or r.client_id is distinct from c.payer_id or not ((e.observation_id is not null and e.actor_id is null and e.action='release' and exists(select 1 from public.finance_fiscal_observations observation join public.finance_fiscal_receivable_origins origin on origin.tenant_id=observation.tenant_id and origin.emission_id=observation.emission_id where observation.tenant_id=e.tenant_id and observation.id=e.observation_id and origin.receivable_id=e.receivable_id and observation.snapshot->>'status'='cancelled' and observation.snapshot->>'environment'='production')) or (e.observation_id is null and exists(select 1 from public.finance_events audit where audit.tenant_id=e.tenant_id and audit.entity_id=e.id and audit.entity_type='customer_credit_application' and audit.action=case when e.action='apply' then 'customer_credit_applied' else 'customer_credit_application_released' end and audit.actor_id is not distinct from e.actor_id and audit.after_data->>'request_id'=e.request_id::text))))) then valid:=false;end if;
 if exists(select 1 from finance_private.customer_credit_application_events e where e.tenant_id=_tenant and e.credit_id=_credit and e.action='release' and not exists(select 1 from finance_private.customer_credit_application_events a where a.id=e.application_id and a.tenant_id=e.tenant_id and a.credit_id=e.credit_id and a.receivable_id=e.receivable_id and a.action='apply')) or exists(select 1 from finance_private.customer_credit_application_events a where a.tenant_id=_tenant and a.credit_id=_credit and a.action='apply' and (select coalesce(sum(r.amount_cents),0) from finance_private.customer_credit_application_events r where r.application_id=a.id and r.action='release')>a.amount_cents) then valid:=false;end if;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'credit_id',_credit,'payer_id',c.payer_id,'valid',coalesce(valid,false),'original_cents',original::text,'applied_cents',case when valid then (used-released)::text end,'released_cents',released::text,'available_cents',case when valid then (original-used+released)::text end,'binding_revision',md5(to_jsonb(c)::text),'source_revision',proof->'source_revision','revision',md5(jsonb_build_object('proof',proof,'events',history)::text),'history',history);
end$$;
revoke all on function finance_private.customer_credit_position(uuid,uuid) from public,anon,authenticated,service_role;
create function finance_private.receivable_credit_evidence(_tenant uuid,_receivable uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare total numeric;valid boolean:=true;c record;position jsonb;history jsonb;
begin
 select coalesce(sum(case when action='apply' then amount_cents else -amount_cents end),0),coalesce(jsonb_agg(to_jsonb(e) order by created_at,id),'[]') into total,history from finance_private.customer_credit_application_events e where tenant_id=_tenant and receivable_id=_receivable;
 for c in select distinct credit_id from finance_private.customer_credit_application_events where tenant_id=_tenant and receivable_id=_receivable loop
  position:=finance_private.customer_credit_position(_tenant,c.credit_id);if position->'valid' is distinct from 'true'::jsonb then valid:=false;end if;
 end loop;
 if total<0 then valid:=false;end if;
 return jsonb_build_object('valid',valid,'declared_applied_cents',total::text,'applied_cents',case when valid then total::text end,'history',history,'revision',md5(history::text));
end$$;
revoke all on function finance_private.receivable_credit_evidence(uuid,uuid) from public,anon,authenticated,service_role;

do $ledger$declare spec record;p record;body text;needle text;begin
 for spec in select * from(values
 ('public._guard_receivable_ledger()','33abeae97a75989a43549b7a67a83720'),
 ('public._recalc_receivable_received()','85aacc9b3818bfe4d5f6f06ef0e3bb95'),
 ('public._receivable_financial_snapshot(uuid,uuid)','8593db406c00779581a34e2038cb5d7f'),
 ('public._receivable_ledger_evidence(uuid,uuid)','351d7b05301ec509747944c68ea6c49e'))v(signature,hash) loop
  select * into p from pg_proc where oid=to_regprocedure(spec.signature);
  if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from spec.hash or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') then raise exception 'finance_credit_application_predecessor_changed: %',spec.signature using errcode='55000';end if;
 end loop;
 select pg_get_functiondef('public._receivable_ledger_evidence(uuid,uuid)'::regprocedure) into body;
 execute replace(body,'FUNCTION public._receivable_ledger_evidence(','FUNCTION finance_private.cash_receivable_ledger_evidence(');
 select pg_get_functiondef('public._guard_receivable_ledger()'::regprocedure) into body;
 needle:='select exists(select 1 from public.receivables_payments where tenant_id=old.tenant_id and receivable_id=old.id) into v_has;';
 if position(needle in body)=0 then raise exception 'finance_credit_guard_history_contract_changed';end if;
 body:=replace(body,needle,needle||' v_has:=v_has or exists(select 1 from finance_private.customer_credit_application_events where tenant_id=old.tenant_id and receivable_id=old.id);');
 needle:='if coalesce(new.received_amount,0)<>v_total';if position(needle in body)=0 then raise exception 'finance_credit_guard_sum_contract_changed';end if;
 body:=replace(body,needle,'select net into v_total from public._receivable_ledger_evidence(old.tenant_id,old.id); '||needle);execute body;
 select pg_get_functiondef('public._recalc_receivable_received()'::regprocedure) into body;
 needle:='update public.receivables r set received_amount=v_total';if position(needle in body)=0 then raise exception 'finance_credit_recalc_contract_changed';end if;
 body:=replace(body,needle,'select ledger.net into v_total from public.receivables target cross join lateral public._receivable_ledger_evidence(target.tenant_id,target.id) ledger where target.id=v_id; '||needle);execute body;
 select pg_get_functiondef('public._receivable_financial_snapshot(uuid,uuid)'::regprocedure) into body;
 body:=replace(body,'v_net numeric;','credit_evidence jsonb;cash_net numeric;v_net numeric;');
 needle:='return v_result||jsonb_build_object(''revision'',md5(v_result::text));';
 if position(needle in body)=0 then raise exception 'finance_credit_snapshot_contract_changed';end if;
 body:=replace(body,needle,'credit_evidence:=finance_private.receivable_credit_evidence(_tenant,_id); select net into cash_net from finance_private.cash_receivable_ledger_evidence(_tenant,_id); v_result:=v_result||jsonb_build_object(''cash_received_cents'',case when v_structural then (cash_net*100)::bigint end,''credit_applied_cents'',case when v_structural then (credit_evidence->>''applied_cents'')::bigint end,''settled_cents'',case when v_structural then (v_net*100)::bigint end,''can_reverse'',coalesce((v_result->>''can_reverse'')::boolean,false) and cash_net>0,''credit_revision'',credit_evidence->''revision'',''credit_application_count'',jsonb_array_length(credit_evidence->''history'')); '||needle);execute body;
end$ledger$;
revoke all on function finance_private.cash_receivable_ledger_evidence(uuid,uuid) from public,anon,authenticated,service_role;
create or replace function public._receivable_ledger_evidence(_tenant uuid,_id uuid) returns table(net numeric,payment_count bigint,valid boolean) language sql stable security invoker set search_path='' as $$
 select cash.net+(credit.value->>'declared_applied_cents')::numeric/100,cash.payment_count,cash.valid and credit.value->'valid'='true'::jsonb
 from finance_private.cash_receivable_ledger_evidence(_tenant,_id) cash cross join lateral(select finance_private.receivable_credit_evidence(_tenant,_id) value) credit;
$$;
revoke all on function public._receivable_ledger_evidence(uuid,uuid) from public,anon,authenticated,service_role;
create function finance_private.sync_credit_application_projection() returns trigger language plpgsql security definer set search_path='' as $$
begin perform public._sync_receivable_financial_projection(new.tenant_id,new.receivable_id);return new;end$$;
revoke all on function finance_private.sync_credit_application_projection() from public,anon,authenticated,service_role;
create trigger recalc_credit_application after insert on finance_private.customer_credit_application_events for each row execute function public._recalc_receivable_received();
create trigger zz_sync_credit_application after insert on finance_private.customer_credit_application_events for each row execute function finance_private.sync_credit_application_projection();

create function finance_private.customer_credit_application_context(_tenant uuid,_credit uuid,_receivable uuid,_amount text,_application uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare credit jsonb;target jsonb;r public.receivables%rowtype;app finance_private.customer_credit_application_events%rowtype;amount bigint;remaining numeric;blockers jsonb:='[]';result jsonb;
begin
 perform finance_private.require_access(_tenant);
 if _amount is null or _amount!~'^[1-9][0-9]{0,13}$' then raise exception 'finance_credit_amount_invalid' using errcode='22023';end if;amount:=_amount::bigint;
 credit:=finance_private.customer_credit_position(_tenant,_credit);select * into r from public.receivables where tenant_id=_tenant and id=_receivable;
 if not found then raise exception 'finance_credit_target_missing' using errcode='22023';end if;
 target:=public._receivable_financial_snapshot(_tenant,_receivable);
 if credit->'valid' is distinct from 'true'::jsonb then blockers:=blockers||jsonb_build_array('credit_source_unverified');end if;
 if r.client_id::text is distinct from credit->>'payer_id' then blockers:=blockers||jsonb_build_array('credit_payer_mismatch');end if;
 if target->'requires_reconciliation' is distinct from 'false'::jsonb then blockers:=blockers||jsonb_build_array('credit_target_unverified');end if;
 if _application is null then
  if target->'can_receive' is distinct from 'true'::jsonb then blockers:=blockers||jsonb_build_array('credit_target_not_collectible');end if;
  if amount>coalesce((credit->>'available_cents')::numeric,-1) then blockers:=blockers||jsonb_build_array('credit_capacity_exceeded');end if;
  if amount>coalesce((target->>'open_cents')::numeric,-1) then blockers:=blockers||jsonb_build_array('credit_target_capacity_exceeded');end if;
 else
  select * into app from finance_private.customer_credit_application_events where tenant_id=_tenant and id=_application and credit_id=_credit and receivable_id=_receivable and action='apply';
  if not found then raise exception 'finance_credit_application_missing' using errcode='22023';end if;
  select app.amount_cents-coalesce(sum(amount_cents),0) into remaining from finance_private.customer_credit_application_events where tenant_id=_tenant and application_id=app.id and action='release';
  if amount>remaining then blockers:=blockers||jsonb_build_array('credit_release_capacity_exceeded');end if;
  if r.status='cancelled' then blockers:=blockers||jsonb_build_array('credit_target_cancelled');end if;
 end if;
 result:=jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'action',case when _application is null then 'apply' else 'release' end,'application_id',_application,'credit_id',_credit,'receivable_id',_receivable,'amount_cents',_amount,'credit',credit-'history','target',jsonb_build_object('receivable_id',r.id,'payer_id',r.client_id,'reference',target->'reference','status',r.status,'nominal_cents',target->>'amount_cents','cash_received_cents',target->>'cash_received_cents','credit_applied_cents',target->>'credit_applied_cents','settled_cents',target->>'settled_cents','open_cents',target->>'open_cents','revision',target->'revision'),'release_available_cents',remaining::text,'eligible',blockers='[]'::jsonb,'can_execute',false,'blockers',blockers);
 return result||jsonb_build_object('revision',md5(result::text));
end$$;
revoke all on function finance_private.customer_credit_application_context(uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
create function finance_private.record_customer_credit_application(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;actor uuid:=auth.uid();req uuid;credit uuid;target uuid;application uuid;amount bigint;action text;ctx jsonb;position jsonb;result jsonb;event_id uuid:=gen_random_uuid();old finance_private.customer_credit_application_events%rowtype;name text;after_ctx jsonb;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_credit_application_invalid' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;req:=(_payload->>'request_id')::uuid;credit:=(_payload->>'credit_id')::uuid;target:=(_payload->>'receivable_id')::uuid;application:=(_payload->>'application_id')::uuid;action:=_payload->>'action';perform finance_private.require_access(t);
 if req is null or credit is null or target is null or coalesce(_payload->>'version','')<>'1' or coalesce(action,'') not in('apply','release') or(action='apply') is distinct from(application is null) or coalesce(_payload->>'amount_cents','')!~'^[1-9][0-9]{0,13}$' or coalesce(_payload->>'expected_revision','')!~'^[a-f0-9]{32}$' or coalesce(length(btrim(_payload->>'reason')),0) not between 5 and 2000 or exists(select 1 from jsonb_object_keys(_payload) k where k<>all(array['version','tenant_id','request_id','credit_id','receivable_id','application_id','action','amount_cents','expected_revision','reason'])) then raise exception 'finance_credit_application_invalid' using errcode='22023';end if;
 amount:=(_payload->>'amount_cents')::bigint;perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor order by role::text for share nowait;perform 1 from public.drivers where tenant_id=t and user_id=actor order by id for share nowait;perform finance_private.require_access(t);
 if auth.uid() is distinct from actor then raise exception 'finance_credit_actor_changed' using errcode='42501';end if;
 select * into old from finance_private.customer_credit_application_events where tenant_id=t and request_id=req;
 if found then if old.actor_id is distinct from actor or old.payload_hash is distinct from md5(_payload::text) then raise exception 'finance_credit_request_conflict' using errcode='23514';end if;return old.result;end if;
 perform public._lock_receivable_financial_graph(t,target);perform 1 from public.finance_customer_credits where tenant_id=t and id=credit for share nowait;
 perform 1 from public.clients where tenant_id=t and id=(select payer_id from public.finance_customer_credits where tenant_id=t and id=credit) for share nowait;
 ctx:=finance_private.customer_credit_application_context(t,credit,target,_payload->>'amount_cents',application);
 if ctx->>'revision' is distinct from _payload->>'expected_revision' then raise exception 'finance_credit_application_changed' using errcode='40001';end if;
 if ctx->'eligible' is distinct from 'true'::jsonb then raise exception 'finance_credit_application_unavailable' using errcode='23514';end if;
 position:=finance_private.customer_credit_position(t,credit);select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,actor::text) into name from auth.users where id=actor;name:=coalesce(name,actor::text);
 result:=jsonb_build_object('version',1,'tenant_id',t,'actor_id',actor,'request_id',req,'event_id',event_id,'application_id',coalesce(application,event_id),'action',action,'credit_id',credit,'receivable_id',target,'amount_cents',amount::text,'cash_movement_created',false);
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(t,'customer_credit_application',event_id,case when action='apply' then 'customer_credit_applied' else 'customer_credit_application_released' end,actor,name,btrim(_payload->>'reason'),ctx,result);
 insert into finance_private.customer_credit_application_events(id,tenant_id,credit_id,receivable_id,action,application_id,amount_cents,request_id,actor_id,actor_name,reason,source_revision,source_snapshot,payload_hash,result) values(event_id,t,credit,target,action,coalesce(application,event_id),amount,req,actor,name,btrim(_payload->>'reason'),position->>'source_revision',position-'history',md5(_payload::text),result);
 after_ctx:=public._receivable_financial_snapshot(t,target);if after_ctx->'requires_reconciliation' is distinct from 'false'::jsonb then raise exception 'finance_credit_projection_failed' using errcode='55000';end if;
 perform finance_private.require_access(t);return result;
exception when lock_not_available then raise exception 'finance_credit_application_busy' using errcode='40001';
end$$;
revoke all on function finance_private.record_customer_credit_application(jsonb) from public,anon,authenticated,service_role;

-- Internal cancellation compensation: immutable release, never a cash refund.
create function finance_private.release_receivable_customer_credits(_tenant uuid,_receivable uuid,_reason text,_observation uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare a record;position jsonb;event_id uuid;req uuid;result jsonb;actor uuid;actor_name text;
begin
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||_tenant::text,0));perform pg_advisory_xact_lock(hashtextextended(_tenant::text||':finance',0));
 if _observation is null then perform finance_private.require_access(_tenant);actor:=auth.uid();actor_name:=actor::text;
 else
  if not exists(select 1 from public.finance_fiscal_observations o join public.finance_fiscal_receivable_origins origin on origin.tenant_id=o.tenant_id and origin.emission_id=o.emission_id join public.hub_fiscal_emissions e on e.tenant_id=o.tenant_id and e.id=o.emission_id where o.id=_observation and o.tenant_id=_tenant and origin.receivable_id=_receivable and o.snapshot->>'status'='cancelled' and o.snapshot->>'environment'='production' and e.status='cancelled' and e.environment='production' and e.dispatch_state='recorded') then raise exception 'finance_credit_cancellation_unproven' using errcode='23514';end if;
  actor_name:='Processamento fiscal';
 end if;
 for a in select app.*,app.amount_cents-(select coalesce(sum(release.amount_cents),0) from finance_private.customer_credit_application_events release where release.tenant_id=app.tenant_id and release.application_id=app.id and release.action='release') remaining from finance_private.customer_credit_application_events app where app.tenant_id=_tenant and app.receivable_id=_receivable and app.action='apply' order by app.id loop
  if a.remaining=0 then continue;end if;
  position:=finance_private.customer_credit_position(_tenant,a.credit_id);if position->'valid' is distinct from 'true'::jsonb or a.remaining<0 then raise exception 'finance_credit_cancellation_evidence_invalid' using errcode='23514';end if;
  event_id:=gen_random_uuid();req:=gen_random_uuid();result:=jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',actor,'request_id',req,'event_id',event_id,'application_id',a.id,'action','release','credit_id',a.credit_id,'receivable_id',_receivable,'amount_cents',a.remaining::text,'cash_movement_created',false,'observation_id',_observation);
  if actor is not null then insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(_tenant,'customer_credit_application',event_id,'customer_credit_application_released',actor,actor_name,_reason,position-'history',result);end if;
  insert into finance_private.customer_credit_application_events(id,tenant_id,credit_id,receivable_id,action,application_id,amount_cents,request_id,actor_id,actor_name,reason,source_revision,source_snapshot,payload_hash,result,observation_id) values(event_id,_tenant,a.credit_id,_receivable,'release',a.id,a.remaining,req,actor,actor_name,_reason,position->>'source_revision',position-'history',md5(result::text),result,_observation);
 end loop;
end$$;
revoke all on function finance_private.release_receivable_customer_credits(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
do $cancel$declare body text;spec record;needle text;begin
 for spec in select * from(values('finance_private.process_fiscal_observation(uuid,uuid)','e4debeb8b03f4c384546ee81607857ee'),('public._invoice_lifecycle_snapshot(uuid,uuid)','2f4938aa940c2b2e83df836196ebae06'),('public.apply_client_invoice_command(jsonb)','c00b2cc6d17e6179b0e0e50988b1e064'))v(signature,hash) loop
  if not exists(select 1 from pg_proc where oid=to_regprocedure(spec.signature) and md5(replace(prosrc,E'\r\n',E'\n'))=spec.hash) then raise exception 'finance_credit_cancel_predecessor_changed: %',spec.signature using errcode='55000';end if;
 end loop;
 select pg_get_functiondef('finance_private.process_fiscal_observation(uuid,uuid)'::regprocedure) into body;
 needle:='select * into r from public.receivables where id=title and tenant_id=_tenant for update;';
 if position(needle in body)=0 then raise exception 'finance_credit_fiscal_cancel_contract_changed';end if;
 body:=replace(body,needle,'if e.status=''cancelled'' and not exists(select 1 from public.receivables credit_target where credit_target.id=origin.receivable_id and (credit_target.client_invoice_id is not null or credit_target.closing_report_id is not null)) and not exists(select 1 from public.client_invoices where tenant_id=_tenant and receivable_id=origin.receivable_id) and not exists(select 1 from public.closing_reports where tenant_id=_tenant and receivable_id=origin.receivable_id) then perform finance_private.release_receivable_customer_credits(_tenant,title,''Liberação por cancelamento fiscal confirmado'',_observation);end if; '||needle);execute body;
 select pg_get_functiondef('public._invoice_lifecycle_snapshot(uuid,uuid)'::regprocedure) into body;
 needle:='and ledger.net=0 and inv.status';if position(needle in body)=0 then raise exception 'finance_credit_invoice_snapshot_contract_changed';end if;
 body:=replace(body,needle,'and (select net from finance_private.cash_receivable_ledger_evidence(_tenant,r.id))=0 and inv.status');execute body;
 select pg_get_functiondef('public.apply_client_invoice_command(jsonb)'::regprocedure) into body;
 needle:='elsif v_action=''cancel'' then';if position(needle in body)=0 then raise exception 'finance_credit_invoice_cancel_contract_changed';end if;
 body:=replace(body,needle,needle||' perform finance_private.release_receivable_customer_credits(v_tenant,v_receivable,v_reason,null);');execute body;
end$cancel$;

create function finance_private.guard_customer_credit_application_insert() returns trigger language plpgsql security definer set search_path='' as $$
declare position jsonb;target_payer uuid;begin
 if not pg_try_advisory_xact_lock(hashtextextended('fiscal:'||new.tenant_id::text,0)) or not pg_try_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0)) then raise exception 'finance_credit_application_busy' using errcode='40001';end if;
 position:=finance_private.customer_credit_position(new.tenant_id,new.credit_id);
 select client_id into target_payer from public.receivables where tenant_id=new.tenant_id and id=new.receivable_id for share nowait;
 if not found or target_payer::text is distinct from position->>'payer_id' or position->'valid' is distinct from 'true'::jsonb or new.source_snapshot->>'binding_revision' is distinct from position->>'binding_revision' or new.source_revision is distinct from position->>'source_revision' then raise exception 'finance_credit_application_source_invalid' using errcode='23514';end if;
 if new.result->>'event_id' is distinct from new.id::text or new.result->>'tenant_id' is distinct from new.tenant_id::text or new.result->>'credit_id' is distinct from new.credit_id::text or new.result->>'receivable_id' is distinct from new.receivable_id::text or new.result->>'amount_cents' is distinct from new.amount_cents::text or new.result->>'action' is distinct from new.action or new.result->>'request_id' is distinct from new.request_id::text or new.result->'cash_movement_created' is distinct from 'false'::jsonb then raise exception 'finance_credit_application_event_invalid' using errcode='23514';end if;
 if new.observation_id is null then
  perform finance_private.require_access(new.tenant_id);
  if new.actor_id is distinct from auth.uid() or not exists(select 1 from public.finance_events audit where audit.tenant_id=new.tenant_id and audit.entity_type='customer_credit_application' and audit.entity_id=new.id and audit.actor_id=new.actor_id and audit.after_data=new.result) then raise exception 'finance_credit_application_audit_invalid' using errcode='23514';end if;
 elsif new.action<>'release' or new.actor_id is not null then raise exception 'finance_credit_application_system_invalid' using errcode='23514';end if;
 return new;
exception when lock_not_available then raise exception 'finance_credit_application_busy' using errcode='40001';
end$$;
revoke all on function finance_private.guard_customer_credit_application_insert() from public,anon,authenticated,service_role;
create trigger guard_customer_credit_application_insert before insert on finance_private.customer_credit_application_events for each row execute function finance_private.guard_customer_credit_application_insert();
create function finance_private.verify_customer_credit_application() returns trigger language plpgsql security definer set search_path='' as $$
declare position jsonb;target jsonb;begin
 position:=finance_private.customer_credit_position(new.tenant_id,new.credit_id);target:=public._receivable_financial_snapshot(new.tenant_id,new.receivable_id);
 if position->'valid' is distinct from 'true'::jsonb or target->'requires_reconciliation' is distinct from 'false'::jsonb then raise exception 'finance_credit_application_inconsistent' using errcode='23514';end if;
 return null;
end$$;
revoke all on function finance_private.verify_customer_credit_application() from public,anon,authenticated,service_role;
create constraint trigger verify_customer_credit_application after insert on finance_private.customer_credit_application_events deferrable initially deferred for each row execute function finance_private.verify_customer_credit_application();

do $audit$declare p record;body text;needle text:='''cash_forecast_agenda_cleared'',';begin
 select * into p from pg_proc where oid=to_regprocedure('finance_private.audit_events(uuid,jsonb)');
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from 'e2ec37aa8997d9a175d003d742f9fb2e' or not p.prosecdef or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[] or not has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') then raise exception 'finance_credit_audit_predecessor_changed' using errcode='55000';end if;
 select pg_get_functiondef(p.oid) into body;
 if (length(body)-length(replace(body,needle,'')))/length(needle)<>2 then raise exception 'finance_credit_audit_classification_changed' using errcode='55000';end if;
 execute replace(body,needle,needle||'''customer_credit_applied'',''customer_credit_application_released'',');
end$audit$;
