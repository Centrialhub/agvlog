-- Local candidate. Bookkeeping only: no bank, fiscal, messaging or SSX calls.
set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$ begin
 if to_regprocedure('public.apply_closing_report_action(jsonb)') is null or to_regclass('public.receivable_financial_commands') is not null then
  raise exception 'Receivable commands require closing lifecycle and an unapplied migration';end if;
end;$guard$;
create unique index receivable_payment_tenant_id_key on public.receivables_payments(tenant_id,id);
create unique index receivable_bank_account_tenant_key on public.bank_accounts(tenant_id,id);
create unique index receivable_bank_transaction_tenant_key on public.bank_transactions(tenant_id,id);
create table public.receivable_financial_commands(
 id uuid primary key,tenant_id uuid not null,actor_id uuid not null,request_id uuid not null,receivable_id uuid not null,
 action text not null check(action in('receive','reverse','reconcile')),reason text not null check(length(btrim(reason)) between 5 and 2000),
 payload_hash text not null,before_snapshot jsonb not null,after_snapshot jsonb not null,response jsonb not null,
 created_at timestamptz not null default clock_timestamp(),unique(tenant_id,id),unique(tenant_id,actor_id,request_id),
 foreign key(tenant_id,receivable_id) references public.receivables(tenant_id,id) on delete restrict
);
create index receivable_financial_commands_target_idx on public.receivable_financial_commands(tenant_id,receivable_id);
alter table public.receivable_financial_commands enable row level security;
revoke all on public.receivable_financial_commands from public,anon,authenticated,service_role;
grant select on public.receivable_financial_commands to authenticated;
create policy receivable_command_actor_read on public.receivable_financial_commands for select to authenticated
 using(actor_id=(select auth.uid()) and public.is_tenant_operator_or_admin(tenant_id));
create trigger receivable_commands_append_only before update or delete on public.receivable_financial_commands
 for each row execute function public._preserve_closing_creation();
alter table public.receivables_payments add column financial_command_id uuid,
 add constraint receivable_payment_target_tenant_fkey foreign key(tenant_id,receivable_id) references public.receivables(tenant_id,id) not valid,
 add constraint receivable_payment_command_fkey foreign key(tenant_id,financial_command_id) references public.receivable_financial_commands(tenant_id,id) deferrable initially deferred,
 add constraint receivable_payment_bank_account_tenant_fkey foreign key(tenant_id,bank_account_id) references public.bank_accounts(tenant_id,id) not valid,
 add constraint receivable_payment_bank_transaction_tenant_fkey foreign key(tenant_id,bank_transaction_id) references public.bank_transactions(tenant_id,id) not valid;
create unique index receivable_one_payment_per_command on public.receivables_payments(tenant_id,financial_command_id) where financial_command_id is not null;
create index receivable_payment_target_idx on public.receivables_payments(tenant_id,receivable_id);
create table public.receivable_payment_reversals(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,receivable_id uuid not null,payment_id uuid not null,
 bank_transaction_id uuid not null,financial_command_id uuid not null,amount numeric(14,2) not null check(amount>0),
 effective_at timestamptz not null,reason text not null check(length(btrim(reason)) between 5 and 2000),
 created_by uuid not null,created_at timestamptz not null default clock_timestamp(),unique(tenant_id,payment_id),unique(tenant_id,financial_command_id),
 foreign key(tenant_id,payment_id) references public.receivables_payments(tenant_id,id) on delete restrict,
 foreign key(tenant_id,receivable_id) references public.receivables(tenant_id,id) on delete restrict,
 foreign key(tenant_id,bank_transaction_id) references public.bank_transactions(tenant_id,id) on delete restrict,
 foreign key(tenant_id,financial_command_id) references public.receivable_financial_commands(tenant_id,id) deferrable initially deferred
);
create index receivable_reversals_target_idx on public.receivable_payment_reversals(tenant_id,receivable_id);
alter table public.receivable_payment_reversals enable row level security;
revoke all on public.receivable_payment_reversals from public,anon,authenticated,service_role;
grant select on public.receivable_payment_reversals to authenticated;
create policy receivable_reversal_operator_read on public.receivable_payment_reversals for select to authenticated
 using((select auth.uid()) is not null and public.is_tenant_operator_or_admin(tenant_id));
create trigger receivable_reversals_append_only before update or delete on public.receivable_payment_reversals
 for each row execute function public._preserve_closing_creation();
