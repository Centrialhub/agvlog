alter table public.incidents alter column actual_cost drop default;
update public.incidents set actual_cost=null where actual_cost=0;

create table if not exists public.incident_versions(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  incident_id uuid not null,
  version_at timestamptz not null default now(),
  actor_id uuid,
  old_data jsonb not null,
  new_data jsonb not null
);
alter table public.incident_versions enable row level security;
revoke all on public.incident_versions from public,anon;
grant select on public.incident_versions to authenticated;
drop policy if exists incident_versions_select on public.incident_versions;
create policy incident_versions_select on public.incident_versions for select to authenticated
using(public.is_tenant_member(tenant_id));

create or replace function public.audit_incident_version_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if old is distinct from new then
    insert into public.incident_versions(tenant_id,incident_id,actor_id,old_data,new_data)
    values(new.tenant_id,new.id,auth.uid(),to_jsonb(old),to_jsonb(new));
    insert into public.entity_audit_log(tenant_id,entity_type,entity_id,action,old_data,new_data,actor_user_id,source)
    values(new.tenant_id,'incident',new.id,'update',to_jsonb(old),to_jsonb(new),auth.uid(),'incident_update');
  end if;
  return new;
end;
$function$;
drop trigger if exists audit_incident_version_v1 on public.incidents;
create trigger audit_incident_version_v1 after update on public.incidents
for each row execute function public.audit_incident_version_v1();

create or replace function public.require_incident_responsibility_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if new.status in('resolved','closed') and new.severity in('high','critical') and not exists(
    select 1 from public.incident_responsible responsible
    where responsible.tenant_id=new.tenant_id and responsible.incident_id=new.id
      and responsible.acknowledged is true
      and nullif(btrim(responsible.responsibility_type),'') is not null
      and nullif(btrim(responsible.final_opinion),'') is not null
  ) then raise exception 'incident_responsibility_required' using errcode='23514'; end if;
  return new;
end;
$function$;
drop trigger if exists require_incident_responsibility_v1 on public.incidents;
create constraint trigger require_incident_responsibility_v1 after insert or update on public.incidents
deferrable initially immediate for each row execute function public.require_incident_responsibility_v1();

create or replace function public.add_employee_incident_action(_incident_id uuid,_employee_id uuid,_action_type text,_description text default null,_amount numeric default 0,_effective_date date default null)
returns uuid language plpgsql security definer set search_path='' as $function$
declare v_tenant uuid;v_category text;v_incident_employee uuid;v_emp_tenant uuid;v_new_id uuid;v_status text;v_completed_by uuid;v_completed_at timestamptz;
 v_allowed text[]:=array['note','verbal_warning','written_warning','suspension','training_required','payroll_discount','document_request','termination_recommendation','other'];
 v_formal text[]:=array['verbal_warning','written_warning','suspension','training_required','document_request','termination_recommendation'];
begin
 if _action_type is null or not(_action_type=any(v_allowed)) then raise exception 'invalid_action_type' using errcode='22023';end if;
 select tenant_id,category,employee_id into v_tenant,v_category,v_incident_employee from public.incidents where id=_incident_id;
 if v_tenant is null then raise exception 'incident_not_found' using errcode='22023';end if;
 if not public.is_tenant_operator_or_admin(v_tenant) then raise exception 'not_authorized' using errcode='42501';end if;
 if _action_type='payroll_discount' and not public.is_tenant_admin(v_tenant) then raise exception 'admin_required_for_payroll_discount' using errcode='42501';end if;
 if coalesce(v_category,'') not in('hr','rh') then raise exception 'incident_not_hr' using errcode='22023';end if;
 if v_incident_employee is null or v_incident_employee<>_employee_id then raise exception 'employee_mismatch' using errcode='22023';end if;
 select tenant_id into v_emp_tenant from public.employees where id=_employee_id;
 if v_emp_tenant is distinct from v_tenant then raise exception 'employee_tenant_mismatch' using errcode='22023';end if;
 if nullif(btrim(coalesce(_description,'')),'') is null then raise exception 'incident_action_description_required' using errcode='22023';end if;
 if _action_type=any(v_formal) and _effective_date is null then raise exception 'incident_action_effective_date_required' using errcode='22023';end if;
 if _action_type='payroll_discount' and (coalesce(_amount,0)<=0 or _effective_date is null) then raise exception 'discount_amount_and_date_required' using errcode='22023';end if;
 if _action_type='payroll_discount' then v_status:='completed';v_completed_by:=auth.uid();v_completed_at:=now();else v_status:='open';end if;
 insert into public.employee_incident_actions(tenant_id,incident_id,employee_id,action_type,description,amount,effective_date,status,completed_by,completed_at,created_by)
 values(v_tenant,_incident_id,_employee_id,_action_type,btrim(_description),coalesce(_amount,0),_effective_date,v_status,v_completed_by,v_completed_at,auth.uid()) returning id into v_new_id;
 return v_new_id;
end;
$function$;

create or replace function public.set_employee_incident_action_status_v1(_action_id uuid,_status text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_action public.employee_incident_actions%rowtype;
begin
 select * into v_action from public.employee_incident_actions where id=_action_id for update;
 if v_action.id is null or not public.is_tenant_operator_or_admin(v_action.tenant_id) then raise exception 'not_authorized' using errcode='42501';end if;
 if _status not in('completed','cancelled') then raise exception 'invalid_action_status' using errcode='22023';end if;
 if v_action.status<>'open' then raise exception 'incident_action_not_open' using errcode='23514';end if;
 update public.employee_incident_actions set status=_status,completed_by=auth.uid(),completed_at=now() where id=_action_id;
 return jsonb_build_object('id',_action_id,'status',_status,'completed_by',auth.uid(),'completed_at',now());
end;
$function$;

drop policy if exists eia_insert on public.employee_incident_actions;
drop policy if exists eia_update on public.employee_incident_actions;
revoke insert,update on public.employee_incident_actions from authenticated;
revoke all on function public.add_employee_incident_action(uuid,uuid,text,text,numeric,date) from public,anon,authenticated,service_role;
grant execute on function public.add_employee_incident_action(uuid,uuid,text,text,numeric,date) to authenticated;
revoke all on function public.set_employee_incident_action_status_v1(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.set_employee_incident_action_status_v1(uuid,text) to authenticated;
