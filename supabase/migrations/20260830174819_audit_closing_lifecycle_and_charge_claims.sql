-- Local candidate: audited lifecycle and non-duplicable delivery charge claims.
-- No fiscal provider, external payment, messaging or SSX calls.
set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$ begin
 if to_regprocedure('public.create_closing_report_draft(jsonb)') is null or to_regclass('public.closing_report_action_requests') is not null then
  raise exception 'Closing lifecycle requires atomic drafts and an unapplied migration';end if;
end;$guard$;
alter table public.closing_reports add column lifecycle_revision bigint not null default 0 check(lifecycle_revision>=0);
create unique index closing_items_tenant_item_report_key on public.closing_report_items(tenant_id,id,closing_report_id);
create table public.closing_report_action_requests(
 tenant_id uuid not null,actor_id uuid not null,request_id uuid not null,report_id uuid not null,
 action text not null check(action in('close','cancel','reopen','mark_sent')),payload_hash text not null,response jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(tenant_id,actor_id,request_id),
 foreign key(tenant_id,report_id) references public.closing_reports(tenant_id,id) on delete restrict
);
create index closing_action_requests_report_idx on public.closing_report_action_requests(tenant_id,report_id);
alter table public.closing_report_action_requests enable row level security;
revoke all on public.closing_report_action_requests from public,anon,authenticated,service_role;
grant select on public.closing_report_action_requests to authenticated;
create policy closing_action_actor_read on public.closing_report_action_requests for select to authenticated
 using(actor_id=(select auth.uid()) and public.is_tenant_operator_or_admin(tenant_id));
create trigger closing_action_requests_append_only before update or delete on public.closing_report_action_requests
 for each row execute function public._preserve_closing_creation();

create table public.closing_report_charge_claims(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,report_id uuid not null,item_id uuid not null,
 fiscal_document_id uuid not null,attempt_id uuid,amount numeric(14,2) not null check(amount>0),
 source_key text generated always as ('delivery:'||fiscal_document_id::text||':'||coalesce(attempt_id::text,'original')) stored,
 claimed_at timestamptz not null default clock_timestamp(),claimed_by uuid not null,
 released_at timestamptz,released_by uuid,release_reason text,
 foreign key(tenant_id,report_id) references public.closing_reports(tenant_id,id) on delete restrict,
 foreign key(tenant_id,item_id,report_id) references public.closing_report_items(tenant_id,id,closing_report_id) on delete restrict,
 foreign key(tenant_id,fiscal_document_id) references public.fiscal_documents(tenant_id,id) on delete restrict,
 check((released_at is null and released_by is null and release_reason is null) or
       (released_at is not null and released_by is not null and length(btrim(release_reason))>=5))
);
create unique index closing_one_active_delivery_charge on public.closing_report_charge_claims(tenant_id,source_key) where released_at is null;
create index closing_claim_report_idx on public.closing_report_charge_claims(tenant_id,report_id);
create index closing_claim_item_idx on public.closing_report_charge_claims(tenant_id,item_id,report_id);
create index closing_claim_document_idx on public.closing_report_charge_claims(tenant_id,fiscal_document_id);
alter table public.closing_report_charge_claims enable row level security;
revoke all on public.closing_report_charge_claims from public,anon,authenticated,service_role;
grant select on public.closing_report_charge_claims to authenticated;
create policy closing_charge_operator_read on public.closing_report_charge_claims for select to authenticated
 using(auth.uid() is not null and public.is_tenant_operator_or_admin(tenant_id));

create function public._preserve_closing_charge_claim() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if tg_op='DELETE' then raise exception 'closing_charge_history_is_immutable' using errcode='55000';end if;
 if (to_jsonb(new)-array['source_key','released_at','released_by','release_reason']) is distinct from (to_jsonb(old)-array['source_key','released_at','released_by','release_reason'])
  or old.released_at is not null or new.released_at is null or new.released_by is distinct from auth.uid()
  or not exists(select 1 from public.closing_reports r where r.tenant_id=old.tenant_id and r.id=old.report_id and r.status in('reviewing','cancelled')
   and r.client_invoice_id is null and r.receivable_id is null and r.received_amount=0) then
  raise exception 'closing_charge_history_is_immutable' using errcode='55000';end if;
 return new;
end;$fn$;
revoke all on function public._preserve_closing_charge_claim() from public,anon,authenticated,service_role;
create trigger preserve_closing_charge_claim before update or delete on public.closing_report_charge_claims for each row execute function public._preserve_closing_charge_claim();

