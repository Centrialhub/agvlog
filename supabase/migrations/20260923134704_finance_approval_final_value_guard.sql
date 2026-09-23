-- Enforce optional limits against the resulting obligation, preserving the default rule.
create or replace function finance_private.guard_approval_limit()
returns trigger language plpgsql security definer set search_path='' as $$
declare issue text; evidence jsonb; changed_obligation boolean := false;
begin
 if new.status is distinct from 'approved' or auth.uid() is null then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0));
 if not exists(select 1 from finance_private.approval_policies where tenant_id=new.tenant_id and enabled) then return new; end if;

 evidence := to_jsonb(new);
 if tg_op='UPDATE' then
  changed_obligation := row(new.amount,new.supplier_id,new.supplier_name)
    is distinct from row(old.amount,old.supplier_id,old.supplier_name);
  -- A direct write cannot replace the preparation identity while approving.
  evidence := evidence || jsonb_build_object('created_by',old.created_by,'updated_by',old.updated_by);
  if old.status='approved' then
   if changed_obligation then
    raise exception 'finance_approval_requires_review' using errcode='55000';
   end if;
   -- Payment projections and metadata changes do not reapprove the obligation.
   return new;
  end if;
  if row(old.supplier_id,old.supplier_name,old.category,old.description,old.amount,old.due_date,old.competence_date,old.document_number,old.notes,old.receipt_url,old.cost_center)
    is distinct from row(new.supplier_id,new.supplier_name,new.category,new.description,new.amount,new.due_date,new.competence_date,new.document_number,new.notes,new.receipt_url,new.cost_center) then
   evidence := evidence || jsonb_build_object('updated_by',auth.uid());
  end if;
 else
  evidence := evidence || jsonb_build_object('created_by',auth.uid());
 end if;

 issue := finance_private.approval_limit_issue(new.tenant_id,evidence);
 if issue is not null then raise exception '%',issue using errcode='55000'; end if;
 if changed_obligation then
  raise exception 'finance_approval_requires_review' using errcode='55000';
 end if;
 return new;
end $$;
revoke all on function finance_private.guard_approval_limit() from public,anon,authenticated,service_role;

-- Preparation identity is server-owned, including direct authenticated table writes.
create or replace function public.stamp_payable_material_editor_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then return new; end if;
 if tg_op='INSERT' then
  new.created_by := auth.uid();
  new.updated_by := null;
 else
  new.created_by := old.created_by;
  new.updated_by := old.updated_by;
  if row(old.supplier_id,old.supplier_name,old.category,old.description,old.amount,old.due_date,old.competence_date,old.document_number,old.status,old.notes,old.receipt_url,old.cost_center)
    is distinct from row(new.supplier_id,new.supplier_name,new.category,new.description,new.amount,new.due_date,new.competence_date,new.document_number,new.status,new.notes,new.receipt_url,new.cost_center) then
   new.updated_by := auth.uid();
  end if;
 end if;
 return new;
end $$;
drop trigger if exists stamp_payable_material_editor_v1 on public.payables;
create trigger stamp_payable_material_editor_v1 before insert or update on public.payables
 for each row execute function public.stamp_payable_material_editor_v1();
revoke all on function public.stamp_payable_material_editor_v1() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
