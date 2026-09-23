-- No row means the existing approval rule. Limits only apply after an administrator saves them.
create table finance_private.approval_policies(
 tenant_id uuid primary key references public.tenants(id), enabled boolean not null default false,
 operator_limit_cents bigint check(operator_limit_cents>=0), admin_limit_cents bigint check(admin_limit_cents>=0),
 prevent_self_approval boolean not null default false, updated_by uuid not null, updated_at timestamptz not null default clock_timestamp());
alter table finance_private.approval_policies enable row level security;
revoke all on finance_private.approval_policies from public,anon,authenticated,service_role;
create function finance_private.approval_policy(t uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare value jsonb;
begin
 perform finance_private.require_access(t);
 select to_jsonb(p) into value from finance_private.approval_policies p where tenant_id=t;
 value:=coalesce(value,jsonb_build_object('tenant_id',t,'enabled',false,'operator_limit_cents',null,'admin_limit_cents',null,'prevent_self_approval',false));
 return jsonb_build_object('version',1,'tenant_id',t,'can_configure',public.is_tenant_admin(t),'policy',value,'revision',md5(value::text));
end$$;
create function finance_private.approval_limit_issue(t uuid,p jsonb) returns text language plpgsql stable security definer set search_path='' as $$
declare policy finance_private.approval_policies%rowtype;cap bigint;role_name text;
begin
 select * into policy from finance_private.approval_policies where tenant_id=t;
 if not found or not policy.enabled then return null;end if;
 select m.role::text into role_name from public.tenant_memberships m where m.tenant_id=t and m.user_id=auth.uid() and m.active order by case m.role::text when 'owner' then 1 when 'admin' then 2 else 3 end limit 1;
 if policy.prevent_self_approval and auth.uid()::text in(p->>'created_by',p->>'updated_by') then return 'finance_approval_preparer';end if;
 if role_name='owner' then return null;end if;
 cap:=case role_name when 'admin' then policy.admin_limit_cents else policy.operator_limit_cents end;
 if cap is not null and (p->>'amount')::numeric*100>cap then return 'finance_approval_limit_exceeded';end if;
 return null;
end$$;
create function finance_private.guard_approval_limit() returns trigger language plpgsql security definer set search_path='' as $$
declare issue text;
begin
 if new.status='approved' and (tg_op='INSERT' or old.status is distinct from 'approved') and auth.uid() is not null then
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0));
  issue:=finance_private.approval_limit_issue(new.tenant_id,case when tg_op='INSERT' then to_jsonb(new) else to_jsonb(old) end);
  if issue is not null then raise exception '%',issue using errcode='55000';end if;
 end if;
 return new;
