create table public.finance_customer_credits (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 payer_id uuid not null references public.clients(id),origin_id uuid not null references public.finance_fiscal_receivable_origins(id),
 receivable_id uuid not null references public.receivables(id),payment_id uuid not null references public.receivables_payments(id),
 bank_transaction_id uuid not null references public.bank_transactions(id),
 observation_id uuid not null references public.finance_fiscal_observations(id),
 amount_cents bigint not null check(amount_cents>0 and amount_cents<=99999999999999),
 evidence_level text not null default 'registered_receipt' check(evidence_level='registered_receipt'),
 receipt_snapshot jsonb not null,created_by uuid,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,payment_id)
);
alter table public.finance_customer_credits enable row level security;
revoke all on public.finance_customer_credits from public,anon,authenticated,service_role;
grant select on public.finance_customer_credits to authenticated,service_role;
create policy finance_customer_credits_read on public.finance_customer_credits for select to authenticated using(finance_private.can_access(tenant_id));
create trigger preserve_finance_customer_credit before update or delete on public.finance_customer_credits for each row execute function finance_private.preserve_event();
create index finance_customer_credits_payer on public.finance_customer_credits(tenant_id,payer_id,created_at,id);

-- Remove only the allocation to the cancelled receivable from its balance.
-- Original payments and bank entries remain unchanged and visible in history.
do $credit_balances$
declare signature text;body text;original text;replacement text;
begin
 original:='and not exists(select 1 from public.receivable_payment_reversals rv where rv.tenant_id=p.tenant_id and rv.payment_id=p.id)';
 replacement:=original||' and not exists(select 1 from public.finance_customer_credits credit where credit.tenant_id=p.tenant_id and credit.payment_id=p.id)';
 foreach signature in array array['public._recalc_receivable_received()','public._guard_receivable_ledger()'] loop
  select pg_get_functiondef(signature::regprocedure) into body;
  if position(original in body)=0 then raise exception 'finance_credit_balance_contract_changed: %',signature;end if;
  execute replace(body,original,replacement);
 end loop;
 -- Exact current invoice-lifecycle source: aggregate belongs to shared evidence.
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public._receivable_ledger_evidence(uuid,uuid)')
  and md5(replace(prosrc,E'\r\n',E'\n'))='516278d4049bbadeed1f2b94e4f020b9' and not prosecdef
  and not has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute')
  and not has_function_privilege('service_role',oid,'execute')) then raise exception 'finance_credit_ledger_contract_changed';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public._receivable_financial_snapshot(uuid,uuid)')
  and md5(replace(prosrc,E'\r\n',E'\n'))='7e78a142d1eabad9c5e503c198f38fa5' and not prosecdef
  and not has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute')
  and not has_function_privilege('service_role',oid,'execute')) then raise exception 'finance_credit_snapshot_contract_changed';end if;
 select pg_get_functiondef('public._receivable_ledger_evidence(uuid,uuid)'::regprocedure) into body;
 original:='coalesce(sum(p.amount) filter(where rv.id is null),0)';
 if (length(body)-length(replace(body,original,'')))/length(original)<>1 then raise exception 'finance_credit_shared_sum_contract_changed';end if;
 execute replace(body,original,'coalesce(sum(p.amount) filter(where rv.id is null and not exists(select 1 from public.finance_customer_credits credit where credit.tenant_id=p.tenant_id and credit.payment_id=p.id)),0)');
 select pg_get_functiondef('public._receivable_financial_snapshot(uuid,uuid)'::regprocedure) into body;
 original:='''reversed_at'',rv.created_at,''reversal_reason'',rv.reason';
 if (length(body)-length(replace(body,original,'')))/length(original)<>1 then raise exception 'finance_credit_history_contract_changed';end if;
 execute replace(body,original,original||',''credit_id'',(select credit.id from public.finance_customer_credits credit where credit.tenant_id=p.tenant_id and credit.payment_id=p.id)');
 -- Cancelled open amount is already handled by the exact192908 snapshot above.
end;
$credit_balances$;

create function finance_private.release_cancelled_receipts(_tenant uuid,_origin uuid,_observation uuid) returns text
language plpgsql security definer set search_path='' as $$
declare origin public.finance_fiscal_receivable_origins%rowtype;r public.receivables%rowtype;paid numeric;valid boolean;
begin
 select * into origin from public.finance_fiscal_receivable_origins where id=_origin and tenant_id=_tenant for update;
 if not found then return 'fiscal_origin_missing';end if;
 if not exists(select 1 from public.hub_fiscal_emissions e where e.id=origin.emission_id and e.tenant_id=_tenant and e.status='cancelled'
   and e.environment='production' and to_jsonb(e)->>'dispatch_state'='recorded') then return 'fiscal_cancellation_not_confirmed';end if;
 select * into r from public.receivables where id=origin.receivable_id and tenant_id=_tenant for update;
 if not found or r.client_id is distinct from (origin.basis->>'payer_id')::uuid then return 'credit_payer_mismatch';end if;
 if r.client_invoice_id is not null or r.closing_report_id is not null
  or exists(select 1 from public.client_invoices where tenant_id=_tenant and receivable_id=r.id)
  or exists(select 1 from public.closing_reports where tenant_id=_tenant and receivable_id=r.id) then return 'cancelled_document_in_billing_group';end if;
 select coalesce(sum(p.amount),0),coalesce(bool_and(p.amount>0 and p.amount=trunc(p.amount,2) and p.amount<=999999999999.99
  and b.id is not null and b.amount=p.amount and b.transaction_type='credit' and b.bank_account_id=p.bank_account_id
  and exists(select 1 from public.bank_accounts a where a.tenant_id=_tenant and a.id=p.bank_account_id)
  and not exists(select 1 from public.receivables_payments other where other.bank_transaction_id=p.bank_transaction_id and other.id<>p.id)),false)
 into paid,valid from public.receivables_payments p left join public.bank_transactions b on b.id=p.bank_transaction_id and b.tenant_id=_tenant
 where p.tenant_id=_tenant and p.receivable_id=r.id
  and not exists(select 1 from public.receivable_payment_reversals rv where rv.tenant_id=_tenant and rv.payment_id=p.id)
  and not exists(select 1 from public.finance_customer_credits credit where credit.tenant_id=_tenant and credit.payment_id=p.id);
 if not valid or paid<=0 or paid>r.amount or paid is distinct from r.received_amount then return 'financial_receipt_evidence_mismatch';end if;
 insert into public.finance_customer_credits(tenant_id,payer_id,origin_id,receivable_id,payment_id,bank_transaction_id,observation_id,amount_cents,receipt_snapshot,created_by)
 select _tenant,r.client_id,origin.id,r.id,p.id,p.bank_transaction_id,_observation,(p.amount*100)::bigint,to_jsonb(p),auth.uid()
 from public.receivables_payments p where p.tenant_id=_tenant and p.receivable_id=r.id
  and not exists(select 1 from public.receivable_payment_reversals rv where rv.tenant_id=_tenant and rv.payment_id=p.id)
  and not exists(select 1 from public.finance_customer_credits credit where credit.tenant_id=_tenant and credit.payment_id=p.id);
 update public.receivables set status='cancelled',received_amount=0,received_at=null,updated_at=clock_timestamp() where id=r.id and tenant_id=_tenant;
 return null;
end;
$$;
revoke all on function finance_private.release_cancelled_receipts(uuid,uuid,uuid) from public,anon,authenticated,service_role;

do $processor_credits$
declare body text;original text;
begin
 select pg_get_functiondef('finance_private.process_fiscal_observation(uuid,uuid)'::regprocedure) into body;
 original:='and not exists(select 1 from public.receivable_payment_reversals rv where rv.tenant_id=_tenant and rv.payment_id=p.id);';
 if position(original in body)=0 then raise exception 'finance_credit_processor_balance_contract_changed';end if;
 body:=replace(body,original,'and not exists(select 1 from public.receivable_payment_reversals rv where rv.tenant_id=_tenant and rv.payment_id=p.id)
     and not exists(select 1 from public.finance_customer_credits credit where credit.tenant_id=_tenant and credit.payment_id=p.id);');
 original:=$old$job_state:='review';issue:='cancelled_document_has_receipts';
     update public.finance_fiscal_receivable_origins set state='credit_pending',observation_id=_observation,updated_at=clock_timestamp() where id=origin.id;$old$;
 if position(original in body)=0 then raise exception 'finance_credit_processor_contract_changed';end if;
 body:=replace(body,original,$new$issue:=finance_private.release_cancelled_receipts(_tenant,origin.id,_observation);
     if issue is null then
      update public.finance_fiscal_receivable_origins set state='cancelled',observation_id=_observation,updated_at=clock_timestamp() where id=origin.id;
     else
      job_state:='review';
      update public.finance_fiscal_receivable_origins set state=case when issue='cancelled_document_in_billing_group' then 'review' else 'credit_pending' end,
       observation_id=_observation,updated_at=clock_timestamp() where id=origin.id;
     end if;$new$);
 original:='elsif r.client_invoice_id is not null or r.closing_report_id is not null then';
 if position(original in body)=0 then raise exception 'finance_credit_processor_group_contract_changed';end if;
 body:=replace(body,original,'elsif r.client_invoice_id is not null or r.closing_report_id is not null
  or exists(select 1 from public.client_invoices where tenant_id=_tenant and receivable_id=r.id)
  or exists(select 1 from public.closing_reports where tenant_id=_tenant and receivable_id=r.id) then');
 execute body;
end;
$processor_credits$;
