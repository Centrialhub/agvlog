-- Candidate local. Reviews are bookkeeping, never a bank/fiscal/SSX request.
set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$ begin
 if to_regprocedure('public._guard_delivery_correction_finance()') is null or to_regclass('public.driver_expense_reviews') is not null then
  raise exception 'Expense review requires financial review guards and an unapplied migration';end if;
end;$guard$;
create unique index driver_expenses_tenant_id_unique on public.driver_expenses(tenant_id,id);
create table public.driver_expense_reviews(
 id uuid primary key,tenant_id uuid not null,actor_id uuid not null,request_id uuid not null,expense_id uuid not null,
 action text not null check(action in('approve','reject')),reason text not null check(length(btrim(reason)) between 5 and 2000),
 payload_hash text not null,before_snapshot jsonb not null,after_snapshot jsonb not null,response jsonb not null,
 created_at timestamptz not null default clock_timestamp(),unique(tenant_id,id),unique(tenant_id,actor_id,request_id),
 foreign key(tenant_id,expense_id) references public.driver_expenses(tenant_id,id) on delete restrict
);
create index driver_expense_reviews_expense_idx on public.driver_expense_reviews(tenant_id,expense_id,created_at desc);
alter table public.driver_expense_reviews enable row level security;
revoke all on public.driver_expense_reviews from public,anon,authenticated,service_role;
grant select on public.driver_expense_reviews to authenticated;
create policy expense_review_operator_read on public.driver_expense_reviews for select to authenticated using(public.is_tenant_operator_or_admin(tenant_id));
create trigger expense_reviews_append_only before update or delete on public.driver_expense_reviews for each row execute function public._preserve_closing_creation();
alter table public.driver_expenses add column review_command_id uuid,
 add constraint expense_review_command_fkey foreign key(tenant_id,review_command_id) references public.driver_expense_reviews(tenant_id,id) deferrable initially deferred;
-- Keep the existing read policies/driver create RPC. Public review writes must
-- use the command; there is no expansion of the old admin-only approval right.
revoke insert,update,delete,truncate,references,trigger on public.driver_expenses from public,anon,authenticated,service_role;

create function public._expense_review_snapshot(_tenant uuid,_expense uuid) returns jsonb
 language plpgsql stable security invoker set search_path='' as $fn$
declare e public.driver_expenses%rowtype;v_errors jsonb:='[]';v_obligations jsonb;v_settlements jsonb;v_history jsonb;v_result jsonb;v_amount bigint;
begin
 select * into e from public.driver_expenses where tenant_id=_tenant and id=_expense;
 if not found then raise exception 'expense_not_found' using errcode='23514';end if;
 if e.amount is null or e.amount<=0 or e.amount>999999999999.99 or e.amount<>round(e.amount,2) then v_errors:=v_errors||'"amount"'::jsonb;
 else v_amount:=(e.amount*100)::bigint;end if;
 if nullif(btrim(e.category),'') is null then v_errors:=v_errors||'"category"'::jsonb;end if;
 if not isfinite(e.expense_at) then v_errors:=v_errors||'"date"'::jsonb;end if;
 if not exists(select 1 from public.drivers d where d.tenant_id=_tenant and d.id=e.driver_id)
  or not exists(select 1 from public.dispatch_trips t where t.tenant_id=_tenant and t.id=e.dispatch_trip_id) then v_errors:=v_errors||'"scope"'::jsonb;end if;
 if e.payment_source is null or e.payment_source not in('driver','advance','company_card','company_account','other') or e.reimbursable is null
  or e.paid_with_advance is distinct from (e.payment_source='advance')
  or (e.payment_source in('company_card','company_account') and e.reimbursable) then v_errors:=v_errors||'"payment_source"'::jsonb;end if;
 if e.no_receipt is null or (e.no_receipt and (length(btrim(coalesce(e.no_receipt_reason,'')))<5 or nullif(e.receipt_url,'') is not null))
  or (not e.no_receipt and (e.receipt_url is null or e.receipt_url not like _tenant::text||'/%' or e.receipt_url like '%..%' or e.receipt_url like '%\%'
    or not exists(select 1 from storage.objects o where o.bucket_id='receipts' and o.name=e.receipt_url))) then v_errors:=v_errors||'"receipt"'::jsonb;end if;
 select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') into v_obligations from public.financial_obligations o where o.tenant_id=_tenant and o.source_table='driver_expenses' and o.source_id=e.id;
 if exists(select 1 from public.financial_obligations o where o.tenant_id=_tenant and o.source_table='driver_expenses' and o.source_id=e.id) and e.approval_status='pending' then v_errors:=v_errors||'"existing_obligation"'::jsonb;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,'needs_recalculation',s.needs_recalculation,'updated_at',s.updated_at) order by s.id),'[]') into v_settlements
  from public.driver_settlements s where s.tenant_id=_tenant and s.dispatch_trip_id=e.dispatch_trip_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'action',h.action,'reason',h.reason,'created_at',h.created_at) order by h.created_at desc,h.id),'[]') into v_history
  from public.driver_expense_reviews h where h.tenant_id=_tenant and h.expense_id=e.id;
 v_result:=jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'expense_id',e.id,'status',e.approval_status,'amount_cents',v_amount,
  'can_approve',public.is_tenant_admin(_tenant) and e.approval_status='pending' and v_errors='[]'::jsonb,
  'can_reject',public.is_tenant_admin(_tenant) and e.approval_status='pending' and not exists(select 1 from public.financial_obligations o where o.tenant_id=_tenant and o.source_table='driver_expenses' and o.source_id=e.id),
  'validation_errors',v_errors,'expense',to_jsonb(e),'settlements',v_settlements,'evidence',jsonb_build_object('expense',to_jsonb(e),'obligations',v_obligations,'settlements',v_settlements));
 return v_result||jsonb_build_object('revision',md5(v_result::text),'history',v_history);
