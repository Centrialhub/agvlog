-- Final lifecycle and recovery fixes reported in bugs 149-179.

create or replace function finance_private.reported_normalized_party(_value text) returns text
language sql immutable strict set search_path='' as $$
 select nullif(regexp_replace(lower(btrim(_value)),'[^a-z0-9]+','','g'),'');
$$;
revoke all on function finance_private.reported_normalized_party(text) from public,anon,authenticated,service_role;

create or replace function finance_private.guard_reported_payable_lifecycle() returns trigger
language plpgsql security definer set search_path='' as $$
declare material_changed boolean;paid numeric;
begin
 material_changed:=tg_op='UPDATE' and (row(old.supplier_id,old.supplier_name,old.category,old.description,old.amount,old.due_date,old.document_number,old.notes)
   is distinct from row(new.supplier_id,new.supplier_name,new.category,new.description,new.amount,new.due_date,new.document_number,new.notes));
 if tg_op='INSERT' and new.status='paid' then raise exception 'finance_payable_payment_required' using errcode='23514';end if;
 if tg_op='UPDATE' and old.status='paid' and material_changed then raise exception 'finance_paid_payable_immutable' using errcode='55000';end if;
 if tg_op='UPDATE' and old.status='approved' and material_changed then new.status:='pending';new.approved_at:=null;new.approved_by:=null;end if;
 if tg_op='UPDATE' and new.status<>'approved' then new.approved_at:=null;new.approved_by:=null;end if;
 if tg_op='UPDATE' and new.status<>'paid' then new.paid_at:=null;end if;
 if new.status='paid' then
  select coalesce(sum(amount),0) into paid from public.payables_payments where tenant_id=new.tenant_id and payable_id=new.id;
  if paid<new.amount then raise exception 'finance_payable_payment_required' using errcode='23514';end if;
 end if;
 if tg_op='UPDATE' and new.status='cancelled' and old.status<>'cancelled' and exists(select 1 from public.payables_payments where tenant_id=new.tenant_id and payable_id=new.id) then
  raise exception 'finance_payable_reverse_payments_first' using errcode='55000';
 end if;
 return new;
end$$;
drop trigger if exists a_reported_payable_lifecycle on public.payables;
create trigger a_reported_payable_lifecycle before insert or update on public.payables for each row execute function finance_private.guard_reported_payable_lifecycle();

create or replace function finance_private.guard_reported_movement_party() returns trigger
language plpgsql security definer set search_path='' as $$
declare movement_name text;expected_name text;
begin
 if tg_table_name='finance_payable_movement_links' then
  select m.beneficiary_name,p.supplier_name into movement_name,expected_name
  from public.finance_movements m join public.payables p on p.tenant_id=new.tenant_id and p.id=new.payable_id
  where m.tenant_id=new.tenant_id and m.id=new.movement_id;
 else
  select m.beneficiary_name,c.company_name into movement_name,expected_name
  from public.finance_movements m
  join public.receivables_payments rp on rp.tenant_id=new.tenant_id and rp.id=new.payment_id
  join public.receivables r on r.tenant_id=rp.tenant_id and r.id=rp.receivable_id
  join public.clients c on c.tenant_id=r.tenant_id and c.id=r.client_id
  where m.tenant_id=new.tenant_id and m.id=new.movement_id;
 end if;
 if finance_private.reported_normalized_party(movement_name) is null or finance_private.reported_normalized_party(expected_name) is null
   or finance_private.reported_normalized_party(movement_name) is distinct from finance_private.reported_normalized_party(expected_name)
 then raise exception 'finance_movement_party_mismatch' using errcode='23514';end if;
 return new;
end$$;
drop trigger if exists reported_payable_movement_party on public.finance_payable_movement_links;
create trigger reported_payable_movement_party before insert on public.finance_payable_movement_links for each row execute function finance_private.guard_reported_movement_party();
drop trigger if exists reported_receivable_movement_party on public.finance_receivable_movement_links;
create trigger reported_receivable_movement_party before insert on public.finance_receivable_movement_links for each row when(new.action='receive') execute function finance_private.guard_reported_movement_party();