alter table public.closing_report_payments add column canonical_receivable_payment_id uuid,
 add constraint closing_payment_canonical_receipt_fkey foreign key(tenant_id,canonical_receivable_payment_id) references public.receivables_payments(tenant_id,id) on delete restrict;
create unique index closing_payment_canonical_receipt_key on public.closing_report_payments(tenant_id,canonical_receivable_payment_id) where canonical_receivable_payment_id is not null;
create trigger closing_payment_append_only before update or delete on public.closing_report_payments
 for each row execute function public._preserve_closing_creation();

create function public._guard_receivable_payment_history() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if tg_op<>'INSERT' then raise exception 'financial_payment_history_is_immutable' using errcode='55000';end if;
 if new.financial_command_id is null then raise exception 'financial_versioned_command_required' using errcode='55000';end if;
 return new;
end;$fn$;
revoke all on function public._guard_receivable_payment_history() from public,anon,authenticated,service_role;
create trigger guard_receivable_payment_history before insert or update or delete on public.receivables_payments
 for each row execute function public._guard_receivable_payment_history();
revoke insert,update,delete,truncate,references,trigger on public.receivables_payments from public,anon,authenticated,service_role;

create function public._guard_receivable_bank_evidence() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if exists(select 1 from public.receivables_payments p where p.tenant_id=old.tenant_id and p.bank_transaction_id=old.id)
  or exists(select 1 from public.receivable_payment_reversals p where p.tenant_id=old.tenant_id and p.bank_transaction_id=old.id) then
  if tg_op='DELETE' or (new.id,new.tenant_id,new.bank_account_id,new.amount,new.transaction_type,new.posted_at,new.raw_payload)
   is distinct from (old.id,old.tenant_id,old.bank_account_id,old.amount,old.transaction_type,old.posted_at,old.raw_payload) then
   raise exception 'financial_bank_evidence_is_immutable' using errcode='55000';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end;$fn$;
revoke all on function public._guard_receivable_bank_evidence() from public,anon,authenticated,service_role;
create trigger guard_receivable_bank_evidence before update or delete on public.bank_transactions
 for each row execute function public._guard_receivable_bank_evidence();