create function public._claim_closing_delivery_charges(_report uuid) returns void language plpgsql security invoker set search_path='' as $fn$
declare r public.closing_reports%rowtype;i public.closing_report_items%rowtype;key text;attempt uuid;existing uuid;begin
 select * into r from public.closing_reports where id=_report;
 if r.filters_snapshot->>'contract' is distinct from 'closing_attempts_v1' then raise exception 'closing_legacy_requires_review' using errcode='55000';end if;
 perform public._assert_closing_sources_current(r.id);
 for i in select * from public.closing_report_items where closing_report_id=r.id and tenant_id=r.tenant_id and freight_value>0
  order by fiscal_document_id,coalesce(metadata->>'attempt_id','original') loop
  if i.fiscal_document_id is null or i.source_type<>'system' then raise exception 'closing_source_requires_review' using errcode='55000';end if;
  attempt:=(i.metadata->>'attempt_id')::uuid;key:='delivery:'||i.fiscal_document_id::text||':'||coalesce(attempt::text,'original');
  if not pg_try_advisory_xact_lock(hashtext('closing-delivery-charge'),hashtext(r.tenant_id::text||':'||key)) then
   raise exception 'closing_charge_concurrent_change' using errcode='40001';end if;
  -- Include pre-migration reports. Never silently backfill or erase conflicting
  -- historical billing; a duplicate requires explicit financial reconciliation.
  if exists(select 1 from public.closing_report_items other join public.closing_reports parent on parent.id=other.closing_report_id and parent.tenant_id=other.tenant_id
   where other.tenant_id=r.tenant_id and other.fiscal_document_id=i.fiscal_document_id and other.freight_value>0 and parent.id<>r.id
   and coalesce(other.metadata->>'attempt_id','original')=coalesce(attempt::text,'original')
   and (parent.status not in('draft','reviewing','cancelled') or parent.client_invoice_id is not null or parent.receivable_id is not null or parent.received_amount>0)) then
   raise exception 'closing_charge_already_reserved' using errcode='23505';end if;
  if i.cte_document_id is not null and exists(select 1 from public.client_invoice_charges charge join public.client_invoices invoice on invoice.id=charge.invoice_id and invoice.tenant_id=charge.tenant_id
   where charge.tenant_id=r.tenant_id and charge.source_type='cte_document' and charge.source_id=i.cte_document_id and charge.cancelled_at is null
    and (invoice.status<>'cancelled' or exists(select 1 from public.receivables recv where recv.tenant_id=invoice.tenant_id and recv.id=invoice.receivable_id and recv.received_amount>0))) then
   raise exception 'closing_fiscal_charge_already_invoiced' using errcode='23505';end if;
  insert into public.closing_report_charge_claims(tenant_id,report_id,item_id,fiscal_document_id,attempt_id,amount,claimed_by)
   values(r.tenant_id,r.id,i.id,i.fiscal_document_id,attempt,i.freight_value,auth.uid()) on conflict(tenant_id,source_key) where released_at is null do nothing;
  select report_id into existing from public.closing_report_charge_claims where tenant_id=r.tenant_id and source_key=key and released_at is null;
  if existing is distinct from r.id then raise exception 'closing_charge_already_reserved' using errcode='23505';end if;
 end loop;
end;$fn$;
revoke all on function public._claim_closing_delivery_charges(uuid) from public,anon,authenticated,service_role;

