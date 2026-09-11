-- Portfolio-only scalar aggregation. No snapshot, writer, page or financial data changes.
set lock_timeout='3s';
set statement_timeout='30s';
do $pins$declare spec record;p record;begin
 for spec in select * from(values
('finance_private.cash_receivable_ledger_evidence(uuid, uuid)','351d7b05301ec509747944c68ea6c49e',false,false),
('finance_private.customer_credit_position(uuid, uuid)','0e2098c0c0f79c666f31dbd9093538db',true,false),
('finance_private.receivable_credit_evidence(uuid, uuid)','d62bb1656e6be89b7753f44c6e5501dc',false,false),
('finance_private.receivable_fiscal_issue(uuid, uuid)','88983b1f6cbb9765237667c87084283b',false,false),
('finance_private.receivable_portfolio_summary(uuid, date, date, uuid)','57b41ad9b959e236163ecb2e2cc590ac',true,true),
('public._receivable_ledger_evidence(uuid,uuid)','51dc0bea52d353a7b6407fb6faa50cf0',false,false),
('public._receivable_financial_snapshot(uuid, uuid)','473e509e0283627f5520dddfb36a083d',false,false)
 )v(signature,hash,is_definer,auth_execute) loop
 select * into p from pg_proc where oid=to_regprocedure(spec.signature);
 if p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n')) is distinct from spec.hash
  or p.prosecdef is distinct from spec.is_definer or p.provolatile<>'s' or p.proconfig is distinct from array['search_path=""']::text[]
  or has_function_privilege('authenticated',p.oid,'execute') is distinct from spec.auth_execute
  or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a where a.grantee<>p.proowner
   and(not spec.auth_execute or a.grantee<>(select oid from pg_roles where rolname='authenticated') or a.privilege_type<>'EXECUTE' or a.is_grantable))
 then raise exception 'finance_portfolio_bulk_predecessor_changed:%',spec.signature using errcode='55000';end if;
 end loop;