create function public._receivable_financial_snapshot(_tenant uuid,_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $fn$
declare r public.receivables%rowtype;inv public.client_invoices%rowtype;c public.closing_reports%rowtype;
 v_net numeric;v_count bigint;v_valid boolean;v_structural boolean:=true;v_balanced boolean;v_reason text;v_history jsonb;v_banks jsonb;v_result jsonb;v_invoice_count int;v_closing_count int;
begin
 select * into r from public.receivables where tenant_id=_tenant and id=_id;
 if not found then raise exception 'financial_receivable_not_found' using errcode='23514';end if;
 select count(*) into v_invoice_count from public.client_invoices where tenant_id=_tenant and (id=r.client_invoice_id or receivable_id=r.id);
 select * into inv from public.client_invoices where tenant_id=_tenant and (id=r.client_invoice_id or receivable_id=r.id) order by id limit 1;
 select count(*) into v_closing_count from public.closing_reports where tenant_id=_tenant and (receivable_id=r.id or (inv.id is not null and client_invoice_id=inv.id));
 select * into c from public.closing_reports where tenant_id=_tenant and (receivable_id=r.id or (inv.id is not null and client_invoice_id=inv.id)) order by id limit 1;
 if v_invoice_count>1 or v_closing_count>1 or r.amount<=0 or r.amount<>round(r.amount,2) or r.amount>999999999999.99
  or (r.client_invoice_id is not null and (inv.id is distinct from r.client_invoice_id or inv.receivable_id is distinct from r.id))
  or (inv.id is not null and (r.client_invoice_id is distinct from inv.id or inv.total_amount is distinct from r.amount or inv.client_id is distinct from r.client_id))
  or (c.id is not null and (c.receivable_id is distinct from r.id or c.client_invoice_id is distinct from inv.id or c.total_amount is distinct from r.amount))
  or (r.closing_report_id is not null and r.closing_report_id is distinct from c.id) then
  v_structural:=false;v_reason:='financial_graph_requires_reconciliation';end if;
 select coalesce(sum(p.amount) filter(where rv.id is null),0),count(*),coalesce(bool_and(
  p.amount>0 and p.amount=round(p.amount,2) and b.id is not null and b.amount=p.amount and b.transaction_type='credit' and b.bank_account_id=p.bank_account_id
  and exists(select 1 from public.bank_accounts account where account.tenant_id=p.tenant_id and account.id=p.bank_account_id)
  and not exists(select 1 from public.receivables_payments other where other.bank_transaction_id=p.bank_transaction_id and other.id<>p.id)
  and (rv.id is null or (rv.receivable_id=p.receivable_id and rv.amount=p.amount and rb.id is not null and rb.amount=p.amount and rb.transaction_type='debit' and rb.bank_account_id=p.bank_account_id))),true)
 into v_net,v_count,v_valid from public.receivables_payments p
 left join public.receivable_payment_reversals rv on rv.tenant_id=p.tenant_id and rv.payment_id=p.id
 left join public.bank_transactions b on b.tenant_id=p.tenant_id and b.id=p.bank_transaction_id
 left join public.bank_transactions rb on rb.tenant_id=rv.tenant_id and rb.id=rv.bank_transaction_id
 where p.tenant_id=_tenant and p.receivable_id=_id;
 if not v_valid or v_net<0 or v_net>r.amount then v_structural:=false;v_reason:='financial_ledger_evidence_requires_reconciliation';end if;
 v_balanced:=coalesce(r.received_amount,0)=v_net
  and r.status is not distinct from (case when r.status='cancelled' and v_net=0 then 'cancelled' when v_net>=r.amount then 'received'
   when v_net>0 then 'partial' when inv.id is not null then 'invoiced' else 'pending' end)
  and (inv.id is null or inv.status is not distinct from (case when inv.status='cancelled' and v_net=0 then 'cancelled'
   when v_net>=r.amount then 'paid' when inv.sent_at is not null then 'sent' else 'generated' end))
  and (c.id is null or (c.received_amount=v_net and c.open_amount=greatest(0,r.amount-v_net)
   and c.status is not distinct from (case when c.status='overdue' and c.expected_payment_date<current_date and v_net<r.amount then 'overdue'
    when v_net>=r.amount then 'paid' when v_net>0 then 'partially_paid' else 'invoiced' end)
   and c.payment_status is not distinct from (case when c.status='overdue' then 'overdue' when v_net>=r.amount then 'paid'
    when v_net>0 then 'partially_paid' else 'unpaid' end)));
 if not v_balanced and v_reason is null then v_reason:='financial_projection_requires_reconciliation';end if;
 if (inv.status='cancelled' or r.status='cancelled') and (v_net>0 or c.id is not null) then
  v_structural:=false;v_reason:='financial_cancelled_graph_requires_reconciliation';end if;
 select coalesce(jsonb_agg(x.value order by x.received_at desc,x.id),'[]') into v_history from (
  select p.id,p.received_at,jsonb_build_object('id',p.id,'amount_cents',(p.amount*100)::bigint,'received_at',p.received_at,'method',p.method,
   'notes',p.notes,'bank_account_id',p.bank_account_id,'bank_account_name',a.name,'attachment_path',p.attachment_url,
   'reversed_at',rv.created_at,'reversal_reason',rv.reason) value
  from public.receivables_payments p left join public.bank_accounts a on a.tenant_id=p.tenant_id and a.id=p.bank_account_id
  left join public.receivable_payment_reversals rv on rv.tenant_id=p.tenant_id and rv.payment_id=p.id
  where p.tenant_id=_tenant and p.receivable_id=_id order by p.received_at desc,p.id limit 500
 ) x;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name) order by a.name,a.id),'[]') into v_banks from public.bank_accounts a where a.tenant_id=_tenant and a.active;
 v_result:=jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'receivable_id',r.id,'invoice_id',inv.id,'report_id',c.id,
  'reference',coalesce(r.invoice_number,r.description,r.id::text),'status',r.status,'amount_cents',(r.amount*100)::bigint,
  'received_cents',(v_net*100)::bigint,'open_cents',(greatest(0,r.amount-v_net)*100)::bigint,
  'requires_reconciliation',not(v_structural and v_balanced),'reconciliation_reason',v_reason,
  'can_receive',v_structural and v_balanced and r.status<>'cancelled' and coalesce(inv.status,'generated')<>'cancelled' and v_net<r.amount,
  'can_reverse',v_structural and v_balanced and v_net>0 and coalesce(public.is_tenant_admin(_tenant),false),
  'can_reconcile',v_structural and not v_balanced and v_count>0 and coalesce(public.is_tenant_admin(_tenant),false),
  'payments',v_history,'history_complete',v_count<=500,'payment_count',v_count,'bank_accounts',v_banks,
  'evidence',jsonb_build_object('receivable',to_jsonb(r),'invoice',case when inv.id is null then null else to_jsonb(inv) end,'closing',case when c.id is null then null else to_jsonb(c) end));
 return v_result||jsonb_build_object('revision',md5(v_result::text));