create function public._guard_closing_lifecycle_state() returns trigger language plpgsql security definer set search_path='' as $fn$
declare linked boolean;begin
 if (new.status='paid' and (new.total_amount<=0 or new.received_amount<new.total_amount or new.payment_status<>'paid'))
  or (new.status='partially_paid' and (new.received_amount<=0 or new.received_amount>=new.total_amount or new.payment_status<>'partially_paid')) then
  raise exception 'closing_invalid_payment_state' using errcode='23514';end if;
 if (old.client_invoice_id is not null and new.client_invoice_id is distinct from old.client_invoice_id)
  or (old.receivable_id is not null and new.receivable_id is distinct from old.receivable_id) then
  raise exception 'closing_financial_links_are_immutable' using errcode='55000';end if;
 if new.receivable_id is not null and (new.receivable_id is distinct from old.receivable_id or new.client_invoice_id is distinct from old.client_invoice_id
  or new.received_amount is distinct from old.received_amount or new.open_amount is distinct from old.open_amount or new.payment_status is distinct from old.payment_status) then
  if not exists(select 1 from public.receivables recv join public.client_invoices invoice on invoice.tenant_id=recv.tenant_id and invoice.id=recv.client_invoice_id
   where recv.tenant_id=new.tenant_id and recv.id=new.receivable_id and invoice.id=new.client_invoice_id and invoice.receivable_id=recv.id
    and invoice.total_amount=new.total_amount and recv.amount=new.total_amount and coalesce(recv.received_amount,0)=new.received_amount
    and new.open_amount=greatest(0,new.total_amount-new.received_amount)) then
   raise exception 'closing_financial_ledger_requires_reconciliation' using errcode='55000';end if;
 end if;
 linked:=old.client_invoice_id is not null or old.receivable_id is not null or old.received_amount>0
  or exists(select 1 from public.closing_report_payments where tenant_id=old.tenant_id and closing_report_id=old.id);
 if new.status is distinct from old.status then
  if new.status='closed' then
   if old.status not in('draft','reviewing') or linked then raise exception 'closing_invalid_state_transition' using errcode='23514';end if;
   perform public._claim_closing_delivery_charges(old.id);
  elsif new.status='reviewing' then
   if old.status not in('closed','sent','cancelled') or linked or not coalesce(public.is_tenant_admin(old.tenant_id),false) then
    raise exception 'closing_reopen_not_allowed' using errcode='23514';end if;
  elsif new.status='cancelled' then
   if old.status not in('draft','reviewing','closed','sent') or linked then raise exception 'closing_cancel_requires_financial_reconciliation' using errcode='23514';end if;
  elsif new.status='sent' then
   if old.status<>'closed' then raise exception 'closing_invalid_state_transition' using errcode='23514';end if;
  elsif new.status='invoiced' then
   if old.status not in('closed','sent') or new.client_invoice_id is null or new.receivable_id is null then raise exception 'closing_invalid_state_transition' using errcode='23514';end if;
   perform public._claim_closing_delivery_charges(old.id);
  elsif new.status in('paid','partially_paid') then
   if old.status not in('invoiced','partially_paid','overdue') or new.client_invoice_id is null or new.receivable_id is null then raise exception 'closing_invalid_state_transition' using errcode='23514';end if;
  elsif new.status='overdue' then
   if old.status not in('invoiced','partially_paid') or not linked then raise exception 'closing_invalid_state_transition' using errcode='23514';end if;
  else raise exception 'closing_invalid_state_transition' using errcode='23514';end if;
 end if;
 if (new.status,new.payment_status,new.invoice_status,new.client_invoice_id,new.receivable_id,new.received_amount,new.open_amount,new.sent_at,new.sent_to,new.sent_channel)
  is distinct from (old.status,old.payment_status,old.invoice_status,old.client_invoice_id,old.receivable_id,old.received_amount,old.open_amount,old.sent_at,old.sent_to,old.sent_channel) then
  new.lifecycle_revision:=old.lifecycle_revision+1;
 elsif new.lifecycle_revision is distinct from old.lifecycle_revision then raise exception 'closing_revision_is_server_owned' using errcode='55000';end if;
 return new;
end;$fn$;
revoke all on function public._guard_closing_lifecycle_state() from public,anon,authenticated,service_role;
create trigger guard_closing_lifecycle_state before update on public.closing_reports for each row execute function public._guard_closing_lifecycle_state();

create function public._release_closing_delivery_charges() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if new.status is distinct from old.status and new.status in('reviewing','cancelled') then
  update public.closing_report_charge_claims set released_at=clock_timestamp(),released_by=auth.uid(),
   release_reason=case when new.status='cancelled' then coalesce(new.cancellation_reason,'Cancelamento auditado') else 'Reabertura auditada do relatório' end
  where tenant_id=new.tenant_id and report_id=new.id and released_at is null;
 end if;return new;
end;$fn$;
revoke all on function public._release_closing_delivery_charges() from public,anon,authenticated,service_role;
create trigger release_closing_delivery_charges after update on public.closing_reports for each row execute function public._release_closing_delivery_charges();

-- A CT-e charge entered through the invoice module must not bypass a reserved
-- closing charge. The same advisory keys serialize both financial entrypoints.
create function public._guard_fiscal_invoice_closing_claim() returns trigger language plpgsql security definer set search_path='' as $fn$
declare doc uuid;begin
 if new.source_type='cte_document' and new.source_id is not null and new.cancelled_at is null then
  for doc in select unnest(fiscal_document_ids) from public.cte_documents where tenant_id=new.tenant_id and id=new.source_id order by 1 loop
   if not pg_try_advisory_xact_lock(hashtext('closing-delivery-charge'),hashtext(new.tenant_id::text||':delivery:'||doc::text||':original')) then
    raise exception 'closing_charge_concurrent_change' using errcode='40001';end if;
   if exists(select 1 from public.closing_report_charge_claims where tenant_id=new.tenant_id and fiscal_document_id=doc and attempt_id is null and released_at is null) then
    raise exception 'closing_charge_already_reserved' using errcode='23505';end if;
  end loop;
 end if;return new;
