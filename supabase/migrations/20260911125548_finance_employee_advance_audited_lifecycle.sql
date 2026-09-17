-- Local candidate. Requires payment core and payroll materialization guards before promotion.
set local lock_timeout='3s';set local statement_timeout='30s';
do $preflight$begin
 if to_regprocedure('finance_private.assert_employee_payroll_window_unmaterialized(uuid,uuid,date)') is null then raise exception 'finance_advance_payroll_guard_required';end if;
end;$preflight$;
create function finance_private.record_employee_advance(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;req uuid;employee uuid;aid uuid;actor uuid:=auth.uid();existing public.finance_commands%rowtype;a public.employee_advances%rowtype;e public.employees%rowtype;result jsonb;name text;amount bigint;day date;create_title boolean;
begin
 if jsonb_typeof(payload) is distinct from 'object' or payload->'version' is distinct from '1'::jsonb or coalesce(payload->>'amount_cents','')!~'^[1-9][0-9]{0,13}$' or jsonb_typeof(payload->'create_payable') is distinct from 'boolean' or length(btrim(coalesce(payload->>'reason',''))) not between 10 and 2000 or coalesce(payload->>'advance_date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (payload->>'payment_method' is not null and payload->>'payment_method' not in('pix','bank_transfer','cash','check','boleto','ted','doc','dinheiro','cartao','debito_automatico','other')) or length(coalesce(payload->>'payment_reference',''))>1000 or exists(select 1 from jsonb_object_keys(payload)k where k<>all(array['version','tenant_id','request_id','employee_id','amount_cents','advance_date','reason','payment_method','payment_reference','create_payable'])) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(payload->>'tenant_id')::uuid;req:=(payload->>'request_id')::uuid;employee:=(payload->>'employee_id')::uuid;amount:=(payload->>'amount_cents')::bigint;day:=(payload->>'advance_date')::date;create_title:=(payload->>'create_payable')::boolean;
 if t is null or req is null or employee is null or not isfinite(day) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform finance_private.require_access(t);perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor order by role::text for share nowait;perform 1 from public.drivers where tenant_id=t and user_id=actor order by id for share nowait;perform finance_private.require_access(t);
 if create_title and not exists(select 1 from public.tenant_memberships where tenant_id=t and user_id=actor and active and role::text in('owner','admin')) then raise exception 'finance_advance_manager_required' using errcode='42501';end if;
 select * into existing from public.finance_commands where tenant_id=t and request_id=req;
 if found then if existing.actor_id is distinct from actor or existing.action<>'employee_advance_registered' or existing.payload<>payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return existing.result;end if;
 select * into e from public.employees where tenant_id=t and id=employee for share nowait;
 if e.id is null then raise exception 'finance_advance_employee_not_found' using errcode='22023';end if;
 perform finance_private.assert_employee_payroll_window_unmaterialized(t,employee,day);
 aid:=public.register_employee_advance(t,employee,amount::numeric/100,day,payload->>'reason',payload->>'payment_method',payload->>'payment_reference',create_title,false);
 if create_title then update public.employee_advances set status='pending',approved_by=null,approved_at=null,updated_at=clock_timestamp() where tenant_id=t and id=aid;end if;
 select * into a from public.employee_advances where tenant_id=t and id=aid;
 result:=jsonb_build_object('version',1,'confirmed',true,'tenant_id',t,'actor_id',actor,'request_id',req,'advance_id',a.id,'employee_id',employee,'payable_id',a.payable_id,'status',a.status,'amount_cents',amount::text,'cash_created',false);
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into name from auth.users where id=actor;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data) values(t,'employee_advance',a.id,'employee_advance_registered',actor,coalesce(name,actor::text),payload->>'reason',result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,req,actor,'employee_advance_registered',payload,result);perform finance_private.require_access(t);return result;
exception when lock_not_available then raise exception 'finance_advance_busy' using errcode='40001';end$$;
revoke all on function finance_private.record_employee_advance(jsonb) from public,anon,authenticated,service_role;

create function finance_private.employee_advance_action_context(t uuid,advance uuid,action text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare pos jsonb;a public.employee_advances%rowtype;issues text[]:='{}';capable boolean;next_status text;
begin
 perform finance_private.require_access(t);if action not in('approve','cancel') or action is null then raise exception 'finance_invalid_action' using errcode='22023';end if;
 pos:=finance_private.employee_advance_position(t,advance);select * into a from public.employee_advances where tenant_id=t and id=advance;
 capable:=exists(select 1 from public.tenant_memberships where tenant_id=t and user_id=auth.uid() and active and role::text in('owner','admin'));
 if not capable then issues:=array_append(issues,'finance_advance_manager_required');end if;
 if pos->>'verified' is distinct from 'true' then issues:=array_append(issues,'finance_advance_source_invalid');end if;
 if action='approve' and a.status<>'pending' or action='cancel' and a.status not in('pending','approved') then issues:=array_append(issues,'finance_advance_action_state_invalid');end if;
 if exists(select 1 from public.payables_payments where tenant_id=t and payable_id=a.payable_id) or (pos->>'paid_cents')::bigint>0 then issues:=array_append(issues,'finance_advance_payment_history_requires_resolution');end if;
 if exists(select 1 from public.payroll_entry_items where tenant_id=t and source_table='employee_advances' and source_id=a.id) then issues:=array_append(issues,'finance_advance_payroll_requires_resolution');end if;
 next_status:=case action when 'approve' then 'approved' else 'cancelled' end;
 begin
  perform finance_private.assert_closed_source_mutable(t,'employee_advances',to_jsonb(a));perform finance_private.assert_closed_source_mutable(t,'employee_advances',to_jsonb(a)||jsonb_build_object('status',next_status));
 exception when sqlstate '55000' then issues:=array_append(issues,'finance_advance_closed_period');end;
 return jsonb_build_object('version',1,'tenant_id',t,'actor_id',auth.uid(),'advance_id',advance,'action',action,'revision',md5(jsonb_build_object('position',pos,'action',action)::text),'eligible',cardinality(issues)=0,'can_manage',capable,'can_execute',false,'blockers',to_jsonb(issues),'advance',pos,'effects',jsonb_build_object('cash_changed',false,'status_after',next_status));
end$$;
revoke all on function finance_private.employee_advance_action_context(uuid,uuid,text) from public,anon,authenticated,service_role;

create function finance_private.apply_employee_advance_action(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid;req uuid;aid uuid;actor uuid:=auth.uid();old public.finance_commands%rowtype;a public.employee_advances%rowtype;ctx jsonb;result jsonb;name text;next_status text;
begin
 if jsonb_typeof(payload) is distinct from 'object' or payload->'version' is distinct from '1'::jsonb or coalesce(payload->>'action','') not in('approve','cancel') or coalesce(payload->>'expected_revision','')!~'^[a-f0-9]{32}$' or length(btrim(coalesce(payload->>'reason',''))) not between 10 and 2000 or exists(select 1 from jsonb_object_keys(payload)k where k<>all(array['version','tenant_id','request_id','advance_id','action','expected_revision','reason'])) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(payload->>'tenant_id')::uuid;req:=(payload->>'request_id')::uuid;aid:=(payload->>'advance_id')::uuid;
 if t is null or req is null or aid is null then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform finance_private.require_access(t);perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor order by role::text for share nowait;perform 1 from public.drivers where tenant_id=t and user_id=actor order by id for share nowait;perform finance_private.require_access(t);
 if not exists(select 1 from public.tenant_memberships where tenant_id=t and user_id=actor and active and role::text in('owner','admin')) then raise exception 'finance_advance_manager_required' using errcode='42501';end if;
 select * into old from public.finance_commands where tenant_id=t and request_id=req;
 if found then if old.actor_id is distinct from actor or old.action<>'employee_advance_action' or old.payload<>payload then raise exception 'finance_request_conflict' using errcode='23505';end if;return old.result;end if;
 select * into a from public.employee_advances where tenant_id=t and id=aid for update nowait;
 if a.payable_id is not null then perform 1 from public.payables where tenant_id=t and id=a.payable_id for update nowait;end if;
 ctx:=finance_private.employee_advance_action_context(t,aid,payload->>'action');
 if ctx->>'revision' is distinct from payload->>'expected_revision' then raise exception 'finance_advance_revision_changed' using errcode='40001';end if;
 if ctx->>'eligible' is distinct from 'true' then raise exception 'finance_advance_action_ineligible' using errcode='55000';end if;
 next_status:=ctx#>>'{effects,status_after}';
 update public.employee_advances set status=next_status,approved_by=case when next_status='approved' then actor else approved_by end,approved_at=case when next_status='approved' then clock_timestamp() else approved_at end,updated_by=actor,updated_at=clock_timestamp() where tenant_id=t and id=aid;
 if next_status='cancelled' and a.payable_id is not null then update public.payables set status='cancelled',updated_at=clock_timestamp() where tenant_id=t and id=a.payable_id;end if;
 result:=jsonb_build_object('version',1,'confirmed',true,'tenant_id',t,'actor_id',actor,'request_id',req,'advance_id',aid,'action',payload->>'action','status',next_status,'cash_changed',false);
 select coalesce(raw_user_meta_data->>'full_name',email,actor::text) into name from auth.users where id=actor;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(t,'employee_advance',aid,case when next_status='approved' then 'employee_advance_approved' else 'employee_advance_cancelled' end,actor,coalesce(name,actor::text),payload->>'reason',ctx,result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,req,actor,'employee_advance_action',payload,result);perform finance_private.require_access(t);return result;
exception when lock_not_available then raise exception 'finance_advance_busy' using errcode='40001';end$$;
revoke all on function finance_private.apply_employee_advance_action(jsonb) from public,anon,authenticated,service_role;

-- Interactive mutations must go through audited commands; service backend remains as previously configured.
revoke insert,update,delete on public.employee_advances from public,anon,authenticated;
revoke execute on function public.register_employee_advance(uuid,uuid,numeric,date,text,text,text,boolean,boolean) from public,anon,authenticated;
