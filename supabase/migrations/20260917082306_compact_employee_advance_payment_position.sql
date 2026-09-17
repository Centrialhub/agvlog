create index if not exists employee_advance_payable_payments
 on public.payables_payments(tenant_id,payable_id,id)
 include(amount,paid_at,bank_account_id,bank_transaction_id);

alter function finance_private.employee_advance_position(uuid,uuid) rename to employee_advance_position_full;

create function finance_private.payable_portfolio_summary_evidence(_tenant uuid,_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.payables%rowtype;issues text[]:='{}';paid numeric:=0;payment_count integer:=0;invalid_amounts integer:=0;invalid_chains integer:=0;valid boolean;active boolean;revision text;
begin
 select * into p from public.payables where tenant_id=_tenant and id=_id;
 if p.id is null then return jsonb_build_object('valid',false,'issues',jsonb_build_array('title_missing'),'payment_count',0);end if;
 if p.status is null or p.status<>all(array['pending','approved','partial','paid','overdue','cancelled']) then issues:=array_append(issues,'unknown_status');end if;
 if not coalesce(p.amount>=0 and p.amount*100=trunc(p.amount*100) and p.amount*100<=99999999999999,false) then issues:=array_append(issues,'invalid_amount');end if;
 if not coalesce(p.paid_amount>=0 and p.paid_amount*100=trunc(p.paid_amount*100) and p.paid_amount*100<=99999999999999,false) then issues:=array_append(issues,'invalid_declared_paid');end if;
 if p.created_at is null or not isfinite(p.created_at) then issues:=array_append(issues,'invalid_created_at');end if;
 if p.due_date is not null and not isfinite(p.due_date) then issues:=array_append(issues,'invalid_due_date');end if;
 with payments as materialized(select * from finance_private.active_payable_payments where tenant_id=_tenant and payable_id=p.id)
 select count(*)::integer,
  coalesce(sum(case when pp.amount>0 and pp.amount*100=trunc(pp.amount*100) and pp.amount*100<=99999999999999 then pp.amount else 0 end),0),
  count(*) filter(where not coalesce(pp.amount>0 and pp.amount*100=trunc(pp.amount*100) and pp.amount*100<=99999999999999,false))::integer,
  count(*) filter(where not coalesce(l.id is not null and l.payable_id=p.id and l.amount_cents=pp.amount*100 and m.direction='out' and m.nature<>'transfer'
   and m.bank_account_id=pp.bank_account_id and (p.driver_id is null or m.driver_id=p.driver_id) and isfinite(pp.paid_at)
   and m.occurred_on=(pp.paid_at at time zone 'America/Sao_Paulo')::date and used.cents>=pp.amount*100 and used.cents<=m.amount_cents
   and account.id is not null and (pp.bank_transaction_id is null or bank.id is not null and bank.bank_account_id=pp.bank_account_id and bank.transaction_type='debit' and abs(bank.amount)=pp.amount and isfinite(bank.posted_at) and (bank.posted_at at time zone 'America/Sao_Paulo')::date=m.occurred_on),false))::integer
 into payment_count,paid,invalid_amounts,invalid_chains
 from payments pp
 left join public.finance_payable_movement_links l on l.tenant_id=_tenant and l.payment_id=pp.id and not exists(select 1 from public.finance_payable_link_reversals r where r.tenant_id=_tenant and r.link_id=l.id)
 left join public.finance_movements m on m.tenant_id=_tenant and m.id=l.movement_id
 left join public.bank_accounts account on account.tenant_id=_tenant and account.id=m.bank_account_id
 left join public.bank_transactions bank on bank.tenant_id=_tenant and bank.id=pp.bank_transaction_id
 left join lateral(select finance_private.movement_used_cents(_tenant,m.id) cents) used on true;
 if invalid_amounts>0 then issues:=array_append(issues,'invalid_payment_amount');end if;
 if invalid_chains>0 then issues:=array_append(issues,'payment_money_chain_unresolved');end if;
 if exists(select 1 from public.finance_payable_movement_links x where x.tenant_id=_tenant and x.payable_id=p.id and not exists(select 1 from public.finance_payable_link_reversals r where r.tenant_id=_tenant and r.link_id=x.id) and not exists(select 1 from finance_private.active_payable_payments ap where ap.tenant_id=_tenant and ap.id=x.payment_id and ap.payable_id=p.id)) then issues:=array_append(issues,'orphan_payment_link');end if;
 if paid is distinct from p.paid_amount then issues:=array_append(issues,'declared_paid_mismatch');end if;
 if paid>p.amount then issues:=array_append(issues,'overpaid');end if;
 if p.status='paid' and paid is distinct from p.amount then issues:=array_append(issues,'paid_without_full_payment');end if;
 if p.status='partial' and not(paid>0 and paid<p.amount) then issues:=array_append(issues,'partial_status_mismatch');end if;
 if p.status in('pending','approved','overdue') and paid>0 then issues:=array_append(issues,'unpaid_status_with_payment');end if;
 if p.status='cancelled' and paid<>0 then issues:=array_append(issues,'cancelled_with_active_payment');end if;
 select coalesce(array_agg(distinct x order by x),'{}') into issues from unnest(issues)x;
 valid:=cardinality(issues)=0;active:=p.status is distinct from 'cancelled';
 select md5(jsonb_build_object(
  'title',to_jsonb(p),'payment_count',payment_count,'paid',paid,'invalid_amounts',invalid_amounts,'invalid_chains',invalid_chains,'issues',issues,
  'payments',(select jsonb_build_object('count',count(*),'xmin',coalesce(max(xmin::text::bigint),0)) from public.payables_payments x where x.tenant_id=_tenant and x.payable_id=p.id),
  'links',(select jsonb_build_object('count',count(*),'xmin',coalesce(max(x.xmin::text::bigint),0)) from public.finance_payable_movement_links x where x.tenant_id=_tenant and (x.payable_id=p.id or exists(select 1 from public.payables_payments pp where pp.tenant_id=_tenant and pp.payable_id=p.id and pp.id=x.payment_id))),
  'reversals',(select jsonb_build_object('count',count(*),'xmin',coalesce(max(r.xmin::text::bigint),0)) from public.finance_payable_link_reversals r where r.tenant_id=_tenant and exists(select 1 from public.finance_payable_movement_links l where l.tenant_id=_tenant and l.id=r.link_id and l.payable_id=p.id)),
  'movements',(select jsonb_build_object('count',count(*),'xmin',coalesce(max(m.xmin::text::bigint),0)) from public.finance_movements m where m.tenant_id=_tenant and exists(select 1 from public.finance_payable_movement_links l where l.tenant_id=_tenant and l.payable_id=p.id and l.movement_id=m.id)),
  'allocations',(select jsonb_build_object('count',count(*),'xmin',coalesce(max(a.xmin::text::bigint),0)) from public.finance_expense_allocations a where a.tenant_id=_tenant and exists(select 1 from public.finance_payable_movement_links l where l.tenant_id=_tenant and l.payable_id=p.id and l.movement_id=a.movement_id))
 )::text) into revision;
 return jsonb_build_object('valid',valid,'issues',to_jsonb(issues),'revision',revision,'payment_count',payment_count,
  'nominal_cents',case when valid then (case when active then trunc(p.amount*100) else 0 end)::text end,
  'paid_cents',case when valid then (case when active then trunc(paid*100) else 0 end)::text end,
  'open_cents',case when valid then (case when active then trunc((p.amount-paid)*100) else 0 end)::text end);
end$$;
revoke all on function finance_private.payable_portfolio_summary_evidence(uuid,uuid) from public,anon,authenticated,service_role;

create function finance_private.employee_advance_position(t uuid,advance uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.employee_advances%rowtype;e public.employees%rowtype;p public.payables%rowtype;proof jsonb;issues text[]:='{}';paid bigint:=0;amount bigint;payment_count integer:=0;revision text;
begin
 select * into a from public.employee_advances where tenant_id=t and id=advance;
 select * into e from public.employees where tenant_id=t and id=a.employee_id;
 if a.id is null then raise exception 'finance_advance_not_found' using errcode='22023';end if;
 if e.id is null or e.driver_id is distinct from a.driver_id then issues:=array_append(issues,'finance_advance_employee_mismatch');end if;
 if not coalesce(a.amount>0 and a.amount*100=trunc(a.amount*100) and a.amount*100<=99999999999999,false) then issues:=array_append(issues,'finance_advance_amount_invalid');else amount:=(a.amount*100)::bigint;end if;
 if a.financial_obligation_id is not null then issues:=array_append(issues,'finance_advance_obligation_requires_review');end if;
 if a.payable_id is null then
  if exists(select 1 from public.payables where tenant_id=t and source_table='employee_advances' and source_id=a.id) then issues:=array_append(issues,'finance_advance_title_unlinked');end if;
  if a.status='paid' then issues:=array_append(issues,'finance_advance_paid_without_evidence');end if;
 else
  select * into p from public.payables where tenant_id=t and id=a.payable_id;
  if p.id is null or p.source_table is distinct from 'employee_advances' or p.source_id is distinct from a.id or p.amount is distinct from a.amount or p.driver_id is distinct from a.driver_id or p.source_metadata->>'employee_id' is distinct from a.employee_id::text then issues:=array_append(issues,'finance_advance_title_chain_invalid');end if;
  proof:=finance_private.payable_portfolio_summary_evidence(t,a.payable_id);
  payment_count:=coalesce((proof->>'payment_count')::integer,0);
  if proof->>'valid' is distinct from 'true' then issues:=array_append(issues,'finance_advance_payment_evidence_invalid');else paid:=(proof->>'paid_cents')::bigint;end if;
 end if;
 if a.status='paid' and paid is distinct from amount then issues:=array_append(issues,'finance_advance_paid_without_full_payment');end if;
 if a.status='cancelled' and paid>0 then issues:=array_append(issues,'finance_advance_cancelled_with_payment');end if;
 revision:=md5(jsonb_build_object('advance',to_jsonb(a),'employee',to_jsonb(e),'title',to_jsonb(p),'payment_summary',proof)::text);
 return jsonb_build_object('version',1,'tenant_id',t,'advance_id',a.id,'employee_id',a.employee_id,'employee_name',e.name,'employee_document',e.doc_cpf,'driver_id',a.driver_id,'status',a.status,'payable_id',a.payable_id,'payable_status',p.status,'verified',cardinality(issues)=0,'issues',to_jsonb(issues),'revision',revision,
  'amount_cents',case when cardinality(issues)=0 then amount::text end,'paid_cents',case when cardinality(issues)=0 then paid::text end,'open_cents',case when cardinality(issues)=0 then (case when a.status='cancelled' then 0 else amount-paid end)::text end,'payment_count',payment_count);
end$$;
revoke all on function finance_private.employee_advance_position(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function finance_private.payroll_advance_payment_evidence(t uuid,advance uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare pos jsonb;fp jsonb;begin
 pos:=finance_private.employee_advance_position_full(t,advance);
 if pos->'verified' is distinct from 'true'::jsonb then raise exception 'finance_payroll_advance_source_review' using errcode='23514';end if;
 select coalesce(jsonb_agg(value order by value->>'payment_id',value->>'link_id'),'[]') into fp from jsonb_array_elements(pos->'footprints');
 return jsonb_build_object('version',1,'advance_id',advance,'employee_id',pos->'employee_id','driver_id',pos->'driver_id','payable_id',pos->'payable_id','amount_cents',pos->'amount_cents','paid_cents',pos->'paid_cents','footprints',fp);
end$$;
revoke all on function finance_private.payroll_advance_payment_evidence(uuid,uuid) from public,anon,authenticated,service_role;