end;$fn$;
revoke all on function public._guard_fiscal_invoice_closing_claim() from public,anon,authenticated,service_role;
create trigger guard_fiscal_invoice_closing_claim before insert or update on public.client_invoice_charges for each row execute function public._guard_fiscal_invoice_closing_claim();

create function public.get_closing_report_action_context(_tenant_id uuid,_report_id uuid) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare r public.closing_reports%rowtype;linked boolean;actions jsonb:='[]';begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'closing_not_authorized' using errcode='42501';end if;
 select * into r from public.closing_reports where tenant_id=_tenant_id and id=_report_id;
 if not found then raise exception 'closing_report_not_found' using errcode='23514';end if;
 linked:=r.client_invoice_id is not null or r.receivable_id is not null or r.received_amount>0 or exists(select 1 from public.closing_report_payments where tenant_id=r.tenant_id and closing_report_id=r.id);
 if r.status in('draft','reviewing') and not linked then actions:=actions||'"close"'::jsonb;end if;
 if r.status in('draft','reviewing','closed','sent') and not linked then actions:=actions||'"cancel"'::jsonb;end if;
 if r.status in('closed','sent','cancelled') and not linked and public.is_tenant_admin(_tenant_id) then actions:=actions||'"reopen"'::jsonb;end if;
 if r.status in('closed','sent','invoiced') then actions:=actions||'"mark_sent"'::jsonb;end if;
 return jsonb_build_object('version',1,'tenant_id',r.tenant_id,'actor_id',auth.uid(),'report_id',r.id,'closing_number',r.closing_number,
  'revision',r.lifecycle_revision,'status',r.status,'payment_status',r.payment_status,'invoice_status',r.invoice_status,
  'total_amount',r.total_amount,'received_amount',r.received_amount,'open_amount',r.open_amount,'has_financial_links',linked,
  'source_review_required',r.filters_snapshot->>'contract' is distinct from 'closing_attempts_v1' or coalesce((r.filters_snapshot->>'financial_review_required')::boolean,false),
  'allowed_actions',actions);
end;$fn$;
revoke all on function public.get_closing_report_action_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_closing_report_action_context(uuid,uuid) to authenticated;