end$$;
create trigger a_payable_approval_limit before insert or update on public.payables for each row execute function finance_private.guard_approval_limit();
create function finance_private.save_approval_policy(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid:=(payload->>'tenant_id')::uuid;req uuid:=(payload->>'request_id')::uuid;before_value jsonb;result jsonb;prior public.finance_commands%rowtype;
begin
 perform finance_private.require_access(t);
 if not public.is_tenant_admin(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if payload->'version' is distinct from '1'::jsonb or req is null or jsonb_typeof(payload->'enabled') is distinct from 'boolean'
 or jsonb_typeof(payload->'prevent_self_approval') is distinct from 'boolean'
 or coalesce(payload->>'operator_limit_cents','0')!~'^(0|[1-9][0-9]{0,13})$'
 or coalesce(payload->>'admin_limit_cents','0')!~'^(0|[1-9][0-9]{0,13})$'
 or length(btrim(coalesce(payload->>'reason',''))) not between 10 and 2000
 or exists(select 1 from jsonb_object_keys(payload) k where k not in('version','tenant_id','request_id','revision','enabled','operator_limit_cents','admin_limit_cents','prevent_self_approval','reason')) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform finance_private.require_access(t);
 if not public.is_tenant_admin(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into prior from public.finance_commands where tenant_id=t and request_id=req;
 if found then
  if prior.actor_id is distinct from auth.uid() or prior.action<>'save_approval_policy' or prior.payload<>payload then raise exception 'finance_request_conflict' using errcode='23505';end if;
  return prior.result;
 end if;
 before_value:=finance_private.approval_policy(t);
 if before_value->>'revision' is distinct from payload->>'revision' then raise exception 'finance_approval_policy_changed' using errcode='40001';end if;
 insert into finance_private.approval_policies(tenant_id,enabled,operator_limit_cents,admin_limit_cents,prevent_self_approval,updated_by)
 values(t,(payload->>'enabled')::boolean,(payload->>'operator_limit_cents')::bigint,(payload->>'admin_limit_cents')::bigint,(payload->>'prevent_self_approval')::boolean,auth.uid())
 on conflict(tenant_id) do update set enabled=excluded.enabled,operator_limit_cents=excluded.operator_limit_cents,admin_limit_cents=excluded.admin_limit_cents,prevent_self_approval=excluded.prevent_self_approval,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 result:=finance_private.approval_policy(t)||jsonb_build_object('confirmed',true,'request_id',req);
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,reason,before_data,after_data)
 values(t,'approval_policy',t,'approval_policy_changed',auth.uid(),btrim(payload->>'reason'),before_value,result);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,req,auth.uid(),'save_approval_policy',payload,result);
 return result;
end$$;
revoke all on function finance_private.approval_policy(uuid),finance_private.approval_limit_issue(uuid,jsonb),finance_private.guard_approval_limit(),finance_private.save_approval_policy(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.approval_policy(uuid),finance_private.save_approval_policy(jsonb) to authenticated;
create function public.get_finance_approval_policy(_tenant_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.approval_policy(_tenant_id)$$;
create function public.save_finance_approval_policy(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select finance_private.save_approval_policy(_payload)$$;
revoke all on function public.get_finance_approval_policy(uuid),public.save_finance_approval_policy(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_approval_policy(uuid),public.save_finance_approval_policy(jsonb) to authenticated;
CREATE OR REPLACE FUNCTION finance_private.payable_approval_context(t uuid, payable uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.payables%rowtype;cost jsonb:=null;blockers jsonb:='[]';amount text;paid text;result jsonb;
begin
 perform finance_private.require_access(t);select * into p from public.payables where tenant_id=t and id=payable;
 if p.id is null then raise exception 'finance_payable_not_found' using errcode='22023';end if;
 amount:=finance_private.unloading_repair_cents(to_jsonb(p)->'amount');paid:=finance_private.unloading_repair_cents(to_jsonb(p)->'paid_amount');
 if coalesce(p.status,'') not in('pending','overdue') or coalesce(amount,'')!~'^[1-9][0-9]{0,13}$' or paid is distinct from '0' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_payable_not_approvable','source_table','payables','source_ids',jsonb_build_array(p.id)));end if;
 if p.source_table='finance_expense_items' then
  if exists(select 1 from public.finance_expense_items e where e.tenant_id=t and e.id=p.source_id and e.payable_id=p.id) then cost:=finance_private.expense_cost_effective(t,p.source_id);end if;
  if cost is null or cost->>'verified' is distinct from 'true' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_expense_cost_unverified','source_table','finance_expense_items','source_ids',jsonb_build_array(p.source_id)));end if;
 end if;
 begin perform finance_private.assert_closed_source_mutable(t,'payables',to_jsonb(p));perform finance_private.assert_closed_source_mutable(t,'payables',to_jsonb(p)||jsonb_build_object('status','approved'));
 exception when sqlstate '55000' then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','finance_payable_approval_closed_period','source_table','payables','source_ids',jsonb_build_array(p.id)));end;
 if finance_private.approval_limit_issue(t,to_jsonb(p)) is not null then blockers:=blockers||jsonb_build_array(jsonb_build_object('code',finance_private.approval_limit_issue(t,to_jsonb(p)),'source_table','payables','source_ids',jsonb_build_array(p.id)));end if;
 result:=jsonb_build_object('version',1,'tenant_id',t,'actor_id',auth.uid(),'payable_id',p.id,'obligation',jsonb_build_object('amount_cents',amount,'paid_cents',paid,'status',p.status,'beneficiary_id',p.supplier_id,'beneficiary_name',p.supplier_name,'source_table',p.source_table,'source_id',p.source_id),'cost_origin',cost,'blockers',blockers,'eligible',jsonb_array_length(blockers)=0,'can_approve',finance_private.can_access(t),'can_execute',false,'_evidence',jsonb_build_object('payable',to_jsonb(p),'cost',cost,'approval_policy',finance_private.approval_policy(t)));
 return result||jsonb_build_object('revision',md5(result::text));
end$function$;
notify pgrst,'reload schema';
