-- Read-only diagnostics. No inferred money, adoption, or closing approval.
create function finance_private.legacy_adoption_candidates(_tenant uuid,_account uuid,_from date,_to date)
returns table(source_table text,source_id uuid,occurred_on date,amount_cents text,direction text,account_id uuid,bank_transaction_id uuid,reason text,context jsonb)
language sql stable set search_path='' as $$
with params as (
 select _tenant tenant_id, _account account_id, _from starts, _to ends
), references_to_bank as (
 select tenant_id, bank_transaction_id id from public.receivables_payments
 union select tenant_id, bank_transaction_id from public.receivable_payment_reversals
 union select tenant_id, bank_transaction_id from public.payables_payments
 union select tenant_id, bank_transaction_id from public.load_payments
), candidates as (
 select p.tenant_id, 'receivables_payments'::text source_table, p.id source_id,
  p.bank_account_id, (p.received_at at time zone 'America/Sao_Paulo')::date as source_day,
  'in'::text direction, p.amount * 100 cents, p.bank_transaction_id,
  'receipt_without_canonical_link'::text issue
 from public.receivables_payments p
 where not exists(select 1 from public.finance_receivable_movement_links l
  where l.tenant_id=p.tenant_id and l.payment_id=p.id and l.action='receive')
 union all
 select r.tenant_id,'receivable_payment_reversals',r.id,p.bank_account_id,
  (r.effective_at at time zone 'America/Sao_Paulo')::date,'out',r.amount*100,
  r.bank_transaction_id,'refund_without_canonical_link'
 from public.receivable_payment_reversals r
 left join public.receivables_payments p on p.tenant_id=r.tenant_id and p.id=r.payment_id
 where not exists(select 1 from public.finance_receivable_movement_links l
  where l.tenant_id=r.tenant_id and l.command_id=r.financial_command_id
   and l.action='reverse' and l.payment_id=r.payment_id
   and l.bank_transaction_id=r.bank_transaction_id)
 union all
 select p.tenant_id,'payables_payments',p.id,p.bank_account_id,
  (p.paid_at at time zone 'America/Sao_Paulo')::date,'out',p.amount*100,
  p.bank_transaction_id,'payable_payment_without_mapping'
 from public.payables_payments p
 -- Any historical canonical link excludes this payment: a reversed payable
 -- allocation is inactive, not an old unadopted cash payment.
 where not exists(select 1 from public.finance_payable_movement_links l
  where l.tenant_id=p.tenant_id and l.payment_id=p.id)
 union all
 select p.tenant_id,'driver_settlement_payments',p.id,null::uuid,
  (p.paid_at at time zone 'America/Sao_Paulo')::date,'out',p.amount*100,
  null::uuid,'settlement_without_active_link_account_unresolved'
 from public.driver_settlement_payments p
 where not exists(select 1 from public.finance_settlement_movement_links l
  where l.tenant_id=p.tenant_id and l.payment_id=p.id
   and not exists(select 1 from public.finance_settlement_link_reversals r
    where r.tenant_id=l.tenant_id and r.link_id=l.id))
 union all
 select p.tenant_id,'closing_report_payments',p.id,p.bank_account_id,
  p.payment_date,'in',p.amount*100,null::uuid,'closing_payment_without_payment_id'
 from public.closing_report_payments p
 where not exists(select 1 from public.receivables_payments r
  where r.tenant_id=p.tenant_id and r.id=p.canonical_receivable_payment_id)
 union all
 select p.tenant_id,'load_payments',p.id,p.bank_account_id,p.payment_date,
  'in',p.amount*100,p.bank_transaction_id,'load_payment_without_payment_id'
 from public.load_payments p
 where not exists(select 1 from public.receivables_payments r
  where r.tenant_id=p.tenant_id and r.id=p.receivable_payment_id)
 union all
 select a.tenant_id,'employee_advances',a.id,null::uuid,
  coalesce((a.paid_at at time zone 'America/Sao_Paulo')::date,a.advance_date),
  'out',a.amount*100,null::uuid,'paid_advance_payment_evidence_incomplete'
 from public.employee_advances a
 where a.status='paid' and a.amount is distinct from (
  select coalesce(sum(pp.amount),0) from public.payables p join public.payables_payments pp
   on pp.tenant_id=p.tenant_id and pp.payable_id=p.id
  where p.tenant_id=a.tenant_id and (p.id=a.payable_id
   or (p.source_table='employee_advances' and p.source_id=a.id))
   and not exists(select 1 from public.finance_payable_movement_links l
    join public.finance_payable_link_reversals r on r.tenant_id=l.tenant_id and r.link_id=l.id
    where l.tenant_id=pp.tenant_id and l.payment_id=pp.id))
 union all
 select x.tenant_id,'payroll_entry_items',x.id,null::uuid,
  coalesce((x.occurred_at at time zone 'America/Sao_Paulo')::date,x.competence_date),
  'unknown',null::numeric,null::uuid,'already_paid_without_exact_money_source'
 from public.payroll_entry_items x
 where x.nature='already_paid'
  and not exists(select 1 from public.driver_settlement_payments p where x.source_table='driver_settlement_payments' and p.tenant_id=x.tenant_id and p.id=x.source_id)
  and not exists(select 1 from public.employee_advances a where x.source_table='employee_advances' and a.tenant_id=x.tenant_id and a.id=x.source_id)
  and not exists(select 1 from public.payables_payments p where x.source_table='payables_payments' and p.tenant_id=x.tenant_id and p.id=x.source_id)
 union all
 select b.tenant_id,'bank_transactions',b.id,b.bank_account_id,
  (b.posted_at at time zone 'America/Sao_Paulo')::date,
  case b.transaction_type when 'credit' then 'in' when 'debit' then 'out' else 'unknown' end,
  b.amount*100,b.id,'legacy_bank_row_requires_source_classification'
 from public.bank_transactions b
 where not exists(select 1 from references_to_bank r where r.tenant_id=b.tenant_id and r.id=b.id)
  and not exists(select 1 from public.finance_receivable_movement_links l
   where l.tenant_id=b.tenant_id and l.bank_transaction_id=b.id)
)
select c.source_table,c.source_id,c.source_day,
 case when c.source_table='employee_advances' or c.cents<=0 or c.cents<>trunc(c.cents) or c.cents>99999999999999 then null else trunc(c.cents)::text end,
 c.direction,c.bank_account_id,c.bank_transaction_id,c.issue,
 jsonb_build_object('amount_status',case when c.source_table='employee_advances' then 'paid_status_only' when c.cents>0 and c.cents=trunc(c.cents) and c.cents<=99999999999999 then 'exact_declared_cents' else 'invalid_or_unknown' end,
 'account_status',case when c.bank_account_id is null then 'unresolved' else 'identified' end,
 'origin_ids',case c.source_table
 when 'receivables_payments' then (select jsonb_build_object('receivable_id',s.receivable_id) from public.receivables_payments s where s.tenant_id=c.tenant_id and s.id=c.source_id)
 when 'receivable_payment_reversals' then (select jsonb_build_object('receivable_id',s.receivable_id,'payment_id',s.payment_id,'command_id',s.financial_command_id) from public.receivable_payment_reversals s where s.tenant_id=c.tenant_id and s.id=c.source_id)
 when 'payables_payments' then (select jsonb_build_object('payable_id',s.payable_id) from public.payables_payments s where s.tenant_id=c.tenant_id and s.id=c.source_id)
 when 'driver_settlement_payments' then (select jsonb_build_object('settlement_id',s.settlement_id) from public.driver_settlement_payments s where s.tenant_id=c.tenant_id and s.id=c.source_id)
 when 'closing_report_payments' then (select jsonb_build_object('closing_report_id',s.closing_report_id,'receivable_id',s.receivable_id,'canonical_receivable_payment_id',s.canonical_receivable_payment_id) from public.closing_report_payments s where s.tenant_id=c.tenant_id and s.id=c.source_id)
 when 'load_payments' then (select jsonb_build_object('load_id',s.load_id,'receivable_id',s.receivable_id,'receivable_payment_id',s.receivable_payment_id) from public.load_payments s where s.tenant_id=c.tenant_id and s.id=c.source_id)
 when 'employee_advances' then (select jsonb_build_object('employee_id',s.employee_id,'payable_id',s.payable_id,'financial_obligation_id',s.financial_obligation_id) from public.employee_advances s where s.tenant_id=c.tenant_id and s.id=c.source_id)
 when 'bank_transactions' then (select jsonb_build_object('import_id',s.import_id) from public.bank_transactions s where s.tenant_id=c.tenant_id and s.id=c.source_id)
 when 'payroll_entry_items' then (select jsonb_build_object('payroll_entry_id',s.payroll_entry_id,'source_id',s.source_id) from public.payroll_entry_items s where s.tenant_id=c.tenant_id and s.id=c.source_id)
 else '{}'::jsonb end)
