-- Recoverable manual titles. Business amounts and sources remain server controlled.
create or replace function finance_private.save_manual_title(_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare t uuid:=(_payload->>'tenant_id')::uuid; actor uuid:=auth.uid(); req uuid:=(_payload->>'request_id')::uuid;
 kind text:=_payload->>'kind'; identifier uuid:=nullif(_payload->>'id','')::uuid;
 fields jsonb:=_payload->'fields'; prior public.finance_commands%rowtype;
 p public.payables%rowtype; r public.receivables%rowtype; before_row jsonb; saved jsonb; result jsonb; duplicate_id uuid;
begin
 perform finance_private.require_access(t);
 if kind='receivable' and not coalesce(public.is_tenant_admin(t),false) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if jsonb_typeof(_payload) is distinct from 'object' or _payload->>'version' is distinct from '1' or req is null
 or kind is null or kind not in('payable','receivable') or jsonb_typeof(fields) is distinct from 'object'
 or (identifier is not null and nullif(_payload->>'expected_updated_at','') is null)
 or length(coalesce(_payload->>'duplicate_reason',''))>2000
 or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','kind','id','expected_updated_at','fields','duplicate_reason'))
 or exists(select 1 from jsonb_object_keys(fields) k where
   (kind='payable' and k not in('supplier_name','category','description','amount','due_date','competence_date','document_number','status','notes'))
   or(kind='receivable' and k not in('client_id','description','amount','due_date','invoice_number','status','notes')))
 then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('fiscal:'||t::text,0));
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 perform finance_private.require_access(t);
 if kind='receivable' and not coalesce(public.is_tenant_admin(t),false) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into prior from public.finance_commands where tenant_id=t and request_id=req;
 if found then
  if prior.actor_id is distinct from actor or prior.action<>'save_manual_title' or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;
  return prior.result;
 end if;
 if fields ? 'amount' and (jsonb_typeof(fields->'amount') is distinct from 'number' or (fields->>'amount')::numeric<=0 or (fields->>'amount')::numeric<>trunc((fields->>'amount')::numeric,2)) then raise exception 'finance_invalid_amount' using errcode='22023';end if;
 if identifier is null and (not(fields ? 'amount') or coalesce(fields->>'status','pending') not in('pending','overdue','cancelled')) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 if kind='payable' then
  if fields->>'status'='approved' then raise exception 'finance_payable_approval_revision_required' using errcode='55000';end if;
  if identifier is null then
   p.tenant_id:=t;p.id:=gen_random_uuid();p.source:='manual';p.status:='pending';p.category:='supplier';p.paid_amount:=0;
   p.created_by:=actor;p.created_at:=clock_timestamp();p.updated_at:=p.created_at;p.source_metadata:='{}';
  else
   select * into p from public.payables where tenant_id=t and id=identifier for update;
   if p.id is null or p.source_table is not null or p.source_id is not null then raise exception 'finance_manual_title_origin_required' using errcode='55000';end if;
   if p.updated_at is distinct from nullif(_payload->>'expected_updated_at','')::timestamptz then raise exception 'finance_manual_title_changed' using errcode='40001';end if;
   before_row:=to_jsonb(p);
  end if;
  p:=jsonb_populate_record(p,fields);
  if length(btrim(coalesce(p.supplier_name,'')))=0 or p.status not in('pending','approved','overdue','cancelled') then raise exception 'finance_invalid_payload' using errcode='22023';end if;
  if identifier is null then
   select id into duplicate_id from public.payables where tenant_id=t and status<>'cancelled'
    and lower(btrim(supplier_name))=lower(btrim(p.supplier_name)) and amount=p.amount
    and document_number is not distinct from p.document_number and due_date is not distinct from p.due_date order by id limit 1;
   if duplicate_id is not null and length(btrim(coalesce(_payload->>'duplicate_reason','')))<10 then raise exception 'finance_possible_duplicate' using errcode='22023';end if;
   insert into public.payables(id,tenant_id,supplier_name,category,description,amount,due_date,competence_date,document_number,status,notes,source,created_by)
    values(p.id,t,btrim(p.supplier_name),p.category,p.description,p.amount,p.due_date,p.competence_date,p.document_number,p.status,p.notes,'manual',actor) returning to_jsonb(payables.*) into saved;
  else
   update public.payables set supplier_name=btrim(p.supplier_name),category=p.category,description=p.description,amount=p.amount,
    due_date=p.due_date,competence_date=p.competence_date,document_number=p.document_number,status=p.status,notes=p.notes,
    updated_at=clock_timestamp() where id=identifier and tenant_id=t returning to_jsonb(payables.*) into saved;
  end if;
 else
  if identifier is null then
   r.id:=gen_random_uuid();r.tenant_id:=t;r.status:='pending';r.received_amount:=0;r.created_by:=actor;
  else
   select * into r from public.receivables where tenant_id=t and id=identifier for update;
   if r.id is null then raise exception 'finance_manual_title_not_found' using errcode='22023';end if;
   if r.updated_at is distinct from nullif(_payload->>'expected_updated_at','')::timestamptz then raise exception 'finance_manual_title_changed' using errcode='40001';end if;
   before_row:=to_jsonb(r);
  end if;
  r:=jsonb_populate_record(r,fields);
  if r.client_id is not null and not exists(select 1 from public.clients where tenant_id=t and id=r.client_id) then raise exception 'finance_invalid_client' using errcode='22023';end if;
  if identifier is null then
   if r.status not in('pending','cancelled') then raise exception 'finance_invalid_payload' using errcode='22023';end if;
   select id into duplicate_id from public.receivables where tenant_id=t and status<>'cancelled' and client_id is not distinct from r.client_id
    and amount=r.amount and invoice_number is not distinct from r.invoice_number and due_date is not distinct from r.due_date order by id limit 1;
   if duplicate_id is not null and length(btrim(coalesce(_payload->>'duplicate_reason','')))<10 then raise exception 'finance_possible_duplicate' using errcode='22023';end if;
   insert into public.receivables(id,tenant_id,client_id,description,amount,due_date,invoice_number,status,notes,created_by)
    values(r.id,t,r.client_id,r.description,r.amount,r.due_date,r.invoice_number,r.status,r.notes,actor) returning to_jsonb(receivables.*) into saved;
  else
   update public.receivables set client_id=r.client_id,description=r.description,amount=r.amount,due_date=r.due_date,
    invoice_number=r.invoice_number,status=r.status,notes=r.notes,updated_by=actor,updated_at=clock_timestamp()
    where id=identifier and tenant_id=t returning to_jsonb(receivables.*) into saved;
  end if;
 end if;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data)
 values(t,kind,(saved->>'id')::uuid,case when identifier is null then 'manual_title_created' else 'manual_title_updated' end,
 actor,actor::text,coalesce(nullif(btrim(_payload->>'duplicate_reason'),''),'Cadastro manual revisado'),before_row,saved);
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',req,'confirmed',true,'kind',kind,'record',saved);
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,req,actor,'save_manual_title',_payload,result);
 return result;