end;$fn$;
revoke all on function public._expense_review_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
create function public.get_driver_expense_review_context(_tenant_id uuid,_expense_id uuid) returns jsonb
 language plpgsql stable security definer set search_path='' as $fn$
begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'expense_not_authorized' using errcode='42501';end if;
 return public._expense_review_snapshot(_tenant_id,_expense_id)-'evidence';
end;$fn$;
revoke all on function public.get_driver_expense_review_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_driver_expense_review_context(uuid,uuid) to authenticated;

create function public.list_driver_expenses_for_review(_tenant_id uuid,_status text default 'pending',_offset integer default 0) returns jsonb
 language plpgsql stable security definer set search_path='' as $fn$
declare v_rows jsonb;v_count bigint;begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'expense_not_authorized' using errcode='42501';end if;
 if _status is null or _status not in('pending','reviewed') or _offset is null or _offset<0 or _offset>1000000 then raise exception 'expense_invalid_filter' using errcode='22023';end if;
 select count(*) into v_count from public.driver_expenses e where e.tenant_id=_tenant_id and (case when _status='pending' then e.approval_status='pending' else e.approval_status<>'pending' end);
 select coalesce(jsonb_agg(value order by expense_at desc,id),'[]') into v_rows from(
  select e.id,e.expense_at,to_jsonb(e)||jsonb_build_object('driver_name',d.name,'review_reason',h.reason) value from public.driver_expenses e
   left join public.drivers d on d.tenant_id=e.tenant_id and d.id=e.driver_id
   left join public.driver_expense_reviews h on h.tenant_id=e.tenant_id and h.id=e.review_command_id
   where e.tenant_id=_tenant_id and (case when _status='pending' then e.approval_status='pending' else e.approval_status<>'pending' end)
   order by e.expense_at desc,e.id limit 50 offset _offset) page;
 return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'can_review',public.is_tenant_admin(_tenant_id),'filter',_status,'offset',_offset,'total',v_count,'rows',v_rows);