end$pins$;
create or replace function finance_private.receivable_portfolio_summary(_tenant uuid,_from date,_to date,_client uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $body$
declare result jsonb;today date:=(statement_timestamp() at time zone 'America/Sao_Paulo')::date;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if (_from is not null and not isfinite(_from)) or (_to is not null and not isfinite(_to)) or _from>_to then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 if _client is not null and not exists(select 1 from public.clients where tenant_id=_tenant and id=_client) then raise exception 'finance_client_not_found' using errcode='22023';end if;
 with selected as materialized(
  select r.* from public.receivables r where r.tenant_id=_tenant and (_client is null or r.client_id=_client)
   and (r.created_at is null or not isfinite(r.created_at) or
    ((_from is null or r.created_at>=(_from::timestamp at time zone 'America/Sao_Paulo'))
     and (_to is null or r.created_at<((_to+1)::timestamp at time zone 'America/Sao_Paulo'))))
 ), active as materialized(
  select s.*,coalesce(
   s.status in('pending','invoiced','partial','received') and s.created_at is not null and isfinite(s.created_at)
   and s.amount::text not in('NaN','Infinity','-Infinity') and coalesce(s.received_amount,0)::text not in('NaN','Infinity','-Infinity')
   and (s.due_date is null or isfinite(s.due_date))
   and s.amount>=0 and s.amount*100=trunc(s.amount*100) and s.amount*100<=99999999999999
   and coalesce(s.received_amount,0)>=0 and coalesce(s.received_amount,0)<=s.amount and coalesce(s.received_amount,0)*100=trunc(coalesce(s.received_amount,0)*100)
   and (s.status<>'received' or s.amount=coalesce(s.received_amount,0)),false) numeric_valid
  from selected s where s.status is distinct from 'cancelled'
 ), invoice_links as materialized(
  select a.id target_id,i.id,i.receivable_id,i.total_amount,i.client_id,i.status,i.sent_at,
   count(*) over(partition by a.id) link_count,row_number() over(partition by a.id order by i.id) ordinal
  from active a join public.client_invoices i on i.tenant_id=_tenant and(i.id=a.client_invoice_id or i.receivable_id=a.id)
 ), first_invoice as materialized(select * from invoice_links where ordinal=1),
 closing_links as materialized(
  select a.id target_id,c.id,c.receivable_id,c.client_invoice_id,c.total_amount,c.received_amount,c.open_amount,c.status,c.payment_status,c.expected_payment_date,
   count(*) over(partition by a.id) link_count,row_number() over(partition by a.id order by c.id) ordinal
  from active a left join first_invoice inv on inv.target_id=a.id
  join public.closing_reports c on c.tenant_id=_tenant and(c.receivable_id=a.id or(inv.id is not null and c.client_invoice_id=inv.id))
 ), cash as materialized(
  select p.receivable_id,
   coalesce(sum(p.amount) filter(where rv.id is null
    and not exists(select 1 from public.finance_receipt_allocation_corrections correction where correction.tenant_id=p.tenant_id and correction.payment_id=p.id)
    and not exists(select 1 from public.finance_customer_credits credit where credit.tenant_id=p.tenant_id and credit.payment_id=p.id)),0) net,
   coalesce(bool_and(p.amount>0 and p.amount=round(p.amount,2)
    and b.id is not null and b.amount=p.amount and b.transaction_type='credit' and b.bank_account_id=p.bank_account_id
    and exists(select 1 from public.bank_accounts account where account.tenant_id=p.tenant_id and account.id=p.bank_account_id)
    and not exists(select 1 from public.receivables_payments other where other.bank_transaction_id=p.bank_transaction_id and other.id<>p.id)
    and(rv.id is null or(rv.receivable_id=p.receivable_id and rv.amount=p.amount and rb.id is not null and rb.amount=p.amount and rb.transaction_type='debit' and rb.bank_account_id=p.bank_account_id))),true) valid
  from public.receivables_payments p join active a on a.id=p.receivable_id and a.numeric_valid
  left join public.receivable_payment_reversals rv on rv.tenant_id=p.tenant_id and rv.payment_id=p.id
  left join public.bank_transactions b on b.tenant_id=p.tenant_id and b.id=p.bank_transaction_id
  left join public.bank_transactions rb on rb.tenant_id=rv.tenant_id and rb.id=rv.bank_transaction_id
  where p.tenant_id=_tenant group by p.receivable_id
 ), credit_events as materialized(
  select e.receivable_id,e.credit_id,e.action,e.amount_cents from finance_private.customer_credit_application_events e
  join active a on a.id=e.receivable_id and a.numeric_valid where e.tenant_id=_tenant
 ), credit_positions as materialized(
  -- One complete source proof per distinct credit, including refunded capacity and audit links.
  select refs.credit_id,finance_private.customer_credit_position(_tenant,refs.credit_id) position
  from(select distinct credit_id from credit_events)refs
 ), credits as materialized(
  select e.receivable_id,sum(case when e.action='apply' then e.amount_cents else -e.amount_cents end) applied,
   bool_and(coalesce(p.position->'valid'='true'::jsonb,false)) valid
  from credit_events e join credit_positions p on p.credit_id=e.credit_id group by e.receivable_id
 ), graph as materialized(
  select a.*,coalesce(cash.net,0) cash_net,coalesce(credits.applied,0) credit_cents,
   coalesce(cash.net,0)+coalesce(credits.applied,0)/100 net,
   coalesce(cash.valid,true) and coalesce(credits.valid,true) and coalesce(credits.applied,0)>=0 ledger_valid,
   inv.id inv_id,inv.status inv_status,inv.sent_at inv_sent_at,
   c.id close_id,c.status close_status,c.received_amount close_received,c.open_amount close_open,
   c.payment_status close_payment_status,c.expected_payment_date close_expected,
   not coalesce(coalesce(inv.link_count,0)>1 or coalesce(c.link_count,0)>1 or a.amount<=0 or a.amount<>round(a.amount,2) or a.amount>999999999999.99
    or(a.client_invoice_id is not null and(inv.id is distinct from a.client_invoice_id or inv.receivable_id is distinct from a.id))
    or(inv.id is not null and(a.client_invoice_id is distinct from inv.id or inv.total_amount is distinct from a.amount or inv.client_id is distinct from a.client_id))
    or(c.id is not null and(c.receivable_id is distinct from a.id or c.client_invoice_id is distinct from inv.id or c.total_amount is distinct from a.amount))
    or(a.closing_report_id is not null and a.closing_report_id is distinct from c.id),false) graph_valid,
   case when a.numeric_valid and(a.cte_document_id is not null or exists(select 1 from public.finance_fiscal_receivable_origins o where o.tenant_id=_tenant and o.receivable_id=a.id))
    then finance_private.receivable_fiscal_issue(_tenant,a.id) end fiscal_issue
  from active a left join first_invoice inv on inv.target_id=a.id
  left join closing_links c on c.target_id=a.id and c.ordinal=1
  left join cash on cash.receivable_id=a.id left join credits on credits.receivable_id=a.id
 ), checked as materialized(
  select g.*,coalesce(numeric_valid and graph_valid and ledger_valid and net>=0 and net<=amount and fiscal_issue is null
   and coalesce(received_amount,0)=net
   and status is not distinct from(case when status='cancelled' and net=0 then 'cancelled' when net>=amount then 'received' when net>0 then 'partial' when inv_id is not null then 'invoiced' else 'pending' end)
   and(inv_id is null or inv_status is not distinct from(case when inv_status='cancelled' and net=0 then 'cancelled' when net>=amount then 'paid' when inv_sent_at is not null then 'sent' else 'generated' end))
   and(close_id is null or(close_received=net and close_open=(case when status='cancelled' then 0 else greatest(0,amount-net) end)
    and close_status is not distinct from(case when close_status='cancelled' and status='cancelled' and inv_status='cancelled' and net=0 then 'cancelled' when close_status='overdue' and close_expected<current_date and net<amount then 'overdue' when net>=amount then 'paid' when net>0 then 'partially_paid' else 'invoiced' end)
    and close_payment_status is not distinct from(case when close_status='overdue' then 'overdue' when net>=amount then 'paid' when net>0 then 'partially_paid' else 'unpaid' end)))
   and not coalesce((inv_status='cancelled' or status='cancelled') and(net>0 or status<>'cancelled' or(inv_id is not null and inv_status<>'cancelled') or(close_id is not null and close_status<>'cancelled')),false),false) valid
  from graph g
 ), amounts as materialized(
  select a.*,case when valid then trunc(amount*100) end nominal,
   case when valid then trunc(coalesce(received_amount,0)*100) end allocated,
   case when valid then cash_net*100 end cash_received,case when valid then credit_cents end credit_applied,
   case when valid then trunc((amount-coalesce(received_amount,0))*100) end remaining from checked a
 ), summary as(
  select count(*) total,count(*) filter(where not valid) invalid,coalesce(sum(nominal),0) nominal,
   coalesce(sum(allocated),0) allocated,coalesce(sum(cash_received),0) cash_received,coalesce(sum(credit_applied),0) credit_applied,
   coalesce(sum(remaining),0) remaining,coalesce(sum(remaining) filter(where due_date<today),0) overdue from amounts
 ), statuses as(
  select coalesce(status,'unknown') status,count(*) count,sum(nominal) nominal,sum(allocated) allocated,
   sum(cash_received) cash_received,sum(credit_applied) credit_applied,sum(remaining) remaining from amounts group by status
 )
 select jsonb_build_object('version',1,'tenant_id',_tenant,'from',_from,'to',_to,'client_id',_client,'as_of',today,
  'total_titles',s.total,'canceled_titles',(select count(*) from selected where status='cancelled'),'invalid_titles',s.invalid,'totals_valid',s.invalid=0,
  'nominal_cents',case when s.invalid=0 then s.nominal::text end,
  'received_allocated_cents',case when s.invalid=0 then s.allocated::text end,
  'cash_received_cents',case when s.invalid=0 then trunc(s.cash_received)::text end,
  'credit_applied_cents',case when s.invalid=0 then s.credit_applied::text end,
  'settled_cents',case when s.invalid=0 then s.allocated::text end,
  'open_cents',case when s.invalid=0 then s.remaining::text end,'overdue_cents',case when s.invalid=0 then s.overdue::text end,
  'status_rows',coalesce((select jsonb_agg(jsonb_build_object('status',g.status,'count',g.count,
   'nominal_cents',case when s.invalid=0 then g.nominal::text end,
   'received_allocated_cents',case when s.invalid=0 then g.allocated::text end,
   'cash_received_cents',case when s.invalid=0 then trunc(g.cash_received)::text end,
   'credit_applied_cents',case when s.invalid=0 then g.credit_applied::text end,
   'settled_cents',case when s.invalid=0 then g.allocated::text end,
   'open_cents',case when s.invalid=0 then g.remaining::text end) order by g.status) from statuses g),'[]'))
 into result from summary s;return result;
end$body$;