end;$function$;
revoke all on function finance_private.save_manual_title(jsonb) from public,anon,authenticated,service_role;
grant execute on function finance_private.save_manual_title(jsonb) to authenticated;
create or replace function public.save_finance_manual_title(_payload jsonb) returns jsonb language sql security invoker set search_path=''
as $$select finance_private.save_manual_title(_payload)$$;
revoke all on function public.save_finance_manual_title(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_finance_manual_title(jsonb) to authenticated;
notify pgrst,'reload schema';
alter table public.payables drop constraint if exists payables_amount_positive;
alter table public.payables add constraint payables_amount_positive check(amount>0) not valid;

do $validation$
begin
  if not exists(select 1 from public.payables where amount<=0) then
    alter table public.payables validate constraint payables_amount_positive;
  end if;
end;$validation$;

drop policy if exists payables_direct_manual_update on public.payables;
create policy payables_direct_manual_update on public.payables as restrictive for update to authenticated
using(source_table is null and source_id is null)
with check(source_table is null and source_id is null);

comment on policy payables_direct_manual_update on public.payables is
  'Browser row updates are limited to standalone titles; derived titles change through their canonical source commands.';

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


revoke all on function public.stamp_payable_material_editor_v1() from public,anon,authenticated,service_role;
revoke all on function public.audit_payable_material_edit_v1() from public,anon,authenticated,service_role;
revoke execute on function public.update_driver_settlement_km_review(uuid,numeric,text,text,numeric,numeric,text,text) from public,anon;
revoke execute on function public.update_driver_settlement_status(uuid,text,text,boolean) from public,anon;
revoke execute on function public.create_manual_driver_settlement(uuid,uuid,uuid,date,uuid[]) from public,anon;