end;$fn$;
revoke all on function public.list_driver_expenses_for_review(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_driver_expenses_for_review(uuid,text,integer) to authenticated;

create function public._guard_expense_review_contract() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if tg_op='DELETE' then raise exception 'expense_history_is_immutable' using errcode='55000';end if;
 if tg_op='INSERT' then
  if new.approval_status is distinct from 'pending' or new.review_command_id is not null or new.approved_by is not null or new.approved_at is not null then
   raise exception 'expense_invalid_initial_review' using errcode='23514';end if;return new;
 end if;
 if (to_jsonb(new)-'updated_at')=(to_jsonb(old)-'updated_at') then return new;end if;
 if old.approval_status<>'pending' or old.review_command_id is not null then raise exception 'expense_reviewed_history_is_immutable' using errcode='55000';end if;
 if (new.approval_status,new.approved_at,new.approved_by,new.review_command_id) is distinct from (old.approval_status,old.approved_at,old.approved_by,old.review_command_id) then
  if new.approval_status not in('approved','rejected') or new.review_command_id is null or new.approved_by is distinct from auth.uid()
   or not coalesce(public.is_tenant_admin(new.tenant_id),false) or new.approved_at is null
   or (to_jsonb(new)-array['approval_status','approved_at','approved_by','updated_at','review_command_id']) is distinct from
      (to_jsonb(old)-array['approval_status','approved_at','approved_by','updated_at','review_command_id']) then raise exception 'expense_review_command_required' using errcode='42501';end if;
 end if;
 return new;
end;$fn$;
revoke all on function public._guard_expense_review_contract() from public,anon,authenticated,service_role;
create trigger guard_expense_review_contract before insert or update or delete on public.driver_expenses for each row execute function public._guard_expense_review_contract();
create function public._check_expense_review_ack() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if new.review_command_id is not null and not exists(select 1 from public.driver_expense_reviews h where h.tenant_id=new.tenant_id and h.id=new.review_command_id
  and h.expense_id=new.id and h.actor_id=new.approved_by and h.after_snapshot->'expense'=to_jsonb(new)) then raise exception 'expense_review_ack_required' using errcode='23514';end if;
 return null;
end;$fn$;
revoke all on function public._check_expense_review_ack() from public,anon,authenticated,service_role;
create constraint trigger check_expense_review_ack after insert or update on public.driver_expenses deferrable initially deferred for each row execute function public._check_expense_review_ack();

-- Touch only the affected settlement, including paid/closed ones. Preserve all
-- amounts, payment rows, status and ledger evidence. Existing payment guards
-- require deliberate reconciliation before any further payment/finalization.
create or replace function public._tg_mark_outdated_expense() returns trigger language plpgsql security definer set search_path='' as $fn$
declare s record;v_old uuid;v_new uuid;v_old_tenant uuid;v_new_tenant uuid;
begin
 if tg_op<>'INSERT' then v_old:=old.dispatch_trip_id;v_old_tenant:=old.tenant_id;end if;
 if tg_op<>'DELETE' then v_new:=new.dispatch_trip_id;v_new_tenant:=new.tenant_id;end if;
 for s in select ds.id,ds.status from public.driver_settlements ds where (ds.tenant_id=v_old_tenant and ds.dispatch_trip_id=v_old) or (ds.tenant_id=v_new_tenant and ds.dispatch_trip_id=v_new) order by ds.id for update nowait loop
  update public.driver_settlements set needs_recalculation=true,recalculation_reason='driver_expense_change',source_updated_at=clock_timestamp() where id=s.id;
  perform public._log_settlement_event(s.id,'marked_outdated',s.status,s.status,'driver_expense_change',jsonb_build_object('expense_id',coalesce(new.id,old.id)));
 end loop;
 return coalesce(new,old);
end;$fn$;
revoke all on function public._tg_mark_outdated_expense() from public,anon,authenticated,service_role;

-- No date-window bulk synchronization: one reviewed company expense produces
-- one obligation. Review never records or guesses a bank payment/match.
create or replace function public._tg_sync_obligations_from_expense() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if new.approval_status='approved' and not new.reimbursable and new.payment_source<>'driver' then
  if exists(select 1 from public.financial_obligations o where o.tenant_id=new.tenant_id and o.source_table='driver_expenses' and o.source_id=new.id) then
   if tg_op='UPDATE' and (to_jsonb(new)-'updated_at')=(to_jsonb(old)-'updated_at') then return new;end if;
   raise exception 'expense_existing_obligation_requires_reconciliation' using errcode='23514';
  end if;
  insert into public.financial_obligations(tenant_id,direction,obligation_type,source_table,source_id,description,counterparty_type,counterparty_id,
   amount_expected,amount_matched,due_date,expected_payment_date,competence_date,status,matching_status,metadata,created_by)
  values(new.tenant_id,'outflow','driver_expense','driver_expenses',new.id,coalesce(nullif(new.notes,''),new.category),'driver',new.driver_id,
   new.amount,0,(new.expense_at at time zone 'America/Sao_Paulo')::date,(new.expense_at at time zone 'America/Sao_Paulo')::date,
   (new.expense_at at time zone 'America/Sao_Paulo')::date,'pending','unmatched',jsonb_build_object('category',new.category,'payment_source',new.payment_source,'dispatch_trip_id',new.dispatch_trip_id,'review_command_id',new.review_command_id),new.approved_by);
 end if;
 return new;
end;$fn$;
revoke all on function public._tg_sync_obligations_from_expense() from public,anon,authenticated,service_role;

create function public.review_driver_expense(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_tenant uuid;v_actor uuid:=auth.uid();v_expense uuid;v_request uuid;v_action text;v_reason text;v_hash text;v_id uuid:=gen_random_uuid();
 v_trip uuid;e public.driver_expenses%rowtype;h public.driver_expense_reviews%rowtype;v_before jsonb;v_after jsonb;v_response jsonb;
begin
 if _payload is null or jsonb_typeof(_payload)<>'object' or length(_payload::text)>10000
  or _payload->'version' is distinct from '1'::jsonb or jsonb_typeof(_payload->'reason') is distinct from 'string'
  or (_payload-array['version','tenant_id','actor_id','request_id','expense_id','action','reason','expected_revision'])<>'{}'::jsonb then raise exception 'expense_invalid_payload' using errcode='22023';end if;
 v_tenant:=(_payload->>'tenant_id')::uuid;v_expense:=(_payload->>'expense_id')::uuid;v_request:=(_payload->>'request_id')::uuid;
 v_action:=_payload->>'action';v_reason:=btrim(_payload->>'reason');
 if v_actor is null or (_payload->>'actor_id')::uuid is distinct from v_actor or not coalesce(public.is_tenant_admin(v_tenant),false) then raise exception 'expense_not_authorized' using errcode='42501';end if;
 if v_request is null or v_expense is null or v_action is null or v_action not in('approve','reject') or v_reason is null or length(v_reason) not between 5 and 2000
  or coalesce(_payload->>'expected_revision','')!~'^[a-f0-9]{32}$' then raise exception 'expense_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtext('driver-expense-review'),hashtext(v_tenant::text||':'||v_actor::text||':'||v_request::text));
 -- Membership can be revoked while a duplicate request waits.
 perform 1 from public.tenant_memberships where tenant_id=v_tenant and user_id=v_actor and active and role::text in('owner','admin') for share;
 if not found or not coalesce(public.is_tenant_admin(v_tenant),false) then raise exception 'expense_not_authorized' using errcode='42501';end if;
 v_hash:=encode(sha256(convert_to(_payload::text,'UTF8')),'hex');
 select * into h from public.driver_expense_reviews where tenant_id=v_tenant and actor_id=v_actor and request_id=v_request;
 if found then if h.payload_hash<>v_hash then raise exception 'expense_request_key_mismatch' using errcode='22023';end if;return h.response;end if;
 select dispatch_trip_id into v_trip from public.driver_expenses where tenant_id=v_tenant and id=v_expense;
 if not found then raise exception 'expense_not_found' using errcode='23514';end if;
 perform 1 from public.dispatch_trips where tenant_id=v_tenant and id=v_trip for update nowait;
 perform 1 from public.driver_settlements where tenant_id=v_tenant and dispatch_trip_id=v_trip order by id for update nowait;
 select * into e from public.driver_expenses where tenant_id=v_tenant and id=v_expense for update nowait;
 if not found or e.dispatch_trip_id is distinct from v_trip then raise exception 'expense_context_changed' using errcode='40001';end if;
 perform 1 from public.financial_obligations where tenant_id=v_tenant and source_table='driver_expenses' and source_id=v_expense order by id for update nowait;
 perform 1 from storage.objects where bucket_id='receipts' and name=e.receipt_url for share nowait;
 v_before:=public._expense_review_snapshot(v_tenant,v_expense);
 if v_before->>'revision'<>_payload->>'expected_revision' then raise exception 'expense_context_changed' using errcode='40001';end if;
 if not coalesce((v_before->>case when v_action='approve' then 'can_approve' else 'can_reject' end)::boolean,false) then raise exception 'expense_requires_reconciliation_or_review' using errcode='23514';end if;
 update public.driver_expenses set approval_status=case when v_action='approve' then 'approved' else 'rejected' end,
  approved_by=v_actor,approved_at=clock_timestamp(),updated_at=clock_timestamp(),review_command_id=v_id where tenant_id=v_tenant and id=v_expense;
 v_after:=public._expense_review_snapshot(v_tenant,v_expense);
 v_response:=jsonb_build_object('version',1,'tenant_id',v_tenant,'actor_id',v_actor,'request_id',v_request,'expense_id',v_expense,'command_id',v_id,'action',v_action,
  'status',v_after->>'status','confirmed',true,'revision',v_after->>'revision');
 insert into public.driver_expense_reviews(id,tenant_id,actor_id,request_id,expense_id,action,reason,payload_hash,before_snapshot,after_snapshot,response)
  values(v_id,v_tenant,v_actor,v_request,v_expense,v_action,v_reason,v_hash,v_before->'evidence',v_after->'evidence',v_response);
 return v_response;
exception when lock_not_available or deadlock_detected then raise exception 'expense_concurrent_change' using errcode='40001';
end;$fn$;
revoke all on function public.review_driver_expense(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.review_driver_expense(jsonb) to authenticated;