end;$fn$;
revoke all on function public._receivable_financial_snapshot(uuid,uuid) from public,anon,authenticated,service_role;

create function public._lock_receivable_financial_graph(_tenant uuid,_id uuid) returns void language plpgsql security invoker set search_path='' as $fn$
declare v_invoice uuid;begin
 select client_invoice_id into v_invoice from public.receivables where tenant_id=_tenant and id=_id;
 perform id from public.closing_reports where tenant_id=_tenant and (receivable_id=_id or client_invoice_id=v_invoice) order by id for update nowait;
 perform id from public.client_invoices where tenant_id=_tenant and (id=v_invoice or receivable_id=_id) order by id for update nowait;
 perform id from public.receivables where tenant_id=_tenant and id=_id for update nowait;
 if not found then raise exception 'financial_receivable_not_found' using errcode='23514';end if;
end;$fn$;
revoke all on function public._lock_receivable_financial_graph(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public._recalc_receivable_received() returns trigger language plpgsql security definer set search_path='' as $fn$
declare v_id uuid:=coalesce(new.receivable_id,old.receivable_id);v_total numeric;begin
 select coalesce(sum(p.amount),0) into v_total from public.receivables_payments p where p.receivable_id=v_id
  and not exists(select 1 from public.receivable_payment_reversals rv where rv.tenant_id=p.tenant_id and rv.payment_id=p.id);
 update public.receivables r set received_amount=v_total,status=case when r.status='cancelled' then 'cancelled'
  when v_total>=r.amount then 'received' when v_total>0 then 'partial' when r.client_invoice_id is not null then 'invoiced' else 'pending' end,
  received_at=case when v_total>=r.amount then (select max(p.received_at) from public.receivables_payments p where p.receivable_id=r.id
   and not exists(select 1 from public.receivable_payment_reversals rv where rv.tenant_id=p.tenant_id and rv.payment_id=p.id)) else null end,
  updated_at=clock_timestamp(),updated_by=auth.uid() where r.id=v_id;
 return coalesce(new,old);
end;$fn$;
revoke all on function public._recalc_receivable_received() from public,anon,authenticated,service_role;
create trigger recalc_receivable_after_reversal after insert on public.receivable_payment_reversals for each row execute function public._recalc_receivable_received();

create function public._sync_receivable_financial_projection(_tenant uuid,_id uuid) returns void language plpgsql security invoker set search_path='' as $fn$
declare r public.receivables%rowtype;begin
 select * into strict r from public.receivables where tenant_id=_tenant and id=_id;
 update public.client_invoices inv set status=case when inv.status='cancelled' then 'cancelled' when r.received_amount>=r.amount then 'paid'
  when inv.sent_at is not null then 'sent' else 'generated' end,updated_at=clock_timestamp(),updated_by=auth.uid() where inv.tenant_id=_tenant and inv.id=r.client_invoice_id;
 update public.closing_reports set received_amount=coalesce(r.received_amount,0),open_amount=greatest(0,total_amount-coalesce(r.received_amount,0)),
  status=case when r.received_amount>=r.amount then 'paid' when r.received_amount>0 then 'partially_paid' else 'invoiced' end,
  payment_status=case when r.received_amount>=r.amount then 'paid' when r.received_amount>0 then 'partially_paid' else 'unpaid' end,
  payment_date=case when r.received_amount>=r.amount then (r.received_at at time zone 'America/Sao_Paulo')::date else null end,
  updated_at=clock_timestamp(),updated_by=auth.uid() where tenant_id=_tenant and receivable_id=_id;
end;$fn$;
revoke all on function public._sync_receivable_financial_projection(uuid,uuid) from public,anon,authenticated,service_role;

create function public._guard_receivable_ledger() returns trigger language plpgsql security definer set search_path='' as $fn$
declare v_total numeric;v_has boolean;begin
 if tg_op='INSERT' then
  if coalesce(new.received_amount,0)<>0 or new.status in('received','partial') then raise exception 'financial_versioned_command_required' using errcode='55000';end if;
  return new;
 end if;
 select exists(select 1 from public.receivables_payments where tenant_id=old.tenant_id and receivable_id=old.id) into v_has;
 if tg_op='DELETE' then
  if v_has or old.client_invoice_id is not null or exists(select 1 from public.closing_reports where tenant_id=old.tenant_id and receivable_id=old.id) then
   raise exception 'financial_receivable_history_is_immutable' using errcode='55000';end if;return old;
 end if;
 if (new.id,new.tenant_id) is distinct from (old.id,old.tenant_id) or ((v_has or old.client_invoice_id is not null) and
  (new.amount,new.client_id,new.client_invoice_id,new.closing_report_id) is distinct from (old.amount,old.client_id,old.client_invoice_id,old.closing_report_id)) then
  raise exception 'financial_receivable_identity_is_immutable' using errcode='55000';end if;
 select coalesce(sum(p.amount),0) into v_total from public.receivables_payments p where p.tenant_id=old.tenant_id and p.receivable_id=old.id
  and not exists(select 1 from public.receivable_payment_reversals rv where rv.tenant_id=p.tenant_id and rv.payment_id=p.id);
 if coalesce(new.received_amount,0)<>v_total or v_total<0 or v_total>new.amount
  or (new.status='received' and (v_total<=0 or v_total<>new.amount)) or (new.status='partial' and (v_total<=0 or v_total>=new.amount))
  or (new.status in('pending','invoiced','cancelled') and v_total<>0) then
  raise exception 'financial_ledger_requires_reconciliation' using errcode='55000';end if;
 return new;
end;$fn$;
revoke all on function public._guard_receivable_ledger() from public,anon,authenticated,service_role;
create trigger guard_receivable_ledger before insert or update or delete on public.receivables for each row execute function public._guard_receivable_ledger();

create function public.get_receivable_financial_context(_tenant_id uuid,_receivable_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'financial_not_authorized' using errcode='42501';end if;
 return public._receivable_financial_snapshot(_tenant_id,_receivable_id)-'evidence';
end;$fn$;
revoke all on function public.get_receivable_financial_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_receivable_financial_context(uuid,uuid) to authenticated;

create function public.apply_receivable_financial_command(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_actor uuid:=auth.uid();v_tenant uuid;v_request uuid;v_id uuid;v_command uuid:=gen_random_uuid();v_action text;v_reason text;v_hash text;
 v_previous public.receivable_financial_commands%rowtype;v_before jsonb;v_after jsonb;v_result jsonb;v_payment public.receivables_payments%rowtype;
 v_amount numeric(14,2);v_date date;v_time timestamptz;v_bank uuid;v_tx uuid;v_payment_id uuid;v_reversal uuid;v_path text;v_report uuid;v_status text;
begin
 if jsonb_typeof(_payload) is distinct from 'object' or octet_length(_payload::text)>20000 or _payload->'version' is distinct from '1'::jsonb
  or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','actor_id','request_id','receivable_id','expected_revision','action','reason','amount_cents','effective_date','bank_account_id','method','notes','attachment_path','payment_id')) then
  raise exception 'financial_invalid_command' using errcode='22023';end if;
 v_tenant:=(_payload->>'tenant_id')::uuid;v_request:=(_payload->>'request_id')::uuid;v_id:=(_payload->>'receivable_id')::uuid;v_action:=_payload->>'action';v_reason:=btrim(_payload->>'reason');
 if v_actor is null or _payload->>'actor_id' is distinct from v_actor::text or v_tenant is null or not coalesce(public.is_tenant_operator_or_admin(v_tenant),false) then
  raise exception 'financial_not_authorized' using errcode='42501';end if;
 if v_request is null or v_id is null or coalesce(v_action,'') not in('receive','reverse','reconcile') or jsonb_typeof(_payload->'reason') is distinct from 'string'
  or coalesce(length(v_reason),0) not between 5 and 2000 or jsonb_typeof(_payload->'expected_revision') is distinct from 'string' or (_payload->>'expected_revision')!~'^[a-f0-9]{32}$' then
  raise exception 'financial_invalid_command' using errcode='22023';end if;
 if v_action='receive' then
  if _payload ? 'payment_id' or jsonb_typeof(_payload->'amount_cents') is distinct from 'number' or (_payload->>'amount_cents')!~'^[0-9]+$'
   or (_payload->>'amount_cents')::numeric not between 1 and 99999999999999 or coalesce(_payload->>'method','') not in('pix','boleto','ted','doc','dinheiro','cartao','debito_automatico','other') then
   raise exception 'financial_invalid_payment' using errcode='22023';end if;
  v_amount:=(_payload->>'amount_cents')::numeric/100;v_bank:=(_payload->>'bank_account_id')::uuid;
  if v_bank is null or (jsonb_typeof(_payload->'notes') is not null and jsonb_typeof(_payload->'notes') not in('string','null')) or length(_payload->>'notes')>2000
   or (jsonb_typeof(_payload->'attachment_path') is not null and jsonb_typeof(_payload->'attachment_path') not in('string','null')) then raise exception 'financial_invalid_payment' using errcode='22023';end if;
 elsif _payload ?| array['amount_cents','bank_account_id','method','notes','attachment_path'] then raise exception 'financial_invalid_command' using errcode='22023';end if;
 if v_action in('receive','reverse') then
  if jsonb_typeof(_payload->'effective_date') is distinct from 'string' or (_payload->>'effective_date')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'financial_invalid_date' using errcode='22023';end if;
  v_date:=(_payload->>'effective_date')::date;
  if not isfinite(v_date) or v_date>(clock_timestamp() at time zone 'America/Sao_Paulo')::date then raise exception 'financial_invalid_date' using errcode='22023';end if;
  v_time:=(v_date+time '12:00') at time zone 'America/Sao_Paulo';
 elsif _payload ?| array['effective_date','payment_id'] then raise exception 'financial_invalid_command' using errcode='22023';end if;
 if v_action='reverse' then v_payment_id:=(_payload->>'payment_id')::uuid;if v_payment_id is null then raise exception 'financial_invalid_payment' using errcode='22023';end if;end if;
 v_hash:=encode(sha256(convert_to(_payload::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext('receivable-financial-command'),hashtext(v_tenant::text||':'||v_actor::text||':'||v_request::text));
 perform tenant_id from public.tenant_memberships where tenant_id=v_tenant and user_id=v_actor and active and role::text in('owner','admin','operator') for share nowait;
 if not found or (v_action in('reverse','reconcile') and not coalesce(public.is_tenant_admin(v_tenant),false)) then raise exception 'financial_not_authorized' using errcode='42501';end if;
 select * into v_previous from public.receivable_financial_commands where tenant_id=v_tenant and actor_id=v_actor and request_id=v_request;
 if found then
  if v_previous.payload_hash<>v_hash then raise exception 'financial_request_key_mismatch' using errcode='22023';end if;return v_previous.response;
 end if;
 perform public._lock_receivable_financial_graph(v_tenant,v_id);
 v_before:=public._receivable_financial_snapshot(v_tenant,v_id);v_report:=(v_before->>'report_id')::uuid;
 if v_before->>'revision' is distinct from _payload->>'expected_revision' then raise exception 'financial_context_changed' using errcode='40001';end if;
 if not coalesce((v_before->>case v_action when 'receive' then 'can_receive' when 'reverse' then 'can_reverse' else 'can_reconcile' end)::boolean,false) then
  raise exception 'financial_action_requires_reconciliation_or_valid_state' using errcode='55000';end if;
 if v_action='receive' then
  if v_amount*100>(v_before->>'open_cents')::numeric then raise exception 'financial_amount_exceeds_open_balance' using errcode='22023';end if;
  perform id from public.bank_accounts where tenant_id=v_tenant and id=v_bank and active for share nowait;
  if not found then raise exception 'financial_invalid_bank_account' using errcode='23514';end if;
  v_path:=nullif(_payload->>'attachment_path','');
  if v_path is not null then
   if length(v_path)>1000 or v_path not like v_tenant::text||'/receivable-payments/%' or v_path like '%..%' then raise exception 'financial_invalid_attachment' using errcode='23514';end if;
   perform id from storage.objects where bucket_id='receipts' and name=v_path for share nowait;
   if not found then raise exception 'financial_attachment_not_found' using errcode='23514';end if;
  end if;
  insert into public.bank_transactions(tenant_id,bank_account_id,posted_at,description,amount,transaction_type,document_number,reconciliation_status,raw_payload)
   values(v_tenant,v_bank,v_time,'Recebimento: '||(v_before->>'reference'),v_amount,'credit',v_before->>'reference','matched',
    jsonb_build_object('source','receivable_payment','receivable_id',v_id,'financial_command_id',v_command)) returning id into v_tx;
  insert into public.receivables_payments(tenant_id,receivable_id,amount,received_at,bank_account_id,method,notes,attachment_url,bank_transaction_id,created_by,financial_command_id)
   values(v_tenant,v_id,v_amount,v_time,v_bank,_payload->>'method',nullif(_payload->>'notes',''),v_path,v_tx,v_actor,v_command) returning id into v_payment_id;
  if v_report is not null then
   insert into public.closing_report_payments(tenant_id,closing_report_id,receivable_id,bank_account_id,payment_date,amount,payment_method,notes,created_by,canonical_receivable_payment_id)
    values(v_tenant,v_report,v_id,v_bank,v_date,v_amount,_payload->>'method',nullif(_payload->>'notes',''),v_actor,v_payment_id);
  end if;
 elsif v_action='reverse' then
  select * into v_payment from public.receivables_payments where tenant_id=v_tenant and receivable_id=v_id and id=v_payment_id for update nowait;
  if not found then raise exception 'financial_payment_not_found' using errcode='23514';end if;
  if exists(select 1 from public.receivable_payment_reversals where tenant_id=v_tenant and payment_id=v_payment_id) then raise exception 'financial_payment_already_reversed' using errcode='23514';end if;
  if v_date<(v_payment.received_at at time zone 'America/Sao_Paulo')::date then raise exception 'financial_invalid_reversal_date' using errcode='22023';end if;
  perform id from public.bank_accounts where tenant_id=v_tenant and id=v_payment.bank_account_id for share nowait;
  if not found then raise exception 'financial_invalid_bank_account' using errcode='23514';end if;
  perform id from public.bank_transactions where tenant_id=v_tenant and id=v_payment.bank_transaction_id and amount=v_payment.amount and transaction_type='credit' and bank_account_id=v_payment.bank_account_id for share nowait;
  if not found then raise exception 'financial_ledger_evidence_requires_reconciliation' using errcode='55000';end if;
  insert into public.bank_transactions(tenant_id,bank_account_id,posted_at,description,amount,transaction_type,document_number,reconciliation_status,raw_payload)
   values(v_tenant,v_payment.bank_account_id,v_time,'Estorno de recebimento: '||(v_before->>'reference'),v_payment.amount,'debit',v_before->>'reference','matched',
    jsonb_build_object('source','receivable_payment_reversal','receivable_id',v_id,'payment_id',v_payment_id,'original_bank_transaction_id',v_payment.bank_transaction_id,'financial_command_id',v_command)) returning id into v_tx;
  insert into public.receivable_payment_reversals(tenant_id,receivable_id,payment_id,bank_transaction_id,financial_command_id,amount,effective_at,reason,created_by)
   values(v_tenant,v_id,v_payment_id,v_tx,v_command,v_payment.amount,v_time,v_reason,v_actor) returning id into v_reversal;
 else
  update public.receivables set received_amount=(v_before->>'received_cents')::numeric/100,status=case when (v_before->>'open_cents')::numeric=0 then 'received'
   when (v_before->>'received_cents')::numeric>0 then 'partial' when client_invoice_id is null then 'pending' else 'invoiced' end,
   received_at=case when (v_before->>'open_cents')::numeric=0 then (select max(p.received_at) from public.receivables_payments p where p.tenant_id=v_tenant and p.receivable_id=v_id
    and not exists(select 1 from public.receivable_payment_reversals rv where rv.tenant_id=p.tenant_id and rv.payment_id=p.id)) else null end,
   updated_at=clock_timestamp(),updated_by=v_actor where tenant_id=v_tenant and id=v_id;
 end if;
 perform public._sync_receivable_financial_projection(v_tenant,v_id);
 v_after:=public._receivable_financial_snapshot(v_tenant,v_id);
 if (v_after->>'requires_reconciliation')::boolean then raise exception 'financial_projection_verification_failed' using errcode='55000';end if;
 if v_report is not null then insert into public.closing_report_history(tenant_id,closing_report_id,action,reason,metadata,created_by)
  values(v_tenant,v_report,'financial_'||v_action,v_reason,jsonb_build_object('request_id',v_request,'financial_command_id',v_command,'payment_id',v_payment_id,'reversal_id',v_reversal,
   'before',v_before->'evidence','after',v_after->'evidence'),v_actor);end if;
 v_result:=jsonb_build_object('version',1,'tenant_id',v_tenant,'actor_id',v_actor,'request_id',v_request,'receivable_id',v_id,'action',v_action,'confirmed',true,
  'command_id',v_command,'payment_id',v_payment_id,'reversal_id',v_reversal,'bank_transaction_id',v_tx,'revision',v_after->>'revision',
  'received_cents',v_after->'received_cents','open_cents',v_after->'open_cents','report_id',v_report,'invoice_id',v_after->'invoice_id');
 insert into public.receivable_financial_commands(id,tenant_id,actor_id,request_id,receivable_id,action,reason,payload_hash,before_snapshot,after_snapshot,response)
  values(v_command,v_tenant,v_actor,v_request,v_id,v_action,v_reason,v_hash,v_before,v_after,v_result);
 return v_result;
exception when lock_not_available then raise exception 'financial_concurrent_change' using errcode='40001';end;$fn$;
revoke all on function public.apply_receivable_financial_command(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.apply_receivable_financial_command(jsonb) to authenticated;
revoke execute on function public.register_receivable_payment(uuid,numeric,timestamptz,uuid,text,text,text),public.reverse_receivable_payment(uuid),public.register_closing_report_payment(uuid,jsonb)
 from public,anon,authenticated,service_role;

-- Contract snapshots remain immutable. Actual ledger movements can be recorded
-- or reversed without pretending that changed operational/fiscal sources were approved.
create or replace function public._guard_closing_source_snapshot() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if tg_table_name='closing_report_items' then
  if old.source_type='system' and public._closing_source_fact(to_jsonb(new)) is distinct from public._closing_source_fact(to_jsonb(old)) then
   raise exception 'closing_source_snapshot_is_immutable' using errcode='55000';end if;
  if new.tenant_id is distinct from old.tenant_id or new.closing_report_id is distinct from old.closing_report_id
   or new.invoice_value is distinct from old.invoice_value or new.freight_value is distinct from old.freight_value or new.metadata is distinct from old.metadata then
   raise exception 'closing_source_snapshot_is_immutable' using errcode='55000';end if;
 else
  if new.tenant_id is distinct from old.tenant_id or new.filters_snapshot is distinct from old.filters_snapshot or new.totals_snapshot is distinct from old.totals_snapshot
   or new.total_amount is distinct from old.total_amount or new.total_freight_value is distinct from old.total_freight_value
   or new.total_invoice_value is distinct from old.total_invoice_value or new.client_id is distinct from old.client_id
   or new.payer_client_id is distinct from old.payer_client_id or new.period_start is distinct from old.period_start or new.period_end is distinct from old.period_end then
   raise exception 'closing_source_snapshot_is_immutable' using errcode='55000';end if;
  if (new.status is distinct from old.status and new.status in('closed','sent'))
   or (new.status='invoiced' and old.status not in('invoiced','paid','partially_paid','overdue'))
   or new.client_invoice_id is distinct from old.client_invoice_id then
   perform public._assert_closing_sources_current(old.id);
  end if;
 end if;return new;
end;$fn$;
revoke all on function public._guard_closing_source_snapshot() from public,anon,authenticated,service_role;

create or replace function public._guard_closing_lifecycle_state() returns trigger language plpgsql security definer set search_path='' as $fn$
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
  if old.status in('invoiced','paid','partially_paid','overdue') and new.status in('invoiced','paid','partially_paid','overdue') then
   if new.status is distinct from (case when new.status='overdue' and new.expected_payment_date<current_date and new.open_amount>0 then 'overdue'
    when new.received_amount>=new.total_amount then 'paid' when new.received_amount>0 then 'partially_paid' else 'invoiced' end)
    or new.payment_status is distinct from (case when new.status='overdue' then 'overdue' when new.received_amount>=new.total_amount then 'paid'
     when new.received_amount>0 then 'partially_paid' else 'unpaid' end)
    or not exists(select 1 from public.receivables recv join public.client_invoices inv on inv.tenant_id=recv.tenant_id and inv.id=recv.client_invoice_id
     where recv.tenant_id=new.tenant_id and recv.id=new.receivable_id and inv.id=new.client_invoice_id and inv.receivable_id=recv.id
      and recv.status<>'cancelled' and inv.status<>'cancelled' and recv.amount=new.total_amount and inv.total_amount=new.total_amount
      and recv.received_amount=new.received_amount and new.open_amount=greatest(0,new.total_amount-new.received_amount)) then
    raise exception 'closing_financial_ledger_requires_reconciliation' using errcode='55000';end if;
  elsif new.status='closed' then
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