from candidates c join params p on p.tenant_id=c.tenant_id
where (c.bank_account_id=p.account_id or c.bank_account_id is null) and c.source_day between p.starts and p.ends;
$$;
revoke all on function finance_private.legacy_adoption_candidates(uuid,uuid,date,date) from public,anon,authenticated,service_role;
create function finance_private.legacy_adoption_inventory(_tenant uuid,_account uuid,_from date,_to date,_page integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _from is null or _to is null or _from>_to or _to-_from>3660 or _page is null or _page not between 1 and 1000000 then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 if not exists(select 1 from public.bank_accounts where tenant_id=_tenant and id=_account) then raise exception 'finance_account_not_found' using errcode='22023';end if;
 with candidates as materialized(select * from finance_private.legacy_adoption_candidates(_tenant,_account,_from,_to)),
 identified as(select * from candidates where account_id=_account),
 unresolved as(select * from candidates where account_id is null),
 page_rows as(select * from identified order by occurred_on,source_table,source_id limit 30 offset (_page-1)*30),
 unknown_rows as(select * from unresolved order by occurred_on,source_table,source_id limit 30 offset (_page-1)*30)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'account_id',_account,'from',_from,'to',_to,'page',_page,'page_size',30,
  'total',(select count(*) from identified),
  'counts_by_source',coalesce((select jsonb_object_agg(source_table,n) from(select source_table,count(*) n from identified group by source_table) s),'{}'),
  'rows',coalesce((select jsonb_agg(to_jsonb(r) order by occurred_on,source_table,source_id) from page_rows r),'[]'),
  'unknown_account',jsonb_build_object('scope','tenant','not_additive_across_accounts',true,'page',_page,'page_size',30,'total',(select count(*) from unresolved),
   'counts_by_source',coalesce((select jsonb_object_agg(source_table,n) from(select source_table,count(*) n from unresolved group by source_table) s),'{}'),
   'rows',coalesce((select jsonb_agg(to_jsonb(r) order by occurred_on,source_table,source_id) from unknown_rows r),'[]')),
  'legacy_integration_status','not_reviewed','can_close',false) into result;
 return result;
end$$;
revoke all on function finance_private.legacy_adoption_inventory(uuid,uuid,date,date,integer) from public,anon,authenticated,service_role;
grant execute on function finance_private.legacy_adoption_inventory(uuid,uuid,date,date,integer) to authenticated;
create function public.get_finance_legacy_adoption_inventory(_tenant_id uuid,_account_id uuid,_from date,_to date,_page integer default 1)
returns jsonb language sql stable security invoker set search_path='' as $$
 select finance_private.legacy_adoption_inventory(_tenant_id,_account_id,_from,_to,_page)
$$;
revoke all on function public.get_finance_legacy_adoption_inventory(uuid,uuid,date,date,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_legacy_adoption_inventory(uuid,uuid,date,date,integer) to authenticated;