create function public.apply_closing_report_action(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor uuid:=auth.uid();tenant uuid;request uuid;report uuid;command text;reason text;expected bigint;r public.closing_reports%rowtype;
 previous public.closing_report_action_requests%rowtype;before_state jsonb;result jsonb;digest text;linked boolean;changed boolean:=true;begin
 if jsonb_typeof(_payload) is distinct from 'object' or octet_length(_payload::text)>20000 or _payload->'version' is distinct from '1'::jsonb
  or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','actor_id','request_id','report_id','expected_revision','action','reason','sent_to','channel')) then
  raise exception 'closing_invalid_action_request' using errcode='22023';end if;
 tenant:=(_payload->>'tenant_id')::uuid;request:=(_payload->>'request_id')::uuid;report:=(_payload->>'report_id')::uuid;
 command:=_payload->>'action';reason:=btrim(_payload->>'reason');
 if actor is null or _payload->>'actor_id' is distinct from actor::text or tenant is null or not coalesce(public.is_tenant_operator_or_admin(tenant),false) then
  raise exception 'closing_not_authorized' using errcode='42501';end if;
 if request is null or report is null or coalesce(command,'') not in('close','cancel','reopen','mark_sent') or jsonb_typeof(_payload->'reason') is distinct from 'string'
  or coalesce(length(reason),0) not between 5 and 2000 or jsonb_typeof(_payload->'expected_revision') is distinct from 'number'
  or (_payload->>'expected_revision')!~'^\d+$' or (_payload->>'expected_revision')::numeric>9007199254740991 then
  raise exception 'closing_invalid_action_request' using errcode='22023';end if;
 expected:=(_payload->>'expected_revision')::bigint;
 if command<>'mark_sent' and (_payload ? 'sent_to' or _payload ? 'channel') then raise exception 'closing_invalid_delivery_channel' using errcode='22023';end if;
 if command='mark_sent' and ((jsonb_typeof(_payload->'sent_to') is not null and jsonb_typeof(_payload->'sent_to') not in('string','null'))
  or (jsonb_typeof(_payload->'channel') is not null and jsonb_typeof(_payload->'channel') not in('string','null')) or length(_payload->>'sent_to')>500 or length(_payload->>'channel')>100) then
  raise exception 'closing_invalid_delivery_channel' using errcode='22023';end if;
 digest:=encode(sha256(convert_to(_payload::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext('closing-report-action'),hashtext(tenant::text||':'||actor::text||':'||request::text));
 perform tenant_id from public.tenant_memberships where tenant_id=tenant and user_id=actor and active and role::text in('owner','admin','operator') for share nowait;
 if not found then raise exception 'closing_not_authorized' using errcode='42501';end if;
 if command='reopen' and not coalesce(public.is_tenant_admin(tenant),false) then raise exception 'closing_reopen_not_authorized' using errcode='42501';end if;
 select * into previous from public.closing_report_action_requests where tenant_id=tenant and actor_id=actor and request_id=request;
 if found then
  if previous.payload_hash is distinct from digest then raise exception 'closing_action_key_mismatch' using errcode='22023';end if;return previous.response;
 end if;
 select * into r from public.closing_reports where tenant_id=tenant and id=report for update nowait;
 if not found then raise exception 'closing_report_not_found' using errcode='23514';end if;
 if r.lifecycle_revision<>expected then raise exception 'closing_action_context_changed' using errcode='40001';end if;
 before_state:=to_jsonb(r);
 linked:=r.client_invoice_id is not null or r.receivable_id is not null or r.received_amount>0 or exists(select 1 from public.closing_report_payments where tenant_id=tenant and closing_report_id=report);
 if command='close' then
  if r.status not in('draft','reviewing') or linked then raise exception 'closing_invalid_state_transition' using errcode='23514';end if;
  if not exists(select 1 from public.closing_report_items where tenant_id=tenant and closing_report_id=report) then raise exception 'closing_no_items' using errcode='23514';end if;
  update public.closing_reports set status='closed',closed_at=clock_timestamp(),closed_by=actor,updated_by=actor,updated_at=clock_timestamp() where id=report;
 elsif command='cancel' then
  if r.status not in('draft','reviewing','closed','sent') or linked then raise exception 'closing_cancel_requires_financial_reconciliation' using errcode='23514';end if;
  update public.closing_reports set status='cancelled',payment_status='cancelled',cancelled_at=clock_timestamp(),cancellation_reason=reason,updated_by=actor,updated_at=clock_timestamp() where id=report;
 elsif command='reopen' then
  if r.status not in('closed','sent','cancelled') or linked then raise exception 'closing_reopen_not_allowed' using errcode='23514';end if;
  update public.closing_reports set status='reviewing',payment_status='unpaid',closed_at=null,closed_by=null,cancelled_at=null,cancellation_reason=null,
   sent_at=null,sent_to=null,sent_channel=null,updated_by=actor,updated_at=clock_timestamp() where id=report;
 else
  if r.status not in('closed','sent','invoiced') then raise exception 'closing_invalid_state_transition' using errcode='23514';end if;
  perform public._assert_closing_sources_current(report);
  changed:=r.sent_at is null or r.sent_to is distinct from _payload->>'sent_to' or r.sent_channel is distinct from _payload->>'channel';
  if changed then update public.closing_reports set status=case when r.status='invoiced' then 'invoiced' else 'sent' end,sent_at=clock_timestamp(),sent_to=_payload->>'sent_to',sent_channel=_payload->>'channel',updated_by=actor,updated_at=clock_timestamp() where id=report;end if;
 end if;
 select * into r from public.closing_reports where id=report;
 if changed then insert into public.closing_report_history(tenant_id,closing_report_id,action,reason,metadata,created_by)
  values(tenant,report,'lifecycle_'||command,reason,jsonb_build_object('request_id',request,'before',before_state,'after',to_jsonb(r)),actor);end if;
 result:=jsonb_build_object('version',1,'tenant_id',tenant,'actor_id',actor,'request_id',request,'report_id',report,'action',command,'confirmed',true,
  'changed',changed,'closing_number',r.closing_number,'status',r.status,'revision',r.lifecycle_revision);
 insert into public.closing_report_action_requests(tenant_id,actor_id,request_id,report_id,action,payload_hash,response) values(tenant,actor,request,report,command,digest,result);
 return result;
exception when lock_not_available then raise exception 'closing_action_concurrent_change' using errcode='40001';end;$fn$;
revoke all on function public.apply_closing_report_action(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.apply_closing_report_action(jsonb) to authenticated;
-- The browser now uses the versioned command for these four transitions.
revoke execute on function public.close_closing_report(uuid),public.cancel_closing_report(uuid,text),public.reopen_closing_report(uuid,text),
 public.mark_closing_report_sent(uuid,uuid,text,text) from public,anon,authenticated,service_role;
