create or replace function public.stamp_operational_route_material_editor_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if row(old.name,old.description,old.classification,old.destinations,old.region_name,old.active,old.periodicity_default)
    is distinct from
    row(new.name,new.description,new.classification,new.destinations,new.region_name,new.active,new.periodicity_default) then
    new.updated_by:=auth.uid();
    new.updated_at:=clock_timestamp();
  end if;
  return new;
end $$;

create or replace function public.audit_operational_route_material_edit_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_changed_fields text[];
begin
  if row(old.name,old.description,old.classification,old.destinations,old.region_name,old.active,old.periodicity_default)
    is distinct from
    row(new.name,new.description,new.classification,new.destinations,new.region_name,new.active,new.periodicity_default) then
    v_changed_fields:=array_remove(array[
      case when old.name is distinct from new.name then 'name' end,
      case when old.description is distinct from new.description then 'description' end,
      case when old.classification is distinct from new.classification then 'classification' end,
      case when old.destinations is distinct from new.destinations then 'destinations' end,
      case when old.region_name is distinct from new.region_name then 'region_name' end,
      case when old.active is distinct from new.active then 'active' end,
      case when old.periodicity_default is distinct from new.periodicity_default then 'periodicity_default' end
    ],null);
    insert into public.entity_audit_log(
      tenant_id,entity_type,entity_id,action,old_data,new_data,actor_user_id,source
    ) values(
      new.tenant_id,'operational_route',new.id,
      case when v_changed_fields=array['name']::text[] then 'rename' else 'material_update' end,
      to_jsonb(old),
      to_jsonb(new)||jsonb_build_object('_changed_fields',to_jsonb(v_changed_fields)),
      auth.uid(),'operational_route_editor'
    );
  end if;
  return new;
end $$;

drop trigger if exists trg_operational_routes_audit_name on public.operational_routes;
drop trigger if exists stamp_operational_route_material_editor_v1 on public.operational_routes;
create trigger stamp_operational_route_material_editor_v1
before update on public.operational_routes
for each row execute function public.stamp_operational_route_material_editor_v1();

drop trigger if exists audit_operational_route_material_edit_v1 on public.operational_routes;
create trigger audit_operational_route_material_edit_v1
after update on public.operational_routes
for each row execute function public.audit_operational_route_material_edit_v1();
