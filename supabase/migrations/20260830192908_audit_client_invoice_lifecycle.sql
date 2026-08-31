-- Local candidate: invoice lifecycle, bookkeeping only. No provider calls.
set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$ begin
 if to_regprocedure('public.apply_receivable_financial_command(jsonb)') is null or to_regclass('public.client_invoice_commands') is not null then
  raise exception 'Invoice lifecycle requires receivable commands and an unapplied migration';end if;
end;$guard$;
create table public.client_invoice_commands(
 id uuid primary key,tenant_id uuid not null,actor_id uuid not null,request_id uuid not null,invoice_id uuid not null,report_id uuid,
 action text not null check(action in('generate','generate_closing','mark_sent','cancel','reactivate')),reason text not null check(length(btrim(reason)) between 5 and 2000),
 payload_hash text not null,before_snapshot jsonb not null,after_snapshot jsonb not null,response jsonb not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id),unique(tenant_id,actor_id,request_id),foreign key(tenant_id,invoice_id) references public.client_invoices(tenant_id,id) on delete restrict,
 foreign key(tenant_id,report_id) references public.closing_reports(tenant_id,id) on delete restrict
);
create index client_invoice_commands_invoice_idx on public.client_invoice_commands(tenant_id,invoice_id);
alter table public.client_invoice_commands enable row level security;
revoke all on public.client_invoice_commands from public,anon,authenticated,service_role;
grant select on public.client_invoice_commands to authenticated;
create policy invoice_command_read on public.client_invoice_commands for select to authenticated
 using(public.is_tenant_operator_or_admin(tenant_id) and (actor_id=(select auth.uid()) or public.is_tenant_admin(tenant_id)));
create trigger invoice_commands_append_only before update or delete on public.client_invoice_commands for each row execute function public._preserve_closing_creation();
alter table public.client_invoices add column lifecycle_command_id uuid,add column lifecycle_revision bigint not null default 0,
 add constraint invoice_lifecycle_command_fkey foreign key(tenant_id,lifecycle_command_id) references public.client_invoice_commands(tenant_id,id) deferrable initially deferred;
