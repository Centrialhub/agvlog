-- Local candidate only: preserve memberships, Auth guards, RLS, grants and tenant identities.
-- Existing shared registry edits must not retry a membership INSERT before ON CONFLICT.
-- No data repair, deletion/unlink, Auth operation, role change or new access provisioning.
DO $patch$
DECLARE
  signature regprocedure := to_regprocedure('private.sync_workspace_person_projection()');
  original_body text;
  original_definition text;
  metadata jsonb;
  patched_body text := $body$
declare
  v_kind text := case when tg_table_name='drivers' then 'driver' else 'employee' end;
  v_person_id uuid;
  v_identity text;
  v_name text := new.name;
  v_cpf text;
  v_email text := new.email;
  v_phone text := new.phone;
  v_active boolean;
  v_target record;
  v_target_id uuid;
  v_user_id uuid;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  -- Vehicle assignment and audit timestamps are company-local, not shared-person edits.
  if tg_table_name='drivers' and tg_op='UPDATE'
    and (to_jsonb(new)-array['current_vehicle_id','updated_at','updated_by'])
      is not distinct from (to_jsonb(old)-array['current_vehicle_id','updated_at','updated_by']) then
    return new;
  end if;
  v_cpf := case when tg_table_name='drivers'
    then coalesce(to_jsonb(new)->>'cpf',to_jsonb(new)->>'doc')
    else to_jsonb(new)->>'doc_cpf' end;
  v_active := case when tg_table_name='drivers'
    then coalesce((to_jsonb(new)->>'active')::boolean,false)
    else coalesce(to_jsonb(new)->>'status','inactive')<>'inactive' end;
  v_user_id := nullif(to_jsonb(new)->>'user_id','')::uuid;
  v_identity := case when length(regexp_replace(coalesce(v_cpf,''),'[^0-9]','','g'))=11
    then 'cpf:'||regexp_replace(v_cpf,'[^0-9]','','g') else v_kind||':'||new.id::text end;

  if tg_table_name='drivers' then
    select link.workspace_person_id into v_person_id from public.workspace_person_tenant_links link
    where link.tenant_id=new.tenant_id and link.driver_id=new.id;
  else
    select link.workspace_person_id into v_person_id from public.workspace_person_tenant_links link
    where link.tenant_id=new.tenant_id and link.employee_id=new.id;
  end if;

  if v_person_id is null then
    insert into public.workspace_people(id,workspace_id,identity_key,name,cpf,email,phone,source_data,active,created_at,updated_at)
    values(new.id,new.workspace_id,v_identity,v_name,v_cpf,v_email,v_phone,to_jsonb(new),v_active,new.created_at,new.updated_at)
    on conflict(workspace_id,identity_key) do update set
      name=excluded.name,cpf=excluded.cpf,email=excluded.email,phone=excluded.phone,
      source_data=excluded.source_data,active=excluded.active,updated_at=excluded.updated_at
    returning id into v_person_id;
  else
    update public.workspace_people set name=v_name,cpf=v_cpf,email=v_email,phone=v_phone,
      source_data=to_jsonb(new),active=v_active,updated_at=new.updated_at where id=v_person_id;
  end if;

  if tg_table_name='drivers' then
    insert into public.workspace_person_tenant_links(workspace_id,workspace_person_id,tenant_id,driver_id)
    values(new.workspace_id,v_person_id,new.tenant_id,new.id) on conflict(tenant_id,driver_id) do nothing;
  else
    insert into public.workspace_person_tenant_links(workspace_id,workspace_person_id,tenant_id,employee_id)
    values(new.workspace_id,v_person_id,new.tenant_id,new.id) on conflict(tenant_id,employee_id) do nothing;
  end if;

  for v_target in
    select t.id tenant_id,
      case when v_kind='driver' then link.driver_id else link.employee_id end projection_id
    from public.tenants t
    left join public.workspace_person_tenant_links link on link.workspace_person_id=v_person_id and link.tenant_id=t.id
      and ((v_kind='driver' and link.driver_id is not null) or (v_kind='employee' and link.employee_id is not null))
    where t.workspace_id=new.workspace_id and t.id<>new.tenant_id
  loop
    if v_kind='driver' and v_user_id is not null
      and not exists(select 1 from public.tenant_memberships m
        where m.tenant_id=v_target.tenant_id and m.user_id=v_user_id) then
      insert into public.tenant_memberships(tenant_id,user_id,role,active)
      values(v_target.tenant_id,v_user_id,'driver',true)
      on conflict(tenant_id,user_id) do nothing;
    end if;
    if v_target.projection_id is null then
      v_target_id := private.insert_shared_projection(tg_table_name,to_jsonb(new),v_target.tenant_id,new.workspace_id);
      if v_kind='driver' then
        insert into public.workspace_person_tenant_links(workspace_id,workspace_person_id,tenant_id,driver_id)
        values(new.workspace_id,v_person_id,v_target.tenant_id,v_target_id);
      else
        insert into public.workspace_person_tenant_links(workspace_id,workspace_person_id,tenant_id,employee_id)
        values(new.workspace_id,v_person_id,v_target.tenant_id,v_target_id);
      end if;
    else
      perform private.apply_shared_projection_columns(tg_table_name,to_jsonb(new),v_target.projection_id);
    end if;
  end loop;
  return new;
end;
$body$;
BEGIN
  IF signature IS NULL THEN RAISE EXCEPTION 'driver_projection_dependency_missing'; END IF;
  SELECT prosrc,pg_get_functiondef(oid),to_jsonb(p)-'prosrc'
    INTO original_body,original_definition,metadata FROM pg_proc p WHERE oid=signature;
  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
      WHERE p.oid=signature AND r.rolname='postgres' AND p.prosecdef
        AND p.proconfig=ARRAY['search_path=""']::text[] AND p.prorettype='trigger'::regtype)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.drivers'::regclass
      AND tgname='drivers_sync_workspace_projection' AND tgfoid=signature
      AND tgtype=21 AND tgenabled='O' AND tgqual IS NULL AND tgnargs=0 AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'driver_projection_contract_changed';
  END IF;
  IF md5(patched_body)<>'9dbdd1516632ffdcc7082fa6eae782da' THEN RAISE EXCEPTION 'driver_projection_patch_changed'; END IF;
  IF md5(original_body)='9dbdd1516632ffdcc7082fa6eae782da' THEN RETURN; END IF;
  IF md5(original_body)<>'e57ff8b148a6e8c4ac4b11913f9b8916' THEN RAISE EXCEPTION 'driver_projection_predecessor_changed'; END IF;
  EXECUTE replace(original_definition,original_body,patched_body);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=signature) IS DISTINCT FROM metadata
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=signature)<>'9dbdd1516632ffdcc7082fa6eae782da' THEN
    RAISE EXCEPTION 'driver_projection_metadata_changed';
  END IF;
END;
$patch$;
