alter table public.payables add column if not exists updated_by uuid;

create or replace function public.stamp_payable_material_editor_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if row(old.supplier_id,old.supplier_name,old.category,old.description,old.amount,old.due_date,old.competence_date,old.document_number,old.status,old.notes,old.receipt_url,old.cost_center)
    is distinct from row(new.supplier_id,new.supplier_name,new.category,new.description,new.amount,new.due_date,new.competence_date,new.document_number,new.status,new.notes,new.receipt_url,new.cost_center) then
    new.updated_by:=auth.uid();
  end if;
  return new;
end;$function$;

create or replace function public.audit_payable_material_edit_v1()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if row(old.supplier_id,old.supplier_name,old.category,old.description,old.amount,old.due_date,old.competence_date,old.document_number,old.status,old.notes,old.receipt_url,old.cost_center)
    is distinct from row(new.supplier_id,new.supplier_name,new.category,new.description,new.amount,new.due_date,new.competence_date,new.document_number,new.status,new.notes,new.receipt_url,new.cost_center) then
    insert into public.entity_audit_log(tenant_id,entity_type,entity_id,action,old_data,new_data,actor_user_id,source)
    values(new.tenant_id,'payable',new.id,'material_update',to_jsonb(old),to_jsonb(new),auth.uid(),'payable_editor');
  end if;
  return new;
end;$function$;

drop trigger if exists stamp_payable_material_editor_v1 on public.payables;
create trigger stamp_payable_material_editor_v1 before update on public.payables
for each row execute function public.stamp_payable_material_editor_v1();
drop trigger if exists audit_payable_material_edit_v1 on public.payables;
create trigger audit_payable_material_edit_v1 after update on public.payables
for each row execute function public.audit_payable_material_edit_v1();