revoke insert,update,delete,truncate,references,trigger on public.client_invoices,public.client_invoice_charges,public.client_invoice_details from public,anon,authenticated,service_role;
do $rls$ declare t text;begin
 foreach t in array array['client_invoices','client_invoice_charges','client_invoice_details'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy invoice_operator_scope on public.%I as restrictive for select to authenticated using (public.is_tenant_operator_or_admin(tenant_id))',t);
  execute format('create policy invoice_operator_read on public.%I for select to authenticated using (public.is_tenant_operator_or_admin(tenant_id))',t);
 end loop;
end;$rls$;

-- One evidence calculation for invoice lifecycle and receivable projections.
create function public._receivable_ledger_evidence(_tenant uuid,_id uuid) returns table(net numeric,payment_count bigint,valid boolean)
 language sql stable security invoker set search_path='' as $fn$
 select coalesce(sum(p.amount) filter(where rv.id is null),0),count(*),coalesce(bool_and(
  p.amount>0 and p.amount=round(p.amount,2) and b.id is not null and b.amount=p.amount and b.transaction_type='credit' and b.bank_account_id=p.bank_account_id
  and exists(select 1 from public.bank_accounts account where account.tenant_id=p.tenant_id and account.id=p.bank_account_id)
  and not exists(select 1 from public.receivables_payments other where other.bank_transaction_id=p.bank_transaction_id and other.id<>p.id)
  and (rv.id is null or (rv.receivable_id=p.receivable_id and rv.amount=p.amount and rb.id is not null and rb.amount=p.amount and rb.transaction_type='debit' and rb.bank_account_id=p.bank_account_id))),true)
 from public.receivables_payments p left join public.receivable_payment_reversals rv on rv.tenant_id=p.tenant_id and rv.payment_id=p.id
 left join public.bank_transactions b on b.tenant_id=p.tenant_id and b.id=p.bank_transaction_id
 left join public.bank_transactions rb on rb.tenant_id=rv.tenant_id and rb.id=rv.bank_transaction_id where p.tenant_id=_tenant and p.receivable_id=_id;
$fn$;
revoke all on function public._receivable_ledger_evidence(uuid,uuid) from public,anon,authenticated,service_role;

create function public._closing_charge_blocks_new(_id uuid) returns boolean language sql stable security invoker set search_path='' as $fn$
 select coalesce((select case when c.status in('draft','reviewing','cancelled') and c.client_invoice_id is null and c.receivable_id is null and c.received_amount=0 then false
  when c.status='cancelled' and c.received_amount=0 and exists(select 1 from public.client_invoices inv join public.receivables r on r.tenant_id=inv.tenant_id and r.id=inv.receivable_id
   cross join lateral public._receivable_ledger_evidence(r.tenant_id,r.id) ledger
   where inv.tenant_id=c.tenant_id and inv.id=c.client_invoice_id and r.id=c.receivable_id and r.client_invoice_id=inv.id and inv.status='cancelled' and r.status='cancelled'
    and inv.total_amount=c.total_amount and r.amount=c.total_amount and coalesce(r.received_amount,0)=0 and ledger.valid and ledger.net=0) then false else true end
  from public.closing_reports c where c.id=_id),true);
$fn$;
revoke all on function public._closing_charge_blocks_new(uuid) from public,anon,authenticated,service_role;

create function public._invoice_lifecycle_snapshot(_tenant uuid,_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $fn$
declare inv public.client_invoices%rowtype;r public.receivables%rowtype;c public.closing_reports%rowtype;ledger record;
 v_valid boolean;v_consistent boolean;v_report_count int;v_result jsonb;v_history jsonb;v_charges jsonb;v_details jsonb;
begin
 select * into inv from public.client_invoices where tenant_id=_tenant and id=_id;if not found then raise exception 'invoice_not_found' using errcode='23514';end if;
 select * into r from public.receivables where tenant_id=_tenant and id=inv.receivable_id;
 select count(*) into v_report_count from public.closing_reports where tenant_id=_tenant and (client_invoice_id=inv.id or receivable_id=r.id);
 select * into c from public.closing_reports where tenant_id=_tenant and (client_invoice_id=inv.id or receivable_id=r.id) order by id limit 1;
 select * into ledger from public._receivable_ledger_evidence(_tenant,r.id);
 v_valid:=r.id is not null and r.client_invoice_id=inv.id and r.client_id=inv.client_id and r.amount=inv.total_amount and inv.total_amount>0 and v_report_count<=1
  and ledger.valid and ledger.net between 0 and r.amount and coalesce(r.received_amount,0)=ledger.net
  and not exists(select 1 from public.receivables other where other.tenant_id=_tenant and other.client_invoice_id=inv.id and other.id<>r.id)
  and (c.id is null or (c.receivable_id=r.id and c.client_invoice_id=inv.id and c.total_amount=r.amount and c.received_amount=ledger.net));
 v_consistent:=v_valid and not (public._receivable_financial_snapshot(_tenant,r.id)->>'requires_reconciliation')::boolean
  and not exists(select 1 from public.client_invoice_charges ch where ch.tenant_id=_tenant and ch.invoice_id=inv.id and (ch.cancelled_at is null)<>(inv.status<>'cancelled'))
  and (c.id is null or inv.status<>'cancelled' or not exists(select 1 from public.closing_report_charge_claims where tenant_id=_tenant and report_id=c.id and released_at is null));
 select coalesce(jsonb_agg(to_jsonb(ch) order by ch.sort_order,ch.id),'[]') into v_charges from public.client_invoice_charges ch where tenant_id=_tenant and invoice_id=inv.id;
 select coalesce(jsonb_agg(to_jsonb(d) order by d.sort_order,d.id),'[]') into v_details from public.client_invoice_details d where tenant_id=_tenant and invoice_id=inv.id;
 select coalesce(jsonb_agg(x.value order by x.created_at desc,x.id),'[]') into v_history from(
  select id,created_at,jsonb_build_object('id',id,'action',action,'reason',reason,'created_at',created_at) value from public.client_invoice_commands where tenant_id=_tenant and invoice_id=inv.id order by created_at desc,id limit 20) x;
 v_result:=jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'invoice_id',inv.id,'report_id',c.id,'receivable_id',r.id,
  'invoice_number',inv.invoice_number,'status',inv.status,'amount_cents',(inv.total_amount*100)::bigint,'received_cents',(ledger.net*100)::bigint,
  'open_cents',(case when inv.status='cancelled' then 0 else greatest(0,inv.total_amount-ledger.net) end*100)::bigint,
  'requires_reconciliation',not coalesce(v_consistent,false),'can_mark_sent',coalesce(v_consistent,false) and inv.status in('generated','sent','paid'),
  'can_cancel',coalesce(v_valid,false) and ledger.net=0 and inv.status in('generated','sent','paid','cancelled') and public.is_tenant_admin(_tenant),
  'can_reactivate',coalesce(v_valid,false) and inv.status='cancelled' and public.is_tenant_admin(_tenant),'history',v_history,
  'evidence',jsonb_build_object('invoice',to_jsonb(inv),'receivable',to_jsonb(r),'closing',case when c.id is null then null else to_jsonb(c) end,'charges',v_charges,'details',v_details));
 return v_result||jsonb_build_object('revision',md5(v_result::text));
end;$fn$;
revoke all on function public._invoice_lifecycle_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
create function public.get_client_invoice_action_context(_tenant_id uuid,_invoice_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'invoice_not_authorized' using errcode='42501';end if;
 return public._invoice_lifecycle_snapshot(_tenant_id,_invoice_id)-'evidence';
end;$fn$;
revoke all on function public.get_client_invoice_action_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_client_invoice_action_context(uuid,uuid) to authenticated;

-- A bounded, single-snapshot list. Totals use proven net receipts, not invoice
-- face value. No per-invoice browser requests and no full evidence/history blob.
create function public.list_client_invoice_financials(_tenant_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare v_result jsonb;begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'invoice_not_authorized' using errcode='42501';end if;
 with recent as materialized(select * from public.client_invoices where tenant_id=_tenant_id order by created_at desc,id limit 501),
 checked as(select inv.*,to_jsonb(client)-'tenant_id' client_json,e.net,coalesce(
   r.id is not null and r.client_invoice_id=inv.id and r.client_id=inv.client_id and r.amount=inv.total_amount and inv.total_amount>0
   and e.valid and e.net between 0 and r.amount and coalesce(r.received_amount,0)=e.net
   and not exists(select 1 from public.receivables other where other.tenant_id=_tenant_id and other.client_invoice_id=inv.id and other.id<>r.id)
   and (case when inv.status='cancelled' then r.status='cancelled' and e.net=0 else
     r.status=(case when e.net>=r.amount then 'received' when e.net>0 then 'partial' else 'invoiced' end)
     and inv.status=(case when e.net>=r.amount then 'paid' when inv.sent_at is not null then 'sent' else 'generated' end) end)
   and not exists(select 1 from public.client_invoice_charges ch where ch.tenant_id=_tenant_id and ch.invoice_id=inv.id and (ch.cancelled_at is null)<>(inv.status<>'cancelled'))
   and (select count(*)<=1 from public.closing_reports c where c.tenant_id=_tenant_id and (c.client_invoice_id=inv.id or c.receivable_id=r.id))
   and not exists(select 1 from public.closing_reports c where c.tenant_id=_tenant_id and (c.client_invoice_id=inv.id or c.receivable_id=r.id) and not coalesce(
     c.client_invoice_id=inv.id and c.receivable_id=r.id and c.client_id=inv.client_id and c.total_amount=r.amount and c.received_amount=e.net
     and c.open_amount=(case when inv.status='cancelled' then 0 else r.amount-e.net end)
     and (case when inv.status='cancelled' then c.status='cancelled' and c.invoice_status='cancelled' and c.payment_status='unpaid'
       and not exists(select 1 from public.closing_report_charge_claims claim where claim.tenant_id=_tenant_id and claim.report_id=c.id and claim.released_at is null)
       else c.status=(case when c.status='overdue' and c.expected_payment_date<current_date and e.net<r.amount then 'overdue' when e.net>=r.amount then 'paid' when e.net>0 then 'partially_paid' else 'invoiced' end)
       and c.payment_status=(case when c.status='overdue' then 'overdue' when e.net>=r.amount then 'paid' when e.net>0 then 'partially_paid' else 'unpaid' end) end),false)),false) consistent
  from (select * from recent order by created_at desc,id limit 500) inv
  left join public.receivables r on r.tenant_id=_tenant_id and r.id=inv.receivable_id
  left join lateral(select cl.company_name,cl.tax_id from public.clients cl where cl.tenant_id=_tenant_id and cl.id=inv.client_id) client on true
  cross join lateral public._receivable_ledger_evidence(_tenant_id,r.id) e)
 select jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'truncated',(select count(*)>500 from recent),
  'rows',coalesce(jsonb_agg((to_jsonb(c)-'client_json'-'net'-'consistent')||jsonb_build_object('clients',c.client_json,
   'received_amount',case when consistent then net else null end,'open_amount',case when consistent then case when status='cancelled' then 0 else total_amount-net end else null end,
   'requires_reconciliation',not consistent) order by created_at desc,id),'[]')) into v_result from checked c;
 return v_result;
end;$fn$;
revoke all on function public.list_client_invoice_financials(uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_client_invoice_financials(uuid) to authenticated;

create function public._guard_invoice_contract() returns trigger language plpgsql security definer set search_path='' as $fn$
declare r public.receivables%rowtype;v_command boolean;v_changed boolean;begin
 if tg_op='DELETE' then raise exception 'invoice_history_is_immutable' using errcode='55000';end if;
 if tg_op='INSERT' then
  if new.status<>'generated' or new.total_amount<=0 or new.receivable_id is not null then raise exception 'invoice_invalid_initial_state' using errcode='23514';end if;return new;
 end if;
 if (new.id,new.tenant_id,new.client_id,new.invoice_number,new.sequence_number,new.installment_number,new.issue_date,new.due_date,new.gross_amount,new.discount_amount,new.interest_amount,new.total_amount,new.payer_snapshot,new.company_snapshot,new.notes)
  is distinct from (old.id,old.tenant_id,old.client_id,old.invoice_number,old.sequence_number,old.installment_number,old.issue_date,old.due_date,old.gross_amount,old.discount_amount,old.interest_amount,old.total_amount,old.payer_snapshot,old.company_snapshot,old.notes) then
  raise exception 'invoice_contract_is_immutable' using errcode='55000';end if;
 select * into r from public.receivables where tenant_id=new.tenant_id and id=new.receivable_id;
 if old.lifecycle_command_id is not null and new.lifecycle_command_id is null then raise exception 'invoice_history_is_immutable' using errcode='55000';end if;
 if new.receivable_id is distinct from old.receivable_id and (old.receivable_id is not null or r.id is null or r.client_invoice_id is distinct from new.id or r.amount is distinct from new.total_amount or r.client_id is distinct from new.client_id) then
  raise exception 'invoice_financial_links_are_immutable' using errcode='55000';end if;
 v_command:=new.lifecycle_command_id is not null and new.lifecycle_command_id is distinct from old.lifecycle_command_id;
 if not v_command then
  if (new.sent_at,new.sent_to,new.sent_channel,new.cancelled_at,new.cancellation_reason) is distinct from (old.sent_at,old.sent_to,old.sent_channel,old.cancelled_at,old.cancellation_reason)
   or (new.status is distinct from old.status and (old.status='cancelled' or new.status='cancelled' or r.id is null or r.status='cancelled'
    or new.status is distinct from (case when coalesce(r.received_amount,0)>=r.amount then 'paid' when new.sent_at is not null then 'sent' else 'generated' end))) then
   raise exception 'invoice_versioned_command_required' using errcode='55000';end if;
 elsif new.lifecycle_command_id is null then raise exception 'invoice_versioned_command_required' using errcode='55000';end if;
 v_changed:=(new.status,new.receivable_id,new.sent_at,new.sent_to,new.sent_channel,new.cancelled_at,new.cancellation_reason,new.lifecycle_command_id)
  is distinct from (old.status,old.receivable_id,old.sent_at,old.sent_to,old.sent_channel,old.cancelled_at,old.cancellation_reason,old.lifecycle_command_id);
 if v_changed then new.lifecycle_revision:=old.lifecycle_revision+1;
 elsif new.lifecycle_revision is distinct from old.lifecycle_revision then raise exception 'invoice_revision_is_server_owned' using errcode='55000';end if;return new;
end;$fn$;
revoke all on function public._guard_invoice_contract() from public,anon,authenticated,service_role;
create trigger guard_invoice_contract before insert or update or delete on public.client_invoices for each row execute function public._guard_invoice_contract();

create function public._guard_invoice_charge_history() returns trigger language plpgsql security definer set search_path='' as $fn$
declare v_status text;begin
 if tg_op='DELETE' or tg_table_name='client_invoice_details' then raise exception 'invoice_charge_history_is_immutable' using errcode='55000';end if;
 if (to_jsonb(new)-'cancelled_at') is distinct from (to_jsonb(old)-'cancelled_at') then raise exception 'invoice_charge_history_is_immutable' using errcode='55000';end if;
 select status into v_status from public.client_invoices where tenant_id=new.tenant_id and id=new.invoice_id;
 if v_status is null or (new.cancelled_at is null)<>(v_status<>'cancelled') then raise exception 'invoice_charge_state_requires_reconciliation' using errcode='55000';end if;return new;
end;$fn$;
revoke all on function public._guard_invoice_charge_history() from public,anon,authenticated,service_role;
create trigger guard_invoice_charge_history before update or delete on public.client_invoice_charges for each row execute function public._guard_invoice_charge_history();
create trigger guard_invoice_detail_history before update or delete on public.client_invoice_details for each row execute function public._guard_invoice_charge_history();

create function public._invoice_money(_value jsonb) returns numeric language plpgsql immutable security invoker set search_path='' as $fn$
declare v numeric;begin
 if _value is null or _value='null'::jsonb then return 0;end if;
 if jsonb_typeof(_value)<>'number' then raise exception 'invoice_invalid_amount' using errcode='22023';end if;v:=(_value#>>'{}')::numeric;
 if v<0 or v>999999999999.99 or v<>round(v,2) then raise exception 'invoice_invalid_amount' using errcode='22023';end if;return v;
end;$fn$;
revoke all on function public._invoice_money(jsonb) from public,anon,authenticated,service_role;

create function public._client_invoice_draft_snapshot(_tenant uuid,_draft jsonb,_lock boolean default false,_exclude_invoice uuid default null) returns jsonb
 language plpgsql security invoker set search_path='' as $fn$
declare v_client uuid;v_charge jsonb;v_type text;v_id uuid;v_gross numeric:=0;v_total numeric;v_amount numeric;v_facts jsonb:='[]';v_fact jsonb;v_count int;v_result jsonb;
 v_cte public.cte_documents%rowtype;v_nfse public.nfse_documents%rowtype;v_client_row public.clients%rowtype;
begin
 if jsonb_typeof(_draft) is distinct from 'object' or octet_length(_draft::text)>1000000 or _draft->>'tenant_id' is distinct from _tenant::text
  or exists(select 1 from jsonb_object_keys(_draft) k where k not in('tenant_id','client_id','issue_date','due_date','installment_number','discount_amount','interest_amount','notes','payer_snapshot','company_snapshot','charges')) then
  raise exception 'invoice_invalid_draft' using errcode='22023';end if;
 v_client:=(_draft->>'client_id')::uuid;
 if _lock then perform id from public.clients where tenant_id=_tenant and id=v_client for share nowait;end if;
 select * into v_client_row from public.clients where tenant_id=_tenant and id=v_client and active;
 if not found then raise exception 'invoice_invalid_client' using errcode='23514';end if;
 if jsonb_typeof(_draft->'charges') is distinct from 'array' or jsonb_array_length(_draft->'charges') not between 1 and 500 then raise exception 'invoice_invalid_charges' using errcode='22023';end if;
 if coalesce(_draft->>'issue_date','')!~'^\d{4}-\d{2}-\d{2}$' or not isfinite((_draft->>'issue_date')::date)
  or (nullif(_draft->>'due_date','') is not null and (not isfinite((_draft->>'due_date')::date) or (_draft->>'due_date')!~'^\d{4}-\d{2}-\d{2}$')) then raise exception 'invoice_invalid_date' using errcode='22023';end if;
 if exists(select 1 from jsonb_array_elements(_draft->'charges') ch where ch->>'source_id' is not null group by ch->>'source_type',ch->>'source_id' having count(*)>1) then
  raise exception 'invoice_duplicate_source' using errcode='23505';end if;
 v_count:=jsonb_array_length(_draft->'charges');
 for v_charge in select value from jsonb_array_elements(_draft->'charges') order by value->>'source_type',value->>'source_id',value->>'sort_order' loop
  if jsonb_typeof(v_charge)<>'object' then raise exception 'invoice_invalid_charge' using errcode='22023';end if;
  v_type:=v_charge->>'source_type';v_id:=nullif(v_charge->>'source_id','')::uuid;v_amount:=public._invoice_money(v_charge->'gross_amount');
  perform public._invoice_money(v_charge->'net_amount'),public._invoice_money(v_charge->'ir_amount'),public._invoice_money(v_charge->'discount_amount'),public._invoice_money(v_charge->'interest_amount');
  if v_type in('cte_document','nfse_document') then
   if v_id is null then raise exception 'invoice_invalid_source' using errcode='23514';end if;
   if _lock and not pg_try_advisory_xact_lock(hashtext('invoice-source-charge'),hashtext(_tenant::text||':'||v_type||':'||v_id::text)) then raise exception 'invoice_source_concurrent_change' using errcode='40001';end if;
   if exists(select 1 from public.client_invoice_charges where tenant_id=_tenant and source_type=v_type and source_id=v_id and cancelled_at is null and invoice_id is distinct from _exclude_invoice) then
    raise exception 'invoice_source_already_billed' using errcode='23505';end if;
  end if;
  if v_type='cte_document' then
   if _lock then perform id from public.cte_documents where tenant_id=_tenant and id=v_id for share nowait;end if;
   select * into v_cte from public.cte_documents where tenant_id=_tenant and id=v_id and client_id=v_client and cancelled_at is null and is_voided=false and status<>'cancelled';
   if not found or coalesce(v_cte.freight_value,0)<>v_amount then raise exception 'invoice_source_changed' using errcode='40001';end if;
   v_fact:=jsonb_build_object('type',v_type,'id',v_id,'client_id',v_cte.client_id,'number',v_cte.cte_number,'series',v_cte.cte_series,'amount',v_cte.freight_value,'status',v_cte.status,'sefaz_status',v_cte.sefaz_status,'documents',v_cte.fiscal_document_ids);
  elsif v_type='nfse_document' then
   if _lock then perform id from public.nfse_documents where tenant_id=_tenant and id=v_id for share nowait;end if;
   select * into v_nfse from public.nfse_documents where tenant_id=_tenant and id=v_id and cliente_id=v_client and not cancelled and not is_preview and status<>'cancelled';
   if not found or coalesce(v_nfse.valor_total,0)<>v_amount then raise exception 'invoice_source_changed' using errcode='40001';end if;
   v_fact:=jsonb_build_object('type',v_type,'id',v_id,'client_id',v_nfse.cliente_id,'number',v_nfse.nfse_number,'amount',v_nfse.valor_total,'net',v_nfse.valor_liquido,'ir',v_nfse.valor_ir,'status',v_nfse.status);
  elsif v_type='manual_service' then
   if v_id is not null or coalesce(length(btrim(v_charge->>'description')),0) not between 1 and 2000 then raise exception 'invoice_invalid_manual_charge' using errcode='22023';end if;
   v_fact:=jsonb_build_object('type',v_type,'description',v_charge->>'description','reference',v_charge->>'reference_number','amount',v_amount);
  else raise exception 'invoice_invalid_source' using errcode='22023';end if;
  v_facts:=v_facts||jsonb_build_array(v_fact);v_gross:=v_gross+v_amount;
 end loop;
 -- Preserve the existing commercial gross-minus-discount-plus-interest rule.
 -- This migration does not reinterpret withholding/tax accounting policy.
 v_total:=v_gross-public._invoice_money(_draft->'discount_amount')+public._invoice_money(_draft->'interest_amount');
 if v_total<=0 or v_total>999999999999.99 then raise exception 'invoice_invalid_total' using errcode='22023';end if;
 v_result:=jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'mode','generate','report_id',null,'client_id',v_client,
  'amount_cents',(v_total*100)::bigint,'charge_count',v_count,'can_generate',true,'evidence',jsonb_build_object('draft',_draft,'source_facts',v_facts,'client',jsonb_build_object('id',v_client,'name',v_client_row.company_name)));
 return v_result||jsonb_build_object('revision',md5(v_result::text));
end;$fn$;
revoke all on function public._client_invoice_draft_snapshot(uuid,jsonb,boolean,uuid) from public,anon,authenticated,service_role;

create function public._closing_invoice_creation_snapshot(_tenant uuid,_report uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $fn$
declare c public.closing_reports%rowtype;v_result jsonb;begin
 select * into c from public.closing_reports where tenant_id=_tenant and id=_report;if not found then raise exception 'invoice_closing_not_found' using errcode='23514';end if;
 v_result:=jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'mode','generate_closing','report_id',c.id,'client_id',c.client_id,
  'amount_cents',(c.total_amount*100)::bigint,'charge_count',1,'can_generate',c.status in('closed','sent') and c.client_id is not null and c.client_invoice_id is null and c.receivable_id is null and c.total_amount>0,
  'evidence',to_jsonb(c));return v_result||jsonb_build_object('revision',md5(v_result::text));
end;$fn$;
revoke all on function public._closing_invoice_creation_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
create function public.get_client_invoice_creation_context(_tenant_id uuid,_report_id uuid default null,_draft jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $fn$
begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'invoice_not_authorized' using errcode='42501';end if;
 if (_report_id is null)=(_draft is null) then raise exception 'invoice_invalid_subject' using errcode='22023';end if;
 if _report_id is not null then return public._closing_invoice_creation_snapshot(_tenant_id,_report_id)-'evidence';end if;
 return public._client_invoice_draft_snapshot(_tenant_id,_draft,false,null)-'evidence';
end;$fn$;
revoke all on function public.get_client_invoice_creation_context(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_client_invoice_creation_context(uuid,uuid,jsonb) to authenticated;

create function public._assert_invoice_sources_for_reactivation(_tenant uuid,_invoice uuid) returns void language plpgsql security invoker set search_path='' as $fn$
declare inv public.client_invoices%rowtype;v_charges jsonb;v_draft jsonb;v_snapshot jsonb;v_original jsonb;begin
 select * into strict inv from public.client_invoices where tenant_id=_tenant and id=_invoice;
 select jsonb_agg(jsonb_build_object('source_type',source_type,'source_id',source_id,'description',description,'reference_number',reference_number,'gross_amount',gross_amount,
  'net_amount',net_amount,'ir_amount',ir_amount,'discount_amount',discount_amount,'interest_amount',interest_amount,'sort_order',sort_order) order by sort_order,id)
  into v_charges from public.client_invoice_charges where tenant_id=_tenant and invoice_id=_invoice;
 v_draft:=jsonb_build_object('tenant_id',_tenant,'client_id',inv.client_id,'issue_date',inv.issue_date,'due_date',inv.due_date,'discount_amount',inv.discount_amount,'interest_amount',inv.interest_amount,'charges',v_charges);
 v_snapshot:=public._client_invoice_draft_snapshot(_tenant,v_draft,true,_invoice);
 if (v_snapshot->>'amount_cents')::numeric<>inv.total_amount*100 then raise exception 'invoice_contract_requires_reconciliation' using errcode='55000';end if;
 select before_snapshot#>'{evidence,source_facts}' into v_original from public.client_invoice_commands where tenant_id=_tenant and invoice_id=_invoice and action='generate' order by created_at limit 1;
 if v_original is not null and v_original is distinct from v_snapshot#>'{evidence,source_facts}' then raise exception 'invoice_source_changed' using errcode='40001';end if;
end;$fn$;
revoke all on function public._assert_invoice_sources_for_reactivation(uuid,uuid) from public,anon,authenticated,service_role;

create function public.apply_client_invoice_command(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_actor uuid:=auth.uid();v_tenant uuid;v_request uuid;v_invoice uuid;v_report uuid;v_receivable uuid;v_action text;v_reason text;v_hash text;v_command uuid:=gen_random_uuid();
 v_before jsonb;v_after jsonb;v_result jsonb;v_previous public.client_invoice_commands%rowtype;v_inv public.client_invoices%rowtype;v_net numeric;v_state text;
begin
 if jsonb_typeof(_payload) is distinct from 'object' or octet_length(_payload::text)>1100000 or _payload->'version' is distinct from '1'::jsonb
  or exists(select 1 from jsonb_object_keys(_payload) k where k not in('version','tenant_id','actor_id','request_id','invoice_id','report_id','draft','expected_revision','action','reason','sent_to','channel')) then
  raise exception 'invoice_invalid_command' using errcode='22023';end if;
 v_tenant:=(_payload->>'tenant_id')::uuid;v_request:=(_payload->>'request_id')::uuid;v_invoice:=(_payload->>'invoice_id')::uuid;v_report:=(_payload->>'report_id')::uuid;v_action:=_payload->>'action';v_reason:=btrim(_payload->>'reason');
 if v_actor is null or _payload->>'actor_id' is distinct from v_actor::text or not coalesce(public.is_tenant_operator_or_admin(v_tenant),false) then raise exception 'invoice_not_authorized' using errcode='42501';end if;
 if v_request is null or coalesce(v_action,'') not in('generate','generate_closing','mark_sent','cancel','reactivate') or jsonb_typeof(_payload->'reason') is distinct from 'string'
  or coalesce(length(v_reason),0) not between 5 and 2000 or coalesce(_payload->>'expected_revision','')!~'^[a-f0-9]{32}$' then raise exception 'invoice_invalid_command' using errcode='22023';end if;
 if (v_action='generate' and (v_invoice is not null or v_report is not null or jsonb_typeof(_payload->'draft') is distinct from 'object'))
  or (v_action='generate_closing' and (v_invoice is not null or v_report is null or _payload?'draft'))
  or (v_action in('mark_sent','cancel','reactivate') and (v_invoice is null or v_report is not null or _payload?'draft'))
  or (v_action<>'mark_sent' and _payload ?| array['sent_to','channel']) then raise exception 'invoice_invalid_subject' using errcode='22023';end if;
 if v_action='mark_sent' and (coalesce(length(btrim(_payload->>'channel')),0) not between 1 and 100 or coalesce(length(btrim(_payload->>'sent_to')),0) not between 1 and 500) then
  raise exception 'invoice_invalid_send_record' using errcode='22023';end if;
 v_hash:=encode(sha256(convert_to(_payload::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext('client-invoice-command'),hashtext(v_tenant::text||':'||v_actor::text||':'||v_request::text));
 perform tenant_id from public.tenant_memberships where tenant_id=v_tenant and user_id=v_actor and active and role::text in('owner','admin','operator') for share nowait;
 if not found or (v_action in('cancel','reactivate') and not coalesce(public.is_tenant_admin(v_tenant),false)) then raise exception 'invoice_not_authorized' using errcode='42501';end if;
 select * into v_previous from public.client_invoice_commands where tenant_id=v_tenant and actor_id=v_actor and request_id=v_request;
 if found then if v_previous.payload_hash<>v_hash then raise exception 'invoice_request_key_mismatch' using errcode='22023';end if;return v_previous.response;end if;
 if v_action='generate' then
  v_before:=public._client_invoice_draft_snapshot(v_tenant,_payload->'draft',true,null);
 elsif v_action='generate_closing' then
  perform id from public.closing_reports where tenant_id=v_tenant and id=v_report for update nowait;
  v_before:=public._closing_invoice_creation_snapshot(v_tenant,v_report);
 else
  select receivable_id into v_receivable from public.client_invoices where tenant_id=v_tenant and id=v_invoice;
  if v_receivable is null then raise exception 'invoice_financial_graph_requires_reconciliation' using errcode='55000';end if;
  perform public._lock_receivable_financial_graph(v_tenant,v_receivable);
  perform id from public.client_invoice_charges where tenant_id=v_tenant and invoice_id=v_invoice order by id for update nowait;
  perform id from public.client_invoice_details where tenant_id=v_tenant and invoice_id=v_invoice order by id for share nowait;
  v_before:=public._invoice_lifecycle_snapshot(v_tenant,v_invoice);v_report:=(v_before->>'report_id')::uuid;
 end if;
 if v_before->>'revision' is distinct from _payload->>'expected_revision' then raise exception 'invoice_context_changed' using errcode='40001';end if;
 if not coalesce((v_before->>(case v_action when 'generate' then 'can_generate' when 'generate_closing' then 'can_generate' when 'mark_sent' then 'can_mark_sent' when 'cancel' then 'can_cancel' else 'can_reactivate' end))::boolean,false) then
  raise exception 'invoice_action_requires_reconciliation_or_valid_state' using errcode='55000';end if;
 if v_action='generate' then v_invoice:=public.create_client_invoice(_payload->'draft');
 elsif v_action='generate_closing' then v_invoice:=public.generate_client_invoice_from_closing(v_report);
 end if;
 select * into strict v_inv from public.client_invoices where tenant_id=v_tenant and id=v_invoice;v_receivable:=v_inv.receivable_id;
 if v_action in('generate','generate_closing') then
  update public.client_invoices set lifecycle_command_id=v_command where tenant_id=v_tenant and id=v_invoice;
 elsif v_action='mark_sent' then
  update public.client_invoices set lifecycle_command_id=v_command,status=case when status='paid' then 'paid' else 'sent' end,
   sent_at=clock_timestamp(),sent_to=btrim(_payload->>'sent_to'),sent_channel=btrim(_payload->>'channel'),updated_at=clock_timestamp(),updated_by=v_actor where tenant_id=v_tenant and id=v_invoice;
 elsif v_action='cancel' then
  update public.receivables set status='cancelled',received_at=null,updated_at=clock_timestamp(),updated_by=v_actor where tenant_id=v_tenant and id=v_receivable;
  update public.client_invoices set lifecycle_command_id=v_command,status='cancelled',cancelled_at=coalesce(cancelled_at,clock_timestamp()),cancellation_reason=coalesce(cancellation_reason,v_reason),updated_at=clock_timestamp(),updated_by=v_actor where tenant_id=v_tenant and id=v_invoice;
  update public.client_invoice_charges set cancelled_at=clock_timestamp() where tenant_id=v_tenant and invoice_id=v_invoice and cancelled_at is null;
  if v_report is not null then update public.closing_reports set status='cancelled',invoice_status='cancelled',payment_status='unpaid',open_amount=0,cancellation_reason=v_reason,updated_at=clock_timestamp(),updated_by=v_actor where tenant_id=v_tenant and id=v_report;end if;
 else
  perform public._assert_invoice_sources_for_reactivation(v_tenant,v_invoice);
  select net into v_net from public._receivable_ledger_evidence(v_tenant,v_receivable);
  update public.receivables set status=case when v_net>=amount then 'received' when v_net>0 then 'partial' else 'invoiced' end,updated_at=clock_timestamp(),updated_by=v_actor where tenant_id=v_tenant and id=v_receivable;
  update public.client_invoices set lifecycle_command_id=v_command,status=case when v_net>=total_amount then 'paid' when sent_at is not null then 'sent' else 'generated' end,
   cancelled_at=null,cancellation_reason=null,updated_at=clock_timestamp(),updated_by=v_actor where tenant_id=v_tenant and id=v_invoice;
  update public.client_invoice_charges set cancelled_at=null where tenant_id=v_tenant and invoice_id=v_invoice and cancelled_at is not null;
  if v_report is not null then
   perform public._claim_closing_delivery_charges(v_report);
   update public.closing_reports set status=case when v_net>=total_amount then 'paid' when v_net>0 then 'partially_paid' else 'invoiced' end,
    invoice_status='invoiced',payment_status=case when v_net>=total_amount then 'paid' when v_net>0 then 'partially_paid' else 'unpaid' end,
    received_amount=v_net,open_amount=greatest(0,total_amount-v_net),cancellation_reason=null,updated_at=clock_timestamp(),updated_by=v_actor where tenant_id=v_tenant and id=v_report;
  end if;
 end if;
 v_after:=public._invoice_lifecycle_snapshot(v_tenant,v_invoice);
 if (v_after->>'requires_reconciliation')::boolean then raise exception 'invoice_projection_verification_failed' using errcode='55000';end if;
 if v_report is not null then insert into public.closing_report_history(tenant_id,closing_report_id,action,reason,metadata,created_by)
  values(v_tenant,v_report,'invoice_'||v_action,v_reason,jsonb_build_object('command_id',v_command,'request_id',v_request,'before',v_before,'after',v_after),v_actor);end if;
 v_result:=jsonb_build_object('version',1,'tenant_id',v_tenant,'actor_id',v_actor,'request_id',v_request,'invoice_id',v_invoice,'report_id',v_report,'receivable_id',v_receivable,
  'action',v_action,'command_id',v_command,'confirmed',true,'invoice_number',v_after->>'invoice_number','status',v_after->>'status','revision',v_after->>'revision');
 insert into public.client_invoice_commands(id,tenant_id,actor_id,request_id,invoice_id,report_id,action,reason,payload_hash,before_snapshot,after_snapshot,response)
  values(v_command,v_tenant,v_actor,v_request,v_invoice,v_report,v_action,v_reason,v_hash,v_before,v_after,v_result);return v_result;
exception when lock_not_available then raise exception 'invoice_concurrent_change' using errcode='40001';end;$fn$;
revoke all on function public.apply_client_invoice_command(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.apply_client_invoice_command(jsonb) to authenticated;
revoke all on function public.create_client_invoice(jsonb),public.generate_client_invoice_from_closing(uuid),public.cancel_client_invoice(uuid,text) from public,anon,authenticated,service_role;

-- Extend the existing financial guards without changing earlier migrations.
create or replace function public._receivable_financial_snapshot(_tenant uuid,_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $fn$
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
 select net,payment_count,valid into v_net,v_count,v_valid from public._receivable_ledger_evidence(_tenant,_id);
 if not v_valid or v_net<0 or v_net>r.amount then v_structural:=false;v_reason:='financial_ledger_evidence_requires_reconciliation';end if;
 v_balanced:=coalesce(r.received_amount,0)=v_net
  and r.status is not distinct from (case when r.status='cancelled' and v_net=0 then 'cancelled' when v_net>=r.amount then 'received'
   when v_net>0 then 'partial' when inv.id is not null then 'invoiced' else 'pending' end)
  and (inv.id is null or inv.status is not distinct from (case when inv.status='cancelled' and v_net=0 then 'cancelled'
   when v_net>=r.amount then 'paid' when inv.sent_at is not null then 'sent' else 'generated' end))
  and (c.id is null or (c.received_amount=v_net and c.open_amount=(case when r.status='cancelled' then 0 else greatest(0,r.amount-v_net) end)
   and c.status is not distinct from (case when c.status='cancelled' and r.status='cancelled' and inv.status='cancelled' and v_net=0 then 'cancelled' when c.status='overdue' and c.expected_payment_date<current_date and v_net<r.amount then 'overdue'
    when v_net>=r.amount then 'paid' when v_net>0 then 'partially_paid' else 'invoiced' end)
   and c.payment_status is not distinct from (case when c.status='overdue' then 'overdue' when v_net>=r.amount then 'paid'
    when v_net>0 then 'partially_paid' else 'unpaid' end)));
 if not v_balanced and v_reason is null then v_reason:='financial_projection_requires_reconciliation';end if;
 if (inv.status='cancelled' or r.status='cancelled') and (v_net>0 or r.status<>'cancelled' or (inv.id is not null and inv.status<>'cancelled') or (c.id is not null and c.status<>'cancelled')) then
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
  'received_cents',(v_net*100)::bigint,'open_cents',((case when r.status='cancelled' then 0 else greatest(0,r.amount-v_net) end)*100)::bigint,
  'requires_reconciliation',not(v_structural and v_balanced),'reconciliation_reason',v_reason,
  'can_receive',v_structural and v_balanced and r.status<>'cancelled' and coalesce(inv.status,'generated')<>'cancelled' and v_net<r.amount,
  'can_reverse',v_structural and v_balanced and v_net>0 and coalesce(public.is_tenant_admin(_tenant),false),
  'can_reconcile',v_structural and not v_balanced and v_count>0 and coalesce(public.is_tenant_admin(_tenant),false),
  'payments',v_history,'history_complete',v_count<=500,'payment_count',v_count,'bank_accounts',v_banks,
  'evidence',jsonb_build_object('receivable',to_jsonb(r),'invoice',case when inv.id is null then null else to_jsonb(inv) end,'closing',case when c.id is null then null else to_jsonb(c) end));
 return v_result||jsonb_build_object('revision',md5(v_result::text));
end;$fn$;

create or replace function public._claim_closing_delivery_charges(_report uuid) returns void language plpgsql security invoker set search_path='' as $fn$
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
   and public._closing_charge_blocks_new(parent.id)) then
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

create or replace function public._preserve_closing_charge_claim() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if tg_op='DELETE' then raise exception 'closing_charge_history_is_immutable' using errcode='55000';end if;
 if (to_jsonb(new)-array['source_key','released_at','released_by','release_reason']) is distinct from (to_jsonb(old)-array['source_key','released_at','released_by','release_reason'])
  or old.released_at is not null or new.released_at is null or new.released_by is distinct from auth.uid()
  or not exists(select 1 from public.closing_reports r where r.tenant_id=old.tenant_id and r.id=old.report_id and r.status in('reviewing','cancelled')
   and ((r.client_invoice_id is null and r.receivable_id is null and r.received_amount=0) or (r.status='cancelled' and not public._closing_charge_blocks_new(r.id)))) then
  raise exception 'closing_charge_history_is_immutable' using errcode='55000';end if;
 return new;
end;$fn$;

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
    and new.open_amount=(case when new.status='cancelled' then 0 else greatest(0,new.total_amount-new.received_amount) end)) then
   raise exception 'closing_financial_ledger_requires_reconciliation' using errcode='55000';end if;
 end if;
 linked:=old.client_invoice_id is not null or old.receivable_id is not null or old.received_amount>0
  or exists(select 1 from public.closing_report_payments where tenant_id=old.tenant_id and closing_report_id=old.id);
 if new.status is distinct from old.status then
  if new.status='cancelled' and new.client_invoice_id is not null then
   if new.received_amount<>0 or new.open_amount<>0 or new.invoice_status<>'cancelled' or new.payment_status<>'unpaid'
    or not exists(select 1 from public.client_invoices inv join public.receivables recv on recv.tenant_id=inv.tenant_id and recv.id=inv.receivable_id
     cross join lateral public._receivable_ledger_evidence(recv.tenant_id,recv.id) ledger
     where inv.tenant_id=new.tenant_id and inv.id=new.client_invoice_id and recv.id=new.receivable_id and recv.client_invoice_id=inv.id
      and inv.status='cancelled' and recv.status='cancelled' and ledger.valid and ledger.net=0 and recv.received_amount=0
      and inv.total_amount=new.total_amount and recv.amount=new.total_amount) then raise exception 'invoice_cancel_requires_financial_reconciliation' using errcode='55000';end if;
  elsif old.status='cancelled' and new.status in('invoiced','partially_paid','paid') and new.client_invoice_id is not null then
   if new.status is distinct from (case when new.received_amount>=new.total_amount then 'paid' when new.received_amount>0 then 'partially_paid' else 'invoiced' end)
    or not exists(select 1 from public.client_invoices inv join public.receivables recv on recv.tenant_id=inv.tenant_id and recv.id=inv.receivable_id
     where inv.tenant_id=new.tenant_id and inv.id=new.client_invoice_id and recv.id=new.receivable_id and recv.client_invoice_id=inv.id
      and inv.status<>'cancelled' and recv.status<>'cancelled' and recv.received_amount=new.received_amount and inv.total_amount=new.total_amount and recv.amount=new.total_amount) then
    raise exception 'invoice_reactivation_requires_financial_reconciliation' using errcode='55000';end if;
   perform public._claim_closing_delivery_charges(old.id);
  elsif old.status in('invoiced','paid','partially_paid','overdue') and new.status in('invoiced','paid','partially_paid','overdue') then
   if new.status is distinct from (case when new.status='overdue' and new.expected_payment_date<current_date and new.open_amount>0 then 'overdue'
    when new.received_amount>=new.total_amount then 'paid' when new.received_amount>0 then 'partially_paid' else 'invoiced' end)
    or new.payment_status is distinct from (case when new.status='overdue' then 'overdue' when new.received_amount>=new.total_amount then 'paid'
     when new.received_amount>0 then 'partially_paid' else 'unpaid' end)
    or not exists(select 1 from public.receivables recv join public.client_invoices inv on inv.tenant_id=recv.tenant_id and inv.id=recv.client_invoice_id
     where recv.tenant_id=new.tenant_id and recv.id=new.receivable_id and inv.id=new.client_invoice_id and inv.receivable_id=recv.id
      and recv.status<>'cancelled' and inv.status<>'cancelled' and recv.amount=new.total_amount and inv.total_amount=new.total_amount
      and recv.received_amount=new.received_amount and new.open_amount=(case when new.status='cancelled' then 0 else greatest(0,new.total_amount-new.received_amount) end)) then
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

-- Retain the private assembler but repair references to columns that never
-- existed on CT-e/NFS-e in the baseline. Do not invent soft-delete fields.
CREATE OR REPLACE FUNCTION public.create_client_invoice(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_tenant uuid;
  v_client uuid;
  v_issue date;
  v_due date;
  v_install integer;
  v_discount numeric(14,2);
  v_interest numeric(14,2);
  v_notes text;
  v_number text;
  v_seq integer;
  v_invoice_id uuid;
  v_charge jsonb;
  v_charge_id uuid;
  v_charge_source_type text;
  v_charge_source_id uuid;
  v_charge_gross numeric(14,2);
  v_detail jsonb;
  v_detail_source_type text;
  v_detail_source_id uuid;
  v_gross numeric(14,2) := 0;
  v_total numeric(14,2);
  v_charges_count integer;
  v_receivable_id uuid;
  v_client_name text;
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' THEN
    RAISE EXCEPTION 'payload must be a JSON object';
  END IF;

  v_tenant := NULLIF(payload->>'tenant_id', '')::uuid;
  v_client := NULLIF(payload->>'client_id', '')::uuid;
  v_issue := COALESCE(NULLIF(payload->>'issue_date', '')::date, CURRENT_DATE);
  v_due := NULLIF(payload->>'due_date', '')::date;
  v_install := COALESCE(NULLIF(payload->>'installment_number', '')::integer, 1);
  v_discount := COALESCE(NULLIF(payload->>'discount_amount', '')::numeric, 0);
  v_interest := COALESCE(NULLIF(payload->>'interest_amount', '')::numeric, 0);
  v_notes := NULLIF(btrim(payload->>'notes'), '');

  IF v_tenant IS NULL OR v_client IS NULL THEN
    RAISE EXCEPTION 'tenant_id and client_id required';
  END IF;
  IF NOT public.is_tenant_member(v_tenant) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF v_install < 1 OR v_install > 999 THEN
    RAISE EXCEPTION 'installment_number must be between 1 and 999';
  END IF;
  IF v_discount < 0 OR v_interest < 0 THEN
    RAISE EXCEPTION 'discount_amount and interest_amount cannot be negative';
  END IF;
  IF payload ? 'payer_snapshot'
     AND jsonb_typeof(payload->'payer_snapshot') NOT IN ('object', 'null') THEN
    RAISE EXCEPTION 'payer_snapshot must be a JSON object';
  END IF;
  IF payload ? 'company_snapshot'
     AND jsonb_typeof(payload->'company_snapshot') NOT IN ('object', 'null') THEN
    RAISE EXCEPTION 'company_snapshot must be a JSON object';
  END IF;

  SELECT c.company_name
    INTO v_client_name
    FROM public.clients AS c
   WHERE c.tenant_id = v_tenant
     AND c.id = v_client;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'client does not belong to tenant';
  END IF;

  IF jsonb_typeof(payload->'charges') <> 'array' THEN
    RAISE EXCEPTION 'charges must be a JSON array';
  END IF;
  v_charges_count := jsonb_array_length(payload->'charges');
  IF v_charges_count < 1 OR v_charges_count > 500 THEN
    RAISE EXCEPTION 'invoice requires between 1 and 500 charges';
  END IF;

  FOR v_charge IN SELECT value FROM jsonb_array_elements(payload->'charges') LOOP
    IF jsonb_typeof(v_charge) <> 'object' THEN
      RAISE EXCEPTION 'each charge must be a JSON object';
    END IF;

    v_charge_source_type := v_charge->>'source_type';
    v_charge_source_id := NULLIF(v_charge->>'source_id', '')::uuid;
    v_charge_gross := COALESCE(NULLIF(v_charge->>'gross_amount', '')::numeric, 0);

    IF v_charge_gross < 0 THEN
      RAISE EXCEPTION 'charge gross_amount cannot be negative';
    END IF;
    IF COALESCE(NULLIF(v_charge->>'discount_amount', '')::numeric, 0) < 0
       OR COALESCE(NULLIF(v_charge->>'interest_amount', '')::numeric, 0) < 0
       OR COALESCE(NULLIF(v_charge->>'ir_amount', '')::numeric, 0) < 0
       OR COALESCE(NULLIF(v_charge->>'net_amount', '')::numeric, 0) < 0 THEN
      RAISE EXCEPTION 'charge monetary amounts cannot be negative';
    END IF;

    CASE v_charge_source_type
      WHEN 'cte_document' THEN
        IF v_charge_source_id IS NULL OR NOT EXISTS (
          SELECT 1
            FROM public.cte_documents AS cte
           WHERE cte.tenant_id = v_tenant
             AND cte.id = v_charge_source_id
             AND cte.client_id = v_client
             AND cte.cancelled_at IS NULL
             AND cte.is_voided = false
             AND cte.status <> 'cancelled'
        ) THEN
          RAISE EXCEPTION 'CT-e is not eligible for this tenant and client';
        END IF;
      WHEN 'nfse_document' THEN
        IF v_charge_source_id IS NULL OR NOT EXISTS (
          SELECT 1
            FROM public.nfse_documents AS nfse
           WHERE nfse.tenant_id = v_tenant
             AND nfse.id = v_charge_source_id
             AND nfse.cliente_id = v_client
             AND nfse.cancelled = false
             AND nfse.is_preview = false
             AND nfse.status <> 'cancelled'
        ) THEN
          RAISE EXCEPTION 'NFS-e is not eligible for this tenant and client';
        END IF;
      WHEN 'manual_service' THEN
        IF v_charge_source_id IS NOT NULL THEN
          RAISE EXCEPTION 'manual service cannot reference a source document';
        END IF;
      ELSE
        RAISE EXCEPTION 'unsupported charge source_type';
    END CASE;

    IF v_charge ? 'details'
       AND jsonb_typeof(v_charge->'details') NOT IN ('array', 'null') THEN
      RAISE EXCEPTION 'charge details must be a JSON array';
    END IF;

    FOR v_detail IN
      SELECT value
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(v_charge->'details') = 'array'
               THEN v_charge->'details' ELSE '[]'::jsonb END
        )
    LOOP
      IF jsonb_typeof(v_detail) <> 'object' THEN
        RAISE EXCEPTION 'each charge detail must be a JSON object';
      END IF;

      v_detail_source_type := v_detail->>'source_type';
      v_detail_source_id := NULLIF(v_detail->>'source_id', '')::uuid;

      IF v_detail_source_type = 'fiscal_document' THEN
        IF v_charge_source_type <> 'cte_document'
           OR v_detail_source_id IS NULL
           OR NOT EXISTS (
             SELECT 1
               FROM public.fiscal_documents AS fd
               JOIN public.cte_documents AS cte
                 ON cte.tenant_id = fd.tenant_id
                AND cte.id = v_charge_source_id
              WHERE fd.tenant_id = v_tenant
                AND fd.id = v_detail_source_id
                AND fd.deleted_at IS NULL
                AND v_detail_source_id = ANY(COALESCE(cte.fiscal_document_ids, ARRAY[]::uuid[]))
           ) THEN
          RAISE EXCEPTION 'fiscal document detail is not linked to the CT-e tenant';
        END IF;
      ELSIF v_detail_source_type = 'nfse_item' THEN
        IF v_charge_source_type <> 'nfse_document' OR v_detail_source_id IS NOT NULL THEN
          RAISE EXCEPTION 'NFS-e item detail is invalid';
        END IF;
      ELSE
        RAISE EXCEPTION 'unsupported detail source_type';
      END IF;
    END LOOP;

    v_gross := v_gross + v_charge_gross;
  END LOOP;

  v_total := v_gross - v_discount + v_interest;
  IF v_total < 0 THEN
    RAISE EXCEPTION 'total_amount cannot be negative';
  END IF;

  v_number := public.next_client_invoice_number(v_tenant, v_issue, v_install);
  v_seq := split_part(v_number, '/', 1)::integer;

  INSERT INTO public.client_invoices(
    tenant_id, client_id, invoice_number, sequence_number, installment_number,
    issue_date, due_date, gross_amount, discount_amount, interest_amount, total_amount,
    status, notes, payer_snapshot, company_snapshot, created_by, updated_by
  ) VALUES (
    v_tenant, v_client, v_number, v_seq, v_install,
    v_issue, v_due, v_gross, v_discount, v_interest, v_total,
    'generated', v_notes,
    CASE WHEN jsonb_typeof(payload->'payer_snapshot') = 'object'
         THEN payload->'payer_snapshot' ELSE '{}'::jsonb END,
    CASE WHEN jsonb_typeof(payload->'company_snapshot') = 'object'
         THEN payload->'company_snapshot' ELSE '{}'::jsonb END,
    auth.uid(), auth.uid()
  ) RETURNING id INTO v_invoice_id;

  FOR v_charge IN SELECT value FROM jsonb_array_elements(payload->'charges') LOOP
    INSERT INTO public.client_invoice_charges(
      tenant_id, invoice_id, source_type, source_id, source_number, source_series,
      reference_number, issue_date, description, gross_amount, discount_amount,
      interest_amount, ir_amount, net_amount, sort_order, metadata
    ) VALUES (
      v_tenant, v_invoice_id, v_charge->>'source_type',
      NULLIF(v_charge->>'source_id', '')::uuid,
      v_charge->>'source_number', v_charge->>'source_series',
      v_charge->>'reference_number',
      NULLIF(v_charge->>'issue_date', '')::date,
      v_charge->>'description',
      COALESCE(NULLIF(v_charge->>'gross_amount', '')::numeric, 0),
      COALESCE(NULLIF(v_charge->>'discount_amount', '')::numeric, 0),
      COALESCE(NULLIF(v_charge->>'interest_amount', '')::numeric, 0),
      COALESCE(NULLIF(v_charge->>'ir_amount', '')::numeric, 0),
      COALESCE(NULLIF(v_charge->>'net_amount', '')::numeric, 0),
      COALESCE(NULLIF(v_charge->>'sort_order', '')::integer, 0),
      CASE WHEN jsonb_typeof(v_charge->'metadata') = 'object'
           THEN v_charge->'metadata' ELSE '{}'::jsonb END
    ) RETURNING id INTO v_charge_id;

    FOR v_detail IN
      SELECT value
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(v_charge->'details') = 'array'
               THEN v_charge->'details' ELSE '[]'::jsonb END
        )
    LOOP
      INSERT INTO public.client_invoice_details(
        tenant_id, invoice_id, charge_id, source_type, source_id,
        emission_date, document_label, document_number, ort_number,
        destination, remitter, recipient, weight_kg, cargo_value,
        displayed_freight_value, notes, metadata, sort_order
      ) VALUES (
        v_tenant, v_invoice_id, v_charge_id,
        v_detail->>'source_type',
        NULLIF(v_detail->>'source_id', '')::uuid,
        NULLIF(v_detail->>'emission_date', '')::date,
        v_detail->>'document_label', v_detail->>'document_number',
        v_detail->>'ort_number', v_detail->>'destination',
        v_detail->>'remitter', v_detail->>'recipient',
        NULLIF(v_detail->>'weight_kg', '')::numeric,
        NULLIF(v_detail->>'cargo_value', '')::numeric,
        NULLIF(v_detail->>'displayed_freight_value', '')::numeric,
        v_detail->>'notes',
        CASE WHEN jsonb_typeof(v_detail->'metadata') = 'object'
             THEN v_detail->'metadata' ELSE '{}'::jsonb END,
        COALESCE(NULLIF(v_detail->>'sort_order', '')::integer, 0)
      );
    END LOOP;
  END LOOP;

  INSERT INTO public.receivables(
    tenant_id, client_id, description, amount, due_date,
    invoice_number, status, notes, client_invoice_id, created_by
  ) VALUES (
    v_tenant, v_client,
    'Fatura ' || v_number || ' - ' || COALESCE(v_client_name, 'Cliente'),
    v_total, v_due, v_number, 'invoiced',
    v_notes, v_invoice_id, auth.uid()
  ) RETURNING id INTO v_receivable_id;

  UPDATE public.client_invoices
     SET receivable_id = v_receivable_id
   WHERE tenant_id = v_tenant
     AND id = v_invoice_id;

  RETURN v_invoice_id;
END;
$function$;

revoke all on function public.create_client_invoice(jsonb) from public,anon,authenticated,service_role;
