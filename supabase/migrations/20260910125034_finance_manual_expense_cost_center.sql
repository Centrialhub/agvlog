create or replace function finance_private.record_manual_expense(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid;request uuid;actor uuid:=auth.uid();prior public.finance_commands%rowtype;
 center uuid;center_name text;cents bigint;supplier uuid;movement uuid;payable uuid;allocation jsonb;result jsonb;actor_name text;receipt text;evidence jsonb;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 t:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if request is null or _payload->>'version' is distinct from '1'
 or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','request_id','supplier_id','supplier_name','category','description','amount_cents','due_date','competence_date','document_number','notes','movement_id','method','reason','receipt_path','cost_center_id')) then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':finance',0));
 if not finance_private.can_access(t) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select * into prior from public.finance_commands where tenant_id=t and request_id=request;
 if found then
  if prior.actor_id<>actor or prior.action<>'record_manual_expense' or prior.payload<>_payload then raise exception 'finance_request_conflict' using errcode='23505';end if;
  return prior.result;
 end if;
 if coalesce(_payload->>'amount_cents','') !~ '^[0-9]{1,14}$'
 or length(btrim(coalesce(_payload->>'reason',''))) not between 5 and 2000
 or length(btrim(coalesce(_payload->>'description',''))) not between 1 and 1000
 or length(btrim(coalesce(_payload->>'supplier_name',''))) not between 1 and 300
 or nullif(btrim(_payload->>'category'),'') is null then raise exception 'finance_invalid_payload' using errcode='22023';end if;
 cents:=(_payload->>'amount_cents')::bigint;
 if cents<=0 then raise exception 'finance_invalid_payment_amount' using errcode='22023';end if;
 supplier:=nullif(_payload->>'supplier_id','')::uuid;movement:=nullif(_payload->>'movement_id','')::uuid;
 receipt:=nullif(btrim(_payload->>'receipt_path'),'');
 if receipt is not null then
  if receipt not like t::text||'/payable-payments/%' or receipt like '%..%' then raise exception 'finance_invalid_receipt_scope' using errcode='22023';end if;
  select to_jsonb(o) into evidence from storage.objects o where bucket_id='receipts' and name=receipt for share nowait;
  if evidence is null then raise exception 'finance_receipt_not_found' using errcode='22023';end if;
  if coalesce(evidence#>>'{metadata,mimetype}','') not in('application/pdf','image/jpeg','image/png','image/webp') or coalesce(evidence#>>'{metadata,size}','') !~ '^[1-9][0-9]{0,7}$' then raise exception 'finance_invalid_receipt_metadata' using errcode='22023';end if;
 end if;
 if supplier is not null then
  perform 1 from public.clients c where c.tenant_id=t and c.id=supplier and c.active and c.is_supplier for share;
  if not found then raise exception 'finance_invalid_supplier' using errcode='22023';end if;
 end if;
 center:=nullif(_payload->>'cost_center_id','')::uuid;
 if center is not null then
  select c.name into center_name from public.cost_centers c where c.id=center and c.tenant_id=t and c.active for share;
  if not found then raise exception 'finance_invalid_cost_center' using errcode='22023';end if;
 end if;
 insert into public.payables(tenant_id,supplier_name,supplier_id,category,description,amount,due_date,competence_date,document_number,notes,status,source,created_by,cost_center)
 values(t,btrim(_payload->>'supplier_name'),supplier,_payload->>'category',btrim(_payload->>'description'),cents::numeric/100,
  nullif(_payload->>'due_date','')::date,nullif(_payload->>'competence_date','')::date,nullif(btrim(_payload->>'document_number'),''),nullif(btrim(_payload->>'notes'),''),
  case when movement is null then 'pending' else 'approved' end,'manual',actor,center_name) returning id into payable;
 if receipt is not null then
  insert into public.finance_manual_expense_evidence(tenant_id,payable_id,receipt_path,evidence,created_by) values(t,payable,receipt,evidence,actor);
  update public.payables set receipt_url=receipt where id=payable and tenant_id=t;
 end if;
 if movement is not null then
  allocation:=finance_private.apply_payable_movement(jsonb_build_object('version',1,'tenant_id',t,'request_id',gen_random_uuid(),
   'payable_id',payable,'movement_id',movement,'amount_cents',cents,'method',coalesce(_payload->>'method','other'),'reason',btrim(_payload->>'reason')));
 end if;
 result:=jsonb_build_object('version',1,'tenant_id',t,'request_id',request,'payable_id',payable,'movement_id',movement,'allocation',allocation,'confirmed',true,'cash_created',false);
 select coalesce(u.raw_user_meta_data->>'full_name',u.email,actor::text) into actor_name from auth.users u where u.id=actor;
 insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data)
 values(t,'payable',payable,'manual_expense_recorded',actor,coalesce(actor_name,actor::text),btrim(_payload->>'reason'),result||jsonb_build_object('amount_cents',cents,'category',_payload->>'category','cost_center_id',center,'cost_center_name',center_name));
 insert into public.finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(t,request,actor,'record_manual_expense',_payload,result);
 return result;
end$$;
