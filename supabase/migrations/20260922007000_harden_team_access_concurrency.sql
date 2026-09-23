create or replace function public.audit_tenant_membership_change_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if old is distinct from new then
    insert into public.entity_audit_log(tenant_id,entity_type,entity_id,action,old_data,new_data,actor_user_id,source)
    values(new.tenant_id,'tenant_membership',new.id,'update',to_jsonb(old),to_jsonb(new),auth.uid(),'team_management');
  end if;
  return new;
end;
$function$;

drop trigger if exists audit_tenant_membership_change_v1 on public.tenant_memberships;
create trigger audit_tenant_membership_change_v1 after update on public.tenant_memberships
for each row execute function public.audit_tenant_membership_change_v1();

create or replace function public.update_tenant_membership_v1(
  _membership_id uuid,_expected_updated_at timestamptz,_role text default null,_active boolean default null
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_row public.tenant_memberships%rowtype;
begin
  select * into v_row from public.tenant_memberships where id=_membership_id for update;
  if v_row.id is null or not public.is_tenant_admin(v_row.tenant_id) then raise exception 'not_authorized' using errcode='42501';end if;
  if v_row.updated_at is distinct from _expected_updated_at then raise exception 'membership_revision_conflict' using errcode='40001';end if;
  if v_row.role='owner' then raise exception 'owner_membership_immutable' using errcode='42501';end if;
  if _role is not null and _role not in('admin','operator','driver') then raise exception 'invalid_membership_role' using errcode='22023';end if;
  if _role is null and _active is null then raise exception 'membership_change_required' using errcode='22023';end if;
  update public.tenant_memberships set role=coalesce(_role::public.app_role,role),active=coalesce(_active,active),updated_at=now()
  where id=v_row.id returning * into v_row;
  return to_jsonb(v_row);
end;
$function$;

create or replace function public.mutate_client_portal_access_v1(
  _access_id uuid,_expected_updated_at timestamptz,_action text,_active boolean default null
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_row public.client_portal_access%rowtype;v_new public.client_portal_access%rowtype;
begin
  select * into v_row from public.client_portal_access where id=_access_id for update;
  if v_row.id is null or not public.is_tenant_admin(v_row.tenant_id) then raise exception 'not_authorized' using errcode='42501';end if;
  if v_row.updated_at is distinct from _expected_updated_at then raise exception 'portal_access_revision_conflict' using errcode='40001';end if;
  if _action='set_active' then
    if _active is null then raise exception 'active_value_required' using errcode='22023';end if;
    update public.client_portal_access set active=_active,updated_at=now() where id=v_row.id returning * into v_new;
    insert into public.entity_audit_log(tenant_id,entity_type,entity_id,action,old_data,new_data,actor_user_id,source)
    values(v_row.tenant_id,'client_portal_access',v_row.id,'set_active',to_jsonb(v_row),to_jsonb(v_new),auth.uid(),'portal_access_management');
    return to_jsonb(v_new);
  elsif _action='delete' then
    delete from public.client_portal_access where id=v_row.id;
    insert into public.entity_audit_log(tenant_id,entity_type,entity_id,action,old_data,new_data,actor_user_id,source)
    values(v_row.tenant_id,'client_portal_access',v_row.id,'delete',to_jsonb(v_row),null,auth.uid(),'portal_access_management');
    return jsonb_build_object('id',v_row.id,'deleted',true);
  end if;
  raise exception 'invalid_portal_access_action' using errcode='22023';
end;
$function$;

create or replace function public.replace_portal_access_after_invite_v1(
  _old_access_id uuid,_expected_updated_at timestamptz,_new_user_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_old public.client_portal_access%rowtype;v_new public.client_portal_access%rowtype;
begin
  select * into v_old from public.client_portal_access where id=_old_access_id for update;
  if v_old.id is null or not public.is_tenant_admin(v_old.tenant_id) then raise exception 'not_authorized' using errcode='42501';end if;
  if v_old.updated_at is distinct from _expected_updated_at then raise exception 'portal_access_revision_conflict' using errcode='40001';end if;
  select * into v_new from public.client_portal_access where tenant_id=v_old.tenant_id and user_id=_new_user_id
    and client_id=v_old.client_id and access_type=v_old.access_type for update;
  if v_new.id is null then raise exception 'invited_portal_access_not_found' using errcode='22023';end if;
  delete from public.client_portal_access where id=v_old.id;
  insert into public.entity_audit_log(tenant_id,entity_type,entity_id,action,old_data,new_data,actor_user_id,source)
  values(v_old.tenant_id,'client_portal_access',v_old.id,'transfer_after_invite',to_jsonb(v_old),to_jsonb(v_new),auth.uid(),'portal_access_management');
  return to_jsonb(v_new);
end;
$function$;

revoke all on function public.update_tenant_membership_v1(uuid,timestamptz,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.mutate_client_portal_access_v1(uuid,timestamptz,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.replace_portal_access_after_invite_v1(uuid,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.update_tenant_membership_v1(uuid,timestamptz,text,boolean) to authenticated;
grant execute on function public.mutate_client_portal_access_v1(uuid,timestamptz,text,boolean) to authenticated;
grant execute on function public.replace_portal_access_after_invite_v1(uuid,timestamptz,uuid) to authenticated;