-- Forecast only includes supported active cash accounts and genuinely open titles.
do $$declare d text;sig regprocedure;begin
 sig:=to_regprocedure('finance_private.cash_forecast_collect_before_agenda(uuid,date,date)');
 if sig is not null then
  d:=pg_get_functiondef(sig);
  d:=replace(d,'from public.bank_accounts where tenant_id=_tenant order by id','from public.bank_accounts where tenant_id=_tenant and active and account_type in(''cash'',''checking'',''savings'',''money_market'') order by id');
  d:=replace(d,$find$a.account_type in('checking','savings')$find$,$replacement$a.account_type in('checking','savings','money_market')$replacement$);
  d:=replace(d,$find$from public.receivables where tenant_id=_tenant and status is distinct from 'cancelled' order by id$find$,$replacement$from public.receivables where tenant_id=_tenant and status is distinct from 'cancelled' and coalesce(received_amount,0)<amount order by id$replacement$);
  d:=replace(d,$find$from public.payables where tenant_id=_tenant and status is distinct from 'cancelled' order by id$find$,$replacement$from public.payables where tenant_id=_tenant and status not in('paid','cancelled') and coalesce(paid_amount,0)<amount order by id$replacement$);
  execute d;
 end if;
end$$;

-- Resolve renegotiated installment sources through their parent receivable.
create or replace function finance_private.cash_forecast_identified_sources(t uuid,_page jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item jsonb;rows jsonb:='[]';data jsonb;party text;label text;description text;document text;origin_id uuid;parent_id uuid;
begin
 perform finance_private.require_access(t);
 if _page->>'tenant_id' is distinct from t::text or _page->>'actor_id' is distinct from auth.uid()::text or jsonb_typeof(_page->'rows') is distinct from 'array' or jsonb_array_length(_page->'rows')>30 then raise exception 'finance_forecast_identification_scope_invalid' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(_page->'rows') loop
  data:=null;party:=null;label:=null;description:=null;document:=null;
  if _page->>'kind'='origins' then
   origin_id:=(item->>'source_id')::uuid;
   if item->>'source_table'='payables' then select to_jsonb(p) into data from public.payables p where p.tenant_id=t and p.id=origin_id;party:=data->>'supplier_name';description:=data->>'description';document:=data->>'document_number';label:='Conta a pagar';
   elsif item->>'source_table'='receivables' then
    parent_id:=case when item->>'economic_key'~'^receivable:[0-9a-f-]{36}:installment:' then split_part(item->>'economic_key',':',2)::uuid else origin_id end;
    select to_jsonb(r),c.company_name into data,party from public.receivables r left join public.clients c on c.tenant_id=t and c.id=r.client_id where r.tenant_id=t and r.id=parent_id;
    description:=data->>'description';document:=data->>'invoice_number';label:='Conta a receber';
   elsif item->>'source_table' in('fiscal_documents','delivery_attempts') then select to_jsonb(f),c.company_name into data,party from public.fiscal_documents f left join public.clients c on c.tenant_id=t and c.id=f.client_id where f.tenant_id=t and (item->>'source_table'='fiscal_documents' and f.id=origin_id or item->>'source_table'='delivery_attempts' and exists(select 1 from public.delivery_attempts d where d.tenant_id=t and d.id=origin_id and d.fiscal_document_id=f.id));description:=data->>'product_summary';document:=data->>'invoice_number';label:='Frete a faturar';end if;
  elsif _page->>'kind'='movements' then select to_jsonb(m),a.name into data,label from public.finance_movements m left join public.bank_accounts a on a.tenant_id=t and a.id=m.bank_account_id where m.tenant_id=t and m.id=(item->>'movement_id')::uuid;party:=data->>'beneficiary_name';description:=data->>'description';
  elsif _page->>'kind'='credits' then select c.company_name into party from public.clients c where c.tenant_id=t and c.id=(item->>'payer_id')::uuid;label:='Crédito de cliente';end if;
  if _page->>'kind'<>'issues' then item:=item||jsonb_build_object('display',jsonb_build_object('basis','current_identification','label',label,'party_name',party,'description',description,'document_number',document));end if;rows:=rows||jsonb_build_array(item);
 end loop;return jsonb_set(_page,'{rows}',rows);
end$$;
revoke all on function finance_private.cash_forecast_identified_sources(uuid,jsonb) from public,anon,authenticated,service_role;

-- A revoked agreement may be replaced by a new audited agreement.
do $$declare d text;sig regprocedure:=to_regprocedure('finance_private.receivable_agreement_context(uuid,uuid,jsonb)');begin
 if sig is not null then d:=pg_get_functiondef(sig);d:=replace(d,$find$action='create' and pos->>'status'<>'none'$find$,$replacement$action='create' and pos->>'status' not in('none','revoked')$replacement$);execute d;end if;
end$$;

-- Keep only the latest 20 agenda events in projections/snapshots; full history stays in its journal reader.
do $$declare d text;sig regprocedure:=to_regprocedure('finance_private.cash_forecast_collect_without_agreements(uuid,date,date)');begin
 if sig is not null then
  d:=pg_get_functiondef(sig);
  d:=replace(d,$find$from finance_private.cash_forecast_agenda_events e where e.tenant_id=_tenant and e.economic_key=r->>'economic_key'$find$,$replacement$from (select * from finance_private.cash_forecast_agenda_events e0 where e0.tenant_id=_tenant and e0.economic_key=r->>'economic_key' order by e0.ordinal desc limit 20) e$replacement$);
  execute d;
 end if;
end$$;

-- Private XML originals can be recovered, and unlinked uploads can be explicitly discarded.
create or replace function payable_xml_private.can_read_original(_path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from payable_xml_private.artifacts a join payable_xml_private.links l on l.artifact_id=a.id where a.tenant_id=private.request_tenant_id() and a.tenant_id=l.tenant_id and a.tenant_id::text||'/'||a.actor_id::text||'/'||a.request_id::text||'/original'=_path and finance_private.can_access(a.tenant_id));
$$;
revoke all on function payable_xml_private.can_read_original(text) from public,anon;grant execute on function payable_xml_private.can_read_original(text) to authenticated;
drop policy if exists payable_xml_original_read on storage.objects;
create policy payable_xml_original_read on storage.objects for select to authenticated using(bucket_id='payable-xml-quarantine' and payable_xml_private.can_read_original(name));
create or replace function public.get_finance_payable_xml_locator_v1(_tenant_id uuid,_link_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p text;begin perform finance_private.require_access(_tenant_id);select a.tenant_id::text||'/'||a.actor_id::text||'/'||a.request_id::text||'/original' into p from payable_xml_private.links l join payable_xml_private.artifacts a on a.id=l.artifact_id where l.tenant_id=_tenant_id and l.id=_link_id;if p is null then raise exception 'payable_xml_not_found';end if;return jsonb_build_object('bucket','payable-xml-quarantine','path',p);end$$;
revoke all on function public.get_finance_payable_xml_locator_v1(uuid,uuid) from public,anon;grant execute on function public.get_finance_payable_xml_locator_v1(uuid,uuid) to authenticated;
create or replace function public.discard_finance_payable_xml_upload_v1(_tenant_id uuid,_artifact_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare a payable_xml_private.artifacts%rowtype;begin perform finance_private.require_access(_tenant_id);select * into a from payable_xml_private.artifacts where tenant_id=_tenant_id and id=_artifact_id and actor_id=auth.uid() for update;if not found or exists(select 1 from payable_xml_private.links where tenant_id=_tenant_id and artifact_id=a.id) then raise exception 'payable_xml_discard_unavailable';end if;perform set_config('app.payable_xml_discard',a.id::text,true);delete from storage.objects where bucket_id='payable-xml-quarantine' and name=a.tenant_id::text||'/'||a.actor_id::text||'/'||a.request_id::text||'/original';delete from payable_xml_private.artifacts where id=a.id;return true;end$$;
revoke all on function public.discard_finance_payable_xml_upload_v1(uuid,uuid) from public,anon;grant execute on function public.discard_finance_payable_xml_upload_v1(uuid,uuid) to authenticated;
create or replace function payable_xml_private.preserve_object() returns trigger language plpgsql set search_path='' as $$begin if old.bucket_id='payable-xml-quarantine' and current_setting('app.payable_xml_discard',true) is distinct from (old.user_metadata->>'artifact_id') then raise exception 'payable_xml_immutable' using errcode='55000';end if;return coalesce(new,old);end$$;

-- List standalone statement artifacts by account so quarantined PDF/images remain discoverable.
create or replace function public.list_finance_account_artifacts_v1(_tenant_id uuid,_account_id uuid,_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;total integer;begin perform finance_private.require_access(_tenant_id);if _offset<0 then raise exception 'invalid_offset';end if;select count(*) into total from secure_upload_private.artifacts where tenant_id=_tenant_id and source_type='bank_account' and source_id=_account_id;select coalesce(jsonb_agg(secure_upload_private.dto(a) order by a.created_at desc,a.id),'[]') into rows from (select * from secure_upload_private.artifacts where tenant_id=_tenant_id and source_type='bank_account' and source_id=_account_id order by created_at desc,id limit 30 offset _offset)a;return jsonb_build_object('tenant_id',_tenant_id,'account_id',_account_id,'offset',_offset,'total',total,'rows',rows,'next_offset',case when _offset+jsonb_array_length(rows)<total then _offset+jsonb_array_length(rows) end);end$$;
revoke all on function public.list_finance_account_artifacts_v1(uuid,uuid,integer) from public,anon;grant execute on function public.list_finance_account_artifacts_v1(uuid,uuid,integer) to authenticated;

-- Full compensating reversal for an incorrectly linked credit refund.
create table if not exists finance_private.customer_credit_refund_reversals(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,refund_id uuid not null unique references finance_private.customer_credit_refunds(id),actor_id uuid not null,actor_name text not null,reason text not null check(length(btrim(reason)) between 5 and 2000),created_at timestamptz not null default clock_timestamp());
alter table finance_private.customer_credit_refund_reversals enable row level security;revoke all on finance_private.customer_credit_refund_reversals from public,anon,authenticated,service_role;
create or replace function finance_private.preserve_reported_refund_reversal() returns trigger language plpgsql set search_path='' as $$begin raise exception 'finance_immutable_record';end$$;
drop trigger if exists preserve_reported_refund_reversal on finance_private.customer_credit_refund_reversals;create trigger preserve_reported_refund_reversal before update or delete on finance_private.customer_credit_refund_reversals for each row execute function finance_private.preserve_reported_refund_reversal();
create or replace function public.reverse_finance_customer_credit_refund_v1(_tenant_id uuid,_refund_id uuid,_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r finance_private.customer_credit_refunds%rowtype;rid uuid:=gen_random_uuid();name text;begin perform finance_private.require_access(_tenant_id);if not coalesce(public.is_tenant_admin(_tenant_id),false) then raise exception 'finance_admin_required' using errcode='42501';end if;if length(btrim(coalesce(_reason,'')))<5 then raise exception 'reason_required';end if;perform pg_advisory_xact_lock(hashtextextended(_tenant_id::text||':finance',0));select * into r from finance_private.customer_credit_refunds where tenant_id=_tenant_id and id=_refund_id for update;if not found or exists(select 1 from finance_private.customer_credit_refund_reversals where refund_id=r.id) then raise exception 'refund_reversal_unavailable';end if;select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,auth.uid()::text) into name from auth.users where id=auth.uid();insert into finance_private.customer_credit_refund_reversals(id,tenant_id,refund_id,actor_id,actor_name,reason) values(rid,_tenant_id,r.id,auth.uid(),coalesce(name,auth.uid()::text),btrim(_reason));insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,before_data,after_data) values(_tenant_id,'customer_credit',r.credit_id,'customer_credit_refund_reversed',auth.uid(),coalesce(name,auth.uid()::text),btrim(_reason),r.result,jsonb_build_object('reversal_id',rid,'refund_id',r.id));return jsonb_build_object('confirmed',true,'reversal_id',rid,'refund_id',r.id);end$$;
revoke all on function public.reverse_finance_customer_credit_refund_v1(uuid,uuid,text) from public,anon;grant execute on function public.reverse_finance_customer_credit_refund_v1(uuid,uuid,text) to authenticated;
create or replace function finance_private.movement_used_cents(_tenant uuid,_movement uuid) returns numeric language sql stable security definer set search_path='' as $$select finance_private.movement_used_before_customer_refunds(_tenant,_movement)+coalesce((select sum(r.amount_cents) from finance_private.customer_credit_refunds r where r.tenant_id=_tenant and r.outgoing_movement_id=_movement and not exists(select 1 from finance_private.customer_credit_refund_reversals v where v.refund_id=r.id)),0)$$;
revoke all on function finance_private.movement_used_cents(uuid,uuid) from public,anon,authenticated,service_role;

do $$declare d text;sig regprocedure;begin
 sig:=to_regprocedure('finance_private.customer_credit_position(uuid,uuid)');
 if sig is not null then d:=pg_get_functiondef(sig);d:=replace(d,'where tenant_id=_tenant and credit_id=_credit order by created_at,id','where tenant_id=_tenant and credit_id=_credit and not exists(select 1 from finance_private.customer_credit_refund_reversals v where v.refund_id=customer_credit_refunds.id) order by created_at,id');execute d;end if;
 sig:=to_regprocedure('finance_private.guard_customer_credit_refund()');
 if sig is not null then d:=pg_get_functiondef(sig);d:=replace(d,'where tenant_id=new.tenant_id and outgoing_movement_id=new.movement_id)','where tenant_id=new.tenant_id and outgoing_movement_id=new.movement_id and not exists(select 1 from finance_private.customer_credit_refund_reversals v where v.refund_id=customer_credit_refunds.id))');execute d;end if;
end$$;
